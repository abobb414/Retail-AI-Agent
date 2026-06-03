export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  modules: ['@nuxtjs/tailwindcss'],
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    apiBase: process.env.NUXT_API_BASE || 'https://backend-bol609619914-4581-abobb.vercel.app',
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || 'https://backend-bol609619914-4581-abobb.vercel.app',
    },
  },
  app: {
    head: {
      title: 'Retail-AI-Agent',
      meta: [
        { name: 'description', content: 'Retail AI Agent starter project with Nuxt 3 and FastAPI.' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
    },
  },
})
