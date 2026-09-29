export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  modules: ['@nuxtjs/tailwindcss'],
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    // 首选：买手定品大模型（OpenAI 兼容端点）
    llmApiKey: process.env.LLM_API_KEY || '',
    llmBaseUrl: process.env.LLM_BASE_URL || 'https://e-flowcode.cc/v1',
    llmModel: process.env.LLM_MODEL || 'glm-5.3-flash',
    // 单次定品调用上限。快模型 6~7s 就够；换成 glm-5.3-flash 这类推理模型要 40s 以上。
    llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS || 40000),
    // 视觉质检：把候选商品图真的发给多模态模型看一眼再上卡片。
    // 关掉（IMAGE_JUDGE=0）则退回「只认品牌官方域名」的老规则。
    enableImageJudge: process.env.IMAGE_JUDGE !== '0',
    // 质检单独指模型（默认复用 LLM_MODEL）。实测 deepseek-v4.1-flash 与 glm-5.3-flash 都能看图。
    imageJudgeModel: process.env.IMAGE_JUDGE_MODEL || '',
    imageJudgeTimeoutMs: Number(process.env.IMAGE_JUDGE_TIMEOUT_MS || 12000),
    // 联网检索：给大模型装的「搜索工具」数据源。
    // 中转站不转发模型内置搜索能力，只能由我们自己代模型执行检索（见 server/utils/webSearch.ts）。
    // 留空则跳过联网，模型退回「凭自身知识定品」。
    tavilyApiKey: process.env.TAVILY_API_KEY || '',

    // ── 二级兜底：Cloudflare Worker（D1 + Vectorize 商品库 RAG）──────────
    // 🔴 这是「后路」，不是可选项。大模型不可用时靠它保证站点还能出卡片。
    // ⚠️ 曾经在 2026-09-29 被误删过（当时把用户说的「api 只留 e-flowcode」
    //    过度理解成「整条兜底链路也一并摘掉」）。恢复记录见 CHANGELOG。
    //    口径澄清：LLM_FALLBACK_*（备用**大模型**）留或不留是取舍，
    //    Worker 兜底（换一**整套数据源**）是可用性保险，两者不是一回事。
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
        { rel: 'icon', type: 'image/png', href: '/favicon.png?v=20260929b' },
      ],
    },
  },
})
