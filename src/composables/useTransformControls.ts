import { ref, computed, type Ref } from 'vue'
import type { AnyDanmu } from '@/types/danmu'

export type TransformMode = 'move' | 'resize' | 'rotate' | 'anchor' | null
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | null

export interface TransformState {
  mode: TransformMode
  resizeHandle: ResizeHandle
  startX: number
  startY: number
  startValue: {
    x: number
    y: number
    scale: number
    rotateZ: number
    anchorX: number
    anchorY: number
  }
}

export interface UseTransformControlsOptions {
  containerWidth: Ref<number>
  containerHeight: Ref<number>
  onUpdate: (changes: Partial<AnyDanmu>) => void
}

export function useTransformControls(
  selectedDanmu: Ref<AnyDanmu | null>,
  options: UseTransformControlsOptions
) {
  const { containerWidth, containerHeight, onUpdate } = options
  
  const isTransforming = ref(false)
  const transformState = ref<TransformState>({
    mode: null,
    resizeHandle: null,
    startX: 0,
    startY: 0,
    startValue: { x: 0, y: 0, scale: 1, rotateZ: 0, anchorX: 0, anchorY: 0 }
  })

  // Throttle helper for performance
  let lastUpdate = 0
  const THROTTLE_MS = 16 // ~60fps

  const throttledUpdate = (changes: Partial<AnyDanmu>) => {
    const now = performance.now()
    if (now - lastUpdate >= THROTTLE_MS) {
      lastUpdate = now
      onUpdate(changes)
    }
  }

  // Convert percentage to pixels
  const percentToPixels = (val: number | string, dimension: 'x' | 'y'): number => {
    if (typeof val === 'string' && val.endsWith('%')) {
      const percent = parseFloat(val)
      return (percent / 100) * (dimension === 'x' ? containerWidth.value : containerHeight.value)
    }
    if (typeof val === 'number') {
      // Assume percentage if 0-100
      return (val / 100) * (dimension === 'x' ? containerWidth.value : containerHeight.value)
    }
    return parseFloat(String(val)) || 0
  }

  // Convert pixels to percentage
  const pixelsToPercent = (px: number, dimension: 'x' | 'y'): number => {
    const size = dimension === 'x' ? containerWidth.value : containerHeight.value
    return (px / size) * 100
  }

  const startTransform = (mode: TransformMode, e: MouseEvent | PointerEvent, handle?: ResizeHandle) => {
    if (!selectedDanmu.value) return
    
    e.preventDefault()
    e.stopPropagation()
    
    isTransforming.value = true
    transformState.value = {
      mode,
      resizeHandle: handle || null,
      startX: e.clientX,
      startY: e.clientY,
      startValue: {
        x: percentToPixels(selectedDanmu.value.x, 'x'),
        y: percentToPixels(selectedDanmu.value.y, 'y'),
        scale: selectedDanmu.value.scale ?? 1,
        rotateZ: selectedDanmu.value.rotateZ ?? 0,
        anchorX: selectedDanmu.value.anchorX ?? 0,
        anchorY: selectedDanmu.value.anchorY ?? 0
      }
    }

    window.addEventListener('mousemove', onTransformMove)
    window.addEventListener('mouseup', onTransformEnd)
    window.addEventListener('pointermove', onTransformMove)
    window.addEventListener('pointerup', onTransformEnd)
  }

  const onTransformMove = (e: MouseEvent | PointerEvent) => {
    if (!isTransforming.value || !selectedDanmu.value) return

    const { mode, startX, startY, startValue, resizeHandle } = transformState.value
    const deltaX = e.clientX - startX
    const deltaY = e.clientY - startY

    if (mode === 'move') {
      const newX = pixelsToPercent(startValue.x + deltaX, 'x')
      const newY = pixelsToPercent(startValue.y + deltaY, 'y')
      throttledUpdate({ x: newX, y: newY })
    } else if (mode === 'resize') {
      // Scale based on distance from center
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
      const sign = deltaX + deltaY > 0 ? 1 : -1
      const newScale = Math.max(0.1, startValue.scale + (sign * distance * 0.005))
      throttledUpdate({ scale: newScale })
    } else if (mode === 'rotate') {
      // Calculate rotation angle
      const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI)
      const newRotateZ = startValue.rotateZ + angle
      throttledUpdate({ rotateZ: newRotateZ })
    } else if (mode === 'anchor') {
      // Anchor is 0-1 range
      const newAnchorX = Math.max(0, Math.min(1, startValue.anchorX + (deltaX / 100)))
      const newAnchorY = Math.max(0, Math.min(1, startValue.anchorY + (deltaY / 100)))
      throttledUpdate({ anchorX: newAnchorX, anchorY: newAnchorY })
    }
  }

  const onTransformEnd = () => {
    isTransforming.value = false
    transformState.value.mode = null
    
    window.removeEventListener('mousemove', onTransformMove)
    window.removeEventListener('mouseup', onTransformEnd)
    window.removeEventListener('pointermove', onTransformMove)
    window.removeEventListener('pointerup', onTransformEnd)
  }

  // Computed position for overlay
  const overlayPosition = computed(() => {
    if (!selectedDanmu.value) return null
    
    return {
      x: percentToPixels(selectedDanmu.value.x, 'x'),
      y: percentToPixels(selectedDanmu.value.y, 'y'),
      scale: selectedDanmu.value.scale ?? 1,
      rotateZ: selectedDanmu.value.rotateZ ?? 0,
      anchorX: selectedDanmu.value.anchorX ?? 0,
      anchorY: selectedDanmu.value.anchorY ?? 0
    }
  })

  return {
    isTransforming,
    transformState,
    overlayPosition,
    startTransform,
    percentToPixels,
    pixelsToPercent
  }
}

