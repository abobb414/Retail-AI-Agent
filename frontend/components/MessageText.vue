<template>
  <div class="whitespace-pre-line">
    <template v-for="(line, lineIndex) in parsedLines" :key="lineIndex">
      <template v-for="(part, partIndex) in line" :key="`${lineIndex}-${partIndex}`">
        <strong v-if="part.strong" class="font-semibold text-slate-800">{{ part.text }}</strong>
        <span v-else>{{ part.text }}</span>
      </template>
      <br v-if="lineIndex < parsedLines.length - 1">
    </template>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  content: string
}>()

const parsedLines = computed(() => {
  return props.content.split('\n').map((line) => {
    const parts: Array<{ text: string, strong: boolean }> = []
    const pattern = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*)/g
    let cursor = 0
    let match: RegExpExecArray | null

    while ((match = pattern.exec(line))) {
      if (match.index > cursor) {
        parts.push({ text: line.slice(cursor, match.index), strong: false })
      }

      parts.push({
        text: match[0].replace(/^\*+|\*+$/g, ''),
        strong: true,
      })
      cursor = match.index + match[0].length
    }

    if (cursor < line.length) {
      parts.push({ text: line.slice(cursor), strong: false })
    }

    return parts.length ? parts : [{ text: '', strong: false }]
  })
})
</script>
