#!/usr/bin/env node
/**
 * 探测某个 OpenAI 兼容端点上的模型「到底有没有视觉」。
 *
 * 为什么需要它：中转站（new-api / one-api 类）在能力上做的是「协议透传」，
 * 模型名是真的、但图片能不能进去、进去后模型看不看得见，只有实测才算数。
 * 失败形态有四种，肉眼区分很重要：
 *   1) HTTP 400 / 4xx，报 "image_url" 不支持  → 中转站或上游模型直接拒图
 *   2) HTTP 200，模型说「我看不到图片 / 我没视觉」 → 图被静默丢弃（真没视觉）
 *   3) HTTP 200，模型正确描述图片             → 真视觉
 *   4) HTTP 200，content 为空串 + finish_reason=length
 *      → 🔴 假性「没视觉」：推理型模型把预算全花在 reasoning_content 上，
 *        答案其实在里面，只是 content 被挤空。调大 max_tokens 即可。
 *        实测 glm-5.3-flash max_tokens=512 ⇒ 空串；=4096 ⇒ 正常作答。
 *
 * 用法：
 *   node scripts/probe-vision.mjs <baseUrl> <apiKey> <model> [imagePath]
 * 例：
 *   node scripts/probe-vision.mjs https://cn.chatapi.app/v1 sk-xxx glm-5.3-flash /tmp/vtest.png
 */

import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

const [, , baseUrl, apiKey, model, imagePathArg] = process.argv
if (!baseUrl || !apiKey || !model) {
  console.error('usage: node scripts/probe-vision.mjs <baseUrl> <apiKey> <model> [imagePath]')
  process.exit(1)
}

const imagePath = imagePathArg || '/tmp/vtest.png'
const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(imagePath).toLowerCase()] || 'image/png'
const dataUrl = `data:${mime};base64,${readFileSync(imagePath).toString('base64')}`
const endpoint = baseUrl.replace(/\/+$/, '') + '/chat/completions'

// 图片内容：一张零售导购 App 的结果页截图。问题问得很具体，
// 只要模型真看见了就必然能说出「推荐 / 商品卡 / 价格」这类词。
const question = '这张图里是什么界面？请说出你看到的具体文字和元素。如果你看不到图片，请直接回答「我看不到图片」。'

async function call(payload, label) {
  const t0 = Date.now()
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  })
  const text = await res.text()
  const ms = Date.now() - t0
  console.log(`\n===== ${label} =====`)
  console.log(`HTTP ${res.status}  ${ms}ms`)
  if (!res.ok) {
    console.log(text.slice(0, 800))
    return { ok: false, status: res.status, text }
  }
  let json
  try { json = JSON.parse(text) } catch { console.log(text.slice(0, 800)); return { ok: false, status: 200, text } }
  const msg = json.choices?.[0]?.message
  const content = typeof msg?.content === 'string' ? msg.content : JSON.stringify(msg?.content)
  console.log('content:', (content || '').slice(0, 600))
  console.log('usage:', JSON.stringify(json.usage))
  console.log('reasoning_content:', (msg?.reasoning_content || '').slice(0, 200))
  return { ok: true, status: 200, content: content || '' }
}

console.log(`endpoint: ${endpoint}`)
console.log(`model   : ${model}`)
console.log(`image   : ${imagePath} (${mime}, ${(dataUrl.length / 1024).toFixed(0)}KB base64)`)

// 三次对照，缺一不可：
//  A. 纯文本  —— 证明 key/模型/端点这一路是通的（排除「连不上」干扰）
//  B. 图片问询 —— 真正的视觉测试
//  C. 图片问询(强制不看图就认输) —— 已合并在 B 的问题里
// 🔴 max_tokens 必须给足！推理型模型（glm-5.3-flash 等）会先写一大段 reasoning_content，
//    预算不够时全部消耗在思考上，content 返回空串、finish_reason=length —— 
//    这会被误读成「模型没有视觉」，其实是答案被思考过程吃光了。
//    本脚本初版就踩了这个坑（max_tokens: 512 ⇒ 误判为无视觉）。
const MAX_TOKENS = 4096

const REFUSE_RE = /看不到|没有视觉|无法查看图片|无法看到|不能查看图片|无法识别图片|请上传图片|I can(not|'t) see|no vision|unable to view|no image/i

const textOnly = await call({
  model,
  messages: [{ role: 'user', content: '只回答两个字：收到' }],
  max_tokens: MAX_TOKENS,
}, 'A. 纯文本连通性')

const noImage = await call({
  model,
  messages: [{ role: 'user', content: question }],
  max_tokens: MAX_TOKENS,
}, 'B. 同一问题·不带图（对照组）')

const vision = await call({
  model,
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: question },
      { type: 'image_url', image_url: { url: dataUrl } },
    ],
  }],
  max_tokens: MAX_TOKENS,
}, 'C. 同一问题·带图')

console.log('\n===== 判定 =====')
if (!textOnly.ok) {
  console.log('❌ 纯文本都不通，先修连通性，视觉结论无效')
} else if (!vision.ok) {
  console.log(`❌ 带图请求被拒（HTTP ${vision.status}）→ 该端点/模型不接受 image_url`)
} else if (REFUSE_RE.test(vision.content)) {
  console.log('❌ 请求 200 但模型自述看不见图 → 图被静默丢弃（中转站剥图 / 模型本身无视觉）')
} else if (!vision.content) {
  console.log('⚠️ content 为空 → 十有八九是 max_tokens 被 reasoning_content 吃光，不是没视觉；看上面的 reasoning 段')
} else if (vision.content.length > 10) {
  console.log('✅ 带图时模型给出了图片内容描述 → 具备视觉通道')
  if (!REFUSE_RE.test(noImage.content)) {
    console.log(`   ⚠️ 但对照组（不带图）也给了回答：「${noImage.content.slice(0, 60)}」`)
    console.log('      ⇒ 可能是凭常识在编，结论不可信 —— 换「随机字符串图」复测（见 probe-vision-sweep.mjs 思路）')
  } else {
    console.log('   ✔ 对照组（不带图）明确拒答 ⇒ 图片确实进了模型，视觉成立')
  }
}
