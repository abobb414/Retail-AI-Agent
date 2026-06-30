import https from 'node:https'

interface IncomingMessage {
  role: 'assistant' | 'user'
  content: string
}

interface ChatRequest {
  messages?: IncomingMessage[]
}

interface WorkerRecommendedProduct {
  id: string
  name: string
  brand: string
  price_display: string
  image: string
  url: string
  why_buy: string
  ideal_for: string[]
  avoid_for: string[]
  next_step_tip: string
}

interface WorkerChatResponse {
  chat_reply: string
  recommended_product: WorkerRecommendedProduct | null
  stage?: 'clarify_slots' | 'rag_recommendation' | 'no_vector_match'
}

function getLatestUserText(messages: IncomingMessage[]) {
  return [...messages]
    .reverse()
    .find((message) => message.role === 'user')
    ?.content
    .trim() ?? ''
}

function buildWorkerMessage(messages: IncomingMessage[]) {
  const userMessages = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim())
    .filter(Boolean)

  if (userMessages.length === 0) {
    return ''
  }

  return userMessages.slice(-4).join('；')
}

function writeEvent(event: H3Event, name: string, data: unknown) {
  event.node.res.write(`event: ${name}\n`)
  event.node.res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function toRecommendation(product: WorkerRecommendedProduct) {
  return {
    name: product.name,
    brand: product.brand,
    category: '运动服饰',
    image: product.image,
    price_range: product.price_display,
    budget_tier: '',
    consultant_summary: product.why_buy,
    materials: '',
    craftsmanship: product.why_buy,
    pairing_note: product.next_step_tip,
    style_tags: [],
    room_tags: [],
    signature_specs: [`商品ID: ${product.id}`],
    matched_preferences: [],
    why_this: [product.why_buy],
    ideal_for: product.ideal_for,
    avoid_for: product.avoid_for,
    why_not_others: '',
    scenarios: [],
    source_url: product.url,
  }
}

function parseWorkerError(responseText: string, fallback: string) {
  try {
    const parsed = JSON.parse(responseText) as { error?: unknown; message?: unknown }
    const message = parsed.error ?? parsed.message

    if (typeof message === 'string' && message.trim()) {
      return message
    }
  } catch {
    // Keep the original response text below when it is not JSON.
  }

  return responseText || fallback
}

async function postWorkerChat(
  workerChatUrl: string,
  resolveIp: string,
  payload: { message: string },
): Promise<WorkerChatResponse> {
  if (!resolveIp) {
    const response = await fetch(workerChatUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const text = await response.text()

    if (!response.ok) {
      throw new Error(parseWorkerError(text, `Worker returned HTTP ${response.status}`))
    }

    return JSON.parse(text)
  }

  return await postWorkerChatWithResolvedIp(workerChatUrl, resolveIp, payload)
}

function postWorkerChatWithResolvedIp(
  workerChatUrl: string,
  resolveIp: string,
  payload: { message: string },
): Promise<WorkerChatResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(workerChatUrl)
    const body = JSON.stringify(payload)
    const request = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        servername: target.hostname,
        headers: {
          host: target.host,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
        lookup: (_hostname, options, callback) => {
          if (typeof options === 'function') {
            options(null, resolveIp, 4)
            return
          }

          if (options?.all) {
            callback(null, [{ address: resolveIp, family: 4 }])
            return
          }

          callback(null, resolveIp, 4)
        },
      },
      (response) => {
        let responseText = ''

        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          responseText += chunk
        })
        response.on('end', () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(parseWorkerError(responseText, `Worker returned HTTP ${response.statusCode}`)))
            return
          }

          try {
            resolve(JSON.parse(responseText))
          } catch (error) {
            reject(error)
          }
        })
      },
    )

    request.on('error', reject)
    request.setTimeout(90_000, () => {
      request.destroy(new Error('Worker request timed out.'))
    })
    request.write(body)
    request.end()
  })
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody<ChatRequest>(event)
  const messages = body.messages ?? []
  const latestUserText = getLatestUserText(messages)
  const workerMessage = buildWorkerMessage(messages)

  event.node.res.setHeader('Cache-Control', 'no-cache')
  event.node.res.setHeader('Connection', 'keep-alive')
  event.node.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')

  if (!config.workerChatUrl) {
    event.node.res.statusCode = 500
    writeEvent(event, 'error', { message: 'Cloudflare Worker Chat URL 未配置。' })
    event.node.res.end()
    return
  }

  if (!latestUserText) {
    writeEvent(event, 'chunk', { text: '你可以告诉我想找的品类、预算或使用场景，我再帮你从真实商品库里挑。' })
    writeEvent(event, 'done', { source: 'empty_input' })
    event.node.res.end()
    return
  }

  try {
    const workerResponse = await postWorkerChat(
      config.workerChatUrl,
      config.workerResolveIp,
      { message: workerMessage || latestUserText },
    )

    writeEvent(event, 'chunk', { text: workerResponse.chat_reply })

    if (workerResponse.recommended_product) {
      writeEvent(event, 'product', {
        product: toRecommendation(workerResponse.recommended_product),
      })
    }

    writeEvent(event, 'meta', {
      mode: 'cloudflare_worker',
      stage: workerResponse.stage ?? (workerResponse.recommended_product ? 'rag_recommendation' : 'no_vector_match'),
      profile_summary: [],
    })
    writeEvent(event, 'done', { source: 'cloudflare_worker' })
  } catch (error) {
    event.node.res.statusCode = 502
    writeEvent(event, 'error', {
      message: error instanceof Error ? error.message : 'Cloudflare Worker 服务暂时不可用。',
    })
  } finally {
    event.node.res.end()
  }
})
