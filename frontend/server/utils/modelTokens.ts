/**
 * 型号词元抽取（纯函数，无依赖 —— 便于单测直接 import）。
 *
 * 为什么单独成文件：这套逻辑是「型号冲突」判定的输入，判错的后果是**静默丢图**，
 * 所以必须有回归测试钉住。而 `llmBuyer.ts` 里全是无扩展名的相对导入
 * （Nuxt/Nitro 能解析，Node 原生 ESM 不能），单测根本 import 不进来。
 */

/**
 * 从**产品名 / 描述**这类自然语言里抽型号词元。
 * - 含数字的型号词：WH-1000XM4 / QC45 / XM5
 * - 长度 ≥5 的拉丁系列名：MOMENTUM / QUIETCOMFORT（型号里没有数字时只能靠它）
 * 纯短的品牌词区分度太低，不取。
 */
export function extractModelTokens(...texts: string[]) {
  const joined = texts.join(' ')
  // `-?` 是为了 `WH-1000XM4` / `QC-45` 这类**带连字符的官方型号**整体取出。
  // 少了它，`[A-Za-z]{0,8}` 只能匹配到 `WH`，而下一个字符是 `-` 不是数字，
  // 于是从 `1000XM4` 处重新起匹配 —— 得到的词元与图片 URL 侧对不上。
  const modelWords = joined.match(/[A-Za-z]{0,8}-?\d[\dA-Za-z-]{1,14}/g) ?? []
  const seriesWords = joined.match(/[A-Za-z]{5,}/g) ?? []

  return [
    ...new Set(
      [...modelWords, ...seriesWords]
        .map((token) => token.toUpperCase().replace(/[^A-Z0-9]/g, ''))
        .filter((token) => token.length >= 3),
    ),
  ].slice(0, 8)
}

/** 归一化：只留 A-Z0-9（`WH-1000XM4` 与 `wh1000xm4` 视为同一个）。 */
function normalizeToken(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * 「URL 侧词元」与「想要的型号」是否指向同一款。
 *
 * 判据是**包含关系**而不是全等 —— 因为 URL 里的词元常和相邻片段粘在一起：
 * ```
 * /products/nikon-aculon-a211-8x42-main.jpg  →  A2118X42
 * ```
 * 全等比对会把这张真·A211 的图判成「型号冲突」，而它其实是干净的好图。
 * 反过来，真错型号（`WH1000XM5` 的图配 `WH1000XM4` 的商品）在包含关系下
 * 依然判得出来 —— 两个方向都不互相包含，保护没有丢。
 *
 * 长度 <3 的词元一律不参与，避免 `M5` / `A2` 这种碎片误伤。
 */
export function urlTokenMatches(token: string, want: string) {
  const a = normalizeToken(token)
  const b = normalizeToken(want)
  if (a.length < 3 || b.length < 3) {
    return false
  }
  return a === b || a.includes(b) || b.includes(a)
}

/**
 * 把图片 URL 里的「形似型号的噪声」洗掉，再抽型号词元。
 *
 * 🔴 这是本项目最隐蔽的一个 bug，值得单独一段说明。
 * 「型号冲突就排除候选」这条规则本意是防错图（实测给 XM4 配上了
 * `store.sony.com.tw/.../product_files/WH-1000XM5/...`）。但它的输入是
 * **图片 URL**，而图片 URL 天生塞满了形似型号的东西：
 *
 * ```
 * .../O1CN01AbCdEf1234567890_!!34783179.jpg_1200x1200.jpg?v=1741429447
 * .../b3b48210fb736b98c0ef3bcc48aa9035144d9f70.jpg@1200w_630h
 * ```
 * 清洗前，`extractModelTokens` 会把 `1200X1200`、`630H`、`V1741429447`、
 * `O1CN01ABCDEF1234567890` 全都当成型号词元，而它们当然和 `WH1000XM4` 对不上，
 * 于是**被判成「型号冲突」直接丢掉**。
 * 后果实测：8 个冷门品牌 0 张图，且日志上完全看不出是被这条规则拦的（静默丢图）。
 *
 * 所以 URL 取词元必须：先洗噪声 → 只认「字母+数字」形态的型号词，
 * 不认长字母串（`UPLOADED`、`THUMBNAILS` 这类路径词也是噪声）。
 * 产品**名称/描述**走 `extractModelTokens`（自然语言，长系列名 MOMENTUM 是有用的）。
 */
export function cleanUrlForModelTokens(rawUrl: string) {
  return rawUrl
    .split('?')[0]
    .split('#')[0]
    // 🔴 域名整段丢掉。型号只会出现在**路径与文件名**里，但域名天生是
    // 「字母+数字」形态：`g-search3.alicdn.com` 抽出 `SEARCH3`、
    // `img12.360buyimg.com` 抽出 `IMG12`、`i0.hdslb.com` 抽出 `I0`。
    // 这些噪声不仅没用，还会把真型号挤掉（结果被 `.slice(0, 8)` 截断）。
    // 单测 `test-image-model-tokens.mjs` 抓到的就是这个。
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, ' ')
    .replace(/^[^/]*/, ' ')
    // 尺寸对（1200x1200 / 800x600）。⚠️ 两侧都**必须 ≥2 位**：
    // 写成 `\d+[xX×]\d+` 时，`ATS-909X2` 里的 `9X2` 会被当成「9x2 尺寸」吃掉，
    // 山进 ATS-909X2 的图于是抽不出任何型号（单测抓到的第二个漏）。
    .replace(/\d{2,5}[xX×]\d{2,5}/g, ' ')
    // `@1200w_630h` 这种宽高后缀：不能用 \b 收尾 —— 后面紧跟 `_` 时 \b 不成立，
    // 实测漏掉了 `@1200w`，然后 `1200W` 被当成型号词元（单测抓到的）。
    .replace(/[@_]\d+[wh](?![a-z0-9])/gi, ' ')
    .replace(/!!\d+/g, ' ') // !!.34783179
    .replace(/\b(?:19|20)\d{2}\b/g, ' ') // 年份
    .replace(/(?<![A-Za-z0-9])\d{4,}(?![A-Za-z0-9])/g, ' ') // 独立的长数字串（商品 ID 593684）
    .replace(/[A-Za-z0-9]{13,}/g, ' ') // 商品 ID / 哈希（型号词元不会这么长）
}

/**
 * URL 专用：只认「字母开头 + 含数字」形态的型号词元（XM4 / WH1000XM5 / A211 / QS2）。
 *
 * 两条收紧都是被噪声逼出来的：
 * - **必须以字母开头**：数字开头的几乎都是 ID（`60abcdefg`、`1zpresso` 里的编号部分）。
 * - **必须同时含字母和数字**：纯数字（`800`/`42`）区分度太低，会把无关图判成冲突。
 *
 * ⚠️ 即便如此，**哈希串仍然无法与型号区分**（`f1be63917` 与 `A211` 形态一样）。
 * 所以这份结果只该用来**排序**，不要拿它做硬性淘汰 —— 真伪交给 imageJudge 看图判。
 */
export function extractUrlModelTokens(rawUrl: string) {
  const cleaned = cleanUrlForModelTokens(decodeURIComponent(rawUrl)).toUpperCase()

  return [
    ...new Set(
      // `-?` 同 `extractModelTokens`：`WH-1000XM5` 要整体取出为 `WH1000XM5`。
      (cleaned.match(/[A-Z]{1,8}-?\d[\dA-Z-]{0,14}/g) ?? [])
        .map((token) => token.replace(/[^A-Z0-9]/g, ''))
        .filter((token) => token.length >= 3 && /^[A-Z]/.test(token) && /\d/.test(token)),
    ),
  ].slice(0, 8)
}
