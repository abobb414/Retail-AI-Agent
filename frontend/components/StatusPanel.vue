<template>
  <aside class="status-panel flex min-h-0 flex-col px-5 py-5 sm:px-6">
    <div class="space-y-4" :class="activeRecommendation ? '' : '-mt-2'">
      <div v-if="activeRecommendation" class="glass-panel rounded-[24px] px-5 py-4 text-[15px] font-medium leading-7 text-slate-700">
        <p class="panel-kicker text-[11px] uppercase tracking-[0.28em]">当前推荐</p>
        <h3 class="mt-3 text-2xl font-semibold leading-tight text-slate-800">{{ activeRecommendation.name }}</h3>
        <p class="mt-2 text-[15px] leading-7 text-slate-600">
          {{ activeRecommendation.category }} · {{ activeRecommendation.budget_tier }}
        </p>
        <p class="mt-3 text-[15px] leading-7 text-slate-700">{{ activeRecommendation.consultant_summary }}</p>
      </div>

      <div v-if="profileSummary.length" class="flex flex-wrap gap-3">
        <div
          v-for="summary in profileSummary"
          :key="summary"
          class="glass-chip inline-flex w-fit max-w-full rounded-[24px] px-4 py-3 text-[15px] font-medium leading-7 text-slate-700"
        >
          {{ summary }}
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import type { Recommendation } from '~/types/recommendation'

defineProps<{
  activeRecommendation: Recommendation | null
  profileSummary: string[]
}>()
</script>

<style scoped>
.status-panel {
  background: transparent;
}

.glass-panel,
.glass-chip {
  backdrop-filter: blur(24px) saturate(1.18);
  -webkit-backdrop-filter: blur(24px) saturate(1.18);
  border: 1px solid rgba(255, 255, 255, 0.58);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.72),
    0 18px 42px rgba(86, 119, 153, 0.12);
}

.glass-panel {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.58), rgba(246, 252, 250, 0.38)),
    radial-gradient(circle at 18% 0%, rgba(192, 241, 220, 0.34), transparent 34%),
    radial-gradient(circle at 100% 24%, rgba(190, 226, 255, 0.28), transparent 36%);
}

.glass-chip {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.48), rgba(239, 249, 246, 0.34));
}

.panel-kicker {
  color: rgba(65, 118, 94, 0.78);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.68);
}
</style>
