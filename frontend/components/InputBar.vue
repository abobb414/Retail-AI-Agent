<template>
  <div class="input-shell flex items-center gap-3 rounded-full px-5 py-3 shadow-[0_18px_38px_rgba(148,163,184,0.12)]">
    <input
      ref="inputElement"
      :value="modelValue"
      type="text"
      class="flex-1 border-0 bg-transparent text-[15px] font-normal text-slate-700 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
      placeholder="比如：夏天通勤穿的半袖，预算 300 以内"
      :disabled="disabled"
      @input="updateValue"
      @keydown.enter="$emit('submit')"
    >
    <button
      type="button"
      class="send-button flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="disabled"
      @click="$emit('submit')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" class="h-5 w-5" aria-hidden="true">
        <path d="M21 3L9 15" />
        <path d="M21 3L14 21L9 15L3 10L21 3Z" />
      </svg>
      <span class="sr-only">发送</span>
    </button>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  autoFocusOnEnable?: boolean
  disabled?: boolean
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
}>()

function updateValue(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

const inputElement = ref<HTMLInputElement | null>(null)

function focusInput() {
  if (props.disabled || props.autoFocusOnEnable === false) {
    return
  }

  requestAnimationFrame(() => {
    inputElement.value?.focus()
  })
}

watch(() => [props.disabled, props.autoFocusOnEnable] as const, ([disabled, autoFocusOnEnable]) => {
  if (!disabled && autoFocusOnEnable !== false) {
    focusInput()
  }
})

onMounted(focusInput)
</script>

<style scoped>
.input-shell {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(248, 244, 238, 0.7));
  border: 0;
}

.send-button {
  background: linear-gradient(180deg, rgba(239, 249, 244, 0.94), rgba(223, 242, 232, 0.9));
  border: 0;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.62);
}
</style>
