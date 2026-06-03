<template>
  <div>
    <p class="mb-2 text-xs uppercase tracking-[0.22em] text-slate-400">{{ title }}</p>
    <div class="flex flex-wrap gap-2">
      <span
        v-for="item in items"
        :key="item"
        class="rounded-full px-3 py-1 text-xs"
        :class="tone === 'emerald' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-600'"
      >
        {{ item }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  items: string[]
  tone?: 'slate' | 'emerald'
}>(), {
  tone: 'slate',
})
</script>
