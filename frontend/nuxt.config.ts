export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  modules: ['@nuxtjs/tailwindcss'],
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    workerChatUrl: process.env.WORKER_CHAT_URL || '',
    workerResolveIp: process.env.WORKER_RESOLVE_IP || '',
  },
  app: {
    head: {
      title: 'Retail-AI-Agent',
      meta: [
        { name: 'description', content: 'Retail AI Agent built with Nuxt 3, local product matching, and streaming AI recommendations.' },
      ],
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicon.png' },
      ],
    },
  },
})
