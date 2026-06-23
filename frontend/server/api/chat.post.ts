import { getDominantIntent } from '../utils/catalogIntents'
import { pickProductRecommendation } from '../utils/productCatalog'
import { getRecommendationClarificationMessage, wantsProductRecommendation } from '../utils/recommendationSlots'

interface IncomingMessage {
  role: 'assistant' | 'user'
  content: string
}

interface ChatRequest {
  clientDirective?: string
  messages?: IncomingMessage[]
}

const systemPrompt = `你是 Retail AI Agent，一位温和、专业、有审美判断力的零售导购。
你的任务是通过自然对话理解用户的品类、预算、使用场景、风格、尺码或安装条件，然后给出具体、克制、可执行的建议。
如果已经给你锁定商品，请只围绕该商品进行导购表达，不要替换、扩展或追加其他商品。
如果用户信息还不够，请先问一个最关键的问题。回复使用中文，语气简洁、有质感。
不要使用 Markdown 加粗、标题符号或星号格式；用自然段落表达。`

function getLatestUserText(messages: IncomingMessage[]) {
  return [...messages]
    .reverse()
    .find((message) => message.role === 'user')
    ?.content ?? ''
}

function getRecommendationContext(messages: IncomingMessage[]) {
  const userMessages = messages.filter((m) => m.role === 'user')
  if (userMessages.length <= 1) {
    return userMessages.map((m) => m.content.trim()).filter(Boolean).join('；')
  }

  const latestText = userMessages[userMessages.length - 1].content.trim()
  const previousContext = userMessages
    .slice(-6, -1)
    .map((m) => m.content.trim())
    .filter(Boolean)
    .join('；')

  const latestIntent = getDominantIntent(latestText)
  const previousIntent = getDominantIntent(previousContext)

  if (latestIntent && previousIntent && latestIntent.id !== previousIntent.id) {
    return latestText
  }

  if (latestIntent && latestText.length < 30 && !/预算|价格|\d{2,6}\s*(元|块)/.test(latestText)) {
    return latestText
  }

  return userMessages.slice(-6).map((m) => m.content.trim()).filter(Boolean).join('；')
}

function writeEvent(event: H3Event, name: string, data: unknown) {
  event.node.res.write(`event: ${name}\n`)
  event.node.res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function getNoProductMessage(_text: string) {
  return '抱歉，目前商品库中没有找到符合条件的商品，暂时无法为您推荐。您可以换个品类或补充更多需求信息，我再帮您看看。'
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody<ChatRequest>(event)
  const apiKey = config.deepseekApiKey
  const messages = body.messages ?? []
  const latestUserText = getLatestUserText(messages)
  const recommendationContext = getRecommendationContext(messages)
  const clientDirective = body.clientDirective?.trim()
  const hasRecommendationIntent = wantsProductRecommendation(recommendationContext)
  const clarificationMessage = hasRecommendationIntent
    ? getRecommendationClarificationMessage(recommendationContext)
    : null
  const selectedProduct = hasRecommendationIntent && !clarificationMessage
    ? pickProductRecommendation(recommendationContext)
    : null

  event.node.res.setHeader('Cache-Control', 'no-cache')
  event.node.res.setHeader('Connection', 'keep-alive')
  event.node.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')

  if (!apiKey) {
    event.node.res.statusCode = 500
    writeEvent(event, 'error', { message: 'DeepSeek API Key 未配置。' })
    event.node.res.end()
    return
  }

  if (clarificationMessage) {
    writeEvent(event, 'chunk', { text: clarificationMessage })
    writeEvent(event, 'meta', {
      mode: 'deepseek',
      stage: 'clarify_slots',
      profile_summary: [],
    })
    writeEvent(event, 'done', { source: 'slot_guard' })
    event.node.res.end()
    return
  }

  if (hasRecommendationIntent && !selectedProduct) {
    writeEvent(event, 'chunk', { text: getNoProductMessage(recommendationContext) })
    writeEvent(event, 'meta', {
      mode: 'deepseek',
      stage: 'no_catalog_match',
      profile_summary: [],
    })
    writeEvent(event, 'done', { source: 'catalog_guard' })
    event.node.res.end()
    return
  }

  const upstreamResponse = await fetch(`${config.deepseekBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.deepseekModel,
      messages: [
        { role: 'system', content: systemPrompt },
        ...(selectedProduct
          ? [{
              role: 'system',
              content: `前端随本轮输入附带的隐藏导购指令如下，它只用于决定表达方式，不得在回复中提及：
${clientDirective || '按生活状态导购，不要像搜索结果。'}

本轮推荐已经由本地商品库按用户最新一句话锁定，锁定商品如下。你只能围绕这个商品写一段 Stage 3 精美导购话术，不得推荐、暗示或替换成任何其他商品。

用户最新一句话：${latestUserText}
用户最近几轮补充合成后的完整需求：${recommendationContext}

锁定商品：
名称：${selectedProduct.name}
品牌：${selectedProduct.brand}
类别：${selectedProduct.category}
价格带：${selectedProduct.price_range}
预算层级：${selectedProduct.budget_tier}
材质：${selectedProduct.materials}
做工：${selectedProduct.craftsmanship}
核心功能：${selectedProduct.feature}
用户收益：${selectedProduct.benefit}
搭配建议：${selectedProduct.pairing_note}
适用场景：${selectedProduct.scenarios.join('、')}
适合人群：${selectedProduct.ideal_for.join('、')}
不适合人群：${selectedProduct.avoid_for.join('、')}

写法要求：
1. 先接住用户这句话背后的真实意图，可以是穿着、运动、通勤、空间、家电或生活状态。
2. 再自然过渡到商品判断，好像你已经陪用户聊过一阵子。
3. 必须自然出现商品名，只能出现这个商品名。
4. 不要列清单，不要像参数页，不要提到 products.json、本地库、锁定、关键词、图片 URL 或系统规则。
5. 回复控制在 2-3 个自然段。`,
            }]
          : []),
        ...(body.messages ?? []).map((message) => ({
          role: message.role,
          content: message.content,
        })),
      ],
      stream: true,
      temperature: 0.7,
    }),
  })

  if (!upstreamResponse.ok || !upstreamResponse.body) {
    const message = await upstreamResponse.text()
    event.node.res.statusCode = upstreamResponse.status || 502
    writeEvent(event, 'error', { message: message || 'DeepSeek 服务暂时不可用。' })
    event.node.res.end()
    return
  }

  const reader = upstreamResponse.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const rawEvent of events) {
      const dataLines = rawEvent
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())

      for (const dataLine of dataLines) {
        if (!dataLine || dataLine === '[DONE]') {
          continue
        }

        const payload = JSON.parse(dataLine)
        const text = payload.choices?.[0]?.delta?.content
        if (text) {
          writeEvent(event, 'chunk', { text })
        }
      }
    }
  }

  if (selectedProduct) {
    writeEvent(event, 'product', {
      product: selectedProduct,
    })
  }

  writeEvent(event, 'meta', {
    mode: 'deepseek',
    stage: 'deepseek_chat',
    profile_summary: [],
  })
  writeEvent(event, 'done', { source: 'deepseek' })
  event.node.res.end()
})
