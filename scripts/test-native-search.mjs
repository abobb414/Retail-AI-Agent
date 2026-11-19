#!/usr/bin/env node
/**
 * DeepSeek 原生联网的离线回归（纯离线，不联网、不需要 API Key）。
 *
 * 钉住三件容易被「看起来正常」掩盖的事：
 * 1. `server_tool_calls` 的解析：只认 kind='search'、URL 去重、失败步骤记 notes；
 * 2. 「零来源」判定：追问轮天然零来源，不能被当成检索失败去补搜；
 * 3. `source_url` 换页：手册页要换成商品页，但绝不换成非商品页、也不凭空发明链接。
 *
 * 用法：
 *   node --experimental-strip-types scripts/test-native-search.mjs
 */

import { register } from 'node:module'

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (error) {
    if (specifier.startsWith('.') && !/\\.[cm]?[jt]s$/.test(specifier)) {
      return next(specifier + '.ts', context)
    }
    throw error
  }
}
`),
)

const { collectNativeSearch, shouldRetryNativeSearch, preferPurchasePage } = await import(
  '../frontend/server/utils/llmBuyer.ts'
)

let passed = 0
const failures = []

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    return
  }

  failures.push(`${name}${detail ? `：${detail}` : ''}`)
}

function step(calls) {
  return { index: 0, calls }
}

// ── collectNativeSearch ──────────────────────────────────────────

{
  const result = collectNativeSearch([
    step([
      {
        kind: 'search',
        status: 'completed',
        action: { queries: ['Sony WH-1000XM5 价格', ' 2026 降噪耳机推荐 '] },
        sources: [
          { url: 'https://www.sony.com.cn/product/wh1000xm5', title: 'WH-1000XM5' },
          { url: 'https://example.com/review', title: '横评' },
        ],
      },
    ]),
  ])

  check('解析出检索词', result.queries.length === 2, JSON.stringify(result.queries))
  check('检索词已 trim', result.queries[1] === '2026 降噪耳机推荐', result.queries[1])
  check('解析出来源', result.hits.length === 2)
  check('title 缺失时用 url 兜底', result.hits[1].title === '横评')
}

{
  const result = collectNativeSearch([
    step([
      {
        kind: 'search',
        status: 'completed',
        action: { queries: ['a'] },
        sources: [{ url: 'https://same.com/1' }, { url: 'https://same.com/1' }],
      },
    ]),
    step([
      {
        kind: 'search',
        status: 'completed',
        action: { queries: ['b'] },
        sources: [{ url: 'https://same.com/1' }, { url: 'https://same.com/2' }],
      },
    ]),
  ])

  check('跨步骤按 URL 去重', result.hits.length === 2, JSON.stringify(result.hits.map((hit) => hit.url)))
  check('跨步骤检索词合并', result.queries.join(',') === 'a,b', result.queries.join(','))
}

{
  const result = collectNativeSearch([
    step([{ kind: 'search', status: 'failed', action: { queries: ['x'] }, error: { code: 'rate_limit' } }]),
  ])

  check('失败步骤不产生来源', result.hits.length === 0)
  check('失败步骤仍记录检索词', result.queries[0] === 'x')
  check('失败步骤写进 notes', result.notes.join('|').includes('rate_limit'), result.notes.join('|'))
}

{
  const result = collectNativeSearch([
    step([
      { kind: 'fetch', status: 'completed', action: { queries: ['忽略'] }, sources: [{ url: 'https://x.com' }] },
      { kind: 'search', status: 'completed', sources: [{ url: 'ftp://bad' }, { url: 'not-a-url' }] },
    ]),
  ])

  check('非 search 步骤被忽略', result.queries.length === 0 && result.hits.length === 0)
  check('非法 URL 被丢弃', result.hits.length === 0)
}

{
  const result = collectNativeSearch([null, {}, { calls: 'nope' }])

  check('畸形输入不抛错', result.hits.length === 0 && result.queries.length === 0)
}

// ── shouldRetryNativeSearch ──────────────────────────────────────

const someHits = [{ title: 'x', url: 'https://x.com', content: '' }]

check('已有来源 ⇒ 不补搜', shouldRetryNativeSearch(['q'], someHits, '') === false)
check(
  '搜过但零来源 ⇒ 补搜（真失败）',
  shouldRetryNativeSearch(['q'], [], '随手一句话') === true,
)
check(
  'JSON 定品但零来源 ⇒ 补搜',
  shouldRetryNativeSearch([], [], '{"action":"recommend","chat_reply":"拿 XM5。"}') === true,
)
check(
  'JSON 追问且零来源 ⇒ 不补搜',
  shouldRetryNativeSearch([], [], '{"action":"clarify","chat_reply":"你常穿多大码？"}') === false,
)
check('散文追问且零来源 ⇒ 不补搜', shouldRetryNativeSearch([], [], '预算大概多少？') === false)
check(
  '散文陈述（可能是在追问没问号）⇒ 不补搜，交给 search_note 记录',
  shouldRetryNativeSearch([], [], '想帮你挑得更准，先告诉我预算和佩戴场景。') === false,
)

// ── preferPurchasePage ───────────────────────────────────────────

const hits = [
  { title: '帮助指南', url: 'https://helpguide.sony.net/mdr/wh1000xm5/v1/zh-cn/contents/TP1000538279.html', content: '' },
  { title: 'WH-1000XM5', url: 'https://www.sony.com.cn/electronics/headband-headphones/wh-1000xm5', content: '' },
  { title: '京东', url: 'https://item.jd.com/100012345678.html', content: '' },
]

check(
  '手册页换成官方商品页',
  preferPurchasePage(hits[0].url, 'Sony', hits, 'WH-1000XM5') === hits[1].url,
  String(preferPurchasePage(hits[0].url, 'Sony', hits, 'WH-1000XM5')),
)
check('已是商品页时不动', preferPurchasePage(hits[1].url, 'Sony', hits, 'WH-1000XM5') === hits[1].url)
check(
  '没有 source_url 时保持 undefined',
  preferPurchasePage(undefined, 'Sony', hits, 'WH-1000XM5') === undefined,
)
check(
  '没有商品页候选时保持原样',
  preferPurchasePage('https://helpguide.sony.net/x', 'Sony', [hits[0]], 'WH-1000XM5') ===
    'https://helpguide.sony.net/x',
)
check(
  '只有非商品页候选时不替换',
  preferPurchasePage('https://support.sony.com.cn/x', 'Sony', [
    { title: 'FAQ', url: 'https://www.sony.com.cn/support/faq', content: '' },
  ], 'WH-1000XM5') === 'https://support.sony.com.cn/x',
)
check(
  '品牌官方商品页优先于电商页',
  preferPurchasePage(hits[0].url, 'Sony', [hits[2], hits[1]], 'WH-1000XM5') === hits[1].url,
)
check(
  '官网页面不带商品路径时，型号词元也算命中',
  preferPurchasePage('https://helpguide.sony.net/x', 'Sony', [
    { title: 'XM5', url: 'https://www.sony.com.cn/electronics/headband-headphones/wh-1000xm5', content: '' },
  ], 'WH-1000XM5') === 'https://www.sony.com.cn/electronics/headband-headphones/wh-1000xm5',
)

// ── 汇总 ─────────────────────────────────────────────────────────

if (failures.length) {
  console.error(`\n✗ ${failures.length} 项失败 / ${passed + failures.length} 项`)
  for (const failure of failures) {
    console.error(`  - ${failure}`)
  }
  process.exit(1)
}

console.log(`✓ 全部通过（${passed} 项）`)
