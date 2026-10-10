import type { ChatMessage, Recommendation } from '~/types/recommendation'

const welcomeMessage = '欢迎来到灵感买手店。你可以说一个品类，也可以说一个场景；如果信息还不够，我会先问一句再推荐。'
const quickPrompts = ['给我推荐半袖', '想找一把办公椅', '小卧室想更舒服']

interface StreamTarget {
  assistantMessage: ChatMessage
  activeRecommendation: Ref<Recommendation | null>
}

/** 按空行切出完整的 SSE 事件块；末尾不完整的那段留给下一次拼接。 */
function splitServerEvents(buffer: string) {
  const parts = buffer.split('\n\n')
  return {
    complete: parts.slice(0, -1),
    remainder: parts.at(-1) ?? '',
  }
}

function applyServerEvent(rawEvent: string, { assistantMessage, activeRecommendation }: StreamTarget) {
  const lines = rawEvent.split('\n')
  const eventName = lines.find((line) => line.startsWith('event:'))?.slice(6).trim()
  const payload = lines.find((line) => line.startsWith('data:'))?.slice(5).trim()

  if (!eventName || !payload) {
    return
  }

  let data: Record<string, any>
  try {
    data = JSON.parse(payload)
  } catch {
    // 单条数据损坏不应毁掉整轮回复，跳过即可。
    return
  }

  if (eventName === 'chunk' && data.text) {
    assistantMessage.content += data.text
    return
  }

  if (eventName === 'product' && data.product) {
    assistantMessage.recommendation = data.product
    activeRecommendation.value = data.product
    return
  }

  // 非定品阶段（思考中 / 追问）没有卡片，清掉上一轮残留。
  if (eventName === 'meta' && data.stage && data.stage !== 'rag_recommendation') {
    assistantMessage.recommendation = null
    activeRecommendation.value = null
    return
  }

  if (eventName === 'error') {
    assistantMessage.content = data.message
      ? `顾问服务暂时有些不稳定：${data.message}`
      : '顾问服务暂时有些不稳定，请稍后再试。'
  }
}

function welcomeMessages(): ChatMessage[] {
  return [{ id: 1, role: 'assistant', content: welcomeMessage, recommendation: null }]
}

export function useChat() {
  const draft = ref('')
  const isStreaming = ref(false)
  const nextId = ref(2)
  const activeRecommendation = ref<Recommendation | null>(null)
  const messages = ref<ChatMessage[]>(welcomeMessages())

  function resetChat() {
    draft.value = ''
    isStreaming.value = false
    nextId.value = 2
    activeRecommendation.value = null
    messages.value = welcomeMessages()
  }

  async function sendMessage(overrideText?: string) {
    const userText = (overrideText ?? draft.value).trim()
    if (!userText || isStreaming.value) {
      return
    }

    messages.value.push({ id: nextId.value++, role: 'user', content: userText, recommendation: null })
    draft.value = ''
    activeRecommendation.value = null
    messages.value = messages.value.map((message) =>
      message.recommendation ? { ...message, recommendation: null } : message,
    )

    const requestMessages = messages.value.map(({ role, content }) => ({ role, content }))

    messages.value.push({ id: nextId.value++, role: 'assistant', content: '', isStreaming: true, recommendation: null })
    // 取响应式代理：直接改原始对象不会触发界面更新。
    const assistantMessage = messages.value.at(-1)!
    const target: StreamTarget = { assistantMessage, activeRecommendation }
    isStreaming.value = true

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: requestMessages }),
      })

      if (!response.ok) {
        throw new Error((await response.text()) || '顾问服务暂时不可用。')
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
        complete.forEach((rawEvent) => applyServerEvent(rawEvent, target))
      }

      // 流结束时补上最后一个没有空行结尾的事件。
      buffer += decoder.decode()
      splitServerEvents(`${buffer}\n\n`).complete.forEach((rawEvent) => applyServerEvent(rawEvent, target))

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
    }
  }

  return {
    activeRecommendation,
    draft,
    isStreaming,
    messages,
    quickPrompts,
    resetChat,
    sendMessage,
  }
}
