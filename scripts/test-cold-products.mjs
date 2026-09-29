#!/usr/bin/env node
/**
 * 冷门/长尾产品端到端测试。
 *
 * 为什么单独测冷门产品：热门品类（耳机、手机）官方站往往有现成的 og:image，
 * 图片链路走第一级就过了，看不出问题。冷门品牌的典型困境是
 * 「官网不给 og:image + 官方域检索召回不到」——以前这类直接无图，
 * 现在靠第三方图 + 视觉质检兜。这批用例就是专门压这条新路径的。
 *
 * 用法：
 *   node scripts/test-cold-products.mjs [port] [--only=<关键词>]
 * 例：
 *   node scripts/test-cold-products.mjs 3100
 */

const PORT = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 3100)
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? ''

/** 都带「品类 + 预算 + 用途」，避免落到追问分支，测不到定品与选图。 */
const CASES = [
  { name: '短波收音机', text: '想买个便携短波收音机，预算 1500 左右，主要听国际广播，出差带着用' },
  { name: '有线入耳耳机', text: '想入一条千元内的入耳式有线耳机，听人声和弦乐为主，预算 800 以内' },
  { name: '游戏方向盘', text: '想玩赛车游戏买个方向盘，预算 1200 左右，主要玩地平线' },
  { name: '手摇磨豆机', text: '想买手摇磨豆机，预算 500 以内，做手冲咖啡' },
  { name: '手冲壶', text: '想要一把手冲壶，预算 1000 左右，控水要稳' },
  { name: '显示器支架', text: '想买显示器支架，预算 700，27 寸显示器用，桌面夹装' },
  { name: '电子表', text: '想买块耐用电子表，预算 1000 以内，日常防水防摔' },
  { name: '双筒望远镜', text: '想买个双筒望远镜，预算 800，看演出和户外用' },
]

function parseSse(raw) {
  const events = []
  for (const block of raw.split('\n\n')) {
    let name = ''
    let payload = ''
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) name = line.slice(6).trim()
      else if (line.startsWith('data:')) payload = line.slice(5).trim()
    }
    if (name) {
      try { events.push({ name, data: JSON.parse(payload) }) } catch { events.push({ name, data: payload }) }
    }
  }
  return events
}

async function runCase(testCase) {
  const startedAt = Date.now()
  const response = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: testCase.text }] }),
    signal: AbortSignal.timeout(180000),
  })

  const raw = await response.text()
  const elapsed = Date.now() - startedAt
  const events = parseSse(raw)

  const meta = [...events].reverse().find((e) => e.name === 'meta' && e.data?.stage && e.data.stage !== 'thinking')?.data ?? {}
  const product = events.find((e) => e.name === 'product')?.data?.product
  const error = events.find((e) => e.name === 'error')?.data?.message

  let imageHost = ''
  if (product?.image) {
    try { imageHost = new URL(product.image).hostname } catch { imageHost = '?' }
  }

  return {
    case: testCase.name,
    stage: error ? 'error' : (meta.stage ?? 'unknown'),
    engine: meta.engine ?? '',
    model: meta.model ?? '',
    searched: meta.searched === true,
    imageFrom: meta.image_from ?? '',
    /** 'logo' 表示这是品牌官方标兜底，不是商品图。 */
    imageKind: product?.image_kind ?? '',
    imageHost,
    product: product ? `${product.brand} ${product.name}` : '',
    price: product?.price_range ?? '',
    sourceUrl: product?.source_url ?? '',
    ms: elapsed,
    error: error ?? '',
  }
}

const selected = only ? CASES.filter((c) => c.name.includes(only) || c.text.includes(only)) : CASES
const rows = []

for (const testCase of selected) {
  process.stdout.write(`▶ ${testCase.name} … `)
  try {
    const row = await runCase(testCase)
    rows.push(row)
    const flag = row.stage === 'rag_recommendation' ? '定品' : row.stage === 'error' ? '报错' : '追问'
    const cover = row.imageHost ? `${row.imageHost}${row.imageKind === 'logo' ? '(标)' : ''}` : '无'
    console.log(`${flag} | 图=${cover}(${row.imageFrom || '-'}) | ${(row.ms / 1000).toFixed(1)}s`)
  } catch (error) {
    console.log(`失败: ${error.message}`)
    rows.push({ case: testCase.name, stage: 'exception', error: error.message, ms: 0 })
  }
}

console.log('\n────── 明细 ──────')
for (const row of rows) {
  console.log(`\n【${row.case}】${row.stage} / ${row.engine} / ${row.model}`)
  console.log(`  商品：${row.product || '(未定品)'}  ${row.price || ''}`)
  console.log(`  检索：${row.searched ? '已联网' : '未联网'}   图片来源：${row.imageFrom || '-'}${row.imageKind ? `(kind=${row.imageKind})` : ''}   图床：${row.imageHost || '无'}`)
  // 「查看官网」按钮靠 source_url 活着，空了按钮就没了 —— 这一行专门盯它。
  console.log(`  官网按钮：${row.sourceUrl || '❌ 缺失（按钮会不显示）'}`)
  console.log(`  耗时：${(row.ms / 1000).toFixed(1)}s${row.error ? `   错误：${row.error}` : ''}`)
}

const priced = rows.filter((r) => r.stage === 'rag_recommendation')
const pictured = priced.filter((r) => r.imageHost)
const photoOnly = pictured.filter((r) => r.imageKind !== 'logo')
const withLink = priced.filter((r) => r.sourceUrl)
const tiers = priced.reduce((acc, r) => {
  const key = r.imageKind === 'logo' ? 'brand_logo' : (r.imageFrom || 'none')
  acc[key] = (acc[key] ?? 0) + 1
  return acc
}, {})

console.log('\n────── 汇总 ──────')
console.log(`定品 ${priced.length}/${rows.length}   有图 ${pictured.length}/${priced.length || 1}（其中真实商品图 ${photoOnly.length}，品牌标兜底 ${pictured.length - photoOnly.length}）`)
console.log(`官网按钮 ${withLink.length}/${priced.length || 1}`)
console.log(`图片来源分布：${JSON.stringify(tiers)}`)
const avg = rows.reduce((sum, r) => sum + (r.ms || 0), 0) / (rows.length || 1)
console.log(`平均耗时：${(avg / 1000).toFixed(1)}s`)
