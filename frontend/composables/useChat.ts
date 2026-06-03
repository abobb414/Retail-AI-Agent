import type { ChatMessage, Recommendation } from '~/types/recommendation'

const welcomeMessage = '欢迎来到 Retail AI Agent。先从空间开始吧。你希望我围绕卧室、客厅、书房，还是某个更具体的角落来为你判断？'

function splitServerEvents(buffer: string) {
  const parts = buffer.split('\n\n')
  return {
    complete: parts.slice(0, -1),
    remainder: parts.at(-1) ?? '',
  }
}

function applyServerEvent(rawEvent: string, assistantMessage: ChatMessage, state: {
  demoMode: Ref<boolean>
  conversationStage: Ref<string>
  profileSummary: Ref<string[]>
  activeRecommendation: Ref<Recommendation | null>
}) {
  const lines = rawEvent.split('\n')
  const eventLine = lines.find((line) => line.startsWith('event:'))
  const dataLine = lines.find((line) => line.startsWith('data:'))
  const eventName = eventLine?.slice(6).trim()
  const payload = dataLine?.slice(5).trim()

  if (!eventName || !payload) {
    return
  }

  const data = JSON.parse(payload)

  if (eventName === 'chunk' && data.text) {
    assistantMessage.content += data.text
    return
  }

  if (eventName === 'product' && data.product) {
    assistantMessage.recommendation = data.product
    state.activeRecommendation.value = data.product
    return
  }

  if (eventName === 'meta') {
    state.demoMode.value = data.mode === 'mock'
    if (data.stage) {
      state.conversationStage.value = data.stage
    }
    state.profileSummary.value = data.profile_summary ?? []
    return
  }

  if (eventName === 'error') {
    assistantMessage.content = data.message
      ? `顾问服务暂时有些不稳定：${data.message}`
      : '顾问服务暂时有些不稳定，请稍后再试。'
  }
}

export function useChat() {
  const draft = ref('')
  const isStreaming = ref(false)
  const nextId = ref(2)
  const demoMode = ref(true)
  const conversationStage = ref('clarify_space')
  const profileSummary = ref<string[]>([])
  const activeRecommendation = ref<Recommendation | null>(null)
  const messages = ref<ChatMessage[]>([
    {
      id: 1,
      role: 'assistant',
      content: welcomeMessage,
      recommendation: null,
    },
  ])

  async function sendMessage() {
    const userText = draft.value.trim()
    if (!userText || isStreaming.value) {
      return
    }

    messages.value.push({
      id: nextId.value++,
      role: 'user',
      content: userText,
      recommendation: null,
    })
    draft.value = ''
    activeRecommendation.value = null

    const requestMessages = messages.value.map(({ role, content }) => ({ role, content }))
    const assistantMessage: ChatMessage = {
      id: nextId.value++,
      role: 'assistant',
      content: '',
      isStreaming: true,
      recommendation: null,
    }

    messages.value.push(assistantMessage)
    isStreaming.value = true

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages: requestMessages }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || '顾问服务暂时不可用。')
      }

      if (!response.body) {
        throw new Error('当前浏览器不支持流式读取。')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const { complete, remainder } = splitServerEvents(buffer)
        buffer = remainder

        for (const rawEvent of complete) {
          applyServerEvent(rawEvent, assistantMessage, {
            demoMode,
            conversationStage,
            profileSummary,
            activeRecommendation,
          })
        }

        messages.value = [...messages.value]
      }

      buffer += decoder.decode()
      const { complete } = splitServerEvents(`${buffer}\n\n`)
      for (const rawEvent of complete) {
        applyServerEvent(rawEvent, assistantMessage, {
          demoMode,
          conversationStage,
          profileSummary,
          activeRecommendation,
        })
      }

      if (!assistantMessage.content.trim()) {
        assistantMessage.content = '我暂时还没有整理出明确判断，你可以再补一句你更想要的氛围或使用方式。'
      }
    } catch (error) {
      assistantMessage.content = error instanceof Error
        ? `连接顾问服务时出现问题：${error.message}`
        : '连接顾问服务时出现了未知问题。'
    } finally {
      assistantMessage.isStreaming = false
      isStreaming.value = false
      messages.value = [...messages.value]
    }
  }

  return {
    activeRecommendation,
    conversationStage,
    demoMode,
    draft,
    isStreaming,
    messages,
    profileSummary,
    sendMessage,
  }
}
