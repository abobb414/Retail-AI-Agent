#!/usr/bin/env node
/**
 * 定品线路的回归测试（纯离线，不联网、不发一次模型请求）。
 *
 * 2026-11-18 起只有**一条**线路（DeepSeek 官方直连），这里钉住的是
 * 「配置写错也不会静默降级成别的行为」这类坑：
 *
 * 1. **模型 ID ≠ 控制台显示名**。控制台写 "DeepSeek-V4.1-Flash"，API 只认
 *    `deepseek-flash`；默认值必须是能直接用的那个 ID。
 * 2. **原生联网只在官方端点生效**。`https://api.deepseek.com/v1` 才声明
 *    `deepseek_web_search`；换成别的域名（哪怕是长得像的）必须退回老路径，
 *    否则请求会被对端 400 顶回来。
 * 3. **视觉质检跟着「刚刚定品成功的那条线路」走**（2026-10-02 故障注入时实测到的 bug）：
 *    定品失败后线路进入熔断，质检若按熔断状态自行判断，就会继续打那条已经不通的线路 ——
 *    每张候选图白等一个 12s 超时，卡片全退成品牌标兜底。
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

function makeConfig(overrides = {}) {
  return {
    llmApiKey: 'test-key',
    llmBaseUrl: OFFICIAL_BASE_URL,
    llmModel: OFFICIAL_MODEL_ID,
    llmWebSearch: true,
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
  const providers = resolveProviders(makeConfig())
  const problems = []

  if (providers.length !== 1) {
    problems.push(`线路数应为 1，实际 ${providers.length}`)
  }
  if (providers[0]?.label !== OFFICIAL_MODEL_ID) {
    problems.push(`label 应是 ${OFFICIAL_MODEL_ID}，实际 ${providers[0]?.label}`)
  }
  if (providers[0]?.baseUrl !== OFFICIAL_BASE_URL) {
    problems.push(`baseUrl 应是 ${OFFICIAL_BASE_URL}，实际 ${providers[0]?.baseUrl}`)
  }
  if (providers[0]?.apiKey !== 'test-key') {
    problems.push('apiKey 没被带上')
  }

  check('完整配置 ⇒ 恰好一条官方线路', problems, describe(providers))
}

for (const missing of ['llmApiKey', 'llmBaseUrl', 'llmModel']) {
  const providers = resolveProviders(makeConfig({ [missing]: '' }))
  check(
    `缺 ${missing} ⇒ 返回空（由上层报「未配置」，而不是发一个注定 400 的请求）`,
    providers.length === 0 ? [] : [describe(providers)],
  )
}

{
  const providers = resolveProviders(makeConfig({ llmModel: 'DeepSeek-V4.1-Flash' }))
  check(
    '模型 ID 原样透传（不做任何"系列名推断"）',
    providers[0]?.model === 'DeepSeek-V4.1-Flash' ? [] : [`实际 ${providers[0]?.model}`],
    '填显示名就由官方 400 报错，别静默替换成别的型号',
  )
}

// ─────────────────────────────────────────────────────────────
// 二、原生联网的启用条件
// ─────────────────────────────────────────────────────────────

{
  const [provider] = resolveProviders(makeConfig())
  check('官方端点 + LLM_WEB_SEARCH 开 ⇒ 声明 deepseek_web_search', provider?.nativeWebSearch === true)
}

{
  const [provider] = resolveProviders(makeConfig({ llmWebSearch: false }))
  check('LLM_WEB_SEARCH=0 ⇒ 不声明服务端工具', provider?.nativeWebSearch === false)
}

for (const baseUrl of [
  'https://api.deepseek.com.evil.com/v1',
  'https://relay.example/v1',
  'https://api.deepseek.com.cn/v1',
]) {
  const [provider] = resolveProviders(makeConfig({ llmBaseUrl: baseUrl }))
  check(
    `非官方端点 ${baseUrl} ⇒ 不声明服务端工具`,
    provider?.nativeWebSearch === false ? [] : [`实际 nativeWebSearch=${provider?.nativeWebSearch}`],
  )
}

// ─────────────────────────────────────────────────────────────
// 三、视觉质检跟着哪条线路走
// ─────────────────────────────────────────────────────────────

{
  const config = makeConfig()
  const [primary] = resolveProviders(config)

  check(
    '质检默认跟定品线路（未指定 IMAGE_JUDGE_MODEL）',
    resolveVisionProvider(config, primary)?.label === OFFICIAL_MODEL_ID
      ? []
      : [`实际 ${resolveVisionProvider(config, primary)?.label}`],
  )
}

{
  const config = makeConfig({ imageJudgeModel: 'judge-model' })
  const [primary] = resolveProviders(config)

  check(
    'IMAGE_JUDGE_MODEL 生效（同站换型号的口径）',
    resolveVisionProvider(config, primary)?.model === 'judge-model'
      ? []
      : [`实际 ${resolveVisionProvider(config, primary)?.model}`],
  )
}

{
  // 定品已经证明这条线路能通，即使熔断器此刻判它冷却，质检也应当继续用它 ——
  // 否则就是拿一条已知不通的路去判定每一张图。
  resetBreakers()
  const config = makeConfig()
  const [primary] = resolveProviders(config)
  for (let i = 0; i < 3; i += 1) {
    noteFailure(OFFICIAL_MODEL_ID)
  }
  const cooling = isProviderCoolingDown(OFFICIAL_MODEL_ID)
  const explicit = resolveVisionProvider(config, primary)
  const implicit = resolveVisionProvider(config)
  resetBreakers()

  const problems = []
  if (!cooling) {
    problems.push('连续 3 次失败后线路应进入冷却期')
  }
  if (explicit?.label !== OFFICIAL_MODEL_ID) {
    problems.push(`显式传入定品线路时应照样返回它，实际 ${explicit?.label}`)
  }
  if (implicit !== null) {
    problems.push(`没传定品线路且处于冷却期时应返回 null，实际 ${implicit?.label}`)
  }
  check('熔断期的行为：显式跟随 / 隐式放弃', problems)
}

// ─────────────────────────────────────────────────────────────

console.log('')
if (failed) {
  console.log(`❌ 定品线路 ${checked - failed}/${checked} 通过，${failed} 例失败`)
  process.exit(1)
}

console.log(`✅ 定品线路 全部通过（${checked} 例）`)
