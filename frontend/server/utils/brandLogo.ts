/**
 * 品牌官方 logo 兜底。
 *
 * 背景（2026-09-29 用户明确要求）：
 * 「官网图片弄不下来 url 咱们就把图片放一个官方标也可以啊，去找官方 logo 放上去」。
 *
 * 在此之前，找不到可用商品图的卡片只能显示一块「暂无可用商品图」的灰底文字 ——
 * 而冷门品牌（泰摩、山进、Tecsun）恰恰是最常见这种结果的，因为：
 * - 官网不给 `og:image`
 * - 官网图片虽然在，但我们的出口 IP 被返 403（实测 `来源页不可达（status=403）`）
 * - 第三方图又普遍带促销水印，视觉质检会正当地否掉
 * 这三条都不是"再努力一点"能解决的，所以不再死磕图，改为退回品牌标识。
 *
 * 为什么用「官方域名自己的 favicon」而不是第三方 logo 服务 —— 实测（2026-09-29）：
 * ```
 * https://www.nikon.com.cn/favicon.ico          200  image/x-icon   3.6KB  0.10s
 * https://www.casio.com.cn/favicon.ico          200  image/x-icon  152KB  0.28s
 * https://logo.clearbit.com/nikon.com           连接失败（服务已停）
 * https://icons.duckduckgo.com/ip3/nikon.com.cn.ico   404（认不出 .com.cn）
 * ```
 * 官方域 favicon **又快又是官方素材**，第三方服务要么死要么认不出中文域名。
 *
 * ⚠️ 延迟要求：这一级必须**与找商品图并行发起**（见 llmBuyer 的 logoPromise），
 * 只有等商品图链路全空时才 await。否则它就成了又一个「死磕」的环节。
 */

import { brandTokens, isBrandOfficialHost, registrableDomain, safeHostname } from './imageTrust'

/** 单次探测上限。实测命中只要 0.1~0.3s，2s 已经是很宽裕的失败上限。 */
const PROBE_TIMEOUT_MS = 2_000

/**
 * logo 至少要这么大才放得上卡片。
 *
 * ⚠️ 一开始用「文件体积 ≥ 2KB」当门槛，是错的：`timemore.cn/favicon.ico`
 * 只有 473 字节但可能是个正常的 32×32 图标，而某些 3KB 的 ICO 里面塞的是 16×16。
 * 体积与像素尺寸不成比例，所以直接读 ICO / PNG 头部里的**真实宽高**。
 * 卡片上按 ~56px 展示，32×32 放大后仍可用；16×16 就是一团糊，不如不放。
 */
const MIN_LOGO_SIDE = 32

/** 只读头部若干字节用于认魔数与读尺寸，别把 152KB 的 favicon 整个拉下来。 */
const PROBE_READ_BYTES = 4 * 1024

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/**
 * 优先 `apple-touch-icon.png`：它是移动端主屏图标，通常 180×180、方图、无小字，
 * 放大当品牌标正好。`favicon.ico` 次之（可能是 16×16）。
 */
const LOGO_PATHS = ['/apple-touch-icon.png', '/favicon.ico']

export interface BrandLogoResult {
  /** 可直接放进 `<img src>` 的地址。 */
  url: string
  /** 用哪个域名推出来的，便于排查。 */
  domain: string
}

type LogoFormat = 'png' | 'ico' | 'jpeg' | 'gif' | 'webp' | 'svg'

function detectFormat(head: Buffer): LogoFormat | null {
  if (head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return 'png'
  }
  if (head.length >= 4 && head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x01 && head[3] === 0x00) {
    return 'ico'
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'jpeg' // eslint-disable-line
  }
  if (head.length >= 4 && head.subarray(0, 4).toString('latin1') === 'GIF8') {
    return 'gif'
  }
  if (
    head.length >= 12 &&
    head.subarray(0, 4).toString('latin1') === 'RIFF' &&
    head.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp'
  }

  const text = head.subarray(0, 256).toString('utf8').trimStart().toLowerCase()
  if (text.startsWith('<svg') || text.startsWith('<?xml')) {
    return 'svg'
  }

  return null
}

/**
 * 读 ICO / PNG 头部里声明的像素尺寸。
 *
 * - ICO：文件头第 4~5 字节是**图像个数**，之后每 16 字节一个目录项，
 *   每项的 0/1 字节是宽高（0 表示 256）。
 *   🔴 必须**遍历所有目录项取最大**，不能只读第一个 —— 踩过：
 *   `www.nikon.com.cn/favicon.ico` 是 `16x16,32x32` 的双尺寸封装，
 *   只读第一个就判成 16×16，把尼康的官方标整个丢掉了。
 * - PNG：IHDR 紧跟 8 字节签名 + 4 字节长度 + 4 字节类型，宽高为大端 4 字节。
 *   （有意思的是 `logitechg.com/favicon.ico` 实际是 144×144 的 PNG，
 *   所以尺寸判断必须按**魔数**走，不能信文件名里的 `.ico`。）
 * - 其余格式（SVG 矢量、JPEG/GIF/WebP）不在这里判尺寸，交给体积下限兜。
 */
function readPixelSide(head: Buffer, format: LogoFormat): number | null {
  if (format === 'ico' && head.length >= 8) {
    const count = head.readUInt16LE(4)
    if (count === 0 || count > 64) {
      return null
    }

    let largest = 0
    for (let index = 0; index < count; index += 1) {
      const offset = 6 + index * 16
      if (offset + 1 >= head.length) {
        break
      }
      const width = head[offset] === 0 ? 256 : head[offset]
      const height = head[offset + 1] === 0 ? 256 : head[offset + 1]
      largest = Math.max(largest, Math.min(width, height))
    }

    return largest || null
  }

  if (format === 'png' && head.length >= 24) {
    const width = head.readUInt32BE(16)
    const height = head.readUInt32BE(20)
    if (width > 0 && height > 0) {
      return Math.min(width, height)
    }
  }

  return null
}

/** 探一个候选地址，通过则返回它的像素边长（越大越优先；未知尺寸返回 0）。 */
async function probeLogo(url: string): Promise<number | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      headers: { accept: 'image/*,*/*;q=0.8', 'user-agent': UA },
      signal: controller.signal,
      redirect: 'follow',
    })

    if (!response.ok || !response.body) {
      response.body?.cancel().catch(() => {})
      return null
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
    // 有些站点 favicon 用 `image/vnd.microsoft.icon`、有些干脆不带 content-type，
    // 所以 content-type 只用来**排除**明确的 HTML，最终以魔数为准。
    // 实测这个排除是必要的：`moondroplab.com/favicon.ico` 返回 200 + text/html 4118 字节
    // （一个伪装成 favicon 的 404 页面）。
    if (contentType.includes('text/html')) {
      response.body.cancel().catch(() => {})
      return null
    }

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0

    try {
      while (received < PROBE_READ_BYTES) {
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

    const head = Buffer.concat(chunks)
    const format = detectFormat(head)

    if (!format) {
      return null
    }

    const side = readPixelSide(head, format)
    if (side !== null) {
      return side >= MIN_LOGO_SIDE ? side : null
    }

    // 尺寸未知（SVG / JPEG / GIF / WebP）：用体积兜一个下限，挡掉明显的占位图。
    return received >= 1024 ? 0 : null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * 推候选域名。顺序即优先级：
 * 1. 已确定的官方域（官方域定向检索挖到的）；
 * 2. 官方候选页的主机（检索结果里判定为官方域的页面）；
 * 3. `source_url` 的域名 + 它的注册域 / `www.` 变体；
 * 4. 品牌词元推出来的域（`tecsun.com.cn` / `timemore.com` 这类）。
 *
 * 🔴 **只接受品牌官方域**，其余一律丢掉（2026-09-29 修正）。
 *
 * 踩过的坑：原来把 `source_url` 的主机无条件排在第 1 位，注释还写着「它已经过了
 * 官方域核验，是最可信的」—— **这句话在这里是错的**。logo 探测是在
 * `verifyProductSource` **之前**就并行发起的（为了零延迟），那一刻 `product.source_url`
 * 还是模型给的原始地址，经常是第三方页。结果实测拿到：
 * ```
 * 莱仕达 PXN  → https://smzdm.com/favicon.ico          ← 什么值得买的标
 * 北弧 E350   → https://www.jd.com/favicon.ico         ← 京东的标
 * 兴戈 EA500LM→ https://zhuanlan.zhihu.com/favicon.ico ← 知乎的标
 * ```
 * 用户要的是「官方 logo」，把第三方站点的标当商品封面会让人误以为有背书关系 ——
 * 这比没有图更糟。所以现在用 `isBrandOfficialHost` 过一道，探不到就老实返回 null，
 * 前端显示文字占位。
 *
 * 导出是为了让 `scripts/test-brand-logo.mjs` 能在**不联网**的情况下把这条规则钉住 ——
 * 这个 bug 的表现（探到别人的 favicon）在跑批结果里看起来完全像「成功」。
 */
export function candidateDomains(options: {
  sourceUrl?: string
  brand?: string
  officialDomain?: string
  extraHosts?: string[]
}) {
  const tokens = brandTokens(options.brand)
  const hosts = new Set<string>()

  const push = (host: string) => {
    if (!host || !host.includes('.')) {
      return
    }
    // 见上方说明：非官方域直接丢，不给它进候选的机会。
    if (!isBrandOfficialHost(host, tokens)) {
      return
    }
    hosts.add(host)

    const registrable = registrableDomain(host)
    if (registrable && registrable !== host && isBrandOfficialHost(registrable, tokens)) {
      hosts.add(registrable)
    }
    if (registrable && registrable.includes('.') && !registrable.startsWith('www.')) {
      const wwwVariant = `www.${registrable}`
      if (isBrandOfficialHost(wwwVariant, tokens)) {
        hosts.add(wwwVariant)
      }
    }
  }

  push(options.officialDomain ?? '')

  for (const host of options.extraHosts ?? []) {
    push(host)
  }

  push(safeHostname(options.sourceUrl))

  for (const token of tokens) {
    // 与检索侧推导官方域时同一套口径（.com/.cn/.com.cn），保持一致才不会两边打架。
    for (const tld of ['.com', '.cn', '.com.cn']) {
      push(`${token}${tld}`)
    }
  }

  return [...hosts].slice(0, 8)
}

/**
 * 找一个能用的品牌官方 logo。找不到就返回 null —— 调用方原样退化为「无图」，
 * 绝不能因为 logo 没找到而让整次定品失败。
 */
export async function resolveBrandLogo(options: {
  sourceUrl?: string
  brand?: string
  /** 已确定的官方域名（官方域定向检索挖到的），优先级最高。 */
  officialDomain?: string
  /** 额外的官方域候选主机（见 candidateDomains 的顺序说明）。 */
  extraHosts?: string[]
}): Promise<BrandLogoResult | null> {
  const domains = candidateDomains(options)

  if (!domains.length) {
    return null
  }

  // 全部并发探，取第一个成功的 —— 串行最坏是 6 域 × 2 路径 × 2s = 24s，不可接受。
  const probes = domains.flatMap((domain) =>
    LOGO_PATHS.map(async (path) => {
      const url = `https://${domain}${path}`
      const side = await probeLogo(url)
      return side === null ? null : { domain, url, side, preferApple: path === LOGO_PATHS[0] }
    }),
  )

  const results = (await Promise.all(probes)).filter((item): item is NonNullable<typeof item> => Boolean(item))

  if (!results.length) {
    return null
  }

  // 先按域名优先级（数组顺序天然带上来的），同域内优先 apple-touch-icon，再比像素。
  const domainOrder = new Map(domains.map((domain, index) => [domain, index]))
  results.sort((a, b) => {
    const byDomain = (domainOrder.get(a.domain) ?? 99) - (domainOrder.get(b.domain) ?? 99)
    if (byDomain !== 0) {
      return byDomain
    }
    if (a.preferApple !== b.preferApple) {
      return a.preferApple ? -1 : 1
    }
    return b.side - a.side
  })

  const best = results[0]
  return { url: best.url, domain: best.domain }
}

/** 压成一行日志。 */
export function formatLogoAudit(brand: string, result: BrandLogoResult | null) {
  return JSON.stringify({ brand, logo: result?.url ?? '', domain: result?.domain ?? '' })
}
