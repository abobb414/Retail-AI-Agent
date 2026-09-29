/**
 * 传输层重试。
 *
 * 背景：本项目所有出网调用（中转站 LLM、Tavily 检索、图片下载）都会偶发裸
 * `fetch failed` / `ECONNRESET`（Node undici 的通用错误）。不重试的代价很大：
 * - 定品阶段一次抖动 = 整条链路失败，用户直接看到 503
 * - 检索阶段一次抖动 = 白丢一路检索结果（表现为「图片突然没了」）
 *
 * ── 2026-09-29 实测：这**不是**某个站点的问题 ──────────────────────
 * 冷门产品用例跑到一半，同一分钟内 e-flowcode、api.tavily.com、图片站三个
 * 互不相干的主机**同时**报 `fetch failed`（16:52、16:58、17:05 各一波），
 * 说明抖动来自本机出网链路（沙箱/代理层）的成片抽风，而不是上游服务不稳。
 * 成片抖动可以持续十几秒 —— 原来「只重试一次 + 固定 800ms」扛不住，
 * 8 条用例里有 3 条因此整条失败。所以这里改成可退避的多次重试。
 *
 * ── 为什么要有「慢失败不重试」这条规则 ────────────────────────────
 * 瞬时抖动失败得都很快（DNS 抽风、连接被 reset：几十到几百毫秒就返回），
 * 而跑了很久才失败的多半是「这条链路本身不通」（连接超时、TLS 被拦）。
 * 后者重试只是把同一个超时再走一遍，白白烧掉用户的时间 —— 用户 2026-09-29
 * 明确要求「速度一定要快点」，所以宁可快速失败，也不做无意义的长重试。
 *
 * 超时（AbortError）是我们主动设的上限，同样必须排除 —— 重试只会多等一个完整超时。
 */

/** 默认：含首次共 3 次尝试。 */
const DEFAULT_ATTEMPTS = 3

/** 默认退避序列（毫秒）。用完之后一直沿用最后一个值。 */
const DEFAULT_BACKOFF_MS = [800, 1_600]

/**
 * 单次尝试已经花了这么久才失败，就不再重试了（理由见文件头）。
 * 5s 的取值依据：实测瞬时抖动的失败耗时在几十毫秒量级（见文件头的时间戳），
 * 5s 已是其百倍余量；而各调用方自己的超时（LLM 40s / Tavily 25s / 单图 15s）
 * 都远大于它，所以这条规则拦下的正是「长超时」那一类，不会误伤瞬时抖动。
 */
const DEFAULT_SLOW_ATTEMPT_MS = 5_000

export interface TransportRetryOptions {
  /** 含首次在内最多尝试几次。 */
  attempts?: number
  /** 每次重试前的等待毫秒数，按序取用。 */
  backoffMs?: number[]
  /** 单次尝试耗时超过它就不再重试。 */
  slowAttemptMs?: number
}

export function isRetryableTransportError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  // 我们主动设的上限，不是抖动。
  if (error.name === 'AbortError' || error.name === 'TimeoutError') {
    return false
  }

  const message = describeTransportError(error).toLowerCase()

  return (
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('econnaborted') ||
    message.includes('eai_again') ||
    message.includes('enotfound') ||
    message.includes('etimedout') ||
    message.includes('socket hang up') ||
    message.includes('other side closed') ||
    message.includes('und_err') ||
    message.includes('network')
  )
}

/**
 * 拼出「有诊断价值」的错误描述。
 *
 * 为什么不能只用 `error.message`：undici 把所有网络故障都压成一个字符串
 * `fetch failed`，真实原因藏在 `error.cause`/`AggregateError` 里。
 * 之前日志里清一色 `fetch failed`，根本分不清是 DNS、连接被拒还是 TLS 被拦，
 * 排查只能靠猜。这里把 cause 链逐层展开，顺带带上 errno/code。
 */
export function describeTransportError(error: unknown): string {
  const parts: string[] = []
  const seen = new Set<unknown>()

  let current: unknown = error
  while (current && !seen.has(current) && parts.length < 6) {
    seen.add(current)

    if (current instanceof Error) {
      parts.push(current.message)
      const code = (current as { code?: unknown }).code
      const errno = (current as { errno?: unknown }).errno
      if (typeof code === 'string' && code) {
        parts.push(code)
      }
      if (typeof errno === 'string' && errno) {
        parts.push(errno)
      }
      current = (current as { cause?: unknown }).cause
      continue
    }

    // AggregateError 的 errors 数组（并发连接同时失败时会走这里）
    const nested = (current as { errors?: unknown }).errors
    if (Array.isArray(nested) && nested.length > 0) {
      current = nested[0]
      continue
    }

    parts.push(String(current))
    break
  }

  return [...new Set(parts)].join(' / ') || '未知错误'
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 跑一次任务，遇到可重试的传输层失败就按退避序列重试。
 *
 * `label` 只用于日志，方便事后统计抖动频率。
 * 各调用方可以按自己的时间预算收窄重试（例如视觉质检单张图预算很小，
 * 就传 `{ attempts: 2, backoffMs: [500] }`，不要把它放大成三倍）。
 */
export async function withTransportRetry<T>(
  label: string,
  run: () => Promise<T>,
  options: TransportRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS)
  const backoffMs = options.backoffMs?.length ? options.backoffMs : DEFAULT_BACKOFF_MS
  const slowAttemptMs = options.slowAttemptMs ?? DEFAULT_SLOW_ATTEMPT_MS

  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const startedAt = Date.now()
    try {
      return await run()
    } catch (error) {
      lastError = error

      if (!isRetryableTransportError(error)) {
        throw error
      }

      const elapsed = Date.now() - startedAt
      const reason = describeTransportError(error)

      if (attempt >= attempts) {
        break
      }

      if (elapsed >= slowAttemptMs) {
        // 见文件头：慢失败 = 链路本身不通，重试只是把同一个超时再走一遍。
        console.warn(
          `[transport] ${label} 传输层失败但已耗时 ${elapsed}ms（≥${slowAttemptMs}ms），判定为链路不通，不再重试：${reason}`,
        )
        throw error
      }

      const wait = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)]
      console.warn(
        `[transport] ${label} 传输层失败（第 ${attempt}/${attempts} 次，耗时 ${elapsed}ms），${wait}ms 后重试：${reason}`,
      )
      await delay(wait)
    }
  }

  throw lastError
}
