/**
 * 商品图视觉质检（VLM）。
 *
 * 为什么需要它 —— 这是对既有结论的一次修正：
 * `imageTrust.ts` 里那套「第三方图整体排除」的规则，是在**当时没有视觉模型可用**的前提下
 * 定出来的（见当时 `pickBrandSearchImage` 的注释：「中转站没有视觉模型可用，只能靠检索侧
 * 给的图片描述做倾向性排序」）。那套规则只能看域名、尺寸、长宽比 ——
 * 它没法知道图里究竟画了什么，于是只能一刀切。
 *
 * 2026-09-29 实测确认中转站的 `glm-5.3-flash` / `deepseek-v4.1-flash` **视觉完全可用**
 * （随机字符串图可读、2MB 大图也能进），于是「图里究竟画了什么」这个最关键的问题
 * 终于可以真正回答：
 * - 是干净的商品展示图，还是女人坐在飞机座椅上的生活场景图？
 * - 有没有媒体水印、站点标、二维码、促销角标（「限时直降」「国行正品」）？
 * - 画的是不是这次要的那款型号（不是就比无图更糟）？
 *
 * ⚠️ 实测踩过的坑（写死在这里，别回头）：
 * 判定请求的 `max_tokens` 必须给足。推理型模型先写一大段 `reasoning_content`，
 * 预算不够时 `content` 返回空串 + `finish_reason=length`，看起来像「模型没有视觉」，
 * 实际答案在 reasoning 里。512 会翻车，4096 正常。
 */

import type { LlmProvider } from './llmProviderTypes'
import { describeTransportError, withTransportRetry } from './transport'

/** 下载上限：实测 2.09MB base64 的整屏截图可以正常进模型（prompt_tokens=7037）。 */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

/**
 * 判定请求的输出预算。**不要调小** —— 推理型模型会把预算全花在 reasoning 上，
 * 结果 content 为空、看起来像判定失败。
 */
const JUDGE_MAX_TOKENS = 4096

/**
 * 单张图的**整体**判定预算（含下载与所有重试路径）。
 *
 * 🔴 `IMAGE_JUDGE_TIMEOUT_MS` 的口径是「一张图总共最多花多久」，不是「每次请求多久」。
 * 踩过：它以前被当成**单次请求**超时，而一张图有两条取图路径（base64 → 远程 URL），
 * 于是最坏是 20s × 2 = 40s。冷门品那一轮实测出现过单张 40.9s 的判定，
 * 一个 123s 的用例就是这么堆出来的（并行批次被最慢的那张拖住）。
 *
 * 为什么从 25s 收到 12s（2026-09-29，用户要求「速度一定要快点」）：
 * 同批候选是**并行**判定的，批次墙钟 = 最慢的那一张，所以单张上限直接决定批次上限。
 * 实测成功判定的耗时分布集中在 2.4~9.3s（占绝大多数），12s 以上只有零星几个；
 * 而失败的那几个会顶满上限 —— 也就是说上限值主要作用在**失败样本**上。
 *
 * 25s → 12s 的实测依据：设 25s 时日志里连续出现
 * `"judgeMs":25005, "note":"判定请求失败：This operation was aborted"`，
 * 单个用例的质检累计烧到 58.9s（`judgeCalls:6, judgeMs:58934`）——
 * 一个「判定失败」的样本把整批并行质检一起拖住 25s。收到 12s 后最坏批次减半还多。
 * 代价是丢掉极少数 12~25s 的慢成功，而这些位置现在有品牌标兜底（见 brandLogo.ts）。
 *
 * 拆分方式：第一条路径拿走「剩余预算 − 给兜底路径留的份额」，兜底路径再拿走剩下的。
 * 这样总时长被钉死在预算附近，正常成功的那次判定在第一条路径里就走完了。
 */
const DEFAULT_JUDGE_TIMEOUT_MS = 12_000

/** 给「远程 URL 兜底路径」预留的份额：实测它成功时只需 3~5s。 */
const FALLBACK_RESERVE_MS = 4_000

/** 任何一条路径至少要有这么久，否则不如直接判「不可用」早点返回。 */
const MIN_ATTEMPT_MS = 3_000

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

export type ImageRejectReason =
  | 'not_product_shot'
  | 'watermark'
  | 'wrong_model'
  | 'low_quality'
  | 'unavailable'
  | 'unparsed'

export interface ImageJudgeResult {
  /** 是否允许作为卡片封面。 */
  accept: boolean
  reason: 'ok' | ImageRejectReason
  /** 模型自述：是不是干净的商品展示图。 */
  productShot: boolean
  /** 模型自述：有没有水印 / 站标 / 二维码 / 促销角标。 */
  watermark: boolean
  /** 模型自述：画的是不是这次要的型号。 */
  matches: 'yes' | 'no' | 'unclear'
  /**
   * 模型自述：整张图**只有品牌标识/文字商标**，没有商品本体。
   *
   * 为什么要单独问这一项（2026-09-29）：品牌官网的 `og:image` 经常直接就是品牌标
   * （实测 `moondroplab.com` 的那张就是纯水月雨 logo）。这类图当商品封面当然不合格，
   * 但它**恰好是用户要的「官方标」**—— 与其丢掉再去 favicon 里凑合一个 32×32 的糊图，
   * 不如把它留作 logo 兜底：同一张图已经在质检里看过一次，识别出来是零额外成本。
   */
  isLogo: boolean
  /** 1~5，作为封面封面的可用程度。 */
  quality: number
  /** 模型给的一句话理由，仅用于日志与排查。 */
  note: string
  /** 判定耗时，便于量化视觉质检的代价。 */
  latencyMs: number
}

const REJECT_RESULT: ImageJudgeResult = {
  accept: false,
  reason: 'unavailable',
  productShot: false,
  watermark: false,
  matches: 'unclear',
  isLogo: false,
  quality: 0,
  note: '',
  latencyMs: 0,
}

/** 允许外部注入的判定上下文。 */
export interface ImageJudgeSubject {
  brand: string
  name: string
}

export interface ImageJudgeOptions {
  provider: LlmProvider
  timeoutMs?: number
  /** 非官方域名上的图：要求模型明确认出型号才放行（不允许靠「说不清」蒙混）。 */
  requireExplicitMatch?: boolean
  /**
   * 检索侧是否已有型号佐证（图片 URL 或它在检索结果里的描述命中了型号词元）。
   *
   * 为什么需要这个开关：第三方域要求 `matches=yes` 在冷门品牌上几乎必然失败 ——
   * 模型见到一张干干净净的「泰摩手摇磨豆机」产品图，也说不出这是不是 C3 ESP 这个子型号，
   * 于是回 `unclear`，图就被丢掉了。而实际上**第二个独立信号**已经能佐证它：
   * 这张图是从「泰摩 栗子 C3 ESP」的检索结果里出来的，URL/描述就带着型号。
   *
   * 所以口径改成「两个信号至少一个成立，且模型没有否认」：
   *   `matches === 'yes'`（模型认出来了）**或** `corroborated`（检索侧佐证）；
   * 但 `matches === 'no'` 永远否决 —— 模型明确说不是，就不赌。
   */
  corroborated?: boolean
}

function buildJudgePrompt(subject: ImageJudgeSubject) {
  return [
    '你是电商商品图的质检员。下面这张图是从网上找到的、准备用作商品卡片封面的候选图。',
    `目标商品：${subject.brand} ${subject.name}`,
    '',
    '请严格按你实际看到的画面判断，只输出下面这一个 JSON 对象，不要任何解释文字或 markdown 代码块：',
    '{',
    '  "product_shot": true/false,',
    '  "watermark": true/false,',
    '  "matches": "yes"/"no"/"unclear",',
    '  "is_logo": true/false,',
    '  "quality": 1-5,',
    '  "reason": "一句话说明"',
    '}',
    '',
    '字段口径（务必按这个来，判断错会让卡片上出现坏图）：',
    '- product_shot：只有「商品本体的干净展示图」才为 true。',
    '  生活场景图（人佩戴/使用、居家摆拍）、宣传海报、多图拼贴、开箱堆图、',
    '  纯 logo、参数表格、包装盒，全部算 false。',
    '- watermark：出现任何水印、媒体台标、站点 logo、二维码、',
    '  促销角标（如「限时直降」「国行正品」「XX数码城」）、覆盖画面的宣传文案，一律 true。',
    '- matches：图里的商品是否就是上面这个品牌型号。',
    '  是 → "yes"；明显是别的型号/别的品类 → "no"；看不清或不认识这个型号 → "unclear"。',
    '  图里没有任何商品（例如纯品牌标）时给 "unclear"。',
    '- is_logo：整张图**只有品牌标识/品牌文字商标**、没有出现商品本体时为 true。',
    '  这类图不能当商品封面（product_shot 应为 false），但会被单独留作品牌标兜底，',
    '  所以要如实回答，别把它混进 product_shot。',
    `- quality：作为卡片封面的可用程度 1~5。干净的白底产品图给 5；`,
    '  能看清商品但构图一般给 3；糊图、截图、信息图给 1~2。',
  ].join('\n')
}

function toDataUrl(buffer: Buffer, contentType: string) {
  const mime = /^image\/[a-z0-9.+-]+$/i.test(contentType) ? contentType.split(';')[0].trim() : 'image/jpeg'
  return `data:${mime};base64,${buffer.toString('base64')}`
}

/**
 * 取整张图（带上限），用来交给模型看。
 * 与 imageTrust 的 `fetchImageHead` 不同 —— 那个只要头部字节解析尺寸，
 * 这个必须拿到完整像素数据。
 */
async function fetchImageBytes(url: string, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8',
        'user-agent': UA,
      },
      signal: controller.signal,
      redirect: 'follow',
    })

    if (!response.ok || !response.body) {
      response.body?.cancel().catch(() => {})
      return null
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!/^image\//i.test(contentType)) {
      response.body.cancel().catch(() => {})
      return null
    }

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0

    try {
      while (received < MAX_IMAGE_BYTES) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        chunks.push(value)
        received += value.byteLength
      }
    } finally {
      reader.cancel().catch(() => {})
    }

    return { buffer: Buffer.concat(chunks), contentType }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function parseJudgeJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  const attempts = [cleaned]
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first >= 0 && last > first) {
    attempts.push(cleaned.slice(first, last + 1))
  }

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // 换下一种解析方式
    }
  }

  return null
}

function coerceMatches(value: unknown): 'yes' | 'no' | 'unclear' {
  const text = String(value ?? '').toLowerCase().trim()
  if (text === 'yes' || text === 'true') {
    return 'yes'
  }
  if (text === 'no' || text === 'false') {
    return 'no'
  }
  return 'unclear'
}

/**
 * 判定一张候选图能否上卡片。
 *
 * 不同来源的严格度不同（`requireExplicitMatch`）：
 * - **品牌官方域**：允许 `matches=unclear`（官方站的产品图常常没有型号字样，
 *   但域名已经保证了归属），只否决明确 `no`。
 * - **第三方域**：不再要求模型「必须认出」，而是要求「两个独立信号至少一个成立、
 *   且模型没有否认」—— 模型认出型号（`matches=yes`）或检索侧有型号佐证（`corroborated`）。
 *   原因见 `ImageJudgeOptions.corroborated`：单靠模型认型号会在冷门品牌上全军覆没。
 * - 无论哪种来源，`matches === 'no'` 一律否决：模型明确说不是这款，就不赌。
 */
/**
 * 下载图片自己的时间上限，与模型推理上限分开算。
 *
 * 踩过：两者共用一个 20s 时，一张 1600px 的图光下载就把预算耗光
 * （实测 `mycoffeestage.com` 那张报 "This operation was aborted"），
 * 然后还得再走一次远程 URL 重试 —— 一条路径的慢拖垮了整轮。
 * 分开后：下载最多 8s，模型推理仍有完整的 20s。
 */
const DOWNLOAD_TIMEOUT_MS = 8_000

export async function judgeProductImage(
  imageUrl: string,
  subject: ImageJudgeSubject,
  options: ImageJudgeOptions,
): Promise<ImageJudgeResult> {
  const startedAt = Date.now()
  const timeoutMs = options.timeoutMs ?? DEFAULT_JUDGE_TIMEOUT_MS
  // 整张图的硬截止时间：下载 + 所有取图路径都算在里面（见 DEFAULT_JUDGE_TIMEOUT_MS）。
  const deadline = startedAt + timeoutMs

  const fetched = await fetchImageBytes(imageUrl, Math.min(DOWNLOAD_TIMEOUT_MS, timeoutMs))

  const prompt = buildJudgePrompt(subject)

  /**
   * 我们能自己下载到 ⇒ 用 base64 交给模型（字节与内容类型都可控）。
   * 下载不到（CN 图床对机房/代理 IP 返 403 很常见）**不等于判不了** ——
   * 让中转站自己去取是完全不同的取图路径，很可能就通了，所以退化为远程 URL 再试。
   */
  const dataUrlPayload: Record<string, unknown> | null = fetched
    ? { type: 'image_url', image_url: { url: toDataUrl(fetched.buffer, fetched.contentType) } }
    : null

  const body = {
    model: options.provider.model,
    temperature: 0.1,
    // 🔴 不要调小：推理型模型会把预算全花在 reasoning_content 上，content 变空串。
    max_tokens: JUDGE_MAX_TOKENS,
    response_format: { type: 'json_object' },
  }

  const callOnce = async (imagePayload: Record<string, unknown>, budgetMs: number) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), budgetMs)

    try {
      const response = await fetch(`${options.provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.provider.apiKey}`,
          accept: 'application/json',
          // 中转站挂在 Cloudflare 后面，异常 UA 会直接 403（error code 1010）。
          'user-agent': UA,
        },
        body: JSON.stringify({ ...body, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, imagePayload] }] }),
        signal: controller.signal,
      })

      if (!response.ok) {
        // 把响应体也带出来：中转站的错误文案很泛（「模型请求失败，请稍后重试或更换模型」），
        // 不带 body 就只能看到「HTTP 400」，排查等于瞎猜。
        const detail = await response.text().catch(() => '')
        throw new Error(`视觉判定 HTTP ${response.status} ${detail.slice(0, 160).replace(/\s+/g, ' ')}`)
      }

      return (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  let payload: Awaited<ReturnType<typeof callOnce>>

  // 两条取图路径依次试：本地下载的 base64 → 让中转站按 URL 自取。
  // 第一条不通不代表判不了，而「判定不了 ⇒ 图片被丢弃」才是真的损失。
  //
  // 实测这条兜底路径真的救回过图：罗技 G920 那张（base64 走了 20s 超时，
  // 换成远程 URL 后 4s 就判完了）—— 所以不能因为「超时」就跳过它。
  const attempts: Array<{ label: string; payload: Record<string, unknown> }> = []

  if (dataUrlPayload) {
    attempts.push({ label: '视觉图片判定(base64)', payload: dataUrlPayload })
  }
  attempts.push({
    label: '视觉图片判定(URL)',
    payload: { type: 'image_url', image_url: { url: imageUrl } },
  })

  let lastError = ''
  let resolved: Awaited<ReturnType<typeof callOnce>> | null = null

  for (const [index, attempt] of attempts.entries()) {
    const remaining = deadline - Date.now()
    // 后面还有兜底路径时，先给它留出份额，剩下的才是这条路径能用的。
    const hasFallback = index < attempts.length - 1
    const budget = Math.max(MIN_ATTEMPT_MS, remaining - (hasFallback ? FALLBACK_RESERVE_MS : 0))

    try {
      // 重试要收敛：这段循环本来就会换两条取图路径各试一次，
      // 如果每条路径再按默认 3 次重试，最坏就是 6 次多模态请求，而单张图
      // 的时间预算只有 15s —— 重试反而会把预算烧光。所以只补 1 次、退避也短。
      resolved = await withTransportRetry(attempt.label, () => callOnce(attempt.payload, budget), {
        attempts: 2,
        backoffMs: [500],
      })
      break
    } catch (error) {
      lastError = describeTransportError(error)

      if (hasFallback) {
        console.warn(`[imageJudge] ${attempt.label} 失败，换下一条取图路径重试：${imageUrl} —— ${lastError}`)
      }
    }
  }

  if (!resolved) {
    return {
      ...REJECT_RESULT,
      reason: 'unavailable',
      note: `判定请求失败：${lastError}`,
      latencyMs: Date.now() - startedAt,
    }
  }

  payload = resolved

  const content = payload.choices?.[0]?.message?.content ?? ''
  const parsed = parseJudgeJson(content)

  if (!parsed) {
    return {
      ...REJECT_RESULT,
      reason: 'unparsed',
      note: `判定未返回可解析 JSON（长度=${content.length}）：${content.slice(0, 120)}`,
      latencyMs: Date.now() - startedAt,
    }
  }

  const productShot = parsed.product_shot === true
  const watermark = parsed.watermark === true
  const matches = coerceMatches(parsed.matches)
  const isLogo = parsed.is_logo === true
  const qualityRaw = Number(parsed.quality)
  const quality = Number.isFinite(qualityRaw) ? Math.min(5, Math.max(0, Math.round(qualityRaw))) : 0
  const note = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 160) : ''

  const base: ImageJudgeResult = {
    accept: false,
    reason: 'ok',
    productShot,
    watermark,
    matches,
    isLogo,
    quality,
    note,
    latencyMs: Date.now() - startedAt,
  }

  // 否决顺序按「后果严重程度」排：错型号最严重（比无图更糟），其次水印，再次场景图。
  if (matches === 'no') {
    return { ...base, reason: 'wrong_model' }
  }
  // 第三方域：模型与检索侧两个信号必须至少一个成立。
  if (options.requireExplicitMatch && matches !== 'yes' && !options.corroborated) {
    return { ...base, reason: 'wrong_model' }
  }
  if (watermark) {
    return { ...base, reason: 'watermark' }
  }
  if (!productShot) {
    return { ...base, reason: 'not_product_shot' }
  }
  if (quality < 3) {
    return { ...base, reason: 'low_quality' }
  }

  return { ...base, accept: true }
}

/**
 * 把判定结果压成一行日志。视觉质检是本项目里最贵的一步
 * （每张图一次多模态请求），不量化就无法判断值不值。
 */
export function formatJudgeAudit(imageUrl: string, result: ImageJudgeResult) {
  let host = ''
  try {
    host = new URL(imageUrl).hostname
  } catch {
    host = ''
  }

  return JSON.stringify({
    host,
    accept: result.accept,
    reason: result.reason,
    productShot: result.productShot,
    watermark: result.watermark,
    matches: result.matches,
    isLogo: result.isLogo,
    quality: result.quality,
    judgeMs: result.latencyMs,
    note: result.note,
  })
}
