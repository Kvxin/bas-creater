<script setup lang="ts">
import { cn } from '@/lib/utils'

defineProps<{
  class?: string
  inset?: boolean
}>()
</script>

<template>
  <div
    :class="cn(
      'px-2 py-1.5 text-sm font-semibold text-foreground',
      inset && 'pl-8',
      $props.class
    )"
  >
    <slot />
  </div>
</template>
