#!/usr/bin/env node
/**
 * 单测：图片 URL 的型号词元抽取（防「型号冲突误判」回归）。
 *
 * 背景：这个 bug 曾经让 8 个冷门品牌 0 张图过闸，而且**日志上看不出来**
 * ——候选被 modelTokens 冲突静默丢掉。所以必须有回归测试钉住。
 *
 * 用法：node scripts/test-image-model-tokens.mjs
 */

import assert from 'node:assert/strict'

const { extractUrlModelTokens, extractModelTokens, urlTokenMatches } = await import(
  '../frontend/server/utils/modelTokens.ts'
)
const { brandTokens } = await import('../frontend/server/utils/imageTrust.ts')

// ── 图片 URL 里的噪声必须被洗净 ──────────────────────────────
// 断言口径：不是「一个词元都不许有」（路径里可能出现真型号），而是
// 「这些**已知噪声**一个都不许当成型号词元」。
const noiseCases = [
  ['阿里图床尺寸后缀', 'https://g-search3.alicdn.com/img/bao/uploaded/i4/O1CN01AbCdEf1234567890_!!34783179.jpg_1200x1200.jpg'],
  ['B站归档图 @宽高后缀', 'https://i0.hdslb.com/bfs/archive/b3b48210fb736b98c0ef3bcc48aa9035144d9f70.jpg@1200w_630h'],
  ['带版本查询串', 'https://mycoffeestage.com/cdn/shop/products/1zpresso-qs2-593684.jpg?v=1741429447'],
  ['京东图床纯编号', 'https://img12.360buyimg.com/n1/jfs/t1/123456/7/8901/234567/60abcdefg/E1f2g3h4i5j6k7l8.jpg'],
  ['尺寸写在文件名里', 'https://example.com/upload/20240115/img_800x600_pic.jpg'],
]

const NOISE_TOKENS = [
  // 域名片段（曾经把 g-search3 → SEARCH3、img12 → IMG12 当成型号）
  'SEARCH3', 'SEARCH1', 'SEARCH2', 'IMG12', 'HDSLB', '360BUYIMG', 'ALICDN', 'I0', 'T1', 'N1',
  // 尺寸 / 宽高后缀
  '1200X1200', '1200W', '630H', '800X600',
  // 版本查询串 / 商品 ID / 时间戳
  'V1741429447', '1741429447', '34783179', '593684', '20240115', '123456', '8901', '234567',
  // 哈希 / 图片 ID
  'O1CN01ABCDEF1234567890', 'B3B48210FB736B98C0EF3BCC48AA9035144D9F70', 'F1BE63917', 'E1F2G3H4I5J6K7L8',
  // 路径词
  'UPLOADED', 'UPLOAD', 'ARCHIVE', 'PRODUCT_FILES', 'PRODUCTS',
]

for (const [label, url] of noiseCases) {
  const tokens = extractUrlModelTokens(url)
  for (const noise of NOISE_TOKENS) {
    assert.ok(
      !tokens.includes(noise),
      `${label} 不该把噪声 ${noise} 当成型号词元，实际得到 ${JSON.stringify(tokens)}`,
    )
  }
}

// 反向：洗净查询串不等于把真型号一起洗掉（同一张图，型号必须留下）
const versionedUrl = 'https://mycoffeestage.com/cdn/shop/products/1zpresso-qs2-593684.jpg?v=1741429447'
assert.ok(
  extractUrlModelTokens(versionedUrl).includes('QS2'),
  `1zpresso-qs2 的图应抽出 QS2，实际得到 ${JSON.stringify(extractUrlModelTokens(versionedUrl))}`,
)

// ── 真型号必须能抽出来（否则「型号冲突」这层保护就失效了）──────
// 断言用生产同款比较（urlTokenMatches，允许包含关系）—— URL 里的型号
// 常和相邻片段粘连（`a211-8x42-main` → `A2118X42`），全等会误判成冲突。
const realCases = [
  ['索尼台湾站 WH-1000XM5', 'https://store.sony.com.tw/resource/file/product_files/WH-1000XM5/43_f1be63917.jpg', 'WH1000XM5'],
  ['尼康双筒 A211', 'https://example.com/products/nikon-aculon-a211-8x42-main.jpg', 'A211'],
  ['山进 ATS-909X2', 'https://web.sangean.com/images/0001204_ATS-909X2_Black_1200x1200_01-1020.png', 'ATS909X2'],
]

for (const [label, url, expected] of realCases) {
  const tokens = extractUrlModelTokens(url)
  assert.ok(
    tokens.some((token) => urlTokenMatches(token, expected)),
    `${label} 应认出型号 ${expected}，实际得到 ${JSON.stringify(tokens)}`,
  )
}

// ── 产品名侧的带连字符型号，也要与 URL 侧取到同一个词元 ─────────
const nameTokens = extractModelTokens('索尼 WH-1000XM4 头戴式无线降噪耳机')
assert.ok(
  nameTokens.some((token) => urlTokenMatches(token, 'WH1000XM4')),
  `产品名应抽出可识别为 WH1000XM4 的词元，实际 ${JSON.stringify(nameTokens)}`,
)

// ── 反向验证：错型号依然能被识别为冲突 ───────────────────────
// 这是当初加「型号冲突」规则要防的 case（实测给 XM4 配上了 XM5 的图）。
// 放宽成全等→包含之后，这个保护必须还在。
const want = extractModelTokens('索尼 WH-1000XM4 头戴式无线降噪耳机')
const wrongTokens = extractUrlModelTokens('https://store.sony.com.tw/resource/file/product_files/WH-1000XM5/43.jpg')
const conflict = wrongTokens.length > 0 && !wrongTokens.some((t) => want.some((w) => urlTokenMatches(t, w)))
assert.ok(conflict, 'XM5 的图配 XM4 的商品，必须仍被判成型号冲突')

const rightTokens = extractUrlModelTokens('https://store.sony.com.tw/resource/file/product_files/WH-1000XM4/43.jpg')
const noConflict = rightTokens.length === 0 || rightTokens.some((t) => want.some((w) => urlTokenMatches(t, w)))
assert.ok(noConflict, 'XM4 的图配 XM4 的商品，不该被判成冲突')

// ── 品牌词元：数字开头的品牌不能被截断（1Zpresso / 1MORE）──────
assert.ok(brandTokens('1Zpresso').includes('1zpresso'), `1Zpresso 应抽到 1zpresso，实际 ${JSON.stringify(brandTokens('1Zpresso'))}`)
assert.ok(brandTokens('1MORE 万魔').includes('1more'), `1MORE 应抽到 1more，实际 ${JSON.stringify(brandTokens('1MORE 万魔'))}`)
assert.ok(brandTokens('Sony').includes('sony'))
assert.ok(brandTokens('索尼').includes('sony'))

console.log(
  `✅ 图片型号词元抽取 全部通过（噪声 URL ${noiseCases.length} 例 × ${NOISE_TOKENS.length} 个噪声词 / 真型号 ${realCases.length} 例 / 版本串保型号 1 例 / 带连字符型号 1 例 / 冲突判定 2 例 / 品牌词元 4 例）`,
)
