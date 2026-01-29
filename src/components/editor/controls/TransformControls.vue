<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useTransformControls } from '@/composables/useTransformControls'
import type { AnyDanmu } from '@/types/danmu'
import { useTimelineStore } from '@/stores/timeline'

const props = defineProps<{
  selected: AnyDanmu | null
  containerWidth: number
  containerHeight: number
  canvasScale: number // The zoom scale of the preview canvas
}>()

const emit = defineEmits<{
  (e: 'update', changes: Partial<AnyDanmu>): void
  (e: 'select', id: string): void
}>()

const timelineStore = useTimelineStore()

// Refs for container dimensions
const containerWidthRef = ref(props.containerWidth)
const containerHeightRef = ref(props.containerHeight)

watch(() => props.containerWidth, (v) => { containerWidthRef.value = v })
watch(() => props.containerHeight, (v) => { containerHeightRef.value = v })

// Selected danmu ref
const selectedRef = computed(() => props.selected)

const {
  isTransforming,
  overlayPosition,
  startTransform
} = useTransformControls(selectedRef, {
  containerWidth: containerWidthRef,
  containerHeight: containerHeightRef,
  onUpdate: (changes) => emit('update', changes)
})

// Track actual DOM element dimensions
const actualElementRect = ref<{ width: number; height: number } | null>(null)

// Find the actual rendered DOM element for the selected clip
const findDanmakuElement = (): HTMLElement | null => {
  if (!timelineStore.selectedClipId) return null

  // The BAS renderer creates elements with class like: bas-danmaku-item--obj_clip_xxxxx
  const clipIdPart = timelineStore.selectedClipId.replace(/[^a-zA-Z0-9]/g, '_')
  const selector = `.bas-danmaku-item--obj_${clipIdPart}`
  return document.querySelector(selector)
}

// Update element rect when selection changes
const updateElementRect = () => {
  nextTick(() => {
    const el = findDanmakuElement()
    if (el) {
      const inner = el.querySelector('.bas-danmaku-item-inner') as HTMLElement
      if (inner) {
        actualElementRect.value = {
          width: inner.offsetWidth,
          height: inner.offsetHeight
        }
      } else {
        actualElementRect.value = {
          width: el.offsetWidth,
          height: el.offsetHeight
        }
      }
    } else {
      actualElementRect.value = null
    }
  })
}

watch(() => props.selected, updateElementRect, { immediate: true })
watch(() => timelineStore.selectedClipId, updateElementRect)

// Use actual size if available, otherwise estimate
const elementWidth = computed(() => {
  if (actualElementRect.value) return actualElementRect.value.width
  if (!props.selected) return 100
  if (props.selected.type === 'text') {
    const content = (props.selected as any).content || ''
    const fontSize = typeof (props.selected as any).fontSize === 'number'
      ? (props.selected as any).fontSize
      : 25
    return Math.max(50, content.length * fontSize * 0.6)
  }
  return 100
})

const elementHeight = computed(() => {
  if (actualElementRect.value) return actualElementRect.value.height
  if (!props.selected) return 30
  if (props.selected.type === 'text') {
    const fontSize = typeof (props.selected as any).fontSize === 'number'
      ? (props.selected as any).fontSize
      : 25
    return fontSize * 1.2
  }
  return 30
})

// Control box style
const controlBoxStyle = computed(() => {
  if (!overlayPosition.value) return {}

  const { x, y, scale, rotateZ, anchorX, anchorY } = overlayPosition.value
  const width = elementWidth.value * scale
  const height = elementHeight.value * scale

  // Position considering anchor point
  const offsetX = width * anchorX
  const offsetY = height * anchorY

  return {
    left: `${x - offsetX}px`,
    top: `${y - offsetY}px`,
    width: `${width}px`,
    height: `${height}px`,
    transform: `rotate(${rotateZ}deg)`,
    transformOrigin: `${anchorX * 100}% ${anchorY * 100}%`
  }
})

// Anchor point position relative to box
const anchorStyle = computed(() => {
  if (!overlayPosition.value) return {}
  const { anchorX, anchorY } = overlayPosition.value
  return {
    left: `${anchorX * 100}%`,
    top: `${anchorY * 100}%`
  }
})

// Handle start functions
const handleMoveStart = (e: MouseEvent) => startTransform('move', e)
const handleRotateStart = (e: MouseEvent) => startTransform('rotate', e)
const handleScaleStart = (e: MouseEvent) => startTransform('resize', e)
const handleAnchorStart = (e: MouseEvent) => startTransform('anchor', e)
</script>

<template>
  <div
    v-if="selected && overlayPosition"
    class="transform-controls absolute pointer-events-none"
    :style="controlBoxStyle"
  >
    <!-- Main border box -->
    <div 
      class="absolute inset-0 border-2 border-primary/80 rounded-sm pointer-events-auto cursor-move"
      @mousedown="handleMoveStart"
      @pointerdown="handleMoveStart"
    >
      <!-- Dashed inner guide -->
      <div class="absolute inset-0.5 border border-dashed border-white/30 rounded-sm pointer-events-none" />
    </div>

    <!-- Corner resize handles -->
    <div 
      class="handle handle-corner handle-se" 
      @mousedown.stop="handleScaleStart"
      @pointerdown.stop="handleScaleStart"
    />
    <div 
      class="handle handle-corner handle-nw" 
      @mousedown.stop="handleScaleStart"
      @pointerdown.stop="handleScaleStart"
    />
    <div 
      class="handle handle-corner handle-ne" 
      @mousedown.stop="handleScaleStart"
      @pointerdown.stop="handleScaleStart"
    />
    <div 
      class="handle handle-corner handle-sw" 
      @mousedown.stop="handleScaleStart"
      @pointerdown.stop="handleScaleStart"
    />

    <!-- Rotation handle -->
    <div class="rotate-handle-container">
      <div class="rotate-handle-line" />
      <div 
        class="rotate-handle"
        @mousedown.stop="handleRotateStart"
        @pointerdown.stop="handleRotateStart"
      >
        <svg viewBox="0 0 24 24" fill="none" class="size-3">
          <path d="M12 2a10 10 0 1 0 10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M12 2v4M12 2L8 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>

    <!-- Anchor point handle -->
    <div
      class="anchor-handle"
      :style="anchorStyle"
      @mousedown.stop="handleAnchorStart"
      @pointerdown.stop="handleAnchorStart"
    >
      <div class="anchor-crosshair" />
    </div>
  </div>
</template>

<style scoped>
.transform-controls {
  z-index: 100;
}

/* Corner handles */
.handle {
  pointer-events: auto;
  position: absolute;
}

.handle-corner {
  width: 10px;
  height: 10px;
  background: hsl(var(--primary));
  border: 2px solid white;
  border-radius: 2px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  cursor: nwse-resize;
}

.handle-nw { top: -5px; left: -5px; cursor: nwse-resize; }
.handle-ne { top: -5px; right: -5px; cursor: nesw-resize; }
.handle-sw { bottom: -5px; left: -5px; cursor: nesw-resize; }
.handle-se { bottom: -5px; right: -5px; cursor: nwse-resize; }

/* Rotation handle */
.rotate-handle-container {
  position: absolute;
  top: -30px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}

.rotate-handle-line {
  width: 1px;
  height: 16px;
  background: hsl(var(--primary) / 0.6);
}

.rotate-handle {
  pointer-events: auto;
  width: 20px;
  height: 20px;
  background: hsl(var(--primary));
  border: 2px solid white;
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.rotate-handle:active {
  cursor: grabbing;
}

/* Anchor point handle */
.anchor-handle {
  pointer-events: auto;
  position: absolute;
  width: 16px;
  height: 16px;
  transform: translate(-50%, -50%);
  cursor: crosshair;
  z-index: 10;
}

.anchor-crosshair {
  position: relative;
  width: 100%;
  height: 100%;
}

.anchor-crosshair::before,
.anchor-crosshair::after {
  content: '';
  position: absolute;
  background: hsl(var(--destructive));
  border-radius: 1px;
}

.anchor-crosshair::before {
  width: 2px;
  height: 100%;
  left: 50%;
  transform: translateX(-50%);
}

.anchor-crosshair::after {
  width: 100%;
  height: 2px;
  top: 50%;
  transform: translateY(-50%);
}

/* Center circle for anchor */
.anchor-handle::after {
  content: '';
  position: absolute;
  width: 6px;
  height: 6px;
  background: white;
  border: 1.5px solid hsl(var(--destructive));
  border-radius: 50%;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 1px 2px rgba(0,0,0,0.2);
}
</style>

