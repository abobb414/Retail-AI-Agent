<template>
  <div class="recommend-card overflow-hidden rounded-[30px] border border-white/50 shadow-[0_26px_60px_rgba(87,94,119,0.24)]">
    <div class="recommend-cover relative h-48 overflow-hidden">
      <img :src="proxiedImage" :alt="recommendation.name" class="h-full w-full object-cover" loading="lazy">
      <div class="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-900/30 to-transparent" />
      <div class="absolute left-5 top-5 flex flex-wrap gap-2">
        <span class="rounded-full bg-white/80 px-3 py-1 text-[11px] font-medium text-slate-700">{{ recommendation.category }}</span>
        <span class="rounded-full bg-black/20 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">{{ recommendation.brand }}</span>
      </div>
      <div class="absolute bottom-5 left-5 right-5">
        <p class="text-[11px] uppercase tracking-[0.26em] text-white/70">顾问推荐</p>
        <h3 class="mt-2 text-2xl font-semibold text-white">{{ recommendation.name }}</h3>
        <div class="mt-2 flex flex-wrap gap-2 text-sm font-medium text-white/80">
          <span>{{ recommendation.price_range }}</span>
          <span>·</span>
          <span>{{ recommendation.budget_tier }}</span>
        </div>
      </div>
    </div>

    <div class="space-y-5 px-5 py-5 text-sm font-normal leading-7 text-slate-600">
      <div class="summary-box rounded-2xl p-4">
        <p class="mb-2 text-xs uppercase tracking-[0.24em] text-emerald-800/60">顾问判断摘要</p>
        <p>{{ recommendation.consultant_summary }}</p>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <p class="mb-1 text-xs uppercase tracking-[0.22em] text-slate-400">材质 / 工艺</p>
          <p>{{ recommendation.materials }}</p>
          <p class="mt-2 text-slate-500">{{ recommendation.craftsmanship }}</p>
        </div>
        <div>
          <p class="mb-1 text-xs uppercase tracking-[0.22em] text-slate-400">搭配建议</p>
          <p>{{ recommendation.pairing_note }}</p>
        </div>
      </div>

      <ChipSection title="风格 / 空间标签" :items="[...recommendation.style_tags, ...recommendation.room_tags]" tone="slate" />
      <ListSection title="专业参数" :items="recommendation.signature_specs" class-name="spec-chip rounded-2xl px-3 py-2" />
      <ChipSection title="命中的偏好点" :items="recommendation.matched_preferences" tone="emerald" />
      <ListSection title="为什么选这款" :items="recommendation.why_this" class-name="reason-chip rounded-2xl px-3 py-2" />

      <div class="grid gap-4 sm:grid-cols-2">
        <ListSection title="更适合哪些人" :items="recommendation.ideal_for" class-name="rounded-2xl bg-emerald-50/70 px-3 py-2" />
        <ListSection title="暂不优先给谁" :items="recommendation.avoid_for" class-name="rounded-2xl bg-rose-50/70 px-3 py-2" />
      </div>

      <div>
        <p class="mb-1 text-xs uppercase tracking-[0.22em] text-slate-400">为什么暂不推荐别的</p>
        <p>{{ recommendation.why_not_others }}</p>
      </div>

      <ChipSection title="适用场景" :items="recommendation.scenarios" tone="slate" />

      <div v-if="recommendation.source_url" class="pt-1">
        <a
          :href="recommendation.source_url"
          target="_blank"
          rel="noreferrer"
          class="inline-flex items-center rounded-full border border-emerald-200/90 bg-emerald-50 px-4 py-2 text-xs font-medium tracking-[0.18em] text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100"
        >
          查看官网
        </a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Recommendation } from '~/types/recommendation'

const props = defineProps<{
  recommendation: Recommendation
}>()

const proxiedImage = computed(() => {
  if (props.recommendation.image.startsWith('/')) {
    return props.recommendation.image
  }

  return `/api/image?url=${encodeURIComponent(props.recommendation.image)}`
})
</script>

<style scoped>
.recommend-card {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 252, 247, 0.82));
}

.recommend-cover {
  background: #dfe9e4;
}

.summary-box {
  background: linear-gradient(180deg, rgba(236, 253, 245, 0.78), rgba(255, 255, 255, 0.62));
  border: 1px solid rgba(167, 243, 208, 0.55);
}

.spec-chip {
  background: rgba(248, 250, 252, 0.8);
  border: 1px solid rgba(226, 232, 240, 0.82);
}

.reason-chip {
  background: rgba(255, 251, 235, 0.78);
  border: 1px solid rgba(253, 230, 138, 0.55);
}
</style>
