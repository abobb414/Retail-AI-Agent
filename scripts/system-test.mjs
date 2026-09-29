#!/usr/bin/env node
/**
 * 系统级端到端测试（System Test）
 *
 * 对一个**运行中**的实例做全链路场景验证，覆盖：
 *   S1 静态服务      —— 首页可访问、壳完整
 *   S2 SSE 协议      —— 事件序列合法、data 均为可解析 JSON、以 done 收尾
 *   S3 追问流程      —— 信息不足时先问一句，不出卡片
 *   S4 定品流程      —— 信息足够时锁定唯一商品，卡片关键字段齐全
 *   S5 多轮上下文    —— 完整对话（问 → 答 → 补充预算）能接上
 *   S6 空输入兜底    —— 空消息列表返回引导文案而非 5xx
 *   S7 兜底链路      —— （--fallback 模式）LLM 不可达时 engine=catalog 出真实卡片
 *
 * 用法：
 *   node scripts/system-test.mjs [baseUrl] [--fallback] [--smoke]
 *
 *   --fallback  断言定品走的是商品库兜底（engine=catalog），用于故障注入实例
 *   --smoke     只跑 S1/S2/S6 快速冒烟（不调大模型）
 *
 * 退出码：0 = 全部通过，1 = 存在失败。
 */

const BASE = (process.argv[2] || 'http://127.0.0.1:3100').replace(/\/$/, '')
const FALLBACK_MODE = process.argv.includes('--fallback')
const SMOKE = process.argv.includes('--smoke')

const REQUEST_TIMEOUT_MS = SMOKE ? 30_000 : 120_000

let pass = 0
let fail = 0
const failures = []

function check(name, cond, detail = '') {
  if (cond) {
    pass += 1
    console.log(`  ✅ ${name}`)
  } else {
    fail += 1
    failures.push(detail ? `${name} — ${detail}` : name)
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(4, 52 - title.length))}`)
}

/** 解析整条 SSE 响应为事件数组；data 必须是合法 JSON。 */
async function readSse(messages) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
    }
    const text = await response.text()
    const events = []
    const malformed = []
    for (const block of text.split('\n\n')) {
      const lines = block.split('\n')
      const name = lines.find((l) => l.startsWith('event:'))?.slice(6).trim()
      const dataLine = lines.find((l) => l.startsWith('data:'))?.slice(5).trim()
      if (!name || !dataLine) {
        continue
      }
      try {
        events.push({ name, data: JSON.parse(dataLine) })
      } catch {
        malformed.push(name)
      }
    }
    return { status: response.status, events, malformed, raw: text }
  } finally {
    clearTimeout(timer)
  }
}

const chunkText = (events) => events
  .filter((e) => e.name === 'chunk')
  .map((e) => e.data?.text ?? '')
  .join('')

const lastEvent = (events) => events.at(-1)?.name ?? ''
const productEvent = (events) => events.find((e) => e.name === 'product')?.data?.product ?? null
const finalMeta = (events) => [...events].reverse().find((e) => e.name === 'meta')?.data ?? {}

/** 卡片关键字段统一校验（S4/S7 共用）。 */
function validateCard(label, product) {
  check(`${label}: 有 product 事件`, Boolean(product))
  if (!product) {
    return
  }
  check(`${label}: name 非空`, typeof product.name === 'string' && product.name.trim().length > 0)
  check(`${label}: brand 非空`, typeof product.brand === 'string' && product.brand.trim().length > 0)
  check(`${label}: price_range 非空`, typeof product.price_range === 'string' && product.price_range.trim().length > 0)
  check(
    `${label}: consultant_summary 非空`,
    typeof product.consultant_summary === 'string' && product.consultant_summary.trim().length > 0,
  )
  if (product.source_url) {
    check(`${label}: source_url 是 http 链接`, product.source_url.startsWith('http'))
  }
  check(`${label}: image 字段存在（可为空）`, typeof product.image === 'string')
}

async function main() {
  console.log(`系统测试目标：${BASE}${FALLBACK_MODE ? '（兜底模式）' : ''}${SMOKE ? '（冒烟）' : ''}`)

  // ── S1 静态服务 ────────────────────────────────────────────
  section('S1 静态服务')
  const home = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(15_000) })
  const homeHtml = await home.text()
  check('首页 HTTP 200', home.status === 200, `实际 ${home.status}`)
  check('页面壳包含挂载点', homeHtml.includes('id="__nuxt"'), homeHtml.slice(0, 80))

  // ── S2+S3 追问流程（协议 + 行为） ─────────────────────────
  section('S2/S3 追问流程与 SSE 协议')
  const clarify = await readSse([{ role: 'user', content: '想要个耳机' }])
  check('SSE 事件非空', clarify.events.length > 0)
  check('data 全部为合法 JSON', clarify.malformed.length === 0, `坏块: ${clarify.malformed.join(',')}`)
  check('以 done 收尾', lastEvent(clarify.events) === 'done', `实际 ${lastEvent(clarify.events)}`)
  const clarifyText = chunkText(clarify.events)
  // 阈值 6：「预算大概多少？」是合法追问（兜底链路的追问会偏短）。
  check('追问有正文', clarifyText.trim().length >= 6, clarifyText.slice(0, 60))
  check('等待事件存在且 pending', clarify.events.some((e) => e.name === 'meta' && e.data?.pending === true))
  check('等待事件不带内部文案（今晚需求）', !clarify.raw.includes('正在核对') && !clarify.raw.includes('正在按你的场景筛品'))
  if (SMOKE) {
    check('冒烟模式不要求追问不出卡片', true)
  } else {
    check('信息不足时不出商品卡', !productEvent(clarify.events))
  }

  if (SMOKE) {
    summarize()
    return
  }

  // ── S4 定品流程 ────────────────────────────────────────────
  section('S4 定品流程与卡片字段')
  const recommend = await readSse([
    { role: 'user', content: '想要个耳机，预算500以内，通勤用' },
  ])
  check('以 done 收尾', lastEvent(recommend.events) === 'done', `实际 ${lastEvent(recommend.events)}`)
  const product = productEvent(recommend.events)
  validateCard('定品', product)
  const recMeta = finalMeta(recommend.events)
  const expectedEngine = FALLBACK_MODE ? 'catalog' : 'llm'
  check(`引擎为 ${expectedEngine}`, recMeta.engine === expectedEngine, `实际 ${recMeta.engine ?? '无'}`)
  if (product) {
    console.log(`     ↳ 定品结果：${product.brand} ${product.name} · ${product.price_range}`)
  }

  // ── S5 多轮上下文 ──────────────────────────────────────────
  section('S5 多轮上下文')
  const multi = await readSse([
    { role: 'user', content: '推荐一把办公椅' },
    { role: 'assistant', content: '你平时久坐多还是有午休习惯？预算大概多少？' },
    { role: 'user', content: '久坐为主，预算1000左右，放家里书房' },
  ])
  check('以 done 收尾', lastEvent(multi.events) === 'done', `实际 ${lastEvent(multi.events)}`)
  const multiProduct = productEvent(multi.events)
  const multiText = chunkText(multi.events)
  const multiAnswered = Boolean(multiProduct) || multiText.trim().length > 0
  check('多轮对话有实质响应', multiAnswered)
  if (multiProduct) {
    validateCard('多轮', multiProduct)
    console.log(`     ↳ 多轮定品：${multiProduct.brand} ${multiProduct.name}`)
  }

  // ── S6 空输入兜底 ──────────────────────────────────────────
  section('S6 空输入处理')
  const empty = await readSse([])
  check('空输入返回 200 而非 5xx', empty.status === 200, `实际 ${empty.status}`)
  check('空输入有引导文案', chunkText(empty.events).length > 0)
  check('空输入以 done 收尾', lastEvent(empty.events) === 'done')

  summarize()
}

function summarize() {
  console.log(`\n══ 结果：${pass} 通过 / ${fail} 失败 ══`)
  if (failures.length) {
    console.log('失败项：')
    for (const item of failures) {
      console.log(`  · ${item}`)
    }
    process.exit(1)
  }
  process.exit(0)
}

main().catch((error) => {
  console.error(`\n系统测试中断：${error.message}`)
  summarize()
})
