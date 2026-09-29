<template>
  <div class="recommend-card overflow-hidden rounded-[24px] border border-white/50 shadow-[0_18px_46px_rgba(87,94,119,0.18)]">
    <!--
      封面三种版式，按「有没有图 / 图是什么」分：
      1. photo：真实商品图，铺满 + 裁切 + 底部压深色渐变，白字标题压在图上；
      2. logo ：品牌官方标兜底。**不能铺满裁切** —— 方形标被 object-cover 裁掉两边很难看，
               也不能在浅色底上压白字。改成居中 contain + 下方深色文字；
      3. none ：连标都没有，退回纯文字块。
    -->
    <div
      class="recommend-cover relative overflow-hidden"
      :class="[photoMode ? 'h-56 sm:h-64' : 'h-40', logoMode ? 'recommend-cover--logo' : '']"
    >
      <img
        v-if="photoMode"
        :src="displayImage"
        :alt="recommendation.name"
        class="h-full w-full object-cover"
        loading="lazy"
        @error="handleImageError"
      >
      <div v-else-if="logoMode" class="flex h-full w-full flex-col items-center justify-center gap-2 px-6">
        <img
          :src="displayImage"
          :alt="`${recommendation.brand} 标识`"
          class="max-h-14 max-w-[55%] object-contain"
          loading="lazy"
          @error="handleImageError"
        >
        <p class="ui-label uppercase tracking-[0.22em] text-slate-400">{{ recommendation.category }}</p>
        <h3 class="line-clamp-2 text-center ui-title font-semibold text-slate-700">{{ recommendation.name }}</h3>
        <p class="ui-meta font-medium text-slate-500">{{ recommendation.price_range }}</p>
      </div>
      <div v-else class="flex h-full w-full flex-col justify-end bg-[linear-gradient(135deg,#dceee8,#e7f0f7)] p-6">
        <p class="ui-label uppercase tracking-[0.22em] text-slate-500">暂无可用商品图</p>
        <p class="mt-2 max-w-md ui-title font-semibold text-slate-700">{{ recommendation.name }}</p>
        <p class="mt-1 ui-meta font-medium text-slate-500">{{ recommendation.price_range }}</p>
      </div>
      <div v-if="photoMode" class="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-900/30 to-transparent" />
      <div class="absolute left-5 top-5 flex flex-wrap gap-2">
        <span class="rounded-full bg-white/80 px-3 py-1 ui-label font-medium text-slate-700">{{ recommendation.category }}</span>
        <span
          class="rounded-full px-3 py-1 ui-label font-medium"
          :class="photoMode ? 'bg-black/20 text-white backdrop-blur' : 'bg-slate-900/5 text-slate-600'"
        >{{ recommendation.brand }}</span>
      </div>
      <div v-if="photoMode" class="absolute bottom-5 left-5 right-5">
        <p class="ui-label uppercase tracking-[0.22em] text-white/70">推荐单品</p>
        <h3 class="ui-display mt-2 font-semibold text-white">{{ recommendation.name }}</h3>
        <div class="mt-2 flex flex-wrap gap-2 ui-meta font-medium text-white/80">
          <span>{{ recommendation.price_range }}</span>
          <template v-if="recommendation.budget_tier">
            <span>·</span>
            <span>{{ recommendation.budget_tier }}</span>
          </template>
        </div>
      </div>
    </div>

    <div class="ui-body space-y-5 px-5 py-5 font-normal text-slate-600">
      <div class="summary-box rounded-2xl p-4">
        <p class="ui-label mb-2 uppercase tracking-[0.2em] text-emerald-800/60">为什么先看它</p>
        <p>{{ recommendation.consultant_summary }}</p>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <p class="ui-label mb-1 uppercase tracking-[0.18em] text-slate-400">商品信息</p>
          <p v-if="recommendation.materials">{{ recommendation.materials }}</p>
          <p :class="recommendation.materials ? 'mt-2 text-slate-500' : ''">{{ recommendation.craftsmanship }}</p>
        </div>
        <div>
          <p class="ui-label mb-1 uppercase tracking-[0.18em] text-slate-400">购买前看什么</p>
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
        <p class="ui-label mb-1 uppercase tracking-[0.18em] text-slate-400">下一步怎么选</p>
        <p>{{ recommendation.why_not_others }}</p>
      </div>

      <div v-if="recommendation.source_url" class="pt-1">
        <a
          :href="recommendation.source_url"
          target="_blank"
          rel="noreferrer"
          class="inline-flex items-center rounded-full border border-emerald-200/90 bg-emerald-50 px-4 py-2 ui-meta font-medium tracking-[0.18em] text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100"
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
const useProxyFallback = ref(false)

/** 后端标了 `image_kind: 'logo'` 就说明这张是品牌标兜底，不是商品图。 */
const isLogo = computed(() => props.recommendation.image_kind === 'logo')

function getProxyImage(image: string) {
  return `/api/image?url=${encodeURIComponent(image)}`
}

const displayImage = computed(() => {
  const image = props.recommendation.image
  if (!image) {
    return ''
  }

  if (image.startsWith('/')) {
    return image
  }

  if (image.startsWith('https://') && !useProxyFallback.value) {
    return image
  }

  return getProxyImage(image)
})

const hasImage = computed(() => Boolean(displayImage.value) && !imageFailed.value)
/** 版式一：真实商品图（铺满裁切）。 */
const photoMode = computed(() => hasImage.value && !isLogo.value)
/** 版式二：品牌标兜底（居中等比）。 */
const logoMode = computed(() => hasImage.value && isLogo.value)

function handleImageError() {
  if (props.recommendation.image?.startsWith('https://') && !useProxyFallback.value) {
    useProxyFallback.value = true
    return
  }

  imageFailed.value = true
}

watch(() => props.recommendation.image, () => {
  imageFailed.value = false
  useProxyFallback.value = false
})
</script>

<style scoped>
.recommend-card {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 252, 247, 0.82));
}

.recommend-cover {
  background: #dfe9e4;
}

/*
 * 品牌标版式的底色：比商品图的 #dfe9e4 更浅更中性。
 * 官方标多为深色或彩色的方形图，压在偏绿的底上会显得脏，
 * 近白底更像「品牌铭牌」，也更接近我们自己品牌页的观感。
 */
.recommend-cover--logo {
  background: linear-gradient(135deg, #f7faf9, #eef3f6);
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
