/**
 * 商品图质量闸门。
 *
 * 为什么不能「挑一张第三方图凑合」（实测证据，别回头）：
 * 把候选域名逐个下载下来肉眼看过，第三方图片的问题不是偶发水印，而是**系统性不可用**：
 * - `g-search1.alicdn.com` 整张是「XX数码城 + 限时直降」促销图，连商品都认不出
 * - `gw.alicdn.com`「国行正品 全国联保」促销版式
 * - `img12.360buyimg.com`「无声 更有声」营销海报（同一站点的 `img10` 又是干净产品图，
 *   即同一域名内质量参差，无法靠域名区分）
 * - `k.sinaimg.cn` 干净产品图，但右下角压着媒体水印
 * - `qnam.smzdm.com`「【耳边评测】脱胎换骨」大字 + 站标水印
 * - `img.alicdn.com` 甚至有扫描线伪影，挂上去就是坏图
 *
 * ⇒ 结论：第三方图不能靠「挑」，只能**整体排除**。图片只允许来自与品牌匹配的官方域名。
 *
 * 另外「干净」还不够，还得是**能上卡片的商品图**。官方站自己的图里也见过：
 * - `www.sony.com.cn` 的 og:image 是 534×187 的小横幅
 * - `www.sonystyle.com.cn` 的 og:image 是满屏中文文案的 XM3/XM4 对比宣传图
 * ⇒ 所以还要过「可达 + 尺寸 + 长宽比」这三关。
 */

/** 中文/常见品牌名 → 官方域名里会出现的拉丁词元。品牌串本身是中文时靠这张表兜。 */
const BRAND_ALIASES: Record<string, string[]> = {
  索尼: ['sony'],
  森海塞尔: ['sennheiser'],
  博士: ['bose'],
  苹果: ['apple'],
  华为: ['huawei'],
  小米: ['xiaomi', 'mi'],
  三星: ['samsung'],
  戴森: ['dyson'],
  飞利浦: ['philips'],
  松下: ['panasonic'],
  铁三角: ['audiotechnica'],
  拜雅: ['beyerdynamic'],
  拜亚动力: ['beyerdynamic'],
  漫步者: ['edifier'],
  罗技: ['logitech'],
  雷蛇: ['razer'],
  大疆: ['dji'],
  安克: ['anker'],
  捷波朗: ['jabra'],
  韶音: ['shokz'],
  声阔: ['soundcore'],
  万魔: ['1more'],
  'b&o': ['bang-olufsen'],
  铂傲: ['bang-olufsen'],
  哈曼卡顿: ['harmankardon'],
  马歇尔: ['marshall'],
  魔声: ['monster'],
  捷波朗耳机: ['jabra'],
  耐克: ['nike'],
  阿迪达斯: ['adidas'],
  优衣库: ['uniqlo'],
  李宁: ['lining'],
  安踏: ['anta'],
  新秀丽: ['samsonite'],
  海尔: ['haier'],
  美的: ['midea'],
  格力: ['gree'],
  九阳: ['joyoung'],
  苏泊尔: ['supor'],
  方太: ['fotile'],
  老板: ['robam'],
  全友: ['quanyou'],
  顾家: ['kuka'],
  海信: ['hisense'],
  创维: ['skyworth'],
  联想: ['lenovo'],
  戴尔: ['dell'],
  华硕: ['asus'],
  宏碁: ['acer'],
  微星: ['msi'],
  tcl: ['tcl'],
  jbl: ['jbl'],
  群晖: ['synology'],
  石头: ['roborock'],
  追觅: ['dreame'],
  科沃斯: ['ecovacs'],
}

/** 手工放宽口子：确认干净、且不属于某个品牌官方的图床。默认空 —— 宁缺毋滥。 */
const EXTRA_TRUSTED_HOSTS: string[] = []

function splitLabels(host: string) {
  return host
    .toLowerCase()
    .replace(/^www\./, '')
    .split(/[.\-_]+/)
    .filter(Boolean)
}

export function safeHostname(raw: string | undefined) {
  if (!raw) {
    return ''
  }
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * 从品牌串里抽「用于匹配官方域名」的词元。
 * - 拉丁词：直接取（Sony / Sennheiser / Bose）
 * - 中文品牌：查别名表（索尼 → sony）
 * 只取 brand，不取 name —— name 里混着型号，容易在第三方域名上误命中。
 *
 * ⚠️ 正则不能要求首字符必须是字母（踩过）：`1Zpresso`、`1MORE`、`8Bitdo`、`70mai`
 * 这类**数字开头**的品牌会被从第二个字符开始截断 —— `1Zpresso` 抽成 `zpresso`，
 * 于是推算出来的官方域是 `zpresso.com / zpresso.cn`（全是别人的域名），
 * 官方域定向检索与品牌域名判定从根上就是错的，而且完全不报错。
 * 现在先抓连续的字母数字串，再要求它**至少含一个字母**（挡掉纯数字）。
 */
export function brandTokens(brand: string | undefined): string[] {
  const tokens = new Set<string>()
  const raw = (brand ?? '').toLowerCase()

  for (const word of raw.match(/[a-z0-9&]{3,}/g) ?? []) {
    if (/[a-z]/.test(word)) {
      tokens.add(word)
    }
  }

  for (const [aliasKey, hosts] of Object.entries(BRAND_ALIASES)) {
    if (raw.includes(aliasKey.toLowerCase())) {
      for (const host of hosts) {
        tokens.add(host)
      }
    }
  }

  return [...tokens]
}

/**
 * host 是否属于这个品牌的官方域名。
 *
 * 判定方式：把 host 按 `.` `-` `_` 切成语段，看是否有语段与品牌词元相等，
 * 或（词元长度 ≥4 时）以词元开头。
 *
 * 实测通过 / 拒绝的样子：
 * - `store.sony.com.tw`、`www.sonystyle.com.cn` → 语段 `sony` / `sonystyle` ✓
 * - `global.sennheiser-hearing.com` → 语段 `sennheiser` ✓
 * - `bz-bose-prod-pub.oss-cn-shanghai.aliyuncs.com` → 语段 `bose` ✓（Bose 自家 OSS）
 * - `img.alicdn.com`、`qnam.smzdm.com`、`k.sinaimg.cn`、`static.cnbetacdn.com` ✗
 */
export function isBrandOfficialHost(hostOrUrl: string, tokens: string[]) {
  const host = hostOrUrl.includes('/') ? safeHostname(hostOrUrl) : hostOrUrl.toLowerCase()

  if (!host || !tokens.length) {
    return false
  }

  if (EXTRA_TRUSTED_HOSTS.some((trusted) => host === trusted || host.endsWith(`.${trusted}`))) {
    return true
  }

  const labels = splitLabels(host)

  return tokens.some((token) =>
    labels.some((label) => {
      // 短词元（mi / hp / amd）只认完全相等，避免 zdmimg 这种误命中。
      if (token.length < 4) {
        return label === token
      }
      return label === token || label.startsWith(token)
    }),
  )
}

/** 二级公共后缀（`.com.cn` 这种要取三段才算注册域）。够用即可，不求完整 PSL。 */
const MULTI_PART_SUFFIXES = [
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'edu.cn',
  'co.uk',
  'com.hk',
  'com.tw',
  'com.sg',
  'co.jp',
  'co.kr',
  'com.au',
]

/**
 * 取注册域（registrable domain），用来给 `include_domains` 用。
 * `store.sony.com.tw` → `sony.com.tw`；`bz-bose-prod-pub.oss-cn-shanghai.aliyuncs.com` → `aliyuncs.com`。
 */
export function registrableDomain(host: string) {
  const labels = host.toLowerCase().split('.').filter(Boolean)

  for (const suffix of MULTI_PART_SUFFIXES) {
    const suffixLabels = suffix.split('.').length
    // 必须**还有**一个主机标签在这个公共后缀之前，否则就不是注册域。
    // 踩过：写成 `>` 而不是 `>=`，`sonystyle.com.cn` 会落到兜底分支返回 `com.cn`，
    // 拿去当 include_domains 等于检索全中国的 .com.cn 站点（实测确实返回了垃圾）。
    if (host.endsWith(`.${suffix}`) && labels.length >= suffixLabels + 1) {
      return labels.slice(-(suffixLabels + 1)).join('.')
    }
  }

  return labels.slice(-2).join('.')
}

// ── 图片本身的三关：可达 / 是图 / 能上卡片 ────────────────────────

const IMAGE_PROBE_TIMEOUT_MS = 6_000
/** 只取头部若干字节：解析尺寸够用，不必下载整张图。 */
const IMAGE_HEAD_BYTES = 64 * 1024
/** 最短边下限：小于此值的图在卡片上会糊。 */
const MIN_IMAGE_SIDE = 300
/**
 * 长宽比可接受区间。
 *
 * 上界的来历：起初设 1.8，为了挡掉 `www.sony.com.cn` 那种 534×187（2.86）的小横幅
 * 和细长条。但 2026-09-29 实测发现它误杀了**标准 og:image 尺寸 1200×630（1.91）**——
 * 罗技 `resource.logitechg.com` 的官方商品图正好是这个比例，被无差别拒绝。
 *
 * 上界放宽到 2.1 是有依据的：这道闸原本是在**看不见图片内容**的年代，
 * 拿长宽比当「这张图能不能当封面」的代理指标。现在视觉质检能直接看图了
 * （营销横幅、拼图会被 imageJudge 判掉），长宽比就该退回它本来的职责 ——
 * 只挡极端尺寸，不再承担内容判断。2.86 的小横幅依然过不了。
 */
const MIN_ASPECT = 0.55
const MAX_ASPECT = 2.1

const IMAGE_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

export type ImageGateReason =
  | 'ok'
  | 'not_brand_host'
  | 'unreachable'
  | 'not_image'
  | 'too_small'
  | 'bad_aspect'
  | 'unknown_size'

export interface ImageGateResult {
  ok: boolean
  reason: ImageGateReason
  host: string
  contentType: string
  width: number
  height: number
}

/** 从头部字节里解析尺寸。认不出就返回 0 —— 不实现完整解码，够用就行。 */
function readImageSize(buffer: Buffer): { width: number; height: number } {
  // PNG：IHDR 紧跟在 8 字节签名后
  if (buffer.length > 24 && buffer.readUInt32BE(0) === 0x89504e47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }

  // GIF
  if (buffer.length > 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
  }

  // WebP：VP8 / VP8L / VP8X 三种变体
  if (buffer.length > 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const variant = buffer.toString('ascii', 12, 16)
    try {
      if (variant === 'VP8X') {
        return { width: (buffer.readUIntLE(24, 3) & 0xffffff) + 1, height: (buffer.readUIntLE(27, 3) & 0xffffff) + 1 }
      }
      if (variant === 'VP8L') {
        const bits = buffer.readUInt32LE(21)
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
      }
      if (variant === 'VP8 ') {
        return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff }
      }
    } catch {
      return { width: 0, height: 0 }
    }
  }

  // JPEG：顺序扫 segment，找 SOFn
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = buffer[offset + 1]
      // SOF0~SOF3 / SOF5~SOF7 / SOF9~SOF11 / SOF13~SOF15
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      if (isSof) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
      }
      const segmentLength = buffer.readUInt16BE(offset + 2)
      if (segmentLength <= 0) {
        break
      }
      offset += 2 + segmentLength
    }
  }

  return { width: 0, height: 0 }
}

/** 只读头部就取消，避免为了一张图把整张图拖下来。 */
async function fetchImageHead(url: URL, signal: AbortSignal) {
  const response = await fetch(url, {
    headers: {
      accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      'user-agent': IMAGE_UA,
      range: `bytes=0-${IMAGE_HEAD_BYTES - 1}`,
    },
    signal,
  })

  if (!response.ok || !response.body) {
    response.body?.cancel().catch(() => {})
    return { contentType: response.headers.get('content-type') ?? '', buffer: Buffer.alloc(0), ok: false as const }
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  try {
    while (received < IMAGE_HEAD_BYTES) {
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

  return {
    contentType: response.headers.get('content-type') ?? '',
    buffer: Buffer.concat(chunks),
    ok: true as const,
  }
}

/**
 * 对一张候选图做三道闸检查。
 * 任何异常都归为不可用 —— 图片是锦上添花，卡住主链路才是问题。
 *
 * `options.requireBrandHost`（默认 true）控制闸一。
 * 置为 false 时不再要求域名属于品牌 —— 这是给 imageJudge 用的：
 * 有了视觉质检之后，「是不是官方域」不再是唯一的可信依据，
 * 第三方图只要模型看过并确认是同款、没水印，也可以放行（严格度由上层定义）。
 */
export async function gateImage(
  rawUrl: string,
  tokens: string[],
  timeoutMs = IMAGE_PROBE_TIMEOUT_MS,
  options: { requireBrandHost?: boolean } = {},
): Promise<ImageGateResult> {
  const host = safeHostname(rawUrl)
  const base: ImageGateResult = { ok: false, reason: 'unreachable', host, contentType: '', width: 0, height: 0 }

  // 闸一：域名必须属于品牌
  if (options.requireBrandHost !== false && !isBrandOfficialHost(host, tokens)) {
    return { ...base, reason: 'not_brand_host' }
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { ...base, reason: 'unreachable' }
    }
  } catch {
    return { ...base, reason: 'unreachable' }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    // 闸二：真的取得到，且返回的确实是图片（cnBeta / 台湾 PChome 都对直连返回 403）
    const head = await fetchImageHead(parsed, controller.signal)

    if (!head.ok || !/^image\//i.test(head.contentType)) {
      return { ...base, reason: 'not_image', contentType: head.contentType }
    }

    // 闸三：尺寸与长宽比
    const { width, height } = readImageSize(head.buffer)
    const result = { ...base, contentType: head.contentType, width, height }

    if (!width || !height) {
      // 认不出尺寸（少见格式）不阻断，只记录。
      return { ...result, ok: true, reason: 'unknown_size' }
    }

    if (Math.min(width, height) < MIN_IMAGE_SIDE) {
      return { ...result, reason: 'too_small' }
    }

    const aspect = width / height
    if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) {
      return { ...result, reason: 'bad_aspect' }
    }

    return { ...result, ok: true, reason: 'ok' }
  } catch {
    return { ...base, reason: 'unreachable' }
  } finally {
    clearTimeout(timeout)
  }
}
