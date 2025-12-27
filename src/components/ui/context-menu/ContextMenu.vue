<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { onClickOutside, useWindowSize } from '@vueuse/core'
import { cn } from '@/lib/utils'

const props = defineProps<{
  visible: boolean
  x: number
  y: number
  class?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const containerRef = ref<HTMLElement | null>(null)
const { width: winWidth, height: winHeight } = useWindowSize()
const pos = ref({ x: 0, y: 0 })

watch(
  () => [props.visible, props.x, props.y],
  async () => {
    if (props.visible) {
      // 从建议位置开始
      pos.value = { x: props.x, y: props.y }

      await nextTick()

      if (containerRef.value) {
        const { offsetWidth, offsetHeight } = containerRef.value

        let newX = props.x
        let newY = props.y

        // 检查右边界
        if (newX + offsetWidth > winWidth.value) {
          newX -= offsetWidth
        }

        // 检查下边界
        if (newY + offsetHeight > winHeight.value) {
          newY -= offsetHeight
        }
        
        // 安全检查，确保不会超出屏幕左/上边界
        newX = Math.max(0, newX)
        newY = Math.max(0, newY)

        pos.value = { x: newX, y: newY }
      }
    }
  },
  { immediate: true }
)

onClickOutside(containerRef, () => {
  if (props.visible) {
    emit('close')
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="containerRef"
      :class="cn(
        'fixed z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-80 zoom-in-95',
        props.class
      )"
      :style="{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
      }"
      @contextmenu.prevent
    >
      <slot />
    </div>
  </Teleport>
</template>