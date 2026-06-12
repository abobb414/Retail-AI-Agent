interface IncomingMessage {
  role: 'assistant' | 'user'
  content: string
}

interface ChatRequest {
  messages?: IncomingMessage[]
}

const systemPrompt = `你是 Retail AI Agent，一位温和、专业、有审美判断力的家居零售顾问。
你的任务是通过自然对话理解用户的空间、氛围、预算、使用场景和偏好，然后给出具体、克制、可执行的建议。
如果用户信息还不够，请先问一个最关键的问题。回复使用中文，语气简洁、有质感。
不要使用 Markdown 加粗、标题符号或星号格式；用自然段落表达。`

function getLatestUserText(messages: IncomingMessage[]) {
  return [...messages]
    .reverse()
    .find((message) => message.role === 'user')
    ?.content ?? ''
}

function getRecentUserContext(messages: IncomingMessage[]) {
  return messages
    .filter((message) => message.role === 'user')
    .slice(-4)
    .map((message) => message.content)
    .join('\n')
}

function writeEvent(event: H3Event, name: string, data: unknown) {
  event.node.res.write(`event: ${name}\n`)
  event.node.res.write(`data: ${JSON.stringify(data)}\n\n`)
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody<ChatRequest>(event)
  const apiKey = config.deepseekApiKey
  const messages = body.messages ?? []
  const latestUserText = getLatestUserText(messages)
  const recommendationContext = getRecentUserContext(messages)
  const selectedProduct = wantsProductRecommendation(latestUserText)
    ? pickProductRecommendation(latestUserText)
    : null
  let assistantText = ''

  event.node.res.setHeader('Cache-Control', 'no-cache')
  event.node.res.setHeader('Connection', 'keep-alive')
  event.node.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')

  if (!apiKey) {
    event.node.res.statusCode = 500
    writeEvent(event, 'error', { message: 'DeepSeek API Key 未配置。' })
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
              content: `用户正在要求具体产品推荐。请围绕这一个产品推荐，不要另编商品名：${selectedProduct.name}。
产品信息：品牌 ${selectedProduct.brand}；类别 ${selectedProduct.category}；价格 ${selectedProduct.price_range}；核心理由：${selectedProduct.consultant_summary} ${selectedProduct.benefit} ${selectedProduct.pairing_note}`,
            }]
          : wantsProductRecommendation(latestUserText)
            ? [{
                role: 'system',
                content: `用户正在要求具体产品推荐，但本地精选库没有足够贴合的单品。请基于当前对话直接给出一个真实存在的具体产品名称和品牌，不要只追问。
如果信息不完整，请做合理假设，并在推荐中自然说明假设。回复里必须出现清晰的产品名，方便系统检索官网图片。`,
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
          assistantText += text
          writeEvent(event, 'chunk', { text })
        }
      }
    }
  }

  const liveProduct = selectedProduct
    ? null
    : await discoverLiveProductRecommendation(assistantText, latestUserText)

  if (selectedProduct || liveProduct) {
    writeEvent(event, 'product', {
      product: selectedProduct ?? liveProduct,
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
