#!/usr/bin/env node
/**
 * 同一张图、同一个端点，横扫多个模型，看「谁是真视觉 / 谁把答案藏在 reasoning_content 里」。
 * 用法：node scripts/probe-vision-sweep.mjs <baseUrl> <apiKey> <model1> [model2] ...
 */
import { readFileSync } from 'node:fs'

const [, , baseUrl, apiKey, ...models] = process.argv
const dataUrl = `data:image/png;base64,${readFileSync('/tmp/vtest.png').toString('base64')}`
const endpoint = baseUrl.replace(/\/+$/, '') + '/chat/completions'

for (const model of models) {
  const t0 = Date.now()
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '这张图左上角的标题文字是什么颜色、写的什么？图里推荐了什么商品？直接给答案。' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }],
        max_tokens: 4096,
      }),
      signal: AbortSignal.timeout(180000),
    })
    const json = JSON.parse(await res.text())
    const msg = json.choices?.[0]?.message || {}
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '')
    const reasoning = msg.reasoning_content || ''
    const u = json.usage || {}
    console.log(`\n===== ${model} ===== HTTP ${res.status} ${Date.now() - t0}ms`)
    console.log(`prompt_tokens=${u.prompt_tokens}  image_tokens=${u.prompt_tokens_details?.image_tokens}  completion=${u.completion_tokens} (reasoning=${u.completion_tokens_details?.reasoning_tokens})`)
    console.log(`finish_reason=${json.choices?.[0]?.finish_reason}`)
    console.log(`content[${content.length}]: ${content.slice(0, 300) || '(空)'}`)
    console.log(`reasoning[${reasoning.length}]: ${reasoning.slice(0, 300) || '(空)'}`)
  }
  catch (e) {
    console.log(`\n===== ${model} ===== 失败: ${e.message}`)
  }
}
