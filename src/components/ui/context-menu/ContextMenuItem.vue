<script setup lang="ts">
import { cn } from '@/lib/utils'

defineProps<{
  class?: string
  inset?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'click', payload: MouseEvent): void
}>()

function handleClick(e: MouseEvent) {
  if (!e.defaultPrevented) {
    emit('click', e)
  }
}
</script>

<template>
  <div
    :class="cn(
      'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-disabled:pointer-events-none data-disabled:opacity-50 hover:bg-accent hover:text-accent-foreground',
      inset && 'pl-8',
      $props.class
    )"
    :data-disabled="disabled ? '' : undefined"
    @click="handleClick"
  >
    <slot />
  </div>
</template>
