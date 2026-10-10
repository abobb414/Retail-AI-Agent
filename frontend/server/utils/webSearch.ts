/**
 * 联网检索层：给大模型「装」一个搜索工具。
 *
 * 背景（实测得出，别走回头路）：
 * - 本项目走的是第三方 OpenAI 兼容中转站（e-flowcode.cc）。该站**不转发**任何
 *   模型内置搜索能力：`web_search: true`（智谱 body 级）、`enable_search: true`
 *   （百炼风格）、`tools: [{ type: 'web_search' }]` 三种写法全部无效或被忽略。
 * - 但该站**完整支持标准 function calling**（`tools` + `tool_calls` + `role: 'tool'`
 *   回填，多轮闭环可用）。
 * ⇒ 所以「让模型联网」只能靠自己实现：模型决定搜什么，我们代它去搜。
 *
 * 数据源选型：免密钥的公开搜索端点（DuckDuckGo / Bing RSS / 百度 / 搜狗 /
 * 公共 SearXNG）在 2026 年已全部被反爬封死，必须用注册型搜索 API。
 * 当前接入 Tavily：免费 1000 credits/月，返回结构化 title/url/content，
 * 且支持 include_images（可顺带解决商品配图）。
 */

import { describeTransportError, withTransportRetry } from './transport'

export interface WebSearchHit {
  title: string
  url: string
  content: string
  score?: number
}
/**
 * 带描述的图片。
 *
 * 踩坑：`include_image_descriptions` 的开关会**改变返回类型** ——
 * 关掉时 `images` 是纯 URL 字符串数组，打开时是 `{ url, description }` 对象数组。
 * 两种都要能吃（中转/版本差异），且打开描述是值得的：描述里常直接点名型号
 * （实测「A pair of Sony WH-1000XM4 wireless headphones…」），能用来核对图片
 * 是不是我们要的那一款 —— 光看 URL 完全无从判断。
 */
export interface SearchImage {
  url: string
  description: string
}

export interface WebSearchOutcome {
  hits: WebSearchHit[]
  images: SearchImage[]
  provider: string
  latencyMs: number
}

/**
 * 单次搜索请求上限。
 *
 * 🔴 不要按「搜索很快」的直觉去调小。2026-09-29 实测（同一个 key、同一条链路）：
 * ```
 * 手摇磨豆机 500元以内 手冲推荐   12.57s
 * 卡西欧 G-SHOCK DW-5600 参数    15.02s
 * 泰摩 C3 ESP 官方售价            4.30s
 * ```
 * 带 `include_images` + `include_image_descriptions` 时 Tavily 要现抓图片元数据，
 * 12s 落在分布中间 —— 原来写 12s 时，冷门品那一轮 8 个用例里有 5 条检索被
 * 自己掐断（日志表现为 `联网检索失败：This operation was aborted`，
 * 时长恰好 12003ms）。而超时是 AbortError，`withTransportRetry` 不重试，
 * 等于白等 12s 还搭上一路检索结果 —— 候选图直接从 15 张掉到 5 张。
 * 宁可多等几秒拿到结果，也不要稳定地丢结果。
 */
const SEARCH_TIMEOUT_MS = 25_000
const MAX_HITS_PER_QUERY = 5

/**
 * 搜索链路的进程内熔断。
 *
 * ── 为什么需要它（2026-10-02 在 Vercel 上实测）──────────────────────
 * 从部署区域 hkg1 连 `api.tavily.com:443` 会**连接超时**，而 undici 的
 * connect timeout 是写死的 10s，日志形态：
 * ```
 * [transport] tavily:xxx 传输层失败但已耗时 10455ms（≥5000ms），判定为链路不通，不再重试：
 *   fetch failed / Connect Timeout Error (attempted address: api.tavily.com:443, timeout: 10000ms) / UND_ERR_CONNECT_TIMEOUT
 * ```
 * 8 次请求里出现了 7 次 —— 也就是几乎每个请求都白等 10s。这 10s 买不到任何东西：
 * 连接都建不起来，说明是链路不通，不是上游在思考，重复尝试不可能变好。
 *
 * 所以这里做一层「一次不通就歇一会儿」的熔断：省下的不只是 10s，
 * 还有用户在静默的 SSE 连接上多暴露的那 10s（见 chat.post.ts 的心跳注释）。
 * 熔断期间 `searchWeb` 直接快速失败，调用方本来就把检索失败当「降级到凭模型知识定品」处理。
 */
const SEARCH_BREAKER_COOLDOWN_MS = Number(process.env.SEARCH_BREAKER_COOLDOWN_MS || 60_000)
let searchDownUntil = 0

/** 连接级失败 = 连都没连上，属于链路不通而不是上游忙。 */
function isConnectLevelFailure(error: unknown) {
  const message = describeTransportError(error).toLowerCase()

  return (
    message.includes('connect timeout') ||
    message.includes('und_err_connect_timeout') ||
    message.includes('etimedout') ||
    message.includes('ehostunreach') ||
    message.includes('enetunreach')
  )
}

function noteSearchDown(reason: string) {
  searchDownUntil = Date.now() + SEARCH_BREAKER_COOLDOWN_MS
  console.warn(
    `[search] 搜索链路判定不通，${Math.round(SEARCH_BREAKER_COOLDOWN_MS / 1000)}s 内不再尝试（避免每次白等 10s 连接超时）：${reason}`,
  )
}

/**
 * 搜索链路当前是否被判定为不通。
 *
 * 调用方用它**跳过整个侦察阶段**：检索已经证明不可达时，连「让模型决定搜什么」
 * 那一轮大模型调用（实测 2~8s）也是白花的 —— 工具调出来也搜不到东西。
 * 跳过之后模型退回「凭自身知识定品」，这正是没配搜索源时的既有路径。
 */
export function isSearchLinkDown() {
  return Date.now() < searchDownUntil
}

/**
 * 中文站点优先，减少英文站噪声；Tavily 对这条参数是软过滤。
 * 踩坑：这里必须写**国家全名**的小写形式，写 ISO 码（zh / CN）会直接 400
 * `Invalid country. Must be a valid country name from the list of supported countries`，
 * 且因为检索整体是「失败不阻断」的，这个 400 会静默吃掉所有检索结果。
 */
const PREFERRED_COUNTRY = 'china'

interface SearchProvider {
  label: string
  apiKey: string
}

function resolveSearchProviders(config: ReturnType<typeof useRuntimeConfig>): SearchProvider[] {
  const providers: SearchProvider[] = []

  if (config.tavilyApiKey) {
    providers.push({ label: 'tavily', apiKey: config.tavilyApiKey })
  }

  return providers
}

export function hasSearchProvider(config: ReturnType<typeof useRuntimeConfig>) {
  return resolveSearchProviders(config).length > 0
}

export function getSearchProviderLabel(config: ReturnType<typeof useRuntimeConfig>) {
  return resolveSearchProviders(config)[0]?.label ?? ''
}

function normalizeHit(raw: unknown): WebSearchHit | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const source = raw as Record<string, unknown>
  const url = typeof source.url === 'string' ? source.url.trim() : ''
  const title = typeof source.title === 'string' ? source.title.trim() : ''

  if (!url || !/^https?:\/\//i.test(url)) {
    return null
  }

  return {
    title: title || url,
    url,
    content: typeof source.content === 'string' ? source.content.trim() : '',
    score: typeof source.score === 'number' ? source.score : undefined,
  }
}

/** 兼容 images 的两种形态：纯 URL 字符串 / 带描述对象。 */
function normalizeSearchImage(raw: unknown): SearchImage | null {
  if (typeof raw === 'string') {
    return /^https?:\/\//i.test(raw) ? { url: raw, description: '' } : null
  }

  if (!raw || typeof raw !== 'object') {
    return null
  }

  const source = raw as Record<string, unknown>
  const url = typeof source.url === 'string' ? source.url.trim() : ''

  if (!/^https?:\/\//i.test(url)) {
    return null
  }

  return {
    url,
    description: typeof source.description === 'string' ? source.description.trim() : '',
  }
}

async function searchWithTavily(
  apiKey: string,
  query: string,
  timeoutMs: number,
  includeDomains: string[] = [],
): Promise<WebSearchOutcome> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
        // 与 LLM 调用同理：异常 UA 容易被 CDN 层的风控直接掐断。
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      },
      body: JSON.stringify({
        query,
        max_results: MAX_HITS_PER_QUERY,
        search_depth: 'basic',
        topic: 'general',
        include_answer: false,
        include_raw_content: false,
        include_images: true,
        include_image_descriptions: true,
        country: PREFERRED_COUNTRY,
        // 限定域检索。实测这是**唯一能稳定拿到品牌官方商品图**的路子：
        // 中国索尼官方站（sonystyle.com.cn / sony.com.cn）整站没有 og:image，
        // 常规检索的 images 又几乎全是第三方促销图/水印图；而限定在官方域内检索，
        // 返回的图就落在官方 DAM 上（实测 1920×1786 的标准产品图）。
        ...(includeDomains.length ? { include_domains: includeDomains } : {}),
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Tavily 返回 HTTP ${response.status}${detail ? `：${detail.slice(0, 160)}` : ''}`)
    }

    const data = (await response.json()) as {
      results?: unknown[]
      images?: unknown[]
    }

    return {
      hits: (data.results ?? []).map(normalizeHit).filter((hit): hit is WebSearchHit => Boolean(hit)),
      images: (data.images ?? [])
        .map(normalizeSearchImage)
        .filter((image): image is SearchImage => Boolean(image)),
      provider: 'tavily',
      latencyMs: Date.now() - startedAt,
    }
  } finally {
    clearTimeout(timeout)
  }
}

/** 检索可调项。 */
export interface SearchOptions {
  /** 限定检索域（Tavily `include_domains`）。用于「只在品牌官方站里找商品图」。 */
  includeDomains?: string[]
}

/**
 * 执行一次联网检索。
 * 全部 provider 失败时抛错，由调用方决定是放弃检索还是降级到「凭模型知识定品」。
 */
export async function searchWeb(
  config: ReturnType<typeof useRuntimeConfig>,
  query: string,
  options: SearchOptions = {},
  timeoutMs = SEARCH_TIMEOUT_MS,
): Promise<WebSearchOutcome> {
  const trimmed = query.trim()

  if (!trimmed) {
    throw new Error('搜索关键词为空')
  }

  const providers = resolveSearchProviders(config)

  if (providers.length === 0) {
    throw new Error('未配置搜索数据源（TAVILY_API_KEY）')
  }

  // 熔断期内直接快速失败：检索是「可有可无」的一路，不该让用户陪着等一个
  // 已经证明不通的连接超时（见 SEARCH_BREAKER_COOLDOWN_MS）。
  const downForMs = searchDownUntil - Date.now()

  if (downForMs > 0) {
    throw new Error(`搜索链路熔断中（还有 ${Math.ceil(downForMs / 1000)}s 恢复），本轮跳过检索`)
  }

  const errors: string[] = []

  for (const provider of providers) {
    try {
      if (provider.label === 'tavily') {
        // 包一层传输层重试：一次 fetch failed 就等于白丢一路检索结果，
        // 表现为「这一轮突然没图了」，很难归因。
        return await withTransportRetry(`tavily:${trimmed.slice(0, 24)}`, () =>
          searchWithTavily(provider.apiKey, trimmed, timeoutMs, options.includeDomains ?? []),
        )
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))

      if (provider.label === 'tavily' && isConnectLevelFailure(error)) {
        noteSearchDown(describeTransportError(error))
      }
    }
  }

  throw new Error(`联网检索失败：${errors.join('；')}`)
}
