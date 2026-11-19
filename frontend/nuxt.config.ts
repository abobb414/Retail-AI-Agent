export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  modules: ['@nuxtjs/tailwindcss'],
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    // 定品大模型：DeepSeek 官方直连（OpenAI 兼容端点）。
    // e-flowcode 中转站已移除：它不转发模型内置联网能力，链路本身也是跨境的。
    // 密钥沿用旧的 LLM_FALLBACK_API_KEY —— Vercel Secret 无法回读，没必要再录一遍；
    // 新部署建议改用 DEEPSEEK_API_KEY。
    llmApiKey: process.env.DEEPSEEK_API_KEY || process.env.LLM_FALLBACK_API_KEY || process.env.LLM_API_KEY || '',
    llmBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    // ⚠️ 填的是**模型 ID**，不是控制台显示名：DeepSeek-V4.1-Flash → deepseek-flash。
    //    传显示名会被 400 拒绝。
    llmModel: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
    // 单次调用上限。联网那一轮包含搜索 + 读页，比纯生成慢，40s 是实测够用的值。
    llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS || 40000),
    // 原生联网：声明 DeepSeek 的服务端工具 deepseek_web_search，由官方执行检索。
    // 🔴 声明工具后不能再带 response_format（会 400），所以 JSON 定稿仍是单独一轮。
    //    置 0 则退回 Tavily 代模型检索（需 TAVILY_API_KEY）。
    llmWebSearch: process.env.LLM_WEB_SEARCH !== '0',

    // 视觉质检：把候选商品图真的发给多模态模型看一眼再上卡片。
    // 关掉（IMAGE_JUDGE=0）则退回「只认品牌官方域名」的老规则。
    enableImageJudge: process.env.IMAGE_JUDGE !== '0',
    // 质检单独指模型（默认复用 LLM_MODEL）。实测 deepseek-flash 能看图。
    imageJudgeModel: process.env.IMAGE_JUDGE_MODEL || '',
    imageJudgeTimeoutMs: Number(process.env.IMAGE_JUDGE_TIMEOUT_MS || 12000),
    // Tavily 现在只做两件事：官方域定向找商品图、第三方图候选。
    // 文字检索交给 deepseek_web_search；这项留空时找图会少几级，最终退回品牌标。
    tavilyApiKey: process.env.TAVILY_API_KEY || '',

    // ── 二级兜底：Cloudflare Worker（D1 + Vectorize 商品库 RAG）──────────
    // 🔴 这是「后路」，不是可选项。大模型不可用时靠它保证站点还能出卡片。
    // ⚠️ 曾经在 2026-09-29 被误删过（当时把用户说的「api 只留 e-flowcode」
    //    过度理解成「整条兜底链路也一并摘掉」）。恢复记录见 CHANGELOG。
    //    口径澄清：大模型线路只剩 DeepSeek 一条，它挂了是「换不出模型」；
    //    Worker 兜底是换一**整套数据源**，不依赖任何大模型，属于可用性保险。
    workerChatUrl: process.env.WORKER_CHAT_URL || '',
    // 可选：把 Worker 域名固定到这个 IP，绕开国内 DNS 解析问题（留空则正常解析）。
    workerResolveIp: process.env.WORKER_RESOLVE_IP || '',
  },
  app: {
    head: {
      title: 'Retail-AI-Agent',
      meta: [
        { name: 'description', content: 'Retail AI Agent built with Nuxt 3, local product matching, and streaming AI recommendations.' },
      ],
      link: [
        // favicon 本体被 vercel.json 设了长缓存，浏览器还有一层独立的 favicon 缓存，
        // 改图标时必须把这里的 v= 版本号 +1 才能强制所有人刷新。
        // 图标源图：https://img.icons8.com/pulsar-color/1600/message-bot.png（1600px 原生源，
        // 只做等比缩放，未重绘 —— 换图时按 icon-to-vector-favicon 流程重跑生成脚本即可）。
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico?v=20260930b', sizes: 'any' },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg?v=20260930b' },
        { rel: 'icon', type: 'image/png', href: '/favicon.png?v=20260930b' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png?v=20260930b' },
      ],
      script: [
        // Vercel Web Analytics：需在 Vercel 项目里开启 Analytics 后该脚本才可用
        { src: '/_vercel/insights/script.js', defer: true },
      ],
    },
  },
})
