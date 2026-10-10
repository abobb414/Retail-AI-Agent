/**
 * 商品来源页核验层（架构文档「方案 1」）。
 *
 * 为什么需要它：
 * - Tavily 的 `images` 是**跨结果混在一起的扁平 URL 列表**，不保证属于我们要的那款商品。
 *   让它去挑图，很容易挑到别家型号甚至站点 Logo —— 错图比无图更糟。
 * - 模型自己写的 `source_url` 也可能记错，点开是 404。
 *
 * 所以图片与来源链接一律以后端**实地回抓**为准：
 * 拿模型给的 source_url → 真去请求 → 页面可达吗？→ 抽出 og:image 作为商品图。
 * 抓不到就老实留空，前端走无图版式，绝不放一张来路不明的图。
 */

import { brandTokens, gateImage, isBrandOfficialHost, safeHostname } from './imageTrust'
import type { ImageJudgeResult } from './imageJudge'
import { isBlockedHost } from './netGuard'

/**
 * 商品图来自哪里。分成多级是为了能观测各级命中率 —— 之前只有「有图/无图」一个信号，
 * 看不出图到底是从官方来的还是从第三方来的。
 * - `og_image`：模型给的来源页上的 og:image（该页须为品牌官方域名）
 * - `brand_og`：检索结果里的品牌官方商品页上的 og:image
 * - `official_search`：限定官方域再检索一次拿到的官方 DAM 图
 * - `judged_search`：**第三方域**的图，靠视觉质检放行（2026-09-29 新增）
 * - `brand_image`：模型自己塞的图（已过闸）
 * - `none`：无图，前端走无图版式
 */
export type ImageFrom =
  | 'og_image'
  | 'brand_og'
  | 'official_search'
  | 'judged_search'
  | 'brand_image'
  /** 品牌官方标兜底（找不到商品图时的最后一招，见 brandLogo.ts）。 */
  | 'brand_logo'
  | 'none'

/**
 * 视觉质检回调。由 llmBuyer 注入（它才知道当前 provider、商品信息与检索上下文），
 * sourcePage 只负责「按顺序试哪几级」，不关心判定是怎么做的。
 * 两个开关的语义见 imageJudge.judgeProductImage / ImageJudgeOptions。
 */
export type ImageJudgeRequest = { requireExplicitMatch: boolean; corroborated?: boolean }
export type ImageJudgeFn = (url: string, request: ImageJudgeRequest) => Promise<ImageJudgeResult>

export interface SourceVerifyOptions {
  /** 商品品牌，用来判定域名是否官方。 */
  brand?: string
  /** 检索结果里命中品牌官方域名的候选商品页，按优先级排好。 */
  candidatePages?: string[]
  timeoutMs?: number
  /** 有视觉质检时，官方图也要真的看一眼再上卡片（官方自己的营销拼图只有视觉能识别）。 */
  judgeImage?: ImageJudgeFn
}

export interface SourceVerifyResult {
  sourceUrl: string
  imageUrl: string
  verified: boolean
  imageFrom: ImageFrom
  /** 被丢掉的原因，仅用于日志排查。 */
  notes: string[]
}

/** 最多额外探测几个官方候选页，控制新增耗时。 */
const MAX_CANDIDATE_PAGES = 2

export interface SourcePageProbe {
  /** 页面最终是否可达（2xx）。 */
  reachable: boolean
  /** HTTP 状态码，网络层失败时为 0。 */
  status: number
  /** 跟随重定向后的最终地址。 */
  finalUrl: string
  /** 页面里抽到的商品图（og:image / twitter:image 等），抽不到为空串。 */
  imageUrl: string
  /** 页面标题，可作为商品名兜底校对。 */
  title: string
}

const PROBE_TIMEOUT_MS = 8_000
/** 只读前 512KB 找 meta 标签：商品页正文体积大，没有全量下载的必要。 */
const MAX_HTML_BYTES = 512 * 1024
const MAX_REDIRECTS = 3

/** SSRF 守卫见 netGuard.ts（与 api/image.get.ts 共用）。 */

function isFetchableUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw.trim())
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null
    }
    if (isBlockedHost(parsed.hostname)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

const PAGE_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/**
 * 按上限读取响应体，避免被超大页面拖住。
 * 注意不能直接用 response.text()：它会读完整个 body。
 */
async function readBodyWithLimit(response: Response, limit: number) {
  if (!response.body) {
    return ''
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let received = 0
  let html = ''

  try {
    while (received < limit) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      received += value.byteLength
      html += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.cancel().catch(() => {})
  }

  return html + decoder.decode()
}

/** 手工跟随重定向：每一跳都要重新过 SSRF 检查，不能直接交给 fetch 自动跳。 */
async function fetchPage(initialUrl: URL, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let currentUrl = initialUrl

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await fetch(currentUrl, {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'user-agent': PAGE_UA,
        },
        redirect: 'manual',
        signal: controller.signal,
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        const nextUrl = location ? isFetchableUrl(new URL(location, currentUrl).toString()) : null
        if (!nextUrl) {
          return { response: null, finalUrl: currentUrl, status: response.status }
        }
        currentUrl = nextUrl
        continue
      }

      return { response, finalUrl: currentUrl, status: response.status }
    }

    return { response: null, finalUrl: currentUrl, status: 0 }
  } finally {
    clearTimeout(timeout)
  }
}

function decodeHtmlEntities(text: string) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/**
 * 抽出所有 <meta> / <link rel=image_src>，按属性名建索引。
 * 正则足够：我们只要几个已知字段，不需要完整 HTML 解析器。
 */
function collectMetaTags(html: string) {
  const bag = new Map<string, string>()

  const metaRegex = /<meta\b[^>]*>/gi
  for (const tag of html.match(metaRegex) ?? []) {
    const key =
      /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase().trim() ?? ''
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? ''
    if (key && content && !bag.has(key)) {
      bag.set(key, content)
    }
  }

  const linkRegex = /<link\b[^>]*>/gi
  for (const tag of html.match(linkRegex) ?? []) {
    if (!/\brel\s*=\s*["']image_src["']/i.test(tag)) {
      continue
    }
    const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? ''
    if (href && !bag.has('image_src')) {
      bag.set('image_src', href)
    }
  }

  return bag
}

/** 优先级：secure_url > og:image > twitter:image > image_src。 */
function pickImageFromMeta(bag: Map<string, string>, baseUrl: URL) {
  const candidates = [
    bag.get('og:image:secure_url'),
    bag.get('og:image:url'),
    bag.get('og:image'),
    bag.get('twitter:image'),
    bag.get('twitter:image:src'),
    bag.get('image_src'),
  ]

  for (const raw of candidates) {
    if (!raw) {
      continue
    }
    const decoded = decodeHtmlEntities(raw)
    // og:image 允许写相对路径，按最终页面地址解析。
    try {
      const resolved = new URL(decoded, baseUrl)
      if (['http:', 'https:'].includes(resolved.protocol)) {
        return resolved.toString()
      }
    } catch {
      // 换下一个候选
    }
  }

  return ''
}

/**
 * 核验一个来源页并抽出商品图。
 * 任何网络层问题都返回 reachable=false，由调用方决定怎么处理，不抛错。
 */
export async function probeSourcePage(rawUrl: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<SourcePageProbe> {
  const initialUrl = isFetchableUrl(rawUrl)

  if (!initialUrl) {
    return { reachable: false, status: 0, finalUrl: '', imageUrl: '', title: '' }
  }

  try {
    const { response, finalUrl, status } = await fetchPage(initialUrl, timeoutMs)

    if (!response || !response.ok) {
      return { reachable: false, status, finalUrl: finalUrl.toString(), imageUrl: '', title: '' }
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!/text\/html|application\/xhtml/i.test(contentType)) {
      // 可达但不是网页（常见于直接指向图片或 PDF），保留链接、不取图。
      response.body?.cancel().catch(() => {})
      return { reachable: true, status, finalUrl: finalUrl.toString(), imageUrl: '', title: '' }
    }

    const html = await readBodyWithLimit(response, MAX_HTML_BYTES)
    const bag = collectMetaTags(html)

    return {
      reachable: true,
      status,
      finalUrl: finalUrl.toString(),
      imageUrl: pickImageFromMeta(bag, finalUrl),
      title: decodeHtmlEntities(bag.get('og:title') || bag.get('twitter:title') || '').slice(0, 120),
    }
  } catch {
    return { reachable: false, status: 0, finalUrl: '', imageUrl: '', title: '' }
  }
}

function isHttpUrl(raw: string | undefined): raw is string {
  return Boolean(raw && /^https?:\/\//i.test(raw))
}

/**
 * 给商品图与来源链接做一次实地核验。
 *
 * 规则（架构文档「方案 1」+ 图片质量闸门）：
 * 1. 模型给的来源页：可达才保留链接；页面上的 og:image **只在该页属于品牌官方域名时**才采用
 *    —— 实测第三方页面（什么值得买社区帖）的 og:image 是带二维码水印的随手拍。
 * 2. 模型没给出图：改用「检索结果里命中品牌官方域名」的页面，回抓它的 og:image。
 *    这一级同时能把 source_url 修正成官方页（前端按钮写的是「查看官网」，指第三方帖就名不副实）。
 * 3. 其余一律留空，让前端走无图版式。
 *
 * 所有候选图都要过 imageTrust 的三道闸（品牌域名 / 可达且是图 / 尺寸长宽比）。
 */
export async function verifyProductSource(
  sourceUrl: string | undefined,
  fallbackImage: string | undefined,
  options: SourceVerifyOptions = {},
): Promise<SourceVerifyResult> {
  const tokens = brandTokens(options.brand)
  const notes: string[] = []
  const result: SourceVerifyResult = { sourceUrl: '', imageUrl: '', verified: false, imageFrom: 'none', notes }

  /**
   * 官方域上的图：过基础闸后再让视觉模型真看一眼。
   *
   * 为什么官方图也要看：闸门只能保「官方 + 可达 + 尺寸合适」，拦不住**官方自己的营销拼图**。
   * 实测拿到过一张 1919×1591 的图 —— 女人坐在飞机座椅上 + App 界面截图 + 耳机组图，
   * 尺寸长宽比全部合格，当卡片封面却很难看。以前识别不了，现在能了。
   *
   * `requireExplicitMatch=false`：官方域已给归属背书，官方产品图常常不带型号字样，
   * 要求模型明确认出型号会误杀。只否决它明确说 `no` 的情况。
   */
  const acceptOfficialImage = async (url: string, from: ImageFrom, label: string) => {
    const gate = await gateImage(url, tokens)

    if (!gate.ok) {
      notes.push(`${label}未过闸：${gate.reason}（${gate.width}×${gate.height}）`)
      return false
    }

    if (!options.judgeImage) {
      result.imageUrl = url
      result.imageFrom = from
      return true
    }

    const verdict = await options.judgeImage(url, { requireExplicitMatch: false })

    if (!verdict.accept) {
      notes.push(`${label}视觉质检未通过：${verdict.reason}（${verdict.note || '无说明'}）`)
      return false
    }

    notes.push(`${label}视觉质检通过：quality=${verdict.quality} matches=${verdict.matches}`)
    result.imageUrl = url
    result.imageFrom = from
    return true
  }

  /**
   * 页面探测**全部并发发起**。
   *
   * 踩过：三级探测（模型给的来源页 + 最多 2 个官方候选页）原来是串行的，
   * 每次 8s 超时 ⇒ 最坏 24s 只花在「探页面」上。实测确实出现过 `probeMs: 21945`
   * —— 官方站对机房 IP 返 403/超时是常态，串行等于把三次失败叠加起来等。
   *
   * 三者之间没有依赖（来源页决定商品图，候选页决定官方链接与 og:image），
   * 并发后最坏只等于最慢的那一次（8s），与「按优先级处理」的语义不冲突：
   * 下面仍然按级别顺序消费结果。
   */
  const sourceProbePromise = isHttpUrl(sourceUrl)
    ? probeSourcePage(sourceUrl, options.timeoutMs).catch(() => null)
    : Promise.resolve(null)

  const candidates = (options.candidatePages ?? [])
    .filter(isHttpUrl)
    .filter((url) => isBrandOfficialHost(safeHostname(url), tokens))
    .slice(0, MAX_CANDIDATE_PAGES)

  const candidateProbePromises = candidates.map((url) =>
    probeSourcePage(url, options.timeoutMs).catch(() => null),
  )

  // ── 第一级：模型给的来源页 ─────────────────────────────────────
  const sourceProbe = await sourceProbePromise

  if (sourceProbe && isHttpUrl(sourceUrl)) {
    const probe = sourceProbe

    if (probe.reachable) {
      const pageUrl = probe.finalUrl || sourceUrl
      const official = isBrandOfficialHost(safeHostname(pageUrl), tokens)
      result.verified = true

      if (probe.imageUrl) {
        if (!official) {
          notes.push(`来源页非品牌官方（${safeHostname(pageUrl)}），其 og:image 不可信，丢弃`)
        } else {
          await acceptOfficialImage(probe.imageUrl, 'og_image', '来源页 og:image ')
        }
      }

      // 🔴 链接**永远保留**（2026-09-29 用户明确要求：「最后跳转到官方按钮你也得给我保留啊，别去掉」）。
      //
      // 这里原来写的是 `redirected && !probe.imageUrl ? '' : pageUrl` ——
      // 被重定向且没拿到 og:image 时就把 sourceUrl 清空。后果是卡片底部的
      // 「查看官网」按钮整块消失（前端是 `v-if="recommendation.source_url"`）。
      //
      // 当初清空的顾虑是「被甩走的链接往往已经不是那款商品了」（见下面注释的
      // sonystyle 例子），这个顾虑本身是对的，**但清空是错误的处置**：
      // ① 用户要的是「能不能去看一眼官方」，不是「链接是否精确指向那一款」；
      // ② 实测大量链接被判成不可达只是**我们自己出口 IP 被拒**（日志里
      //    `来源页不可达（status=403/0）` 反复出现），站点对用户其实是好的 ——
      //    拿我们的探测失败去删用户的入口，是把自己的问题算在站点头上。
      // 所以改成：只要 URL 语法上是 http(s) 就留着，重定向则记进 notes 供排查。
      const redirected = pageUrl.replace(/\/$/, '') !== sourceUrl.replace(/\/$/, '')
      if (redirected) {
        notes.push(`来源页被重定向到 ${pageUrl}，链接保留（不再因为「可能不是那一款」而清空）`)
      }
      result.sourceUrl = pageUrl
    } else {
      // 探测失败同样保留链接，理由同上：多半是我们访问不了，不是链接坏了。
      notes.push(`来源页不可达（status=${probe.status}），图丢弃但链接保留`)
      result.sourceUrl = sourceUrl
    }
  }

  // ── 第二级：品牌官方候选页（来自检索结果）─────────────────────
  // 探测请求已在上面并发发起（见 candidateProbePromises 的说明），
  // 这里只按优先级消费结果。
  //
  // 官方候选页只要可达就算数 —— 即便它没给我们可用的 og:image，
  // 这个地址本身也比第三方帖更适合挂在「查看官网」按钮上。
  let officialPageUrl = ''

  /**
   * 兜底链接：官方域候选页里**第一个**（不管我们探不探得动）。
   *
   * 为什么要留这个：`officialPageUrl` 只在探测可达时才赋值，而实测我们的出口
   * 被官方站返 403/超时是常态（ergotron.com、uniqlo.com 两个用例整轮都探不通）。
   * 结果是模型给的 source_url 被清空、候选页也补不上 —— 卡片底部的按钮直接消失。
   * 站点对用户是好的，只是我们访问不了，所以把它留作链接来源。
   */
  const firstOfficialCandidate = candidates[0] ?? ''

  for (const [index, candidateUrl] of candidates.entries()) {
    if (result.imageUrl && officialPageUrl) {
      break
    }

    const probe = await candidateProbePromises[index]

    if (!probe || !probe.reachable) {
      notes.push(`官方候选页不可达：${safeHostname(candidateUrl)}（仍作为链接兜底）`)
      continue
    }

    officialPageUrl ||= probe.finalUrl || candidateUrl

    if (result.imageUrl) {
      continue
    }

    if (!probe.imageUrl) {
      notes.push(`官方候选页无 og:image：${safeHostname(candidateUrl)}`)
      continue
    }

    await acceptOfficialImage(probe.imageUrl, 'brand_og', `官方候选页 og:image（${safeHostname(candidateUrl)}）`)
  }

  if (officialPageUrl && !isBrandOfficialHost(safeHostname(result.sourceUrl), tokens)) {
    result.sourceUrl = officialPageUrl
    result.verified = true
  }

  // 到这儿链接还是空的，就用官方域候选页兜 —— 前端「查看官网」按钮靠它活着。
  if (!result.sourceUrl && firstOfficialCandidate) {
    result.sourceUrl = firstOfficialCandidate
    notes.push(`模型未给出可用来源，链接兜底为官方域候选页：${safeHostname(firstOfficialCandidate)}`)
  }

  // ── 第三级：模型当年自己塞的图 ────────────────────────────────
  // 提示词已要求它留空，但旧版模型仍可能给。分两种情况：
  // - 品牌官方域：过闸即用（老规则）。
  // - 第三方域：**只有视觉质检明确认出同款才放行**（新规则，2026-09-29 起）。
  //   没有视觉质检时仍然一律拒绝 —— 第三方图系统性带水印，这个结论没变。
  if (!result.imageUrl && isHttpUrl(fallbackImage)) {
    const brandHost = isBrandOfficialHost(safeHostname(fallbackImage), tokens)
    const gate = await gateImage(fallbackImage, tokens, undefined, { requireBrandHost: brandHost })

    if (!gate.ok) {
      notes.push(`模型自带的图未过闸：${gate.reason}（${safeHostname(fallbackImage)}）`)
    } else if (!options.judgeImage) {
      if (brandHost) {
        result.imageUrl = fallbackImage
        result.imageFrom = 'brand_image'
      } else {
        notes.push(`模型自带的图在第三方域（${safeHostname(fallbackImage)}），无视觉质检时不作数`)
      }
    } else {
      // 这一级没有检索上下文可佐证（模型是凭空塞的图），所以第三方域不给 corroborated：
      // 模型必须自己认出来才放行。
      const verdict = await options.judgeImage(fallbackImage, { requireExplicitMatch: !brandHost })

      if (verdict.accept) {
        result.imageUrl = fallbackImage
        result.imageFrom = brandHost ? 'brand_image' : 'judged_search'
        notes.push(`模型自带的图视觉质检通过：quality=${verdict.quality} matches=${verdict.matches}`)
      } else {
        notes.push(`模型自带的图视觉质检未通过：${verdict.reason}（${verdict.note || '无说明'}）`)
      }
    }
  }

  return result
}
