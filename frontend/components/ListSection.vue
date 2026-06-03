<template>
  <div>
    <p class="mb-2 text-xs uppercase tracking-[0.22em] text-slate-400">{{ title }}</p>
    <ul class="space-y-2">
      <li v-for="item in items" :key="item" :class="className">{{ item }}</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  items: string[]
  className: string
}>()
</script>
