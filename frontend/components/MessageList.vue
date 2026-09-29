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
          class="mt-1 flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full"
          :class="message.role === 'assistant' ? 'ai-avatar' : 'user-avatar'"
        >
          <span
            class="avatar-glyph"
            :class="message.role === 'assistant' ? 'avatar-glyph-ai' : 'avatar-glyph-user'"
            role="img"
            :aria-label="message.role === 'assistant' ? '顾问头像' : '用户头像'"
          />
        </div>

        <div
          class="message-stack space-y-3"
          :class="[
            message.role === 'user' ? 'user-stack' : 'assistant-stack',
            message.recommendation ? 'has-recommendation' : '',
          ]"
        >
          <div
            class="message-bubble ui-body rounded-[24px] px-4 py-3 shadow-[0_16px_36px_rgba(140,156,176,0.12)]"
            :class="message.role === 'assistant' ? 'assistant-bubble text-slate-700' : 'user-bubble text-slate-700'"
          >
            <MessageText v-if="message.content" :content="message.content" />
            <span v-else-if="message.isStreaming" class="streaming-row">
              <span class="streaming-dots" aria-label="顾问正在回复">
                <span />
                <span />
                <span />
              </span>
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
  max-width: min(34rem, calc(100vw - 5.75rem));
  overflow: hidden;
  position: relative;
  overflow-wrap: anywhere;
  word-break: break-word;
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

/* 头像：单色线稿走 CSS mask，颜色由 CSS 给（不把黑色原封不动贴上去） */
.avatar-glyph {
  background-color: currentColor;
  display: block;
  height: 34px;
  width: 34px;
  -webkit-mask-image: var(--avatar-mask);
  mask-image: var(--avatar-mask);
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: contain;
  mask-size: contain;
}

/* 顾问（AI）：品牌绿 —— 沿用改造前内联 SVG 的墨色 #059669 */
.avatar-glyph-ai {
  --avatar-mask: url('/avatar-bot.svg');
  color: #059669;
  /* 机器人是「宽而扁 + 内部细节多」的形，同样 34px 下比用户的人形读起来轻，
     所以单独放大一档做光学配平（36/40 仍留有安全边距） */
  height: 36px;
  width: 36px;
}

/* 用户：中性石板灰 —— 沿用改造前内联 SVG 的墨色 #475569 */
.avatar-glyph-user {
  --avatar-mask: url('/avatar-user.svg');
  color: #475569;
}

.streaming-row {
  align-items: center;
  display: inline-flex;
  gap: 0.5rem;
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
