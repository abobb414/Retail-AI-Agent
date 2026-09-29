/**
 * 首选定品引擎：买手大模型 + 联网检索工具。
 *
 * 设计要点（都是实测踩过的）：
 * 1. 这类模型是**推理模型**：答案在 `message.content`，思考过程在
 *    `message.reasoning_content`。max_tokens 给小了会全被 reasoning 吃掉，
 *    `content` 返回空字符串且 finish_reason = 'length'。
 *    ⇒ max_tokens 给足，并且遇到 length 截断要自动重试加长。
 * 2. 模型偶尔会把 JSON 包在 ``` 里，或前后带解释文字 ⇒ 做容错解析。
 * 3. 连续失败要熔断：否则每条消息都白等一个超时，兜底链路形同虚设。
 * 4. **联网靠自建工具**：中转站不转发任何模型内置搜索能力，但支持标准
 *    function calling。所以流程是「模型决定搜什么 → 我们代它搜 → 结果回填
 *    → 模型二次调用完成定品」。见 webSearch.ts 的说明。
 */

import { verifyProductSource, type ImageFrom, type ImageJudgeFn, type ImageJudgeRequest } from './sourcePage'
import { brandTokens, gateImage, isBrandOfficialHost, registrableDomain, safeHostname } from './imageTrust'
import { formatJudgeAudit, judgeProductImage } from './imageJudge'
import { resolveBrandLogo } from './brandLogo'
import { extractModelTokens, extractUrlModelTokens, urlTokenMatches } from './modelTokens'
import type { LlmProvider } from './llmProviderTypes'
import { withTransportRetry } from './transport'
import {
  getSearchProviderLabel,
  hasSearchProvider,
  searchWeb,
  type SearchImage,
  type WebSearchHit,
} from './webSearch'

export interface LlmLockedProduct {
  name?: string
  brand?: string
  category?: string
  price_display?: string
  image?: string
  /**
   * 图的类型。缺省即普通商品图；`'logo'` 表示这是**品牌官方标兜底**，
   * 前端要换一种排版（居中 contain，不要铺满裁切 —— 一个方形标被 object-cover
   * 裁掉两边会很难看）。
   */
  image_kind?: 'logo'
  source_url?: string
  consultant_summary?: string
  craftsmanship?: string
  pairing_note?: string
  why_this?: string[]
  ideal_for?: string[]
  avoid_for?: string[]
  why_not_others?: string
  scenarios?: string[]
  matched_preferences?: string[]
  signature_specs?: string[]
}

export interface LlmBuyerOutcome {
  action: 'clarify' | 'recommend'
  chat_reply: string
  locked_product: LlmLockedProduct | null
  provider: string
  latencyMs: number
  /** 本轮实际发起过的检索关键词（前端可用来显示「已联网」）。 */
  searchQueries: string[]
  /** 是否真的拿到了网页结果。 */
  searched: boolean
  /** 来源页是否经过后端实地核验（可达）。 */
  sourceVerified: boolean
  /** 商品图是怎么来的：模型来源页 og:image / 官方候选页 og:image / 模型自带的官方图 / 无。 */
  imageFrom: ImageFrom
}

interface ChatTurn {
  role: 'assistant' | 'user'
  content: string
}

type ChatMessage = Record<string, unknown>

interface ToolCall {
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

interface CompletionResult {
  content: string
  finishReason: string
  toolCalls: ToolCall[]
}

/** 单次大模型调用上限（毫秒）。推理模型首字慢，给太短会必然失败。 */
const DEFAULT_LLM_TIMEOUT_MS = 40_000
/** 首次请求的 max_tokens；被 length 截断时按倍数再试。 */
const LLM_MAX_TOKENS = 3_200
const LLM_MAX_TOKENS_RETRY = 8_000
/** 历史消息最多带几轮，防止上下文无限增长。 */
const MAX_HISTORY_TURNS = 12

/** 一轮侦察里最多执行几次搜索（Tavily 免费额度 1000/月，别浪费）。 */
const MAX_SEARCH_CALLS = 3
/** 兜底选图时最多实测几张（每张要多发一次带 Range 的请求，控制耗时）。 */
const MAX_IMAGE_GATE_TRIES = 3
/** 官方域定向检索时最多限定几个域名（域太多会稀释召回）。 */
const MAX_OFFICIAL_DOMAINS = 3
/**
 * 视觉质检最多实看几张候选图。每张都是一次多模态请求（实测 3~8s），
 * 候选多不等于命中率高，宁可少看几张也别把交互延迟堆到 30s+。
 *
 * 2026-09-29 从 4 收回 3：同批是并行发出的，候选越多越容易撞上中转站多模态
 * 接口的并发限制 —— 日志里成片出现 `HTTP 400 Invalid base64 image_url` /
 * `Please start a new conversation, replace the image, and try again.`，
 * 都是并发过密时被拒的表现，反而拉长了最慢那一张的时间。
 */
const MAX_JUDGE_CANDIDATES = 2
/** 第三方候选最多过闸几个（闸便宜但每个也是一次请求，别无限并发）。 */
const MAX_GATE_CANDIDATES = 10
/**
 * 单次定品全流程的视觉质检总次数上限，防止各级加起来的调用量失控。
 *
 * 踩过：写 8 时，官方层 + 品牌层就可能吃掉 6~8 次，轮到**最需要它的第三方层**
 * 时预算已经见底 —— 日志里会出现
 * `reason:"unavailable", note:"本轮视觉质检次数已用尽（上限 8）"`，
 * 而其中还有 `检索侧佐证=true` 的候选（本来很可能被放行）。
 *
 * 2026-09-29 从 10 收到 6、再收到 5：用户要求「速度一定要快点」。
 * 每次质检最坏 12s（单张上限），5 次封顶 ≈ 最坏 3 批 × 12s，
 * 而不是原来 10 次 × 25s。既然现在有品牌标兜底（见 brandLogo.ts），
 * 就没必要为了多捞一张商品图把交互延迟堆上去。
 */
const MAX_JUDGE_CALLS = 5

/**
 * 找图阶段的**总**时间预算（含页面探测、官方域定向检索、所有视觉质检）。
 *
 * 🔴 这是「别死磕」这句话的落点。用户 2026-09-29：「你别死磕了，官网图片弄不下来
 * url 咱们就把图片放一个官方标也可以啊」，紧接着「速度一定要快点」。
 *
 * 改动前这条链路是**无上限串行**的：探 3 个页面（各 8s）→ 品牌图过闸+质检（3 张）
 * → 官方域定向检索（一次完整检索）+ 3 张质检 → 第三方过闸 + 4 张质检。
 * 实测最坏 123s，其中 `officialImageMs` 单项就有 50s。而拿到的往往还是「无图」。
 *
 * 超预算就不再往下试**新的层级**，直接走品牌标兜底（前端以「标识 + 型号」呈现）。
 * 注意闸门只卡「层级起点」，不卡单张质检 —— 原因见下面 judge 包装里的说明。
 * 这不是放弃质量：前面几级该试的已经试了，剩下的是低概率高代价的尝试。
 */
const IMAGE_PHASE_BUDGET_MS = Number(process.env.IMAGE_PHASE_BUDGET_MS || 25_000)
/** 每条检索结果截断长度，控制上下文体积。 */
const HIT_SNIPPET_LIMIT = 220

/** 连续失败到阈值后，在冷却期内直接走兜底，不再白等超时。 */
const FAILURE_THRESHOLD = 3
const COOLDOWN_MS = 90_000
const breaker = new Map<string, { failures: number; openUntil: number }>()

export function isProviderCoolingDown(providerLabel: string) {
  const state = breaker.get(providerLabel)
  return Boolean(state && state.openUntil > Date.now())
}

function noteFailure(providerLabel: string) {
  const state = breaker.get(providerLabel) ?? { failures: 0, openUntil: 0 }
  state.failures += 1
  if (state.failures >= FAILURE_THRESHOLD) {
    state.openUntil = Date.now() + COOLDOWN_MS
    state.failures = 0
  }
  breaker.set(providerLabel, state)
}

function noteSuccess(providerLabel: string) {
  breaker.delete(providerLabel)
}

export function resetBreakers() {
  breaker.clear()
}

const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: [
      '联网搜索真实网页，返回标题、链接和摘要。',
      '用于确认商品是否真实在售、当前官方价格、官方商品页地址、第三方评测结论。',
      '一次请求里可以并行发起多个 query。',
      '⚠️ 只在你已经掌握足够信息、准备锁定具体型号时才调用；如果还需要向用户追问，不要调用本工具。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词。中文为主，建议带上品牌与型号，例如「Sony WH-1000XM5 官方 售价」。',
        },
      },
      required: ['query'],
    },
  },
}

/** 日期必须写进系统提示：否则模型会拿训练截止年份去检索（实测搜出「…价格 2025」）。 */
function todayLabel() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function buildSystemPrompt() {
  return [
  `当前日期：${todayLabel()}。用户说的「最新」「今年」都指当前这一年，检索商品时不要使用过去的年份。`,
  '',
  '你是「灵感买手店」的资深买手，服务中文用户。你的唯一任务是：判断信息够不够，够了就亲自定品，不够就问一个最关键的问题。',
  '',
  '## 什么时候追问，什么时候直接定品（最容易做错的地方）',
  '先做一个判断：这个问题**不回答，你是否就无法推荐任何一款**？',
  '- 是 → 追问。典型：完全不知道买什么品类；不知道给谁用；没有预算且品类价格跨度极大。',
  '- 否 → 直接定品。仅仅「回答了会更精准」的问题**不要问**，按主流选择定品，并在文案里说明你按什么假设来选。',
  '',
  '⚠️ 实测最容易犯的错是**过度追问**：用户已经给了「品类 + 预算 + 核心用途」，还在问舒适度偏好、颜色、尺寸这类不影响能否作答的问题。',
  '只要这三项齐了，一律直接定品。典型反面例子：「预算 1500 的头戴降噪耳机，地铁通勤，看重降噪和续航」——这已经足够定品，不该再问「你戴眼镜吗」。',
  '',
  '### 必须追问的判据（action = "clarify"）',
  '缺少下面任何一项、且它真的会导致无法作答时，先问，不要出商品：',
  '- 品类或用途（到底买什么、给谁用）',
  '- 预算或可接受的价格带',
  '- 会彻底改变选型的硬约束：服饰鞋帽要人群/性别与尺码；家电家具要空间尺寸或安装条件',
  '一次只问一个问题，问最影响结果的那一个。不要罗列清单，不要一次问三件事，不要在这时给出任何商品。',
  '⚠️ **判定为 clarify 时，绝对不要调用 web_search**。追问阶段搜索等于白烧额度，没有任何收益。',
  '',
  '## 可以直接定品（action = "recommend"）',
  '信息足够时，锁定【有且只有一款】商品，并遵守：',
  '- 必须是真实存在、当前在售的具体型号，「品牌 + 型号/系列名」要对得上，不能拼凑',
  '- 决定 recommend 之前，**先调用 web_search 核对**：该型号是否真实在售、当前大致售价、官方页面地址（建议 2~3 个 query 并行）',
  '- 严禁编造型号、虚构参数、虚构价格；核实不到就退到你最有把握的经典型号',
  '- price_display 给参考价，形如「¥899 左右」或「约 ¥1,299」；不确定就写「约 ¥xxx」',
  '',
  '## 关于 source_url 与 image（重要）',
  '- source_url：从检索结果的 results[].url 里挑**该型号的官方商品页**（品牌官网 / 官方旗舰店优先，其次可信媒体页），原样复制那个 url，不要自己拼接或改动',
  '- image：**一律留空字符串**。商品图由后端从 source_url 回抓 og:image，你不需要、也不要猜图片地址',
  '- 检索结果里没有合适的官方页时，source_url 也留空 —— 宁可为空，绝不凭记忆编造 URL（编造的链接点开就是 404）',
  '',
  '## 文案要求',
  '- chat_reply 必须是**成稿**：不能出现自我纠错、犹豫或思考痕迹（如「80？不，」「等等」「嗯，其实」「让我想想」），把最终结论直接说出来',
  '- 像真人顾问：克制、专业、具体。禁止「亲爱的用户」「欢迎来到」「为您推荐以下商品」「根据您的需求」',
  '- 结合用户已经说过的场景与预算，不要复述系统逻辑，不要提商品库、检索、向量之类的实现细节',
  '- consultant_summary 是卡片主理由；craftsmanship 是具体商品信息，不要空泛；pairing_note 是「买前要确认什么」',
  '- 中文，不要 markdown，不要代码块，只输出一个 JSON 对象',
  '',
  '## 输出结构（严格按此 JSON）',
  JSON.stringify(
    {
      action: 'clarify 或 recommend',
      chat_reply: '一句话回应用户；action 为 clarify 时，这里就是那一个追问',
      locked_product:
        'action=recommend 时填对象，否则为 null。对象字段：name, brand, category, price_display, image, source_url, consultant_summary, craftsmanship, pairing_note, why_this[最多3条], ideal_for[最多3条], avoid_for[最多2条], why_not_others, scenarios[最多4个], matched_preferences[最多4条], signature_specs[最多3条硬参数]',
    },
    null,
    0,
  ),
  ].join('\n')
}

/**
 * 定品 provider —— **只有 e-flowcode 一条**（2026-09-29 用户要求：「api 只留 e-flowcode」）。
 *
 * 之前这里还会追加一个 `LLM_FALLBACK_*` 备选模型。去掉的理由不是"它坏了"，而是：
 * 1. 首选失败时再去试备选，用户要多等一个**完整超时**（实测 40s）才看到兜底结果 ——
 *    而备选链路实测从没赢过（同协议同中转，抖动是链路级的，换模型救不回来）；
 * 2. 两路 key 分散了排障视线：出现「模型请求失败」时，日志里分不清是哪条路的问题。
 * 现在失败就是失败，快速报错，不再用一个大概率也没用的备选拖长时间。
 */
function resolveProviders(config: ReturnType<typeof useRuntimeConfig>): LlmProvider[] {
  if (!config.llmApiKey || !config.llmBaseUrl || !config.llmModel) {
    return []
  }

  return [
    {
      label: config.llmModel,
      baseUrl: config.llmBaseUrl,
      apiKey: config.llmApiKey,
      model: config.llmModel,
    },
  ]
}

export function hasLlmProvider(config: ReturnType<typeof useRuntimeConfig>) {
  return resolveProviders(config).some((provider) => !isProviderCoolingDown(provider.label))
}

/**
 * 视觉质检用的 provider。
 * 默认复用定品同一条中转站链路，可用 `IMAGE_JUDGE_MODEL` 单独指一个多模态模型
 * （比如定品用快模型、质检用好模型）。实测 `deepseek-v4.1-flash` 看图 5.6s 且
 * `glm-5.3-flash` 也能看，两者都不必换。
 *
 * 同样只认 e-flowcode 这一条（见 resolveProviders 的说明）。
 */
function resolveVisionProvider(config: ReturnType<typeof useRuntimeConfig>): LlmProvider | null {
  const model = config.imageJudgeModel || config.llmModel

  if (config.llmApiKey && config.llmBaseUrl && model) {
    return { label: model, baseUrl: config.llmBaseUrl, apiKey: config.llmApiKey, model }
  }

  return null
}

/**
 * 造一个视觉质检回调。
 *
 * 拿不到 provider（没配 key）或显式关掉（`IMAGE_JUDGE=0`）时返回 undefined，
 * 上层据此退回「只认品牌官方域名」的老规则 —— 两条路径都必须能跑，
 * 因为视觉质检是可选增强，不该成为链路能不能用的前提。
 */
function createImageJudge(
  config: ReturnType<typeof useRuntimeConfig>,
  product: LlmLockedProduct,
): ImageJudgeFn | undefined {
  if (!config.enableImageJudge) {
    return undefined
  }

  const provider = resolveVisionProvider(config)

  if (!provider) {
    return undefined
  }

  return (url: string, request: ImageJudgeRequest) =>
    judgeProductImage(
      url,
      { brand: product.brand ?? '', name: product.name ?? '' },
      {
        provider,
        timeoutMs: config.imageJudgeTimeoutMs,
        requireExplicitMatch: request.requireExplicitMatch,
        corroborated: request.corroborated,
      },
    )
}

export function sanitizeCopyText(value: unknown) {
  return typeof value === 'string'
    ? value
        .replace(/您/g, '你')
        .replace(/亲爱的用户/g, '')
        .replace(/欢迎来到[^，,。!！]*[，,。!！\s]*/g, '')
        .replace(/^(推荐理由|为什么推荐|导购建议)[：:]\s*/g, '')
        .trim()
    : ''
}

export function sanitizeCopyArray(value: unknown, fallback: string[], limit: number) {
  const items = Array.isArray(value)
    ? value.map(sanitizeCopyText).filter((item) => item.length >= 2)
    : []

  return (items.length ? items : fallback).slice(0, limit)
}

/** 容错取出 JSON：剥代码块 → 直接 parse → 退化为首尾大括号切片。 */
function parseLlmJson(rawContent: string): Record<string, unknown> | null {
  const cleaned = rawContent
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  const attempts = [cleaned]
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    attempts.push(cleaned.slice(firstBrace, lastBrace + 1))
  }

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // 换下一种解析方式
    }
  }

  return null
}

/**
 * 单次 chat/completions 调用（真正发请求的那一层，不含重试）。
 * `options.tools` 存在时不带 response_format —— 两者都带会让部分模型直接
 * 吐 JSON 而跳过工具调用，起不到侦察作用。
 */
async function sendCompletion(
  provider: LlmProvider,
  messages: ChatMessage[],
  maxTokens: number,
  timeoutMs: number,
  options: { tools?: unknown[]; jsonMode?: boolean } = {},
): Promise<CompletionResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  const body: Record<string, unknown> = {
    model: provider.model,
    temperature: options.tools?.length ? 0.2 : 0.4,
    max_tokens: maxTokens,
    messages,
  }

  if (options.tools?.length) {
    body.tools = options.tools
    body.tool_choice = 'auto'
  }

  if (options.jsonMode) {
    body.response_format = { type: 'json_object' }
  }

  try {
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${provider.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
        // 中转站普遍挂在 Cloudflare 后面，异常 UA 会被直接 403（error code 1010）。
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`${provider.label} 返回 HTTP ${response.status}${detail ? `：${detail.slice(0, 160)}` : ''}`)
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string; tool_calls?: ToolCall[] }
        finish_reason?: string
      }>
    }
    const choice = data.choices?.[0]

    return {
      content: choice?.message?.content ?? '',
      finishReason: choice?.finish_reason ?? '',
      toolCalls: Array.isArray(choice?.message?.tool_calls) ? choice!.message!.tool_calls! : [],
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * 带传输层重试的调用入口。业务层一律用这个，不要直接用 sendCompletion。
 * 每次尝试都会新建 AbortController —— 复用旧的会把上一轮已经触发过的 abort 带过来。
 *
 * 重试策略由 transport.ts 决定（默认含首次共 3 次、退避 800/1600ms）。
 * 这里不额外传参：定品是整个链路最不能失败的一步，值得用最宽的重试。
 */
async function requestCompletion(
  provider: LlmProvider,
  messages: ChatMessage[],
  maxTokens: number,
  timeoutMs: number,
  options: { tools?: unknown[]; jsonMode?: boolean } = {},
): Promise<CompletionResult> {
  return withTransportRetry(provider.label, () =>
    sendCompletion(provider, messages, maxTokens, timeoutMs, options),
  )
}

/** 模型给的 arguments 偶尔是畸形 JSON，取不到就当作没给。 */
function extractSearchQuery(rawArguments: string | undefined) {
  if (!rawArguments) {
    return ''
  }

  try {
    const parsed = JSON.parse(rawArguments) as { query?: unknown }
    const query = typeof parsed.query === 'string' ? parsed.query.trim() : ''
    return query.slice(0, 160)
  } catch {
    return ''
  }
}

function truncate(text: string, limit: number) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized
}

/**
 * 把检索结果整理成模型好读的 tool 返回体。
 *
 * 注意这里**不返回图片地址**：Tavily 的 images 是跨结果混在一起的扁平列表，
 * 交给模型挑图很容易挑到别家型号或站点 Logo。图片改由后端从 source_url
 * 回抓 og:image（见 sourcePage.ts），所以也不需要让模型看到这些噪声。
 */
function formatHitsForTool(query: string, hits: WebSearchHit[]) {
  return JSON.stringify({
    query,
    results: hits.slice(0, 5).map((hit) => ({
      title: truncate(hit.title, 90),
      url: hit.url,
      snippet: truncate(hit.content, HIT_SNIPPET_LIMIT),
    })),
  })
}

interface ReconOutcome {
  /** 模型跳过检索、直接给出的定品 JSON（省掉第二次调用）。 */
  directPayload: Record<string, unknown> | null
  queries: string[]
  hits: WebSearchHit[]
  images: SearchImage[]
  /** 阶段一内部耗时拆解：模型那一轮 vs 真正发出去的检索。 */
  timings: { llmMs: number; searchMs: number }
  /** 检索层面的失败原因，只做提示，不阻断主链路。 */
  notes: string[]
}

/**
 * 第一轮：带 tools 的侦察。
 * 模型要么直接给答案，要么发起若干 web_search —— 由它自己判断，
 * 信息不足时它会选择追问（不调工具、也不给 JSON），那样直接进定品阶段。
 */
async function runSearchRecon(
  provider: LlmProvider,
  messages: ChatMessage[],
  config: ReturnType<typeof useRuntimeConfig>,
  timeoutMs: number,
): Promise<ReconOutcome> {
  const queries: string[] = []
  const hits: WebSearchHit[] = []
  const images: SearchImage[] = []
  const notes: string[] = []

  const timings = { llmMs: 0, searchMs: 0 }
  let first: CompletionResult
  const llmStartedAt = Date.now()

  try {
    first = await requestCompletion(provider, messages, LLM_MAX_TOKENS, timeoutMs, {
      tools: [WEB_SEARCH_TOOL],
    })
  } catch (error) {
    timings.llmMs = Date.now() - llmStartedAt
    notes.push(error instanceof Error ? error.message : String(error))
    return { directPayload: null, queries, hits, images, timings, notes }
  }

  timings.llmMs = Date.now() - llmStartedAt

  const calls = first.toolCalls
    .filter((call) => call.function?.name === 'web_search')
    .slice(0, MAX_SEARCH_CALLS)

  if (calls.length === 0) {
    // 没调工具：也许是它觉得该追问，也许它已经直接定品了。
    return { directPayload: parseLlmJson(first.content), queries, hits, images, timings, notes }
  }

  messages.push({
    role: 'assistant',
    content: first.content || null,
    tool_calls: calls,
  })

  const searchStartedAt = Date.now()
  const settled = await Promise.all(
    calls.map(async (call) => {
      const query = extractSearchQuery(call.function?.arguments)

      if (!query) {
        return { id: call.id ?? '', query: '', text: JSON.stringify({ error: '检索关键词为空' }), hits: [] as WebSearchHit[], images: [] as SearchImage[] }
      }

      try {
        const outcome = await searchWeb(config, query)
        return {
          id: call.id ?? '',
          query,
          text: formatHitsForTool(query, outcome.hits),
          hits: outcome.hits,
          images: outcome.images,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        notes.push(`${query}：${message}`)
        return { id: call.id ?? '', query, text: JSON.stringify({ query, error: message }), hits: [] as WebSearchHit[], images: [] as SearchImage[] }
      }
    }),
  )

  timings.searchMs = Date.now() - searchStartedAt

  for (const item of settled) {
    if (item.query) {
      queries.push(item.query)
    }
    hits.push(...item.hits)
    images.push(...item.images)

    messages.push({
      role: 'tool',
      tool_call_id: item.id,
      content: item.text,
    })
  }

  return { directPayload: null, queries, hits, images, timings, notes }
}

/**
 * 官方域定向检索：**唯一能稳定拿到品牌官方商品图的一级**。
 *
 * 为什么必须单独做一级（都是实测出来的）：
 * - 中国索尼官方站（sonystyle.com.cn / sony.com.cn）**整站没有 og:image**，
 *   所以第一级（回抓来源页 og:image）对索尼这个牌子永远是空的。
 * - 常规检索的 `images` 里几乎全是第三方图（天猫促销图、京东海报、媒体水印图），
 *   按「不要第三方」的规则只能全部丢掉 —— 实测 6 轮全部无图。
 * - 而给 Tavily 加上 `include_domains` 限定到官方域再检索一次，返回的图就落在
 *   官方 DAM 上（实测 5 张里 2 张过关：1920×1786 产品图、1919×1591 场景图）。
 *
 * 域从哪来：从**第一轮检索的命中结果**里取品牌官方域名，不靠猜。
 */
async function searchOfficialBrandImage(
  config: ReturnType<typeof useRuntimeConfig>,
  product: LlmLockedProduct,
  hits: WebSearchHit[],
  judgeImage?: ImageJudgeFn,
) {
  const tokens = brandTokens(product.brand)

  if (!tokens.length) {
    return { imageUrl: '', pageUrl: '', notes: [] as string[] }
  }

  const notes: string[] = []

  const domainsFrom = (list: WebSearchHit[]) => [
    ...new Set(
      list
        .map((hit) => safeHostname(hit.url))
        .filter((host) => host && isBrandOfficialHost(host, tokens))
        .map((host) => registrableDomain(host)),
    ),
  ]

  let domains = domainsFrom(hits).slice(0, MAX_OFFICIAL_DOMAINS)

  // 第一轮结果里可能一个官方域名都没有（实测 6 轮里出现过一次，全是第三方站点）。
  // 此时补一次「找官网」的常规检索，只为把官方域名挖出来 —— 不然后面那步无从下手。
  if (!domains.length) {
    try {
      const discovery = await searchWeb(config, `${product.brand} ${product.name} 官网`.slice(0, 120))
      domains = domainsFrom(discovery.hits).slice(0, MAX_OFFICIAL_DOMAINS)
      if (domains.length) {
        notes.push(`第一轮无官方域名，补检索挖到：${domains.join('、')}`)
      }
    } catch (error) {
      notes.push(`找官网的补检索失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // 再补上「品牌词元直接推出来的官方域」。
  // 实测两个死角都靠这个兜住：只挖到 `sony.com.hk`（香港站，图上没有 XM4）
  // 或 `anker.com.cn`（没有 Soundcore 的图）时，官方域定向检索就等于白做。
  // 即使一个官方域都没挖到，这里也至少能靠品牌词元凑出候选域 —— 所以不提前返回。
  const derived = tokens
    .flatMap((token) => [`${token}.com`, `${token}.com.cn`, `${token}.cn`])
    .filter((domain) => !domains.includes(domain))

  domains = [...domains, ...derived].slice(0, MAX_OFFICIAL_DOMAINS)
  notes.push(`官方域定向检索限定：${domains.join('、')}`)

  const query = `${product.brand} ${product.name}`.slice(0, 120)
  const outcome = await searchWeb(config, query, { includeDomains: domains })

  const imageUrl = await pickBrandSearchImage(product, outcome.images, judgeImage)

  // 顺带把来源链接升级成官方商品页（前端按钮写的是「查看官网」）。
  const modelTokens = extractModelTokens(product.name ?? '')
  const pageUrl =
    outcome.hits
      .map((hit) => hit.url)
      .filter((url) => isBrandOfficialHost(safeHostname(url), tokens))
      .sort((a, b) => {
        const score = (url: string) =>
          modelTokens.filter((token) => url.toLowerCase().includes(token.toLowerCase())).length +
          (/product|detail|goods|item|\/p\//i.test(url) ? 1 : 0)
        return score(b) - score(a)
      })[0] ?? ''

  if (!imageUrl) {
    notes.push(`官方域定向检索（${domains.join('、')}）未找到过闸的图`)
  }

  return { imageUrl, pageUrl, notes }
}

/**
 * 从检索结果里挑出「品牌官方域名」的候选商品页，交给来源核验层去回抓 og:image。
 *
 * 为什么需要：第一级（模型给的 source_url）命中率实测只有 1/5 —— 模型经常给不出
 * 官方页，或者给一个第三方测评帖。而检索结果里其实常躺着品牌官方页
 * （实测出现过 store.sony.com.tw、global.sennheiser-hearing.com）。
 * 后端自己从结果里挑，比指望模型挑准可靠。
 *
 * 排序：URL 里带型号词元的优先（更像商品详情页而不是品类首页）。
 */
function pickOfficialCandidatePages(hits: WebSearchHit[], product: LlmLockedProduct, limit = 2) {
  const tokens = brandTokens(product.brand)
  const modelTokens = extractModelTokens(product.name ?? '')
  const seen = new Set<string>()
  const scored: Array<{ url: string; score: number }> = []

  for (const hit of hits) {
    const host = safeHostname(hit.url)

    if (!host || !isBrandOfficialHost(host, tokens)) {
      continue
    }

    let score = 1
    const lowered = hit.url.toLowerCase()
    for (const token of modelTokens) {
      if (lowered.includes(token.toLowerCase())) {
        score += 2
      }
    }
    // 明显是新闻/支持页的，降权（og:image 常是横幅或配图）。
    if (/news|press|support|about|blog|event/i.test(hit.url)) {
      score -= 1
    }

    if (!seen.has(hit.url)) {
      seen.add(hit.url)
      scored.push({ url: hit.url, score })
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.url)
}

/**
 * 宣传拼图 vs 产品图的区分信号。
 *
 * 闸门能保证「官方 + 可达 + 尺寸合适」，但拦不住**官方自己的营销拼图** ——
 * 实测拿到过一张 1919×1591 的图：女人坐在飞机座椅上 + App 界面截图 + 耳机组图，
 * 尺寸长宽比全部合格，当卡片封面却很难看。
 * 中转站没有视觉模型可用，只能靠检索侧给的图片描述做倾向性排序：
 * 「A woman is seated comfortably…」这类描述降权，「A pair of … headphones」这类加权。
 */
const LIFESTYLE_IMAGE_HINT =
  /\b(woman|man|girl|boy|model|people|person|lady|kids?|is seated|is standing|is wearing|is holding|is shown|lifestyle|sitting)\b/i
const PRODUCT_IMAGE_HINT =
  /\b(a pair of|pair of|product( photo| image)?|on a (white|dark|gray) background|isolated|close[- ]?up|product shot)\b/i

/**
 * 候选图的统一准入：**先把全部候选过闸** → 取前 N 张并行视觉质检 → 按候选原优先级取第一个通过的。
 *
 * ⚠️ 顺序不能反（踩过）：一开始是「先按排名截前 3 张，再逐张过闸」，
 * 结果实测 8 个冷门品牌 0 张图 —— 排名靠前的候选恰好全是不可达的站点
 * （TW/CN 的中小电商图床对机房 IP 返 403），3 张全军覆没就直接放弃，
 * 而排在第 4、5 位的可达候选根本没被看过。
 * 过闸本身很便宜（一次 Range 请求），视觉质检才贵（一次多模态请求），
 * 所以正确的顺序是「闸便宜，先全量做；质检贵，只做前几名」。
 *
 * 为什么并行质检：实测单次 3.6~12.9s。串行试 3 张最坏 30s+，
 * 并行后最坏只等于最慢的那一次。中转站按 token 计费且图片请求便宜，
 * 用这点钱换 20s 交互延迟是划算的。
 *
 * 注意 `Promise.all` 是保序的，所以最后按原顺序 `find` 第一个通过的，
 * 而不是「谁先返回谁赢」—— 候选顺序本身就是质量排序，不能被打乱。
 *
 * 无视觉质检时的降级行为：`requireBrandHost` 为 true（官方域）才放行，
 * 第三方域直接返回空 —— 这是 2026-09-29 之前的老规则，必须原样保留。
 */
async function pickFirstAcceptable(
  candidates: Array<{ url: string; corroborated?: boolean }>,
  hostTokens: string[],
  judge: ImageJudgeFn | undefined,
  options: {
    requireBrandHost: boolean
    requireExplicitMatch: boolean
    label: string
    /** 最多送几张去视觉质检（闸后的存活者里按原优先级取前 N）。 */
    maxJudge?: number
  },
): Promise<string> {
  if (!candidates.length) {
    return ''
  }

  const gated = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      gate: await gateImage(candidate.url, hostTokens, undefined, { requireBrandHost: options.requireBrandHost }),
    })),
  )

  const rejected = gated.filter((item) => !item.gate.ok)
  const survivors = gated.filter((item) => item.gate.ok).map((item) => item.candidate)

  if (rejected.length) {
    // 不过闸的原因必须打出来：否则只看到「没图」，无从判断是域名挡的还是站点不可达。
    console.log(
      `[llmBuyer][imgAudit] ${options.label}过闸淘汰 ${rejected.length}/${gated.length}：` +
        JSON.stringify(rejected.map((item) => `${safeHostname(item.candidate.url)}:${item.gate.reason}`)),
    )
  }

  if (!survivors.length) {
    return ''
  }

  if (!judge) {
    if (!options.requireBrandHost) {
      console.warn(`[llmBuyer][imgAudit] 无视觉质检，跳过 ${survivors.length} 张第三方候选图（${options.label}）`)
      return ''
    }

    return survivors[0].url
  }

  const toJudge = options.maxJudge ? survivors.slice(0, options.maxJudge) : survivors

  const verdicts = await Promise.all(
    toJudge.map(async (candidate) => {
      const verdict = await judge(candidate.url, {
        requireExplicitMatch: options.requireExplicitMatch,
        corroborated: candidate.corroborated,
      })

      console.log(
        `[llmBuyer][imgAudit] ${options.label} ${formatJudgeAudit(candidate.url, verdict)} 检索侧佐证=${Boolean(candidate.corroborated)}`,
      )

      return { candidate, verdict }
    }),
  )

  return verdicts.find((item) => item.verdict.accept)?.candidate.url ?? ''
}

/**
 * 兜底选图：从检索结果带出的图片里挑一张**品牌官方域名**上的图。
 *
 * 准入两条：
 * 1. **必须落在品牌官方域名上**。第三方图整体排除 —— 实测逐个下载看过，
 *    `g-search1.alicdn.com` 是「XX数码城」促销图、`gw.alicdn.com` 是「国行正品」促销版式、
 *    `img12.360buyimg.com` 是「无声 更有声」海报、`k.sinaimg.cn` 压着媒体水印、
 *    `qnam.smzdm.com` 带「【耳边评测】」大字。这不是偶发，是系统性的 —— 挑不出来，只能整片不要。
 *    （→ 第三方图后来走的是 `pickJudgedSearchImage`，靠视觉质检放行。）
 * 2. **型号不能冲突**。实测踩过：给 XM4 定品，配上了
 *    `store.sony.com.tw/.../product_files/WH-1000XM5/...` —— 官方域名、图也干净，
 *    但**型号是错的**。错型号比无图更难被发现，所以 URL 里出现型号词元时，
 *    必须与本次定品的型号一致，否则直接排除。
 *
 * 描述/URL 命中型号与「产品图 vs 生活场景图」的信号只作为**排序权重**，不作为准入条件。
 * 真正决定「这张图能不能用」的是闸门 + 视觉质检。
 */
async function pickBrandSearchImage(
  product: LlmLockedProduct,
  images: SearchImage[],
  judgeImage?: ImageJudgeFn,
) {
  const hostTokens = brandTokens(product.brand)

  if (!hostTokens.length || !images.length) {
    return ''
  }

  const wantTokens = extractModelTokens(product.name ?? '')

  const ranked = images
    .filter((image) => isBrandOfficialHost(safeHostname(image.url), hostTokens))
    .map((image) => {
      const urlText = decodeURIComponent(image.url).toUpperCase()
      const description = image.description
      const descriptionUpper = description.toUpperCase()
      // URL 用清洗过的专用取词（见 modelTokens.ts 的说明），描述是自然语言可直接用通用取词。
      const urlTokens = extractUrlModelTokens(image.url)
      const tokenConflict =
        urlTokens.length > 0 && !urlTokens.some((token) => wantTokens.some((want) => urlTokenMatches(token, want)))

      /**
       * 型号冲突：**有视觉质检时只降权，不淘汰**。
       *
       * 为什么改（踩过，代价是 8 个冷门品牌 0 张图）：
       * 这条规则靠 URL 字符串推断「型号对不对」，而图片 URL 里哈希串与型号无法区分
       * （`f1be63917` 和 `A211` 形态一模一样）。硬过滤会把大量干净的好图静默丢掉，
       * 日志上还完全看不出来。现在判断「是不是这款」这件事已经交给 imageJudge
       * 直接看图了 —— 那个信号比 URL 字符串强得多，所以 URL 冲突退回它擅长的角色：排序。
       * 当然，没有视觉质检时（`IMAGE_JUDGE=0`）它仍是唯一的线索，继续硬过滤。
       */
      const conflicts = judgeImage ? false : tokenConflict

      const urlHits = wantTokens.filter((token) => urlText.includes(token)).length
      const descHits = wantTokens.filter((token) => descriptionUpper.includes(token)).length

      let score = descHits * 3 + urlHits * 2 + 1
      if (judgeImage && tokenConflict) {
        score -= 3
      }
      if (PRODUCT_IMAGE_HINT.test(description)) {
        score += 2
      }
      if (LIFESTYLE_IMAGE_HINT.test(description)) {
        score -= 2
      }

      return { image, conflicts, score, evidence: descHits + urlHits }
    })
    .filter((item) => !item.conflicts)
    .sort((a, b) => b.score - a.score)

  if (!ranked.length) {
    return ''
  }

  // 有型号佐证的优先取；一个佐证都没有时退而取第一张（至少域名与型号都没冲突）。
  const ordered = ranked.some((item) => item.evidence > 0)
    ? ranked.filter((item) => item.evidence > 0)
    : ranked

  return pickFirstAcceptable(
    ordered.slice(0, MAX_IMAGE_GATE_TRIES).map((item) => ({ url: item.image.url })),
    hostTokens,
    judgeImage,
    { requireBrandHost: true, requireExplicitMatch: false, label: '官方候选图', maxJudge: MAX_IMAGE_GATE_TRIES },
  )
}

/**
 * 第三方候选的排序权重。
 *
 * ⚠️ 这里**只排序、不淘汰**。起初把这份「实测带过水印」的名单当成硬性排除，
 * 结果是冷门品牌几乎全军覆没 —— Tavily 对这类品牌的图片召回本来就差，
 * 排前面的往往正好是这几家电商图床，一排除就什么都不剩了。
 *
 * 而现在有了视觉质检，「这个域名历史上出过带水印的图」已经不是可靠信号了：
 * 同一域名内质量参差（实测 `img10.360buyimg.com` 是干净产品图、
 * `img12.360buyimg.com` 是营销海报）。正确的做法是**让视觉模型看图**，
 * 把域名信誉降级成排序权重 —— 干净的图床优先送检，有前科的排后面。
 */
const KNOWN_DIRTY_IMAGE_HOSTS = [
  'g-search1.alicdn.com',
  'g-search2.alicdn.com',
  'g-search3.alicdn.com',
  'gw.alicdn.com',
  'img.alicdn.com',
  'k.sinaimg.cn',
  'qnam.smzdm.com',
  'qna.smzdm.com',
  'static.cnbetacdn.com',
]

function thirdPartyImageRank(url: string) {
  const host = safeHostname(url)

  // 有前科的排最后（但仍会被送检，而不是丢掉）。
  if (KNOWN_DIRTY_IMAGE_HOSTS.includes(host)) {
    return 0
  }

  // 大电商/品牌图床相对规范，优先送检。
  if (/360buyimg\.com|jd\.com|sunimg\.cn|xiaomi\.com|mi-img\.com|apple\.com|hdslb\.com/.test(host)) {
    return 2
  }

  return 1
}

/**
 * 第三方图候选：把「整体排除」换成「逐张视觉质检」。
 *
 * 这是 2026-09-29 那次修正带来的新能力。此前第三方图被整片封杀，
 * 依据是「下载下来肉眼看过多张、系统性带水印」—— 在**没有视觉模型**的前提下，
 * 这个决定是对的：除了域名，当时没有任何信号能判断图里画了什么。
 * 现在能看了，规则就可以细化成「一张一张判」：
 *
 * - 仍要过基础闸（可达 / 是图 / 尺寸 / 长宽比），但**跳过品牌域名闸**。
 * - 必须过视觉质检（`requireExplicitMatch=true`）：模型认出型号，或检索侧有型号佐证，
 *   二者至少一个成立，且模型没有明确否认 —— 口径见 imageJudge 的 corroborated 说明。
 * - 与官方图一样排除型号冲突的候选。
 * - 域名只用来排序（见 thirdPartyImageRank），不再用来淘汰。
 */
async function pickJudgedSearchImage(
  product: LlmLockedProduct,
  images: SearchImage[],
  judgeImage?: ImageJudgeFn,
) {
  // 没有视觉质检就完全不要碰第三方图 —— 退回老规则。
  if (!judgeImage || !images.length) {
    return ''
  }

  const hostTokens = brandTokens(product.brand)
  const wantTokens = extractModelTokens(product.name ?? '')
  const seen = new Set<string>()

  const candidates = images
    .filter((image) => !isBrandOfficialHost(safeHostname(image.url), hostTokens))
    .filter((image) => {
      if (seen.has(image.url)) {
        return false
      }
      seen.add(image.url)
      return true
    })
    .map((image) => {
      const urlText = decodeURIComponent(image.url).toUpperCase()
      const descriptionUpper = (image.description || '').toUpperCase()
      const urlTokens = extractUrlModelTokens(image.url)
      // 第三方域**总是**有视觉质检（没有质检时这个函数根本不会被调用），
      // 所以型号冲突一律只降权、不淘汰，交由模型看图定夺。
      //
      // 这里刻意不做 `conflicts` 淘汰：URL 里的 `1200x1200`、`f1be63917` 这类
      // 尺寸/哈希串与型号词元在形态上无法区分（见 modelTokens 的说明），
      // 拿它当硬门槛会静默丢图 —— 冷门品曾经因此 0 图。
      const tokenConflict =
        urlTokens.length > 0 && !urlTokens.some((token) => wantTokens.some((want) => urlTokenMatches(token, want)))
      // 检索侧佐证：图片 URL 或其检索描述里出现了本次要的型号词元。
      // 这是独立于「模型认不认得出」的第二个信号，见 imageJudge 的 corroborated 说明。
      const corroborated = wantTokens.some((token) => urlText.includes(token) || descriptionUpper.includes(token))

      return {
        image,
        corroborated,
        // 排序：检索侧已有型号佐证的优先送检。
        // 这一层是**最后的兜底**，预算常常只够看前几名（见 MAX_JUDGE_CALLS），
        // 所以「谁先被看」直接决定成败。佐证是很强的信号（URL/描述里就带着型号），
        // 给 +2 让它能压过图床信誉的差距 —— 实测有 `检索侧佐证=true` 的候选
        // 因为排在后面而一次都没被看过。
        rank: thirdPartyImageRank(image.url) - (tokenConflict ? 1 : 0) + (corroborated ? 2 : 0),
      }
    })
    .sort((a, b) => b.rank - a.rank)
    // 过闸很便宜但也不是白给（每个候选一次 Range 请求），封顶 MAX_GATE_CANDIDATES 个。
    .slice(0, MAX_GATE_CANDIDATES)

  return pickFirstAcceptable(
    candidates.map((item) => ({ url: item.image.url, corroborated: item.corroborated })),
    hostTokens,
    judgeImage,
    {
      requireBrandHost: false,
      requireExplicitMatch: true,
      label: '第三方候选图',
      maxJudge: MAX_JUDGE_CANDIDATES,
    },
  )
}

/**
 * 阶段二的收口：强制拿到可解析的 JSON。
 *
 * 实测过的一个坑：即使带了 `response_format: json_object`，模型仍会偶尔「忘记」
 * 输出 JSON（同一输入三次里出现过一次，返回一段 179 字的纯文本，finish_reason=stop）。
 * 这属于语言层抖动而不是服务故障 —— 直接抛错会白白降级到商品库，所以补一条硬
 * 指令重试一次，而不是立刻放弃。
 */
async function finalizeWithJson(
  provider: LlmProvider,
  messages: ChatMessage[],
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  let { content, finishReason } = await requestCompletion(provider, messages, LLM_MAX_TOKENS, timeoutMs, {
    jsonMode: true,
  })

  // 推理模型常见坑：max_tokens 被思考过程吃光，content 为空且 length 截断。
  if (!content.trim() && finishReason === 'length') {
    ;({ content, finishReason } = await requestCompletion(provider, messages, LLM_MAX_TOKENS_RETRY, timeoutMs, {
      jsonMode: true,
    }))
  }

  let parsed = parseLlmJson(content)

  if (!parsed) {
    // 这行日志用来量化「模型忘记输出 JSON」的真实发生率：
    // 命中一次就意味着定品多等约 10s，频繁出现就该换模型或改提示词。
    console.warn(
      `[llmBuyer] ${provider.label} 首轮未返回可解析 JSON（finish_reason=${finishReason || 'unknown'}，长度=${content.length}），触发重试`,
    )

    const retryMessages: ChatMessage[] = [
      ...messages,
      {
        role: 'assistant',
        content: content.trim().slice(0, 600) || '（上一轮未按要求输出 JSON）',
      },
      {
        role: 'user',
        content: '只输出上面要求的那一个 JSON 对象。不要任何解释文字，不要 markdown 代码块。',
      },
    ]

    try {
      const retry = await requestCompletion(provider, retryMessages, LLM_MAX_TOKENS_RETRY, timeoutMs, {
        jsonMode: true,
      })
      parsed = parseLlmJson(retry.content)

      if (parsed) {
        content = retry.content
      } else {
        finishReason = retry.finishReason
        content = retry.content
      }
    } catch (error) {
      throw new Error(
        `${provider.label} 未返回可解析的 JSON，重试也失败（${error instanceof Error ? error.message : String(error)}）`,
      )
    }
  }

  if (!parsed) {
    // 最后一次机会：内容非空、但确实不是 JSON ⇒ 大概率是模型**用散文回了话**，
    // 而不是服务故障。
    //
    // 实测依据（2026-09-29 冷门用例跑批）：日志出现
    // `未返回可解析的 JSON（finish_reason=stop，长度=1068）`，
    // 而同一批的另一个用例正常返回了 `clarify_slots`，正文是一句正常的追问。
    // 也就是说模型在「该定品还是该追问」上本身就不稳，它有时直接用自然语言问你一句。
    // 这时把整条请求判成 503「买手大模型暂时不可用」是**误报** —— 模型好得很，
    // 只是没吐 JSON。用户该看到的是那句追问，而不是一个错误页。
    const prose = content.trim()

    if (prose.length > 0) {
      console.warn(
        `[llmBuyer] ${provider.label} 重试后仍非 JSON（finish_reason=${finishReason || 'unknown'}，长度=${prose.length}），按「追问」正文回收，不判为故障`,
      )
      return { action: 'clarify', chat_reply: prose.slice(0, 600) }
    }

    throw new Error(
      `${provider.label} 未返回可解析的 JSON（finish_reason=${finishReason || 'unknown'}，长度=${content.length}）`,
    )
  }

  return parsed
}

async function callProvider(
  provider: LlmProvider,
  history: ChatTurn[],
  timeoutMs: number,
  config: ReturnType<typeof useRuntimeConfig>,
) {
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    ...history.slice(-MAX_HISTORY_TURNS).map((turn) => ({ role: turn.role, content: turn.content })),
  ]

  let queries: string[] = []
  let hits: WebSearchHit[] = []
  let images: SearchImage[] = []
  const timings: Record<string, number> = {}

  // ── 阶段一：联网侦察（仅在配置了搜索源时启用）────────────────
  if (hasSearchProvider(config)) {
    const reconStartedAt = Date.now()
    const recon = await runSearchRecon(provider, messages, config, timeoutMs)
    timings.reconMs = Date.now() - reconStartedAt
    timings.reconLlmMs = recon.timings.llmMs
    timings.reconSearchMs = recon.timings.searchMs
    queries = recon.queries
    hits = recon.hits
    images = recon.images

    if (recon.notes.length) {
      console.warn('[llmBuyer] 检索降级：', recon.notes.join('；'))
    }

    if (recon.directPayload) {
      return { payload: recon.directPayload, queries, hits, images, timings }
    }
  }

  // ── 阶段二：定品（强制 JSON 输出）────────────────────────────
  // 这一轮不再给 tools：模型没有「再搜一轮」的退路，只能基于已有材料下判断。
  //
  // 紧接着再补一条 user 指令：实测「忽略 json_object、回一段纯文本」的抖动
  // 几乎只发生在 role:'tool' 之后（约 1/3 概率），此时系统提示已被一堆工具结果
  // 冲淡。把 JSON 要求放到**离生成位置最近**的一条消息里，能显著降低触发率。
  if (messages[messages.length - 1]?.role === 'tool') {
    messages.push({
      role: 'user',
      content:
        '资料已经够了，直接给出最终结论。只输出要求的那一个 JSON 对象：不要解释文字，不要 markdown 代码块，不要复述检索内容。',
    })
  }

  const finalizeStartedAt = Date.now()
  const payload = await finalizeWithJson(provider, messages, timeoutMs)
  timings.finalizeMs = Date.now() - finalizeStartedAt

  return { payload, queries, hits, images, timings }
}

function normalizeProduct(raw: unknown): LlmLockedProduct | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }

  const source = raw as Record<string, unknown>
  const name = sanitizeCopyText(source.name)
  const brand = sanitizeCopyText(source.brand)

  if (!name || !brand) {
    return null
  }

  return {
    name,
    brand,
    category: sanitizeCopyText(source.category) || undefined,
    price_display: sanitizeCopyText(source.price_display) || undefined,
    image: sanitizeCopyText(source.image) || undefined,
    source_url: sanitizeCopyText(source.source_url) || undefined,
    consultant_summary: sanitizeCopyText(source.consultant_summary) || undefined,
    craftsmanship: sanitizeCopyText(source.craftsmanship) || undefined,
    pairing_note: sanitizeCopyText(source.pairing_note) || undefined,
    why_this: Array.isArray(source.why_this) ? (source.why_this as unknown[]).map(sanitizeCopyText) : undefined,
    ideal_for: Array.isArray(source.ideal_for) ? (source.ideal_for as unknown[]).map(sanitizeCopyText) : undefined,
    avoid_for: Array.isArray(source.avoid_for) ? (source.avoid_for as unknown[]).map(sanitizeCopyText) : undefined,
    why_not_others: sanitizeCopyText(source.why_not_others) || undefined,
    scenarios: Array.isArray(source.scenarios) ? (source.scenarios as unknown[]).map(sanitizeCopyText) : undefined,
    matched_preferences: Array.isArray(source.matched_preferences)
      ? (source.matched_preferences as unknown[]).map(sanitizeCopyText)
      : undefined,
    signature_specs: Array.isArray(source.signature_specs)
      ? (source.signature_specs as unknown[]).map(sanitizeCopyText)
      : undefined,
  }
}

/**
 * 首选链路：让大模型亲自定品（可联网核实）。
 * 全部 provider 都失败时抛错，由调用方降级到商品库兜底链路。
 */
export async function decideProductWithLlm(
  config: ReturnType<typeof useRuntimeConfig>,
  history: ChatTurn[],
): Promise<LlmBuyerOutcome> {
  const providers = resolveProviders(config)

  if (providers.length === 0) {
    throw new Error('未配置 LLM_API_KEY，无法使用大模型定品。')
  }

  const errors: string[] = []
  const timeoutMs = Number(config.llmTimeoutMs) || DEFAULT_LLM_TIMEOUT_MS

  for (const provider of providers) {
    if (isProviderCoolingDown(provider.label)) {
      errors.push(`${provider.label} 处于熔断冷却期`)
      continue
    }

    const startedAt = Date.now()

    try {
      const { payload, queries, hits, images, timings } = await callProvider(provider, history, timeoutMs, config)
      const product = normalizeProduct(payload.locked_product)
      const action = payload.action === 'recommend' || product ? 'recommend' : 'clarify'
      const chatReply = sanitizeCopyText(payload.chat_reply)

      if (action === 'recommend' && !product) {
        throw new Error(`${provider.label} 声称定品但商品字段不完整`)
      }

      if (!chatReply && !product) {
        throw new Error(`${provider.label} 返回内容为空`)
      }

      // ── 来源核验（架构文档「方案 1」）──────────────────────────
      // 模型给的 source_url / image 一律当作「线索」而不是事实：
      // 真去抓一次页面，可达才保留链接，og:image 才拿来当商品图。
      // 这层不抛错——核验失败只影响图片与链接，不该拖垮整次定品。
      const llmLatencyMs = Date.now() - startedAt
      let sourceVerified = false
      let imageFrom: ImageFrom = 'none'

      if (action === 'recommend' && product) {
        const probeStartedAt = Date.now()
        /** 找图阶段的总截止时间，见 IMAGE_PHASE_BUDGET_MS。 */
        const imagePhaseDeadline = probeStartedAt + IMAGE_PHASE_BUDGET_MS

        // 视觉质检回调：拿不到就返回 undefined，下面每一级都会退回老规则。
        const judgeImage = createImageJudge(config, product)
        let judgeMs = 0
        let judgeCalls = 0
        let judgeWallStartedAt = 0

        /**
         * 官方域候选页（检索结果里判定为官方域的页面）。
         * 提前算出来是因为**两个地方都要用**：来源页核验、以及品牌标探测的域名候选。
         */
        const officialCandidatePages = pickOfficialCandidatePages(hits, product)

        /**
         * 品牌标兜底 —— 与找商品图**并行**发起。
         *
         * 用户 2026-09-29 明确要求：「官网图片弄不下来 url 咱们就把图片放一个官方标也可以啊」。
         * 关键是不能让它变成又一个「死磕」环节：探测本身最坏要 2s，串在找图之后就是纯增加等待；
         * 并行发起后，它只在这条链路最终没图时才被 await，而此时已经过去十几秒，
         * 结果早就回来了 —— 实测对总耗时零影响。
         */
        const logoPromise = resolveBrandLogo({
          sourceUrl: product.source_url,
          brand: product.brand,
          // 在这里传官方候选页的主机，是为了把「官网主站 favicon」的命中面扩到
          // 检索已经证明是官方域的站点上（如 e-pxn.com.cn）。
          // 注意它只增加**并发**探测的域名数，不增加等待：这一级仍然是最后才 await。
          extraHosts: officialCandidatePages
            .map((page) => safeHostname(page))
            .filter((host) => host.length > 0),
        }).catch(() => null)

        /** 质检时顺手捞到的「品牌官方标」（官网 og:image 常常就是它），比 favicon 清晰得多。 */
        let officialLogoFromJudge = ''
        /**
         * 官方域上「不是商品图」的 og:image —— 最后的兜底标识候选。
         *
         * 为什么要有这一档：实测官网 og:image 很常见的一类失败是
         * `reason:"not_product_shot"`，理由写着「整张图仅有 CASIO 品牌文字标识，没有出现商品本体」。
         * 这类图当封面不合格，但**它正是用户要的官方标**，而它已经在质检里被看过一次，
         * 识别出来是零额外成本。把它排在 favicon 之后：favicon 通常是 16×16~32×32 的糊图，
         * 而官网 og:image 往往是大尺寸干净图 —— 能用上的话观感好得多。
         * 只在「真标识 + favicon 都没有」时才轮到它，所以不会污染正常链路。
         */
        let officialNonProductImage = ''

        /**
         * 包一层做两件事：
         * 1. 记账 —— 视觉质检是本轮最贵的一步（每张图一次多模态请求），不单独计时就无法判断它值不值。
         * 2. 限流 —— 各级加起来最坏能送十几个候选来质检（来源页 og / 官方候选页 / 兜底选图 /
         *    官方域定向检索 / 第三方），必须封顶。次数用尽后直接返回「拒绝」，
         *    而不是抛错：图片只是锦上添花，链路本身不能因为质检额度用尽而失败。
         */
        const judge: ImageJudgeFn | undefined = judgeImage
          ? async (url, request) => {
              // 只按**次数**限流，不在这里看时间预算。
              //
              // 为什么不在质检这层加时间闸门：试过，会踩一个新坑 ——
              // 官方域定向检索本身要跑一次完整检索（最坏 25s），它一旦吃掉预算，
              // 后面那一整批质检就会**全部**被判「预算用尽」而拒绝，
              // 连本来能过的好图也一起丢掉。所以时间预算只用来决定
              // 「还要不要开启下一个**层级**」（见 IMAGE_PHASE_BUDGET_MS），
              // 单张的成本由 imageJudge 自己的 15s 上限兜住。
              if (judgeCalls >= MAX_JUDGE_CALLS) {
                return {
                  accept: false,
                  reason: 'unavailable',
                  productShot: false,
                  watermark: false,
                  matches: 'unclear',
                  isLogo: false,
                  quality: 0,
                  note: `本轮视觉质检次数已用尽（上限 ${MAX_JUDGE_CALLS}）`,
                  latencyMs: 0,
                }
              }

              judgeCalls += 1
              judgeWallStartedAt ||= Date.now()
              const verdict = await judgeImage(url, request)
              judgeMs += verdict.latencyMs

              // 顺手收集品牌官方标：必须是**品牌官方域**上的图。
              // 加域名约束是因为第三方域上的「logo 图」往往是媒体台标或促销角标，
              // 那正是我们要躲开的东西。
              if (isBrandOfficialHost(safeHostname(url), brandTokens(product.brand))) {
                if (verdict.isLogo) {
                  officialLogoFromJudge ||= url
                } else if (
                  !verdict.accept &&
                  verdict.reason === 'not_product_shot' &&
                  !verdict.watermark
                ) {
                  // 官网 og:image 被判「不是商品图」但没水印 ⇒ 留作最后的标识兜底。
                  // 要求「无水印」是因为带站标/促销角标的图当标识会很难看。
                  officialNonProductImage ||= url
                }
              }

              return verdict
            }
          : undefined

        // 模型给的 source_url 只是线索：真去抓页面，可达才留链接；
        // og:image 还要过「品牌官方域名 + 可达 + 尺寸长宽比」三道闸，再经视觉质检。
        const verified = await verifyProductSource(product.source_url, product.image, {
          brand: product.brand,
          candidatePages: officialCandidatePages,
          judgeImage: judge,
        })

        timings.probeMs = Date.now() - probeStartedAt

        // 链接绝不清空（用户 2026-09-29 明确要求保留「查看官网」按钮）：
        // 核验结果为空时退回模型原样给的地址 —— 前端按钮是 `v-if="source_url"`，
        // 这里一置空按钮就整块消失。真正的把关交给下面 official 那一级的替换逻辑
        // （有官方页时会被换掉），而不是靠删除入口。
        product.source_url = verified.sourceUrl || product.source_url || undefined
        sourceVerified = verified.verified
        imageFrom = verified.imageFrom

        // 兜底选图：只认品牌官方域名上的图（第三方整片排除，理由见 pickBrandSearchImage）。
        if (!verified.imageUrl) {
          const fallback = await pickBrandSearchImage(product, images, judge)
          product.image = fallback || undefined
          if (fallback) {
            imageFrom = 'brand_image'
          }
        } else {
          product.image = verified.imageUrl
        }

        // 官方域定向检索：前几级都空时才做，这是最可靠的一级（会多花一次检索额度）。
        // 但它也是最贵的一级（一次完整检索 + 最多 3 张质检），所以先看预算还剩多少 —— 
        // 见 IMAGE_PHASE_BUDGET_MS：超预算就跳过，直接交给品牌标兜底。
        if (!product.image && action === 'recommend' && Date.now() < imagePhaseDeadline) {
          const officialStartedAt = Date.now()
          try {
            const official = await searchOfficialBrandImage(config, product, hits, judge)
            timings.officialImageMs = Date.now() - officialStartedAt

            if (official.imageUrl) {
              product.image = official.imageUrl
              imageFrom = 'official_search'
            }

            if (official.pageUrl && (!product.source_url || !isBrandOfficialHost(safeHostname(product.source_url), brandTokens(product.brand)))) {
              product.source_url = official.pageUrl
              sourceVerified = true
            }

            verified.notes.push(...official.notes)
          } catch (error) {
            timings.officialImageMs = Date.now() - officialStartedAt
            verified.notes.push(`官方域定向检索失败：${error instanceof Error ? error.message : String(error)}`)
          }
        }

        // 最后一公里：官方域实在拿不到图时，才启用第三方图 + 视觉质检（老规则禁止的那批）。
        // 冷门品牌最容易卡在这里 —— 官网不提供 og:image、官方域检索也召回不到，
        // 但电商图床上一堆干净的产品图，以前只能白白丢掉。
        if (!product.image && action === 'recommend' && Date.now() < imagePhaseDeadline) {
          const judgedStartedAt = Date.now()
          const judged = await pickJudgedSearchImage(product, images, judge)
          timings.judgedImageMs = Date.now() - judgedStartedAt

          if (judged) {
            product.image = judged
            imageFrom = 'judged_search'
          }
        } else if (!product.image && action === 'recommend') {
          console.log(
            `[llmBuyer][imgAudit] 跳过第三方图：找图预算已用尽（${IMAGE_PHASE_BUDGET_MS}ms）`,
          )
        }

        // ── 品牌官方标兜底 ────────────────────────────────────────
        // 到这一步还没图，就**不再死磕商品图**（用户 2026-09-29 的要求），
        // 改用一张官方标识，卡片以「标识 + 型号」的方式呈现。
        // 优先级：质检判为纯标识的官方域图（官网 og:image 常常就是它，分辨率高）
        //        → 官方域 favicon（实测 32×32 ~ 192×192）
        //        → 官方域上「不是商品图但无水印」的图（最后一档，前面都没有才用）
        // 三者都拿不到就维持原样（前端显示「暂无可用商品图」的文字块）。
        if (!product.image && action === 'recommend') {
          const logoStartedAt = Date.now()
          const probed = await logoPromise
          const logoUrl = officialLogoFromJudge || probed?.url || officialNonProductImage || ''

          if (logoUrl) {
            product.image = logoUrl
            // 标出「这是标识不是商品图」，前端据此换一种排版（居中、contain，不铺满裁切）。
            product.image_kind = 'logo'
            imageFrom = 'brand_logo'
          }

          timings.logoMs = Date.now() - logoStartedAt
          console.log(
            `[llmBuyer][imgAudit] 品牌标兜底 ${JSON.stringify({
              from: officialLogoFromJudge
                ? 'official_og_is_logo'
                : probed
                  ? 'favicon'
                  : officialNonProductImage
                    ? 'official_og_not_product'
                    : 'none',
              logoUrl,
              domain: probed?.domain ?? '',
            })}`,
          )
        }

        // 视觉质检的代价要分开记：
        // - judgeWallMs 是整轮为质检实际多等的时间（并行时远小于下面那个和）
        // - judgeMsSum 是所有质检请求的耗时之和，用来看调用量与单张成本
        timings.judgeWallMs = judgeWallStartedAt ? Date.now() - judgeWallStartedAt : 0
        timings.judgeMsSum = judgeMs
        timings.judgeCalls = judgeCalls

        // 审计打点：量化「图片各级命中率」与各闸门的拦截分布。
        // 没有这行就只能看到「有图」，看不出图是从哪一级来的、被谁挡掉的。
        console.log(
          '[llmBuyer][imgAudit] ' +
            JSON.stringify({
              brand: product.brand,
              name: product.name,
              tier: imageFrom,
              imageHost: safeHostname(product.image),
              sourceHost: safeHostname(product.source_url),
              candidateCount: images.length,
              candidateHosts: [...new Set(images.map((image) => safeHostname(image.url)))].filter(Boolean),
              judged: Boolean(judge),
              judgeCalls,
              judgeMs,
              chosenImage: product.image || '',
              gateNotes: verified.notes,
            }),
        )
      }

      noteSuccess(provider.label)
      console.log(
        `[llmBuyer] ${provider.label} ok action=${action} 耗时拆解(ms)=`,
        JSON.stringify(timings),
        `检索=${queries.length}词 命中=${hits.length}图=${images.length}`,
      )

      return {
        action,
        chat_reply: chatReply,
        locked_product: action === 'recommend' ? product : null,
        provider: provider.label,
        latencyMs: llmLatencyMs,
        searchQueries: queries,
        searched: hits.length > 0,
        sourceVerified,
        imageFrom,
      }
    } catch (error) {
      noteFailure(provider.label)
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  throw new Error(`大模型定品失败：${errors.join('；')}`)
}

/** 把大模型定品结果映射成前端卡片的 Recommendation 结构。 */
export function toLlmRecommendation(product: LlmLockedProduct) {
  const summary = product.consultant_summary || `${product.brand} ${product.name}`
  const craftsmanship = product.craftsmanship || summary
  const pairingNote = product.pairing_note || ''
  const signatureSpecs = (product.signature_specs ?? []).filter(Boolean)

  return {
    name: product.name!,
    brand: product.brand!,
    category: product.category || '商品',
    image: product.image || '',
    // 空串 = 普通商品图；'logo' = 品牌标兜底，前端换版式（居中 contain）。
    image_kind: product.image_kind ?? '',
    price_range: product.price_display || '',
    budget_tier: '',
    consultant_summary: summary,
    materials: '',
    craftsmanship,
    pairing_note: pairingNote,
    style_tags: [] as string[],
    room_tags: [] as string[],
    signature_specs: signatureSpecs.length ? signatureSpecs.slice(0, 3) : [`${product.brand} 官方在售型号`],
    matched_preferences: sanitizeCopyArray(product.matched_preferences, [], 4),
    why_this: sanitizeCopyArray(product.why_this, [summary], 3),
    ideal_for: sanitizeCopyArray(product.ideal_for, [], 3),
    avoid_for: sanitizeCopyArray(product.avoid_for, [], 2),
    why_not_others: product.why_not_others || pairingNote,
    scenarios: sanitizeCopyArray(product.scenarios, [], 4),
    source_url: product.source_url || '',
  }
}

/** 供日志/前端展示：当前联网检索用的是什么数据源。 */
export function describeSearchSource(config: ReturnType<typeof useRuntimeConfig>) {
  return hasSearchProvider(config) ? getSearchProviderLabel(config) : ''
}
