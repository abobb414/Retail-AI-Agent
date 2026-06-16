<template>
  <div class="recommend-card overflow-hidden rounded-[24px] border border-white/50 shadow-[0_18px_46px_rgba(87,94,119,0.18)]">
    <div class="recommend-cover relative h-56 overflow-hidden sm:h-64">
      <img
        v-if="showImage"
        :src="proxiedImage"
        :alt="recommendation.name"
        class="h-full w-full object-cover"
        loading="lazy"
        @error="imageFailed = true"
      >
      <div v-else class="flex h-full w-full flex-col justify-end bg-[linear-gradient(135deg,#dceee8,#e7f0f7)] p-6">
        <p class="text-[11px] uppercase tracking-[0.22em] text-slate-500">暂无可用商品图</p>
        <p class="mt-2 max-w-md text-lg font-semibold leading-snug text-slate-700">{{ recommendation.name }}</p>
      </div>
      <div v-if="showImage" class="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-900/30 to-transparent" />
      <div class="absolute left-5 top-5 flex flex-wrap gap-2">
        <span class="rounded-full bg-white/80 px-3 py-1 text-[11px] font-medium text-slate-700">{{ recommendation.category }}</span>
        <span class="rounded-full bg-black/20 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">{{ recommendation.brand }}</span>
      </div>
      <div v-if="showImage" class="absolute bottom-5 left-5 right-5">
        <p class="text-[11px] uppercase tracking-[0.22em] text-white/70">推荐单品</p>
        <h3 class="mt-2 text-xl font-semibold leading-snug text-white sm:text-2xl">{{ recommendation.name }}</h3>
        <div class="mt-2 flex flex-wrap gap-2 text-sm font-medium text-white/80">
          <span>{{ recommendation.price_range }}</span>
          <span>·</span>
          <span>{{ recommendation.budget_tier }}</span>
        </div>
      </div>
    </div>

    <div class="space-y-5 px-5 py-5 text-sm font-normal leading-7 text-slate-600">
      <div class="summary-box rounded-2xl p-4">
        <p class="mb-2 text-xs uppercase tracking-[0.2em] text-emerald-800/60">为什么先看它</p>
        <p>{{ recommendation.consultant_summary }}</p>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <p class="mb-1 text-xs uppercase tracking-[0.18em] text-slate-400">商品信息</p>
          <p>{{ recommendation.materials }}</p>
          <p class="mt-2 text-slate-500">{{ recommendation.craftsmanship }}</p>
        </div>
        <div>
          <p class="mb-1 text-xs uppercase tracking-[0.18em] text-slate-400">购买前看什么</p>
          <p>{{ recommendation.pairing_note }}</p>
        </div>
      </div>

      <ChipSection title="适用场景" :items="recommendation.scenarios" tone="slate" />
      <ListSection title="商品细节" :items="recommendation.signature_specs" class-name="spec-chip rounded-2xl px-3 py-2" />
      <ChipSection title="你提到的点" :items="recommendation.matched_preferences" tone="emerald" />
      <ListSection title="为什么选这款" :items="recommendation.why_this" class-name="reason-chip rounded-2xl px-3 py-2" />

      <div class="grid gap-4 sm:grid-cols-2">
        <ListSection title="更适合哪些人" :items="recommendation.ideal_for" class-name="rounded-2xl bg-emerald-50/70 px-3 py-2" />
        <ListSection title="先别急着买的人" :items="recommendation.avoid_for" class-name="rounded-2xl bg-rose-50/70 px-3 py-2" />
      </div>

      <div>
        <p class="mb-1 text-xs uppercase tracking-[0.18em] text-slate-400">下一步怎么选</p>
        <p>{{ recommendation.why_not_others }}</p>
      </div>

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

const imageFailed = ref(false)

const proxiedImage = computed(() => {
  if (!props.recommendation.image) {
    return ''
  }

  if (props.recommendation.image.startsWith('/')) {
    return props.recommendation.image
  }

  return `/api/image?url=${encodeURIComponent(props.recommendation.image)}`
})

const showImage = computed(() => Boolean(proxiedImage.value) && !imageFailed.value)

watch(() => props.recommendation.image, () => {
  imageFailed.value = false
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
