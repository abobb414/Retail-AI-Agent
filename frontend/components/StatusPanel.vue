<template>
  <aside class="status-panel flex min-h-0 flex-col px-5 py-5 sm:px-6">
    <div class="space-y-4" :class="activeRecommendation ? '' : '-mt-2'">
      <div v-if="activeRecommendation" class="assistant-bubble rounded-[24px] px-4 py-3 text-[15px] font-medium leading-7 text-slate-800">
        <p class="text-[11px] uppercase tracking-[0.28em] text-slate-700">当前推荐</p>
        <h3 class="mt-3 text-2xl font-semibold leading-tight text-slate-800">{{ activeRecommendation.name }}</h3>
        <p class="mt-2 text-[15px] leading-7 text-slate-800">
          {{ activeRecommendation.category }} · {{ activeRecommendation.budget_tier }}
        </p>
        <p class="mt-3 text-[15px] leading-7 text-slate-800">{{ activeRecommendation.consultant_summary }}</p>
      </div>

      <div v-if="profileSummary.length" class="flex flex-wrap gap-3">
        <div
          v-for="summary in profileSummary"
          :key="summary"
          class="assistant-bubble inline-flex w-fit max-w-full rounded-[24px] px-4 py-3 text-[15px] font-medium leading-7 text-slate-800"
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

.assistant-bubble {
  background: #fff;
  border: 1px solid rgba(230, 236, 242, 0.96);
  box-shadow: 0 20px 42px rgba(104, 120, 145, 0.18);
}
</style>
