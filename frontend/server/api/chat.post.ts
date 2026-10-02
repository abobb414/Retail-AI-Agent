import https from 'node:https'
import {
  decideProductWithLlm,
  describeSearchSource,
  hasLlmProvider,
  toLlmRecommendation,
  type LlmProductLockedEvent,
} from '../utils/llmBuyer'

interface IncomingMessage {
  role: 'assistant' | 'user'
  content: string
}

interface ChatRequest {
  messages?: IncomingMessage[]
}

/** Worker 端返回的商品结构（对应仓库根目录 index.ts 的 rag_recommendation 分支）。 */
interface WorkerRecommendedProduct {
  id: string
  name: string
  brand: string
  category?: string
  department?: string
  product_type?: string
  gender?: string | null
  attributes?: Record<string, unknown>
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

/**
 * 两条链路，缺一不可。
 *
 *   llm      —— 首选：买手大模型亲自定品（e-flowcode 中转站）
 *   catalog  —— 兜底：Cloudflare Worker + D1 + Vectorize 商品库 RAG
 *
 * 🔴 关于 `catalog` 的存废（2026-09-29 的教训）：
 * 用户当时说的「api 只留 e-flowcode」指的是**买手大模型的供应商**只留一个
 * （原来还挂着 `LLM_FALLBACK_*` 备用大模型）。我把它过度理解成
 * 「整条兜底链路也一并摘掉」，顺手删了 Worker 商品库兜底 —— 那是错的。
 * 这两件事的性质完全不同：
 *   · 备用大模型 = 同一个出口换个型号。中转站抖动是链路级的，换模型救不回来，
 *     删掉它确实只省延迟不损可用性（所以它保持移除）。
 *   · Worker 兜底 = 换一整套数据源（D1 真实库存 + 向量召回），不依赖任何大模型。
 *     它是「大模型整条链路崩了」时唯一还能出卡片的路径，属于可用性保险，不能删。
 * 现在恢复为两级：大模型失败（报错 / 超时 / JSON 不合法）→ 立刻降级商品库兜底。
 * 正常情况下首选一次就成功，兜底连碰都不会碰，所以不额外增加延迟。
 */
type Engine = 'llm' | 'catalog'

function getLatestUserText(messages: IncomingMessage[]) {
  return [...messages]
    .reverse()
    .find((message) => message.role === 'user')
    ?.content
    .trim() ?? ''
}

function writeEvent(event: H3Event, name: string, data: unknown) {
  const res = event.node.res

  // 客户端断开后继续 write 会抛 ERR_STREAM_DESTROYED。SSE 是「尽力送达」：
  // 写不进去就不写，但**这个异常绝不能把降级逻辑（乃至兜底链路）带崩**。
  if (res.writableEnded || res.destroyed) {
    return
  }

  try {
    res.write(`event: ${name}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  } catch (error) {
    console.warn(
      '[chat] 事件写入失败（客户端可能已断开）：',
      error instanceof Error ? error.message : String(error),
    )
  }
}

/**
 * SSE 心跳间隔。
 *
 * 2026-10-02 实测出来的必要性：定品链路从 0.5s 发完等待态到最终产出，
 * 中间 **30~58s 一个字节都不发**。这段时间里连接在跨境链路上被中间设备
 * 随机 RST（实测 31.9s / 38.0s / 46.1s 都出现过），前端读到一半就报
 * `network error` —— 而后端其实是跑完了的，东西全烂在路上。
 * 5s 一次的空注释行不改变协议语义（前端与测试脚本都会跳过无 event/data 的块），
 * 但它让连接「一直在动」，也顺带顶掉各种代理的空闲回收。
 */
const SSE_HEARTBEAT_MS = 5_000

/** 空注释行是 SSE 标准里合法的「心跳」，客户端会直接忽略。 */
function writeHeartbeat(event: H3Event) {
  const res = event.node.res

  if (res.writableEnded || res.destroyed) {
    return
  }

  try {
    res.write(': ping\n\n')
  } catch {
    // 连接不可写：交给后续写事件时的守卫处理。
  }
}

/**
 * 大模型没给正文时的占位话术。
 *
 * 「先出的文字」是这一轮唯一的即时反馈，不能是空的 —— 那等于白改。
 */
function lockedFallbackText(locked: LlmProductLockedEvent) {
  if (locked.action === 'recommend' && locked.product) {
    const name = [locked.product.brand, locked.product.name].filter(Boolean).join(' ')
    return name ? `我建议先看这一款：${name}。` : '我给你锁定了一款，卡片马上来。'
  }

  return '再多说一句你的使用场景，我好给你定一款。'
}

/** 只保留有内容的对话轮次，供大模型读取上下文。 */
function toChatHistory(messages: IncomingMessage[]) {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role, content: message.content.trim() }))
    .filter((message) => message.content.length > 0)
}

// ────────────────────────────────────────────────────────────────
// 兜底链路：Cloudflare Worker（D1 + Vectorize 商品库 RAG）
// ────────────────────────────────────────────────────────────────

/**
 * 把多轮对话压成一句给 Worker 的检索问题。
 *
 * 为什么不能直接丢最新一句：用户常说的是「有没有便宜点的」这类带指代的话，
 * 单看最后一句 Worker 无从检索。所以分两种情况：
 *   · 独立选品请求（「想要个 300 以内的显示器支架」）→ 只用最新一句，
 *     避免被上文里的旧预算/旧品类串味；
 *   · 其余（追问、补充、指代）→ 最近 4 轮拼起来，把上下文带上。
 */
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
  const hasKind = /服饰|服装|数码|手机|平板|电脑|显示器|耳机|手机壳|电器|空调|冰箱|洗衣机|厨房电器|家具|沙发|床|桌|椅|收纳|家居用品|床品|餐具|香薰|个护|护手霜|护肤|食品|零食|宠物|母婴|文具|办公|灯|照明|玩具|围巾|口罩|太阳镜/.test(text)
  const hasReference = /这个|它|上面|刚才|同款|类似/.test(text)
  const hasTargetedShoppingCue = /(?:想要|买)(?:(?:一|个|套|台|把|张|件|双|款|块|副|部|条|只)\s*)?(?:服饰|服装|数码|手机|平板|电脑|显示器|耳机|手机壳|电器|空调|冰箱|洗衣机|厨房电器|家具|沙发|床|桌|椅|收纳|家居用品|床品|餐具|香薰|个护|护手霜|护肤|食品|零食|宠物|母婴|文具|办公|灯|照明|玩具|围巾|口罩|太阳镜)/.test(text)
  const hasStandaloneCue = /推荐|想买|想找|需要|有没有|给我|购买|选购|预算|价格|价位|不超过|不高于|元|块|人民币|rmb|cny/.test(text) || hasTargetedShoppingCue

  return hasKind && !hasReference && hasStandaloneCue
}

function normalizeIntentText(message: string) {
  return message.toLowerCase().replace(/\s+/g, '')
}

/** 把 Worker 返回的导购话术洗一遍（称呼统一成「你」，去掉模板腔）。 */
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

/**
 * Worker 商品 → 前端卡片结构。
 *
 * ⚠️ `source_url` 直接取 `product.url`，**任何情况下都不要清空它** ——
 * 卡片上的「查看官网」按钮就靠这个字段（用户 2026-09-29 明确要求保留）。
 * D1 里的 url 是入库时人工核过的真实商品页，比大模型现编的链接可信得多。
 */
function toRecommendation(product: WorkerRecommendedProduct) {
  return {
    name: product.name,
    brand: product.brand,
    category: product.category || product.department || '商品',
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
    // Not JSON — fall through and use the raw body below.
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

/**
 * resolveIp 非空时的替代传输路径。
 *
 * 存在的理由：国内环境偶尔解析不到 `*.workers.dev`，把域名钉死在 IP 上能绕开。
 * 但钉 IP 会丢掉 SNI 之外的灵活性（Worker 换 Anycast IP 就失联），所以它是**可选**的，
 * 只在 env 里显式配了 WORKER_RESOLVE_IP 才走这条路。
 */
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
    // Worker 端要跑 embedding + 向量召回 + D1 查询，给它 90s 的宽裕上限。
    // 注意这只是「上限」，正常一次是 1~3s。
    request.setTimeout(90_000, () => {
      request.destroy(new Error('Worker request timed out.'))
    })
    request.write(body)
    request.end()
  })
}

/** 首选链路：大模型亲自定品。命中则事件已写完，返回 true。 */
async function runLlmPrimary(
  event: H3Event,
  config: ReturnType<typeof useRuntimeConfig>,
  messages: IncomingMessage[],
): Promise<{ handled: boolean; reason?: string }> {
  const history = toChatHistory(messages)

  if (history.length === 0) {
    return { handled: false, reason: '对话历史为空' }
  }

  /** 定品结论是否已经提前下发过（下发过就不再重发同一段文字与同一份 meta）。 */
  let announced = false

  try {
    const outcome = await decideProductWithLlm(config, history, {
      /**
       * ── 先出文字，卡片后补（2026-10-02 的改造）──────────────────
       *
       * 定品一完成就回调，此刻图片还没找。后面还有来源核验 + 四级取图 +
       * 视觉质检，实测还要 10~40s；原来这段时间 SSE 一个字节都不发，
       * 用户看到的是「没反应」，连接还极容易被中间设备掐断。
       * 现在把结论先发出去：用户十几秒内就有话可读，卡片等图齐了再补。
       */
      onProductLocked: (locked) => {
        announced = true

        writeEvent(event, 'chunk', { text: locked.chatReply || lockedFallbackText(locked) })
        writeEvent(event, 'meta', {
          mode: 'llm',
          engine: 'llm' satisfies Engine,
          model: locked.provider,
          stage: locked.action === 'recommend' ? 'rag_recommendation' : 'clarify_slots',
          latency_ms: locked.latencyMs,
          searched: locked.searched,
          search_queries: locked.searchQueries,
          search_source: describeSearchSource(config),
          profile_summary: [],
        })
      },
    })

    if (outcome.action === 'recommend' && outcome.locked_product) {
      const recommendation = toLlmRecommendation(outcome.locked_product)

      // 兜底路径（结论没提前发过）才需要在这里补文字。
      if (!announced) {
        writeEvent(event, 'chunk', {
          text: outcome.chat_reply || `我建议先看这款：${recommendation.brand} ${recommendation.name}。`,
        })
      }

      // ── 卡片后补 ──────────────────────────────────────────────
      // 到这一步卡片才带得动图片与来源链接，所以在这里才发 product。
      writeEvent(event, 'product', { product: recommendation })
      writeEvent(event, 'meta', {
        mode: 'llm',
        engine: 'llm' satisfies Engine,
        model: outcome.provider,
        stage: 'rag_recommendation',
        latency_ms: outcome.latencyMs,
        searched: outcome.searched,
        search_queries: outcome.searchQueries,
        search_source: describeSearchSource(config),
        source_verified: outcome.sourceVerified,
        image_from: outcome.imageFrom,
        profile_summary: [],
      })
      writeEvent(event, 'done', { source: 'llm_primary' })

      return { handled: true }
    }

    // 追问：文字与 meta 已经提前发过时，这里只补一个收尾事件。
    if (!announced) {
      writeEvent(event, 'chunk', {
        text: outcome.chat_reply || '再多说一句你的使用场景，我好给你定一款。',
      })
      writeEvent(event, 'meta', {
        mode: 'llm',
        engine: 'llm' satisfies Engine,
        model: outcome.provider,
        stage: 'clarify_slots',
        latency_ms: outcome.latencyMs,
        searched: outcome.searched,
        search_queries: outcome.searchQueries,
        search_source: describeSearchSource(config),
        profile_summary: [],
      })
    }
    writeEvent(event, 'done', { source: 'llm_primary' })

    return { handled: true }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    // 不在这里报错 —— 把原因带回给调用方，由它决定降级还是失败。
    console.warn('[chat] 买手大模型定品失败：', reason)
    return { handled: false, reason }
  }
}

/**
 * 兜底链路：商品库 RAG（Cloudflare Worker + D1 + Vectorize）。命中则事件已写完，返回 true。
 *
 * 只在首选失败时才会被调用，所以正常路径上它**不产生任何延迟**。
 * 它不依赖任何大模型，因此「中转站整个挂了」时它照样能出卡片 —— 这正是它存在的意义。
 *
 * ⚠️ 它给出的商品是**库存里的真实商品**，不一定精准命中用户这次的需求；
 * 所以 meta 里继续保留 `engine: 'catalog'`，供内部状态与故障排查使用。
 */
async function runCatalogFallback(
  event: H3Event,
  config: ReturnType<typeof useRuntimeConfig>,
  messages: IncomingMessage[],
  fallbackReason: string,
): Promise<{ handled: boolean; reason?: string }> {
  const workerChatUrl = String(config.workerChatUrl || '')

  if (!workerChatUrl) {
    return { handled: false, reason: '未配置商品库兜底（WORKER_CHAT_URL）' }
  }

  const latestUserText = getLatestUserText(messages)
  const workerMessage = buildWorkerMessage(messages) || latestUserText

  try {
    const workerResponse = await postWorkerChat(
      workerChatUrl,
      String(config.workerResolveIp || ''),
      { message: workerMessage },
    )

    writeEvent(event, 'chunk', {
      text: cleanCopyText(workerResponse.chat_reply) || '我从在售商品库里挑了一款。',
    })

    if (workerResponse.recommended_product) {
      writeEvent(event, 'product', {
        product: toRecommendation(workerResponse.recommended_product),
      })
    }

    writeEvent(event, 'meta', {
      mode: 'cloudflare_worker',
      engine: 'catalog' satisfies Engine,
      stage: workerResponse.stage
        ?? (workerResponse.recommended_product ? 'rag_recommendation' : 'no_vector_match'),
      // 保留失败原因，供内部诊断；前端不把服务来源或错误细节暴露给用户。
      // 注意别再加「大模型定品失败：」前缀 —— upstream 的 reason 里已经有了，会重复。
      fallback_reason: fallbackReason,
      profile_summary: [],
    })
    writeEvent(event, 'done', { source: 'catalog_fallback' })

    return { handled: true }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn('[chat] 商品库兜底失败：', reason)
    return { handled: false, reason }
  }
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody<ChatRequest>(event)
  const messages = body.messages ?? []
  const latestUserText = getLatestUserText(messages)

  event.node.res.setHeader('Cache-Control', 'no-cache')
  event.node.res.setHeader('Connection', 'keep-alive')
  event.node.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  // 明确告诉路上任何一层反向代理「别缓冲」，否则 SSE 会被攒成一坨再吐。
  event.node.res.setHeader('X-Accel-Buffering', 'no')

  if (!latestUserText) {
    writeEvent(event, 'chunk', { text: '你可以告诉我想找的品类、预算或使用场景，我再帮你挑一款。' })
    writeEvent(event, 'done', { source: 'empty_input' })
    event.node.res.end()
    return
  }

  /** 心跳定时器。放在 try 外面是为了在 finally 里一定能清掉（serverless 里漏掉会一直吊着实例）。 */
  let heartbeat: ReturnType<typeof setInterval> | undefined

  try {
    // 定品要花十几到几十秒，全程只有心跳在动 —— 见 SSE_HEARTBEAT_MS 的说明。
    heartbeat = setInterval(() => writeHeartbeat(event), SSE_HEARTBEAT_MS)

    // ── 首选：大模型亲自定品 ──────────────────────────────────
    // 推理/大模型一次定品要几秒到几十秒，先给前端一个等待态，别让用户干等。
    if (hasLlmProvider(config)) {
      writeEvent(event, 'meta', {
        mode: 'llm',
        engine: 'llm' satisfies Engine,
        stage: 'thinking',
        pending: true,
        // 前端只显示统一的三点等待动画，不暴露内部检索或模型流程。
        profile_summary: [],
      })
    }

    const primary = await runLlmPrimary(event, config, messages)

    if (primary.handled) {
      return
    }

    // ── 首选失败 → 降级商品库兜底（Worker + D1 + Vectorize）────────
    // 这就是用户说的「防止大模型崩溃的后路」：整条大模型链路挂了，
    // 至少还能从真实在售商品库里捞一款出来把卡片填上。
    console.warn('[chat] 买手大模型定品失败，降级商品库兜底：', primary.reason)

    // 告诉前端「已经换路了」：前面的 thinking 还在转，换句话别让用户以为卡死。
    // 只有真的配了兜底才说 —— 否则就是给用户一个兑现不了的承诺。
    if (String(config.workerChatUrl || '')) {
      writeEvent(event, 'meta', {
        mode: 'llm',
        engine: 'llm' satisfies Engine,
        stage: 'thinking',
        pending: true,
        hint: '大模型这会儿不稳，正在从在售商品库里找…',
        profile_summary: [],
      })
    }

    const fallback = await runCatalogFallback(
      event,
      config,
      messages,
      primary.reason ?? '原因未知',
    )

    if (fallback.handled) {
      return
    }

    // ── 两条都走不通，如实报错 ────────────────────────────────────
    // 这里只可能发生在大模型与商品库**同时**不可用（或兜底压根没配）。
    // 报错要给出两条链路的各自原因，否则用户只能看到一句没用的「失败了」。
    event.node.res.statusCode = 503
    writeEvent(event, 'error', {
      message: hasLlmProvider(config)
        ? `定品失败：大模型（${primary.reason ?? '原因未知'}）、商品库兜底（${fallback.reason ?? '原因未知'}）都没取到，稍后再试一次。`
        : '尚未配置买手大模型（LLM_API_KEY / LLM_BASE_URL / LLM_MODEL），无法定品。',
    })
  } catch (error) {
    event.node.res.statusCode = 502
    writeEvent(event, 'error', {
      message: error instanceof Error ? error.message : '顾问服务暂时不可用。',
    })
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat)
    }
    event.node.res.end()
  }
})
