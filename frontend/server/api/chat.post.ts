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
  category?: string
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

interface PolishedRecommendationCopy {
  chat_reply?: string
  consultant_summary?: string
  craftsmanship?: string
  pairing_note?: string
  why_this?: string[]
  ideal_for?: string[]
  avoid_for?: string[]
  why_not_others?: string
  scenarios?: string[]
  matched_preferences?: string[]
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

  const latestUserMessage = userMessages.at(-1) ?? ''

  if (isStandaloneProductRequest(latestUserMessage)) {
    return latestUserMessage
  }

  return userMessages.slice(-4).join('；')
}

function isStandaloneProductRequest(message: string) {
  const text = normalizeIntentText(message)
  const hasKind = /半袖|短袖|t恤|tee|上衣|衬衫|polo|鞋|裤|外套|夹克|卫衣|包|灯|照明|台灯|香薰|收纳|床品|小家具|椅|桌|沙发|空调|冰箱|洗衣机|烤箱|咖啡机/.test(text)
  const hasBudget = /\d+(?:\.\d+)?\s*(?:元|块|rmb|cny|以内|以下|左右|上下)|预算/.test(text)
  const hasAudience = /男士|男生|男子|男款|男式|女士|女生|女子|女款|女式|儿童|孩子|宝宝|中性/.test(text)
  const hasScene = /通勤|上班|办公室|跑步|健身|训练|户外|日常|休闲|卧室|客厅|厨房|书房|小卧室|小户型/.test(text)
  const hasSwitchCue = /再给我|换|重新|另外|下一轮|新/.test(text)

  return hasKind && (hasBudget || hasAudience || hasScene || hasSwitchCue)
}

function normalizeIntentText(message: string) {
  return message.toLowerCase().replace(/\s+/g, '')
}

function writeEvent(event: H3Event, name: string, data: unknown) {
  event.node.res.write(`event: ${name}\n`)
  event.node.res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function toRecommendation(product: WorkerRecommendedProduct) {
  return {
    name: product.name,
    brand: product.brand,
    category: product.category || inferDisplayCategory(product),
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

function inferDisplayCategory(product: WorkerRecommendedProduct) {
  const text = normalizeIntentText(`${product.name} ${product.brand} ${product.why_buy}`)

  if (/灯|照明|台灯|落地灯|吊灯|壁灯|氛围灯|橱柜照明|led/.test(text)) {
    return '照明灯具'
  }

  if (/香薰|香氛|精油|扩香/.test(text)) {
    return '家居香氛'
  }

  if (/收纳|置物|储物|柜|架|盒|箱|篮/.test(text)) {
    return '收纳整理'
  }

  if (/椅|凳|沙发/.test(text)) {
    return '座椅沙发'
  }

  if (/桌|茶几|书桌|餐桌/.test(text)) {
    return '桌几'
  }

  if (/床品|床单|被套|枕|床笠|毯/.test(text)) {
    return '床品家纺'
  }

  if (/空调|冰箱|洗衣机|烤箱|咖啡机|洗碗机|电饭煲|家电/.test(text)) {
    return '家用电器'
  }

  if (/半袖|短袖|t恤|tee|polo|圆领|上衣/.test(text)) {
    return 'T恤/短袖'
  }

  if (/跑鞋|运动鞋|篮球鞋|足球鞋|板鞋|德训鞋|鞋|靴|凉鞋/.test(text)) {
    return '鞋履'
  }

  if (/运动裤|短裤|长裤|裤/.test(text)) {
    return '裤装'
  }

  if (/外套|夹克|冲锋衣|卫衣|风衣|羽绒服/.test(text)) {
    return '外套'
  }

  if (/背包|斜挎包|单肩包|托特包|包/.test(text)) {
    return '包袋'
  }

  if (/宠物|猫|狗/.test(text)) {
    return '宠物用品'
  }

  return '精选商品'
}

function mergeRecommendationCopy(
  product: WorkerRecommendedProduct,
  copy: PolishedRecommendationCopy | null,
) {
  const fallback = toRecommendation(product)

  if (!copy) {
    return fallback
  }

  const consultantSummary = cleanCopyText(copy.consultant_summary) || fallback.consultant_summary
  const craftsmanship = cleanCopyText(copy.craftsmanship) || consultantSummary
  const pairingNote = cleanCopyText(copy.pairing_note) || fallback.pairing_note
  const whyNotOthers = cleanCopyText(copy.why_not_others) || pairingNote

  return {
    ...fallback,
    consultant_summary: consultantSummary,
    craftsmanship,
    pairing_note: pairingNote,
    why_this: cleanCopyArray(copy.why_this, fallback.why_this, 3),
    ideal_for: cleanCopyArray(copy.ideal_for, fallback.ideal_for, 3),
    avoid_for: cleanCopyArray(copy.avoid_for, fallback.avoid_for, 2),
    why_not_others: whyNotOthers,
    scenarios: cleanCopyArray(copy.scenarios, fallback.scenarios, 4),
    matched_preferences: cleanCopyArray(copy.matched_preferences, fallback.matched_preferences, 4),
  }
}

function cleanCopyText(value: unknown) {
  return typeof value === 'string'
    ? value
        .replace(/您/g, '你')
        .replace(/亲爱的用户/g, '')
        .replace(/欢迎来到[^，,。!！]*[，,。!！\s]*/g, '')
        .replace(/^(推荐理由|为什么推荐|导购建议)[：:]\s*/g, '')
        .trim()
    : ''
}

function cleanCopyArray(value: unknown, fallback: string[], limit: number) {
  const items = Array.isArray(value)
    ? value.map(cleanCopyText).filter((item) => item.length >= 2)
    : []

  return (items.length ? items : fallback).slice(0, limit)
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

async function polishRecommendationCopy(
  config: ReturnType<typeof useRuntimeConfig>,
  message: string,
  product: WorkerRecommendedProduct,
): Promise<PolishedRecommendationCopy | null> {
  if (!config.deepseekApiKey) {
    return null
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4500)

  try {
    const response = await fetch(`${config.deepseekBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.deepseekApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.deepseekModel,
        temperature: 0.35,
        max_tokens: 520,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              '你是一个克制、专业、会追问也会判断取舍的零售导购。',
              '你只能为已经锁定的真实商品写前端卡片文案，不能更改商品 id、name、brand、price、image、url。',
              '不要说“亲爱的用户”“欢迎来到”“直接购买”“为您推荐以下商品”。',
              '文案要具体、像真人顾问，不要写“比只按关键词硬推更稳”这种系统解释。',
              '只返回纯 JSON，不要 markdown。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: JSON.stringify({
              user_message: message,
              locked_product: product,
              output_schema: {
                chat_reply: '一句自然导购回复，说明为什么先看这款',
                consultant_summary: '一句卡片主理由，结合用户场景和预算',
                craftsmanship: '一句商品信息，不要空泛',
                pairing_note: '购买前应该确认什么',
                why_this: ['最多3条具体理由'],
                ideal_for: ['最多3条适合人群'],
                avoid_for: ['最多2条不适合或需谨慎人群'],
                why_not_others: '下一步怎么选',
                scenarios: ['最多4个场景标签'],
                matched_preferences: ['最多4个用户已表达偏好'],
              },
            }),
          },
        ],
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const rawContent = data.choices?.[0]?.message?.content ?? ''
    return parseDeepSeekJson(rawContent)
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function parseDeepSeekJson(rawContent: string): PolishedRecommendationCopy | null {
  const cleaned = rawContent
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    return JSON.parse(cleaned) as PolishedRecommendationCopy
  } catch {
    const firstBrace = cleaned.indexOf('{')
    const lastBrace = cleaned.lastIndexOf('}')

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as PolishedRecommendationCopy
      } catch {
        return null
      }
    }

    return null
  }
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
    const polishedCopy = workerResponse.recommended_product
      ? await polishRecommendationCopy(config, workerMessage || latestUserText, workerResponse.recommended_product)
      : null

    writeEvent(event, 'chunk', { text: cleanCopyText(polishedCopy?.chat_reply) || workerResponse.chat_reply })

    if (workerResponse.recommended_product) {
      writeEvent(event, 'product', {
        product: mergeRecommendationCopy(workerResponse.recommended_product, polishedCopy),
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
