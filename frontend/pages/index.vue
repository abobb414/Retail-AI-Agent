<template>
  <div class="chat-page flex min-h-[100dvh] flex-col">
    <!-- 品牌锁合钉在**整页**左上角（卡片之外），沿用 start.abobb.site 顶栏的规格与左右留白 -->
    <header class="page-topbar">
      <div class="brand-lockup">
        <img
          class="brand-mark"
          :src="brandMark"
          alt=""
          aria-hidden="true"
          width="28"
          height="28"
        />
        <span class="brand-copy">
          <strong>Retail AI Agent</strong>
          <small>shopping concierge</small>
        </span>
      </div>
      <button
        v-if="messages.length > 1"
        type="button"
        class="new-chat-button ui-meta inline-flex items-center gap-2 rounded-full px-4 py-2 font-medium text-slate-500 transition hover:-translate-y-0.5 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="isStreaming"
        @click="resetChat"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" class="h-4 w-4" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v5h5" />
        </svg>
        <span>新会话</span>
      </button>
    </header>

    <div class="shell-area">
      <div class="chat-shell flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden bg-white/52 shadow-[0_40px_100px_rgba(86,119,153,0.16)] backdrop-blur-[24px] sm:rounded-[36px]" :class="{ 'entrance': entranceActive }">
        <div class="flex min-h-0 flex-1 flex-col overflow-hidden entrance-body">
          <MessageList :messages="messages" />
        </div>

        <footer class="shell-footer px-4 py-4 sm:px-6 sm:py-6 entrance-footer">
          <div class="mx-auto w-full max-w-4xl">
            <div v-if="messages.length === 1" class="mb-3 flex flex-wrap gap-2">
              <button
                v-for="(prompt, i) in quickPrompts"
                :key="prompt"
                type="button"
                class="quick-prompt ui-meta rounded-full border border-white/70 bg-white/65 px-4 py-2 font-medium text-slate-500 shadow-[0_12px_28px_rgba(130,145,160,0.10)] transition hover:-translate-y-0.5 hover:bg-white/82 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50 entrance-prompt"
                :class="{ 'entrance-prompt-visible': entranceActive }"
                :style="{ '--prompt-delay': `${0.34 + i * 0.06}s` }"
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
              class="entrance-input"
              @submit="sendMessage"
            />
          </div>
        </footer>
      </div>
    </div>

    <footer class="page-footer ui-label">© {{ year }} AlistairBo · Retail AI Agent · 保留所有权利</footer>
  </div>
</template>

<script setup lang="ts">
import brandMark from '~/assets/icons/favicon-robot.svg'

const {
  activeRecommendation,
  draft,
  isStreaming,
  messages,
  quickPrompts,
  resetChat,
  sendMessage,
} = useChat()

// 版权年份跟着系统走，免得每年回来改一次。
const year = new Date().getFullYear()

const entranceActive = ref(false)
onMounted(() => {
  requestAnimationFrame(() => {
    entranceActive.value = true
  })
})
</script>

<style scoped>
.chat-page {
  background:
    radial-gradient(circle at 12% 16%, rgba(154, 232, 199, 0.24), transparent 28%),
    radial-gradient(circle at 84% 12%, rgba(166, 218, 255, 0.34), transparent 26%),
    radial-gradient(circle at 72% 82%, rgba(194, 231, 255, 0.32), transparent 24%);
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}

/* ── 页面级顶栏 ─────────────────────────────────────
   品牌锁合钉在**整页**左上角（卡片之外），左右留白照抄 start.abobb.site
   的 .topbar：clamp(22px, 5vw, 76px)。

   高度**钉死 84px**（= 27 + 锁合 30 + 27）而不是用 padding 撑：这样
   ① 锁合的上下间隙恒为 27px；
   ② 「新会话」按钮出现/消失时顶栏高度不变（否则按钮会把顶栏撑到 92px，
      卡片整体往下跳 8px）；
   ③ 与页脚 min-height 84px 配平 ⇒ 卡片外围的上下留白严格相等。 */
.page-topbar {
  align-items: center;
  animation: entrance-header 0.38s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both;
  display: flex;
  flex: none;
  gap: 12px;
  height: 84px;
  justify-content: space-between;
  padding: 0 clamp(22px, 5vw, 76px);
  position: relative;
  z-index: 2;
}

/* 卡片区：吃掉顶栏之外的全部高度，整页仍是一屏不滚。 */
.shell-area {
  display: flex;
  flex: 1 1 auto;
  justify-content: center;
  min-height: 0;
  /* 上下都不留白：卡片上顶顶栏、下接页脚，卡片外围的上下留白由顶栏/页脚各自的高度决定。 */
  padding: 0 1.5rem;
}

/* 页脚版权：整页最底部一行小字，左右留白与顶栏同一套。
   高度对齐顶栏（27+30+27 = 84px），文字垂直居中 ⇒
   「卡片到视口顶」与「卡片到视口底」的留白严格相等。 */
.page-footer {
  align-items: center;
  color: #93a0b0;
  display: flex;
  flex: none;
  justify-content: center;
  letter-spacing: 0.06em;
  min-height: 84px;
  padding: 0 clamp(22px, 5vw, 76px);
  position: relative;
  text-align: center;
  z-index: 2;
}

.chat-shell {
  position: relative;
}

.shell-footer {
  position: relative;
  background: transparent;
  border-top: 0;
}

@media (max-width: 639px) {
  .page-topbar {
    height: 62px;
    padding: 0 20px;
  }

  /* 窄屏卡片贴边满屏；页脚高度对齐窄屏顶栏（16+30+16 = 62px）。 */
  .shell-area {
    padding: 0;
  }

  .page-footer {
    min-height: 62px;
    padding: 0 20px;
  }
}

.brand-lockup {
  align-items: center;
  display: inline-flex;
  gap: 10px;
}

/* 品牌图标 = 站点 favicon（彩色机器人）的同款矢量素材，直接 1:1 呈现在 28px 画布上。 */
.brand-mark {
  display: block;
  flex: none;
  height: 28px;
  width: 28px;
}

/* 两行锁合：第一行品牌名，第二行英文小字。尺寸/间距对齐 start.abobb.site 的 logo。 */
.brand-copy {
  display: flex;
  flex-direction: column;
  line-height: 1.1;
}

.brand-copy strong {
  color: #1f2d3d;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.brand-copy small {
  color: #7b8798;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  margin-top: 4px;
}

.quick-prompt {
  backdrop-filter: blur(18px);
}

.new-chat-button {
  background: rgba(255, 255, 255, 0.58);
  border: 1px solid rgba(255, 255, 255, 0.68);
  box-shadow: 0 14px 30px rgba(148, 163, 184, 0.12);
}

/* ── Entrance animation ────────────────────────────── */

.entrance {
  animation: entrance-shell 0.42s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.entrance .entrance-body {
  opacity: 0;
  animation: entrance-fade 0.4s ease 0.18s both;
}

.entrance .entrance-footer {
  opacity: 0;
  animation: entrance-footer 0.4s cubic-bezier(0.22, 1, 0.36, 1) 0.22s both;
}

.entrance-prompt {
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.3s ease, transform 0.3s ease;
  transition-delay: var(--prompt-delay, 0.34s);
}

.entrance-prompt.entrance-prompt-visible {
  opacity: 1;
  transform: translateY(0);
}

.entrance .entrance-input {
  opacity: 0;
  animation: entrance-footer 0.38s cubic-bezier(0.22, 1, 0.36, 1) 0.3s both;
}

@keyframes entrance-shell {
  from {
    opacity: 0;
    transform: scale(0.97) translateY(10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@keyframes entrance-header {
  from {
    opacity: 0;
    transform: translateY(-12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes entrance-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes entrance-footer {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
