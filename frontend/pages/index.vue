<template>
  <div class="chat-page flex min-h-[100dvh] items-start justify-center px-0 py-0 sm:px-6 sm:py-6 lg:py-8">
    <div class="chat-shell mx-auto flex h-[100dvh] w-full max-w-6xl flex-col overflow-hidden bg-white/52 shadow-[0_40px_100px_rgba(86,119,153,0.16)] backdrop-blur-[24px] sm:h-[min(88vh,920px)] sm:rounded-[36px]">
      <header class="shell-header flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8 sm:py-5">
        <div class="brand-lockup">
          <p class="wordmark" aria-label="Retail AI Agent">
            <span class="wordmark-retail">Retail</span>
            <span class="wordmark-ai">AI</span>
            <span class="wordmark-agent">Agent</span>
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="status-pill rounded-full border px-4 py-2 text-sm font-medium"
            :class="demoMode ? 'border-amber-200/80 bg-amber-50/80 text-amber-700' : 'border-emerald-200/80 bg-emerald-50/70 text-emerald-700'"
          >
            {{ demoMode ? '本地演示模式' : '模型在线模式' }}
          </span>
        </div>
      </header>

      <div class="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(0,1.22fr)_minmax(280px,0.78fr)]">
        <MessageList :messages="messages" />
        <StatusPanel class="hidden lg:flex" :active-recommendation="activeRecommendation" :profile-summary="profileSummary" />
      </div>

      <footer class="shell-footer px-4 py-4 sm:px-6 sm:py-6">
        <div class="mx-auto w-full max-w-4xl">
          <div v-if="messages.length === 1" class="mb-3 flex flex-wrap gap-2">
            <button
              v-for="prompt in quickPrompts"
              :key="prompt"
              type="button"
              class="quick-prompt rounded-full border border-white/70 bg-white/65 px-4 py-2 text-sm font-medium text-slate-500 shadow-[0_12px_28px_rgba(130,145,160,0.10)] transition hover:-translate-y-0.5 hover:bg-white/82 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="isStreaming"
              @click="sendMessage(prompt)"
            >
              {{ prompt }}
            </button>
          </div>
          <InputBar
            v-model="draft"
            :auto-focus-on-enable="!activeRecommendation"
            :disabled="isStreaming"
            @submit="sendMessage"
          />
        </div>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
const {
  activeRecommendation,
  demoMode,
  draft,
  isStreaming,
  messages,
  profileSummary,
  quickPrompts,
  sendMessage,
} = useChat()
</script>

<style scoped>
.chat-page {
  background:
    radial-gradient(circle at 12% 16%, rgba(154, 232, 199, 0.24), transparent 28%),
    radial-gradient(circle at 84% 12%, rgba(166, 218, 255, 0.34), transparent 26%),
    radial-gradient(circle at 72% 82%, rgba(194, 231, 255, 0.32), transparent 24%);
}

.chat-shell {
  position: relative;
}

.shell-header,
.shell-footer {
  position: relative;
}

.shell-header {
  background: transparent;
  border-bottom: 0;
}

.shell-footer {
  background: transparent;
  border-top: 0;
}

.brand-lockup {
  align-items: center;
  display: flex;
}

.wordmark {
  align-items: center;
  color: #58a57e;
  display: inline-flex;
  font-size: 1.6rem;
  font-style: italic;
  font-weight: 700;
  gap: 0.55rem;
  letter-spacing: 0.12em;
  margin: 0;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.78), 0 8px 24px rgba(124, 176, 145, 0.16);
}

@media (max-width: 640px) {
  .wordmark {
    font-size: 1.18rem;
    gap: 0.34rem;
    letter-spacing: 0.08em;
  }

  .status-pill {
    font-size: 0.75rem;
    padding: 0.45rem 0.75rem;
  }
}

.status-pill {
  box-shadow: 0 16px 32px rgba(155, 170, 188, 0.12);
}

.quick-prompt {
  backdrop-filter: blur(18px);
}
</style>
