#!/usr/bin/env node
/**
 * 工具调用协议标记（DSML）剥离的回归测试（纯离线，不联网、不调大模型）。
 *
 * 为什么单独测这个：2026-10-10 的 30 例自然对话回归里，用例 01（服饰/跑步鞋）
 * 偶发整屏乱码且不出卡，正文是模型吐出的**工具调用原文**：
 *
 *   <｟DSML｠ calls>
 *   <｟DSML｠ invoke name="web_search">
 *   <｟DSML｠ parameter name="query">男士跑步鞋 500元以内<｟DSML｠ parameter>
 *
 * （上面用 ｟ ｠ 代指竖线，实际是全角 `｜` U+FF5C 或半角 `|`。）
 *
 * 根因：模型偶尔不走标准 `tool_calls` 字段，改用这段文本协议；后端只认标准字段，
 * 认不出它，于是它顺着「模型没返回 JSON」的兜底分支**被当成追问正文原样发给用户**。
 * 复现率约 10%~25% —— 单次通过完全不能说明问题，必须用测试把规则钉死。
 *
 * 用法：
 *   node --experimental-strip-types scripts/test-tool-protocol.mjs
 *
 * ── 为什么要注册一个解析钩子 ─────────────────────────────────────
 * `llmBuyer.ts` 里有一批**无扩展名**的相对导入（`from './sourcePage'` 等），
 * 这在 Nuxt/Vite 里没问题，但裸 Node 的 ESM 解析器会直接报
 * `ERR_MODULE_NOT_FOUND`。用一个 data: URL 的 resolve 钩子补 `.ts` 后缀 ——
 * 与 `test-brand-logo.mjs` / `test-llm-lines.mjs` 保持同一套做法，不额外加脚本。
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

const { stripToolProtocol, hasToolProtocol, sanitizeCopyText } = await import(
  '../frontend/server/utils/llmBuyer.ts'
)

const FW = '\uFF5C' // 全角竖线
const HW = '|' // 半角竖线

/** 真实泄漏原文（取自 2026-10-10 的测试日志，全角竖线，未闭合）。 */
const REAL_LEAK = [
  `<${FW}${FW}DSML${FW}${FW} calls>`,
  `<${FW}${FW}DSML${FW}${FW} invoke name="web_search">`,
  `<${FW}${FW}DSML${FW}${FW} parameter name="query" string="true">男士跑步鞋 500元以内</${FW}${FW}DSML${FW}${FW} parameter>`,
  `</${FW}${FW}DSML${FW}${FW} invoke>`,
  `</${FW}${FW}DSML${FW}${FW} calls>`,
].join('\n')

let pass = 0
let fail = 0
let group = ''

function section(name) {
  group = name
  console.log(`\n==== ${name} ====`)
}

function check(name, got, want) {
  const ok = got === want
  ok ? pass++ : fail++
  console.log(`${ok ? '  ok  ' : ' FAIL '} | ${name}`)
  if (!ok) {
    console.log(`         [${group}] 期望=${JSON.stringify(want)}`)
    console.log(`         实际=${JSON.stringify(got)}`)
  }
}

// ── 1. 剥离：协议文本必须剥净，人话必须留住 ─────────────────────────
section('stripToolProtocol —— 剥离协议、保留人话')
check('真实泄漏原文（全角）剥净', stripToolProtocol(REAL_LEAK), '')
check('真实泄漏 + 前置人话 → 只留人话', stripToolProtocol(`这款很适合你。\n${REAL_LEAK}`), '这款很适合你。')
check('真实泄漏 + 后置人话 → 只留人话', stripToolProtocol(`${REAL_LEAK}\n想要我继续推荐吗？`), '想要我继续推荐吗？')
check('半角纯协议剥净（单角标，贴近真实）', stripToolProtocol(`<${HW}${HW}DSML${HW}${HW} calls>`), '')
check('半角未闭合尾部 → 只留前半句', stripToolProtocol(`前半句${HW}${HW}DSML${HW}${HW} invoke name="x"`), '前半句')
check('无 `<` 前缀的协议块也剥', stripToolProtocol(`${FW}${FW}DSML${FW}${FW} calls> 后面的话`), '后面的话')

// ── 2. 反例：正常文案一个字符都不许动 ───────────────────────────────
section('stripToolProtocol —— 正常文案不许被误伤')
const INTACT = [
  ['正常追问不变', '你平时穿男款还是女款？'],
  ['正常成稿不变', '推荐 Nike Pegasus 41，缓震适合日常慢跑。'],
  ['含管道符的文案不变', '预算是 500 | 800 两档，你选哪个？'],
  ['Markdown 表格不变', '| 型号 | 价格 |\n| --- | --- |\n| Pegasus 41 | 799 |'],
  ['含域名不变', '这款在 fdsports.com 有评测，可以去看看。'],
  ['含竖线的网址不变', 'https://example.com/a|b?x=1|2'],
]
for (const [name, text] of INTACT) check(name, stripToolProtocol(text), text)

// ── 3. hasToolProtocol：判定要准，不能把普通文案判成泄漏 ────────────
section('hasToolProtocol —— 判定泄漏')
check('真实泄漏原文 → true', hasToolProtocol(REAL_LEAK), true)
check('半角协议 → true', hasToolProtocol(`${HW}${HW}DSML${HW}${HW} x`), true)
check('正常追问 → false', hasToolProtocol('你平时穿男款还是女款？'), false)
check('正常成稿 → false', hasToolProtocol('推荐 Nike Pegasus 41。'), false)
check('含 fdsports 域名不误判 → false', hasToolProtocol('参考 fdsports.com 的评测'), false)

// ── 4. sanitizeCopyText：纵深防御，顺手把清洗规则一起钉住 ───────────
section('sanitizeCopyText —— 纵深防御')
check('协议文本清洗为空', sanitizeCopyText(REAL_LEAK), '')
check('人话中的协议被剥、人话保留', sanitizeCopyText(`推荐这款。${REAL_LEAK}`), '推荐这款。')
check('您 → 你', sanitizeCopyText('您可以在 fdsports.com 看看'), '你可以在 fdsports.com 看看')
check('「欢迎来到」套话被去掉', sanitizeCopyText('欢迎来到本店，这款适合你'), '这款适合你')
check('「推荐理由：」前缀被去掉', sanitizeCopyText('推荐理由：缓震好'), '缓震好')
check('非字符串返回空串', sanitizeCopyText(null), '')

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
