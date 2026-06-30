<template>
  <div ref="viewport" class="message-viewport h-full min-h-0 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
    <TransitionGroup name="message" tag="div" class="space-y-4">
      <div
        v-for="message in messages"
        :key="message.id"
        :data-message-id="message.id"
        :data-message-role="message.role"
        class="flex items-start gap-3"
        :class="message.role === 'user' ? 'flex-row-reverse' : ''"
      >
        <div
          class="mt-1 flex h-10 w-10 shrink-0 items-center justify-center"
          :class="message.role === 'assistant' ? 'ai-avatar' : 'user-avatar'"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            :class="message.role === 'assistant' ? 'avatar-icon avatar-icon-ai' : 'avatar-icon avatar-icon-user'"
            aria-hidden="true"
          >
            <circle cx="12" cy="8" r="3.2" />
            <path d="M6.8 18.2C7.5 15.8 9.5 14.4 12 14.4C14.5 14.4 16.5 15.8 17.2 18.2" />
          </svg>
          <span class="sr-only">{{ message.role === 'assistant' ? '顾问头像' : '用户头像' }}</span>
        </div>

        <div
          class="message-stack space-y-3"
          :class="[
            message.role === 'user' ? 'user-stack' : 'assistant-stack',
            message.recommendation ? 'has-recommendation' : '',
          ]"
        >
          <div
            class="message-bubble rounded-[24px] px-4 py-3 text-[15px] font-normal leading-7 shadow-[0_16px_36px_rgba(140,156,176,0.12)]"
            :class="message.role === 'assistant' ? 'assistant-bubble text-slate-700' : 'user-bubble text-slate-700'"
          >
            <MessageText v-if="message.content" :content="message.content" />
            <span v-else-if="message.isStreaming" class="streaming-dots" aria-label="顾问正在回复">
              <span />
              <span />
              <span />
            </span>
          </div>
          <RecommendationCard v-if="message.recommendation" :recommendation="message.recommendation" />
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import type { ChatMessage } from '~/types/recommendation'

const props = defineProps<{
  messages: ChatMessage[]
}>()

const viewport = ref<HTMLElement | null>(null)

function scrollToBottom(behavior: ScrollBehavior = 'auto') {
  const element = viewport.value
  if (element) {
    element.scrollTo({ top: element.scrollHeight, behavior })
  }
}

function scrollMessageIntoReadingPosition(messageId: number, behavior: ScrollBehavior = 'smooth') {
  const element = viewport.value
  const target = element?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)
  if (!element || !target) {
    return
  }

  const viewportTop = element.getBoundingClientRect().top
  const targetTop = target.getBoundingClientRect().top
  const readingOffset = 16
  element.scrollTo({
    top: element.scrollTop + targetTop - viewportTop - readingOffset,
    behavior,
  })
}

watch(
  () => props.messages.map((message) => `${message.id}:${message.role}`).join('|'),
  async () => {
    await nextTick()
    const latestMessage = props.messages.at(-1)
    if (!latestMessage) {
      return
    }

    if (latestMessage.role === 'assistant') {
      scrollMessageIntoReadingPosition(latestMessage.id)
      return
    }

    scrollToBottom('smooth')
  },
)

onMounted(scrollToBottom)
</script>

<style scoped>
.message-viewport {
  background: transparent;
  scrollbar-color: rgba(148, 163, 184, 0.55) transparent;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
}

@media (min-width: 1024px) {
  .message-viewport {
    border-right: 0;
  }
}

.message-viewport::-webkit-scrollbar {
  width: 6px;
}

.message-viewport::-webkit-scrollbar-track {
  background: transparent;
}

.message-viewport::-webkit-scrollbar-thumb {
  background-clip: padding-box;
  background-color: rgba(148, 163, 184, 0.42);
  border: 1px solid transparent;
  border-radius: 9999px;
}

.message-viewport::-webkit-scrollbar-thumb:hover {
  background-color: rgba(100, 116, 139, 0.56);
}

.message-bubble {
  display: inline-block;
  max-width: min(34rem, 100%);
  overflow: hidden;
  position: relative;
  width: fit-content;
}

.message-stack {
  align-items: flex-start;
  display: flex;
  flex-direction: column;
  max-width: 88%;
  min-width: 0;
}

.user-stack {
  align-items: flex-end;
}

.assistant-stack {
  align-items: flex-start;
}

.message-stack.has-recommendation {
  width: min(34rem, 88%);
}

@media (min-width: 640px) {
  .message-stack {
    max-width: 84%;
  }

  .message-stack.has-recommendation {
    width: min(34rem, 84%);
  }
}

.assistant-bubble {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(251, 246, 239, 0.74));
  border: 1px solid rgba(255, 255, 255, 0.52);
}

.user-bubble {
  background: linear-gradient(180deg, rgba(234, 250, 241, 0.96), rgba(219, 243, 231, 0.88));
  border: 1px solid rgba(206, 235, 222, 0.92);
}

.ai-avatar {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(241, 251, 245, 0.82));
  border: 1px solid rgba(255, 255, 255, 0.74);
  border-radius: 9999px;
  box-shadow: 0 10px 26px rgba(148, 163, 184, 0.14);
}

.user-avatar {
  background: linear-gradient(180deg, rgba(232, 250, 240, 0.98), rgba(214, 241, 228, 0.92));
  border: 1px solid rgba(208, 235, 223, 0.92);
  border-radius: 9999px;
  box-shadow: 0 10px 26px rgba(148, 163, 184, 0.14);
}

.avatar-icon {
  height: 18px;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
  width: 18px;
}

.avatar-icon-ai {
  stroke: rgba(5, 150, 105, 0.9);
}

.avatar-icon-user {
  stroke: rgba(71, 85, 105, 0.9);
}

.streaming-dots {
  align-items: center;
  display: inline-flex;
  gap: 0.3rem;
  min-height: 1.5rem;
}

.streaming-dots span {
  animation: pulse 1s ease-in-out infinite;
  background: rgba(15, 23, 42, 0.45);
  border-radius: 9999px;
  height: 0.42rem;
  width: 0.42rem;
}

.streaming-dots span:nth-child(2) {
  animation-delay: 0.14s;
}

.streaming-dots span:nth-child(3) {
  animation-delay: 0.28s;
}

.message-enter-active {
  transition: opacity 0.32s ease, transform 0.32s ease;
}

.message-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.message-enter-to {
  opacity: 1;
  transform: translateY(0);
}

@keyframes pulse {
  0%,
  80%,
  100% {
    opacity: 0.28;
    transform: translateY(0);
  }

  40% {
    opacity: 1;
    transform: translateY(-2px);
  }
}
</style>
