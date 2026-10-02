#!/usr/bin/env node
/**
 * 定品线路（主 + 备用）的回归测试（纯离线，不联网、不发一次模型请求）。
 *
 * 为什么单独测这个：备用线路是**可用性保险**，而保险最典型的失效方式不是"配置写错"，
 * 而是「以为配了、其实没生效」——它在正常路径上永远不被走到，出问题那天才发现是空的。
 * 三个真实的坑，都在这里钉死：
 *
 * 1. **模型 ID ≠ 控制台显示名**。DeepSeek 官方控制台写的是 "DeepSeek-V4.1-Flash"，
 *    但 API 只认 `deepseek-flash`；填显示名第一次请求就被 400 顶回来
 *    （The supported API model names are deepseek-flash, deepseek-v4-pro.）。
 *    默认值必须是能直接用的那个 ID。
 *
 * 2. **两条线路的 label 不能重名**。label 同时是熔断器的分组键，
 *    重名会让"官方明明好好的"被主线路的连续失败一起拉黑 90s。
 *
 * 3. **视觉质检必须跟着"刚刚定品成功的那条线路"走**（2026-10-02 故障注入时实测到的 bug）：
 *    熔断阈值是"连续 3 次"，主线路第 1 次失败就把定品切给了备用，此时它还没进冷却期；
 *    质检若按熔断状态自行判断，就会继续走那条已经不通的线路 ——
 *    结果每张候选图白等一个 12s 超时，卡片全退成品牌标兜底。
 *
 * 用法：
 *   node --experimental-strip-types scripts/test-llm-lines.mjs
 *
 * ── 为什么要注册一个解析钩子 ─────────────────────────────────────
 * 源码里的相对导入是**无扩展名**的（`import { ... } from './transport'`），
 * Nuxt/Vite 能解析，裸 Node 的 ESM 解析器会报 ERR_MODULE_NOT_FOUND。
 * 用 data: URL 的 resolve 钩子补 `.ts` 后缀，保持单文件、不额外加依赖。
 * （同 test-brand-logo.mjs 的做法。）
 */

import { register } from 'node:module'

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (error) {
    // 只补「相对路径 + 无扩展名」这一种情况，别去猜别的。
    if (specifier.startsWith('.') && !/\\.[cm]?[jt]s$/.test(specifier)) {
      return next(specifier + '.ts', context)
    }
    throw error
  }
}
`),
)

const { resolveProviders, resolveVisionProvider, isProviderCoolingDown, noteFailure, resetBreakers } = await import(
  '../frontend/server/utils/llmBuyer.ts'
)

/** 与 nuxt.config.ts 的默认值保持一致 —— 这里写死是为了"默认值被改坏"时能立刻报警。 */
const OFFICIAL_BASE_URL = 'https://api.deepseek.com/v1'
const OFFICIAL_MODEL_ID = 'deepseek-flash'

/** 一份「主线路已配好、备用也配好」的基准 config。每个用例只覆盖关心的字段。 */
function makeConfig(overrides = {}) {
  return {
    llmApiKey: 'primary-key',
    llmBaseUrl: 'https://relay.example/v1',
    llmModel: 'relay-model',
    llmFallbackApiKey: 'fallback-key',
    llmFallbackBaseUrl: OFFICIAL_BASE_URL,
    llmFallbackModel: OFFICIAL_MODEL_ID,
    llmFallbackTimeoutMs: 0,
    imageJudgeModel: '',
    ...overrides,
  }
}

let checked = 0
let failed = 0

/**
 * @param {string} name
 * @param {string[]} problems 空数组 = 通过
 * @param {string} detail 通过时打印的摘要
 */
function check(name, problems, detail = '') {
  checked += 1
  if (problems.length) {
    failed += 1
    console.log(`❌ ${name}`)
    for (const problem of problems) {
      console.log(`     ${problem}`)
    }
  } else {
    console.log(`✅ ${name}${detail ? `  →  ${detail}` : ''}`)
  }
}

const describe = (providers) =>
  providers.map((provider) => `${provider.label}@${provider.baseUrl}`).join(' → ') || '(空)'

// ─────────────────────────────────────────────────────────────
// 一、线路组装
// ─────────────────────────────────────────────────────────────

{
  const providers = resolveProviders(makeConfig({ llmFallbackApiKey: '' }))
  check(
    '没配备用 KEY ⇒ 只有一条线路，行为与加备用之前完全一致',
    providers.length === 1 && providers[0].label === 'relay-model' ? [] : [`实际 ${describe(providers)}`],
    describe(providers),
  )
}

{
  const providers = resolveProviders(makeConfig())
  const problems = []
  if (providers.length !== 2) {
    problems.push(`线路数应为 2，实际 ${providers.length}`)
  }
  if (providers[0]?.label !== 'relay-model') {
    problems.push(`第 1 条应是主线路 relay-model，实际 ${providers[0]?.label}`)
  }
  if (providers[1]?.label !== OFFICIAL_MODEL_ID) {
    problems.push(`第 2 条 label 应是 ${OFFICIAL_MODEL_ID}，实际 ${providers[1]?.label}`)
  }
  if (providers[1]?.baseUrl !== OFFICIAL_BASE_URL) {
    problems.push(`第 2 条 baseUrl 应是 ${OFFICIAL_BASE_URL}，实际 ${providers[1]?.baseUrl}`)
  }
  if (providers[1]?.apiKey !== 'fallback-key') {
    problems.push('第 2 条没拿到备用 KEY —— 备用线路等于没配')
  }
  check('配了备用 KEY ⇒ 追加成第 2 条，顺序 = 主 → 备', problems, describe(providers))
}

{
  // 这是"控制台显示名 vs API 模型 ID"那个坑的锁：显示名会被官方 400 拒掉。
  const providers = resolveProviders(makeConfig({ llmFallbackModel: 'DeepSeek-V4.1-Flash' }))
  check(
    '备用线路用的是 config 里的模型 ID（不再做任何"系列名推断"）',
    providers[1]?.model === 'DeepSeek-V4.1-Flash' ? [] : [`实际 ${providers[1]?.model}`],
    '填错就原样透传，由官方 400 报错，绝不静默替换',
  )
}

{
  const providers = resolveProviders(makeConfig({ llmFallbackTimeoutMs: 30000 }))
  check(
    '备用线路可单独设超时（国内直连不必陪着主线路等满 40s）',
    providers[1]?.timeoutMs === 30000 ? [] : [`实际 ${providers[1]?.timeoutMs}`],
    `timeoutMs=${providers[1]?.timeoutMs}`,
  )
}

{
  const providers = resolveProviders(makeConfig({ llmFallbackTimeoutMs: 0 }))
  check(
    '备用超时留空 ⇒ 不写死值，交给全局 LLM_TIMEOUT_MS 兜',
    providers[1]?.timeoutMs === undefined ? [] : [`实际 ${providers[1]?.timeoutMs}`],
    `timeoutMs=${providers[1]?.timeoutMs}`,
  )
}

{
  const providers = resolveProviders(makeConfig({ llmModel: OFFICIAL_MODEL_ID }))
  const labels = providers.map((provider) => provider.label)
  const problems = []
  if (labels[0] === labels[1]) {
    problems.push(`两条线路 label 撞了（${labels[0]}）—— 熔断器会把它们当成同一条`)
  }
  if (!labels[1].includes('api.deepseek.com')) {
    problems.push(`第 2 条 label 应补上出口域名以示区分，实际 ${labels[1]}`)
  }
  check('两条线路重名时自动区分（熔断器分组键不能撞）', problems, labels.join(' / '))
}

{
  const providers = resolveProviders(makeConfig({ llmApiKey: '', llmBaseUrl: '', llmModel: '' }))
  check(
    '主线路缺失时可以只靠备用线路跑（备用不是"必须依附主线路"的装饰）',
    providers.length === 1 && providers[0].label === OFFICIAL_MODEL_ID ? [] : [describe(providers)],
    describe(providers),
  )
}

{
  const providers = resolveProviders(
    makeConfig({ llmApiKey: '', llmBaseUrl: '', llmModel: '', llmFallbackApiKey: '' }),
  )
  check('两条都没配 ⇒ 返回空，由上层抛「未配置」而不是悄悄假装能用', providers.length === 0 ? [] : [describe(providers)])
}

// ─────────────────────────────────────────────────────────────
// 二、视觉质检跟着哪条线路走
// ─────────────────────────────────────────────────────────────

{
  const config = makeConfig()
  const [primary, fallback] = resolveProviders(config)

  check(
    '质检默认跟主线路（未指定 IMAGE_JUDGE_MODEL）',
    resolveVisionProvider(config, primary)?.label === 'relay-model'
      ? []
      : [`实际 ${resolveVisionProvider(config, primary)?.label}`],
  )

  // 🔴 这条是 2026-10-02 那个 bug 的回归锁：定品已经落到备用线路，
  //    质检必须一起切；否则每张候选图白等 12s，卡片退成品牌标。
  const viaFallback = resolveVisionProvider(config, fallback)
  const problems = []
  if (viaFallback?.label !== OFFICIAL_MODEL_ID) {
    problems.push(`质检应跟定品所走的备用线路，实际 ${viaFallback?.label}`)
  }
  if (viaFallback?.baseUrl !== OFFICIAL_BASE_URL) {
    problems.push(`质检 baseUrl 应切到 ${OFFICIAL_BASE_URL}，实际 ${viaFallback?.baseUrl}`)
  }
  check('定品走备用线路时，质检跟着一起切（而不是继续打那条已挂的线路）', problems, describe([viaFallback]))
}

{
  const config = makeConfig({ imageJudgeModel: 'judge-model' })
  const [primary, fallback] = resolveProviders(config)

  check(
    'IMAGE_JUDGE_MODEL 在主线路出口上生效（同站换型号的口径）',
    resolveVisionProvider(config, primary)?.model === 'judge-model'
      ? []
      : [`实际 ${resolveVisionProvider(config, primary)?.model}`],
  )

  const onFallback = resolveVisionProvider(config, fallback)
  check(
    'IMAGE_JUDGE_MODEL 不套到备用出口上（那是另一家供应商，不一定有该型号）',
    onFallback?.model === OFFICIAL_MODEL_ID ? [] : [`实际 ${onFallback?.model}`],
    `实际用 ${onFallback?.model}`,
  )
}

{
  // 主线路进冷却期后，即使调用方没传 activeProvider，也不该再拿它做质检。
  resetBreakers()
  const config = makeConfig()
  const before = resolveVisionProvider(config)?.label
  for (let i = 0; i < 3; i += 1) {
    noteFailure('relay-model')
  }
  const cooling = isProviderCoolingDown('relay-model')
  const after = resolveVisionProvider(config)?.label
  resetBreakers()

  const problems = []
  if (!cooling) {
    problems.push('连续 3 次失败后主线路应进入冷却期')
  }
  if (after !== OFFICIAL_MODEL_ID) {
    problems.push(`主线路冷却时质检应改用备用，实际 ${after}`)
  }
  check('主线路熔断后质检自动改走备用', problems, `${before} → ${after}`)
}

// ─────────────────────────────────────────────────────────────

console.log('')
if (failed) {
  console.log(`❌ 定品线路 ${checked - failed}/${checked} 通过，${failed} 例失败`)
  process.exit(1)
}

console.log(`✅ 定品线路 全部通过（${checked} 例）`)
