<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import Moveable from 'moveable'
import type { AnyDanmu } from '@/types/danmu'

const MIN_SCALE = 0.1
const MOVEABLE_CLASS = 'bas-transform-moveable'
const RENDER_DIRECTIONS = ['nw', 'ne', 'sw', 'se']

type ActiveGesture = 'drag' | 'scale' | 'rotate' | 'origin' | null

interface TransformOverlayItem {
  clipId: string
  danmu: AnyDanmu
}

interface ElementRect {
  width: number
  height: number
}

interface DraftTransform {
  x: number
  y: number
  width: number
  height: number
  translateX: number
  translateY: number
  scale: number
  rotateX: number
  rotateY: number
  rotateZ: number
  anchorX: number
  anchorY: number
}

interface TextEditorState {
  clipId: string
  field: 'content' | 'text'
  value: string
}

interface MarqueeState {
  startX: number
  startY: number
  currentX: number
  currentY: number
  additive: boolean
  baseSelection: string[]
}

const props = defineProps<{
  items: TransformOverlayItem[]
  selectedClipId: string | null
  containerWidth: number
  containerHeight: number
  canvasScale: number
}>()

const emit = defineEmits<{
  (e: 'select', payload: { clipIds: string[]; primaryClipId: string | null; primaryDanmuId: string | null }): void
  (e: 'commit', updates: Array<{ id: string; changes: Partial<AnyDanmu> }>): void
}>()

const overlayRootRef = ref<HTMLElement | null>(null)
const textEditorRef = ref<HTMLTextAreaElement | null>(null)
const moveableInstance = shallowRef<Moveable | null>(null)
const activeGesture = ref<ActiveGesture>(null)
const selectedClipIds = ref<string[]>([])
const drafts = ref<Record<string, DraftTransform>>({})
const marquee = ref<MarqueeState | null>(null)
const textEditor = ref<TextEditorState | null>(null)

const overlayElements = new Map<string, HTMLElement>()
const actualElements = new Map<string, HTMLElement>()
const actualInnerElements = new Map<string, HTMLElement>()

let mutationObserver: MutationObserver | null = null
let syncFrame = 0

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const round = (value: number, digits = 4) => Number(value.toFixed(digits))
const clampScale = (value: number) => Math.max(MIN_SCALE, value)
const getCanvasScale = () => props.canvasScale || 1

const itemByClipId = computed(() => {
  return new Map(props.items.map((item) => [item.clipId, item]))
})

const selectedClipIdSet = computed(() => new Set(selectedClipIds.value))

const percentToPixels = (val: number | string | undefined, dimension: 'x' | 'y'): number => {
  const size = dimension === 'x' ? props.containerWidth : props.containerHeight

  if (val == null) return 0

  if (typeof val === 'string') {
    if (val.endsWith('%')) {
      const percent = parseFloat(val)
      return Number.isFinite(percent) ? (percent / 100) * size : 0
    }
    const numericValue = parseFloat(val)
    return Number.isFinite(numericValue) ? numericValue : 0
  }

  return Number.isFinite(val) ? (val / 100) * size : 0
}

const pixelsToPercent = (px: number, dimension: 'x' | 'y'): number => {
  const size = dimension === 'x' ? props.containerWidth : props.containerHeight
  return size > 0 && Number.isFinite(px) ? (px / size) * 100 : 0
}

const sanitizeClipId = (clipId: string) => clipId.replace(/[^a-zA-Z0-9]/g, '_')

const resolveFontSizePx = (danmu: AnyDanmu): number => {
  const raw = danmu.type === 'text'
    ? danmu.fontSize
    : danmu.type === 'button'
      ? danmu.fontSize
      : undefined

  const fallbackPx = (5 / 100) * props.containerHeight

  if (typeof raw === 'number') {
    return (raw / 100) * props.containerHeight
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim().toLowerCase()

    if (trimmed.endsWith('%')) {
      return (parseFloat(trimmed) / 100) * props.containerHeight
    }

    if (trimmed.endsWith('px')) {
      const parsedPx = parseFloat(trimmed)
      return Number.isFinite(parsedPx) ? parsedPx : fallbackPx
    }

    const parsed = parseFloat(trimmed)
    return Number.isFinite(parsed) ? (parsed / 100) * props.containerHeight : fallbackPx
  }

  return fallbackPx
}

const estimateElementSize = (danmu: AnyDanmu): ElementRect => {
  if (danmu.type === 'text') {
    const content = danmu.content ?? ''
    const fontSize = resolveFontSizePx(danmu)
    return {
      width: Math.max(50, content.length * fontSize * 0.6),
      height: Math.max(24, fontSize * 1.2),
    }
  }

  if (danmu.type === 'path') {
    const width = typeof danmu.width === 'number'
      ? danmu.width
      : typeof danmu.width === 'string' && danmu.width.endsWith('%')
        ? (parseFloat(danmu.width) / 100) * props.containerWidth
        : 120

    const height = typeof danmu.height === 'number'
      ? danmu.height
      : typeof danmu.height === 'string' && danmu.height.endsWith('%')
        ? (parseFloat(danmu.height) / 100) * props.containerHeight
        : 80

    return {
      width: Math.max(24, width),
      height: Math.max(24, height),
    }
  }

  const text = danmu.text ?? ''
  return {
    width: Math.max(80, text.length * 14 + 40),
    height: 36,
  }
}

const createDraft = (danmu: AnyDanmu, rect: ElementRect): DraftTransform => {
  return {
    x: percentToPixels(danmu.x, 'x'),
    y: percentToPixels(danmu.y, 'y'),
    width: rect.width,
    height: rect.height,
    translateX: 0,
    translateY: 0,
    scale: clampScale(danmu.scale ?? 1),
    rotateX: danmu.rotateX ?? 0,
    rotateY: danmu.rotateY ?? 0,
    rotateZ: danmu.rotateZ ?? 0,
    anchorX: clamp(danmu.anchorX ?? 0, 0, 1),
    anchorY: clamp(danmu.anchorY ?? 0, 0, 1),
  }
}

const getDraft = (clipId: string) => drafts.value[clipId] ?? null

const getOverlayStyle = (clipId: string) => {
  const draft = getDraft(clipId)
  if (!draft) return {}

  return {
    left: `${draft.x - draft.width * draft.anchorX}px`,
    top: `${draft.y - draft.height * draft.anchorY}px`,
    width: `${draft.width}px`,
    height: `${draft.height}px`,
    transformOrigin: `${draft.anchorX * 100}% ${draft.anchorY * 100}%`,
    transform: `translate(${draft.translateX}px, ${draft.translateY}px) rotate(${draft.rotateZ}deg) scale(${draft.scale})`,
  }
}

const marqueeStyle = computed(() => {
  if (!marquee.value) return {}

  const left = Math.min(marquee.value.startX, marquee.value.currentX)
  const top = Math.min(marquee.value.startY, marquee.value.currentY)
  const width = Math.abs(marquee.value.currentX - marquee.value.startX)
  const height = Math.abs(marquee.value.currentY - marquee.value.startY)

  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  }
})

const textEditorStyle = computed(() => {
  if (!textEditor.value) return {}
  return {
    ...getOverlayStyle(textEditor.value.clipId),
  }
})

const setOverlayElement = (clipId: string, element: unknown) => {
  const resolvedElement = element instanceof HTMLElement
    ? element
    : element && typeof element === 'object' && '$el' in element
      ? (element as { $el?: unknown }).$el
      : null

  if (resolvedElement instanceof HTMLElement) {
    overlayElements.set(clipId, resolvedElement)
    return
  }
  overlayElements.delete(clipId)
}

const findDanmakuElement = (clipId: string) => {
  return document.querySelector(`.bas-danmaku-item--obj_${sanitizeClipId(clipId)}`) as HTMLElement | null
}

const buildInnerTransform = (danmu: AnyDanmu, anchorX: number, anchorY: number) => {
  return `translate(${round(-anchorX * 100)}%, ${round(-anchorY * 100)}%)`
}

const applyDraftToActualElement = (clipId: string) => {
  const item = itemByClipId.value.get(clipId)
  const draft = getDraft(clipId)
  const actualElement = actualElements.get(clipId)
  if (!item || !draft || !actualElement) return

  actualElement.style.transformOrigin = '0 0'
  actualElement.style.transform = [
    `translate(${round(draft.x + draft.translateX)}px, ${round(draft.y + draft.translateY)}px)`,
    `rotateX(${round(draft.rotateX)}deg)`,
    `rotateY(${round(draft.rotateY)}deg)`,
    `rotate(${round(draft.rotateZ)}deg)`,
    `scale(${round(draft.scale)})`,
  ].join(' ')

  const innerElement = actualInnerElements.get(clipId)
  if (innerElement) {
    innerElement.style.transformOrigin = '0 0'
    innerElement.style.transform = buildInnerTransform(item.danmu, draft.anchorX, draft.anchorY)
  }
}

const emitSelection = (clipIds: string[], primaryClipId?: string | null) => {
  const validIds = Array.from(new Set(clipIds.filter((clipId) => itemByClipId.value.has(clipId))))
  const resolvedPrimary = primaryClipId && validIds.includes(primaryClipId)
    ? primaryClipId
    : validIds[0] ?? null
  const orderedIds = resolvedPrimary
    ? [resolvedPrimary, ...validIds.filter((clipId) => clipId !== resolvedPrimary)]
    : validIds

  selectedClipIds.value = orderedIds

  const primaryItem = resolvedPrimary ? itemByClipId.value.get(resolvedPrimary) : null

  emit('select', {
    clipIds: orderedIds,
    primaryClipId: resolvedPrimary,
    primaryDanmuId: primaryItem?.danmu.id ?? null,
  })
}

const scheduleStageSync = () => {
  if (syncFrame) {
    cancelAnimationFrame(syncFrame)
  }

  syncFrame = requestAnimationFrame(() => {
    syncFrame = 0
    void syncStageState()
  })
}

const syncStageState = async () => {
  await nextTick()

  const nextDrafts: Record<string, DraftTransform> = {}
  const nextActualElements = new Map<string, HTMLElement>()
  const nextActualInnerElements = new Map<string, HTMLElement>()

  for (const item of props.items) {
    const actualElement = findDanmakuElement(item.clipId)
    const measurementTarget = (actualElement?.querySelector('.bas-danmaku-item-inner') as HTMLElement | null) ?? actualElement
    const rect = measurementTarget
      ? {
          width: Math.max(1, measurementTarget.offsetWidth || measurementTarget.clientWidth || 1),
          height: Math.max(1, measurementTarget.offsetHeight || measurementTarget.clientHeight || 1),
        }
      : estimateElementSize(item.danmu)

    if (actualElement) {
      nextActualElements.set(item.clipId, actualElement)
    }
    if (measurementTarget instanceof HTMLElement) {
      nextActualInnerElements.set(item.clipId, measurementTarget)
    }

    const shouldPreserveDraft = !!activeGesture.value && selectedClipIdSet.value.has(item.clipId)
    const currentDraft = drafts.value[item.clipId]

    nextDrafts[item.clipId] = shouldPreserveDraft && currentDraft
      ? {
          ...currentDraft,
          width: rect.width,
          height: rect.height,
          rotateX: item.danmu.rotateX ?? currentDraft.rotateX,
          rotateY: item.danmu.rotateY ?? currentDraft.rotateY,
        }
      : createDraft(item.danmu, rect)
  }

  actualElements.clear()
  actualInnerElements.clear()

  nextActualElements.forEach((value, key) => actualElements.set(key, value))
  nextActualInnerElements.forEach((value, key) => actualInnerElements.set(key, value))

  drafts.value = nextDrafts

  const filteredSelection = selectedClipIds.value.filter((clipId) => nextDrafts[clipId])
  if (filteredSelection.length !== selectedClipIds.value.length) {
    emitSelection(filteredSelection, filteredSelection[0] ?? null)
  }

  nextTick(() => {
    syncMoveableTargets()
  })
}

const getSelectedOverlayElements = () => {
  if (textEditor.value) return []

  return selectedClipIds.value
    .map((clipId) => overlayElements.get(clipId))
    .filter((element): element is HTMLElement => !!element)
}

const getGuidelineElements = () => {
  return props.items
    .map((item) => item.clipId)
    .filter((clipId) => !selectedClipIdSet.value.has(clipId))
    .map((clipId) => overlayElements.get(clipId))
    .filter((element): element is HTMLElement => !!element)
}

const syncMoveableTargets = () => {
  const instance = moveableInstance.value
  if (!instance || !overlayRootRef.value) return

  const selectedTargets = getSelectedOverlayElements()
  const instanceAny = instance as any
  const currentManager = instance.getManager?.() as { props?: { groupable?: boolean } } | undefined
  const isGroupSelection = selectedTargets.length > 1
  const isCurrentlyGrouped = !!currentManager?.props?.groupable
  const nextTarget = selectedTargets.length > 1
    ? selectedTargets
    : selectedTargets[0] ?? null
  const needsModeSwitch = isGroupSelection !== isCurrentlyGrouped
  const waitForTargetChange = needsModeSwitch
    ? instance.waitToChangeTarget?.()
    : null

  instanceAny.target = nextTarget
  instanceAny.targets = []
  instanceAny.elementGuidelines = getGuidelineElements()
  instanceAny.verticalGuidelines = [0, props.containerWidth / 2, props.containerWidth]
  instanceAny.horizontalGuidelines = [0, props.containerHeight / 2, props.containerHeight]
  instanceAny.bounds = {
    left: 0,
    top: 0,
    right: props.containerWidth,
    bottom: props.containerHeight,
  }
  instanceAny.zoom = props.canvasScale || 1

  instance.updateSelectors?.()

  if (waitForTargetChange) {
    void waitForTargetChange.then(() => {
      instance.updateRect()
    })
    return
  }

  instance.updateRect()
}

const getClipIdFromTarget = (target: EventTarget | null | undefined) => {
  return target instanceof HTMLElement ? target.dataset.clipId ?? null : null
}

const getSingleSelectedClipId = () => {
  return selectedClipIds.value.length === 1 ? selectedClipIds.value[0] ?? null : null
}

const resolveGestureClipId = (target: EventTarget | null | undefined) => {
  return getClipIdFromTarget(target) ?? getSingleSelectedClipId()
}

const resolveGroupGestureClipId = (target: EventTarget | null | undefined, index: number) => {
  return getClipIdFromTarget(target) ?? selectedClipIds.value[index] ?? null
}

const startMoveableDrag = (event: PointerEvent, clipId: string, waitForTargetChange = false) => {
  const instance = moveableInstance.value as any
  const targetElement = overlayElements.get(clipId)

  if (!instance || !targetElement) return

  if (waitForTargetChange) {
    instance.waitToChangeTarget?.().then(() => {
      instance.dragStart?.(event, targetElement)
    })
    return
  }

  instance.dragStart?.(event, targetElement)
}

const parseTransformOrigin = (value: string, state: DraftTransform) => {
  const [rawX = '0%', rawY = '0%'] = value.split(' ')

  const parsePart = (part: string, size: number) => {
    if (part.endsWith('%')) {
      return clamp(parseFloat(part) / 100, 0, 1)
    }
    return clamp((parseFloat(part) || 0) / size, 0, 1)
  }

  return {
    anchorX: parsePart(rawX, state.width),
    anchorY: parsePart(rawY, state.height),
  }
}

const applyDragTranslation = (clipId: string, dragEvent: { beforeTranslate?: number[] } | undefined) => {
  const draft = getDraft(clipId)
  if (!draft || !dragEvent?.beforeTranslate) return

  draft.translateX = dragEvent.beforeTranslate[0] ?? draft.translateX
  draft.translateY = dragEvent.beforeTranslate[1] ?? draft.translateY
}

const commitSelectedDrafts = () => {
  const updates = new Map<string, Partial<AnyDanmu>>()

  for (const clipId of selectedClipIds.value) {
    const item = itemByClipId.value.get(clipId)
    const draft = getDraft(clipId)
    if (!item || !draft) continue

    const committedX = draft.x + draft.translateX
    const committedY = draft.y + draft.translateY

    updates.set(item.danmu.id, {
      x: round(pixelsToPercent(committedX, 'x')),
      y: round(pixelsToPercent(committedY, 'y')),
      scale: round(clampScale(draft.scale)),
      rotateZ: round(draft.rotateZ),
      anchorX: round(clamp(draft.anchorX, 0, 1)),
      anchorY: round(clamp(draft.anchorY, 0, 1)),
    })

    draft.x = committedX
    draft.y = committedY
    draft.translateX = 0
    draft.translateY = 0
    applyDraftToActualElement(clipId)
  }

  emit(
    'commit',
    Array.from(updates.entries()).map(([id, changes]) => ({ id, changes }))
  )
}

const finishGesture = (gesture: Exclude<ActiveGesture, null>, isDrag?: boolean) => {
  if (activeGesture.value !== gesture) return

  if (gesture === 'drag' ? !!isDrag : true) {
    commitSelectedDrafts()
  }

  activeGesture.value = null
  nextTick(() => {
    syncMoveableTargets()
  })
}

const bindMoveableEvents = (instance: Moveable) => {
  instance.on('dragStart', (event: any) => {
    const clipId = resolveGestureClipId(event.target)
    const draft = clipId ? getDraft(clipId) : null
    activeGesture.value = 'drag'
    if (draft) {
      event.set?.([draft.translateX, draft.translateY])
    }
  })

  instance.on('drag', (event: any) => {
    const clipId = resolveGestureClipId(event.target)
    if (!clipId) return
    applyDragTranslation(clipId, event)
    applyDraftToActualElement(clipId)
  })

  instance.on('dragEnd', (event: any) => {
    finishGesture('drag', event?.isDrag)
  })

  instance.on('dragGroupStart', ({ events }: any) => {
    activeGesture.value = 'drag'
    events.forEach((childEvent: any, index: number) => {
      const clipId = resolveGroupGestureClipId(childEvent.target, index)
      const draft = clipId ? getDraft(clipId) : null
      if (draft) {
        childEvent.set?.([draft.translateX, draft.translateY])
      }
    })
  })

  instance.on('dragGroup', ({ events }: any) => {
    events.forEach((childEvent: any, index: number) => {
      const clipId = resolveGroupGestureClipId(childEvent.target, index)
      if (!clipId) return
      applyDragTranslation(clipId, childEvent)
      applyDraftToActualElement(clipId)
    })
  })

  instance.on('dragGroupEnd', (event: any) => {
    finishGesture('drag', event?.isDrag)
  })

  instance.on('scaleStart', (event: any) => {
    const clipId = resolveGestureClipId(event.target)
    const draft = clipId ? getDraft(clipId) : null
    activeGesture.value = 'scale'
    if (!draft) return

    event.set?.([draft.scale, draft.scale])
    event.dragStart?.set?.([draft.translateX, draft.translateY])
  })

  instance.on('scale', (event: any) => {
    const clipId = resolveGestureClipId(event.target)
    const draft = clipId ? getDraft(clipId) : null
    if (!clipId || !draft) return

    applyDragTranslation(clipId, event.drag)
    draft.scale = clampScale(event.scale?.[0] ?? draft.scale)
    applyDraftToActualElement(clipId)
  })

  instance.on('scaleEnd', (event: any) => {
    finishGesture('scale', event?.isDrag)
  })

  instance.on('scaleGroupStart', ({ events }: any) => {
    activeGesture.value = 'scale'
    events.forEach((childEvent: any, index: number) => {
      const clipId = resolveGroupGestureClipId(childEvent.target, index)
      const draft = clipId ? getDraft(clipId) : null
      if (!draft) return

      childEvent.set?.([draft.scale, draft.scale])
      childEvent.dragStart?.set?.([draft.translateX, draft.translateY])
    })
  })

  instance.on('scaleGroup', ({ events }: any) => {
    events.forEach((childEvent: any, index: number) => {
      const clipId = resolveGroupGestureClipId(childEvent.target, index)
      const draft = clipId ? getDraft(clipId) : null
      if (!clipId || !draft) return

      applyDragTranslation(clipId, childEvent.drag)
      draft.scale = clampScale(childEvent.scale?.[0] ?? draft.scale)
      applyDraftToActualElement(clipId)
    })
  })

  instance.on('scaleGroupEnd', (event: any) => {
    finishGesture('scale', event?.isDrag)
  })

  instance.on('rotateStart', (event: any) => {
    const clipId = resolveGestureClipId(event.target)
    const draft = clipId ? getDraft(clipId) : null
    activeGesture.value = 'rotate'
    if (!draft) return

    event.set?.(draft.rotateZ)
    event.dragStart?.set?.([draft.translateX, draft.translateY])
  })

  instance.on('rotate', (event: any) => {
    const clipId = resolveGestureClipId(event.target)
    const draft = clipId ? getDraft(clipId) : null
    if (!clipId || !draft) return

    applyDragTranslation(clipId, event.drag)
    draft.rotateZ = event.beforeRotate ?? event.rotation ?? event.rotate ?? draft.rotateZ
    applyDraftToActualElement(clipId)
  })

  instance.on('rotateEnd', (event: any) => {
    finishGesture('rotate', event?.isDrag)
  })

  instance.on('rotateGroupStart', ({ events }: any) => {
    activeGesture.value = 'rotate'
    events.forEach((childEvent: any, index: number) => {
      const clipId = resolveGroupGestureClipId(childEvent.target, index)
      const draft = clipId ? getDraft(clipId) : null
      if (!draft) return

      childEvent.set?.(draft.rotateZ)
      childEvent.dragStart?.set?.([draft.translateX, draft.translateY])
    })
  })

  instance.on('rotateGroup', ({ events }: any) => {
    events.forEach((childEvent: any, index: number) => {
      const clipId = resolveGroupGestureClipId(childEvent.target, index)
      const draft = clipId ? getDraft(clipId) : null
      if (!clipId || !draft) return

      applyDragTranslation(clipId, childEvent.drag)
      draft.rotateZ = childEvent.beforeRotate ?? childEvent.rotation ?? childEvent.rotate ?? draft.rotateZ
      applyDraftToActualElement(clipId)
    })
  })

  instance.on('rotateGroupEnd', (event: any) => {
    finishGesture('rotate', event?.isDrag)
  })

  instance.on('dragOriginStart', (event: any) => {
    const clipId = resolveGestureClipId(event.target)
    const draft = clipId ? getDraft(clipId) : null
    activeGesture.value = 'origin'
    if (!draft) return

    event.dragStart?.set?.([draft.translateX, draft.translateY])
  })

  instance.on('dragOrigin', (event: any) => {
    const clipId = resolveGestureClipId(event.target)
    const draft = clipId ? getDraft(clipId) : null
    if (!clipId || !draft) return

    const { anchorX, anchorY } = parseTransformOrigin(event.transformOrigin ?? '', draft)
    draft.anchorX = anchorX
    draft.anchorY = anchorY
    applyDragTranslation(clipId, event.drag)
    applyDraftToActualElement(clipId)
  })

  instance.on('dragOriginEnd', (event: any) => {
    finishGesture('origin', event?.isDrag)
  })
}

const createMoveableInstance = () => {
  if (!overlayRootRef.value || moveableInstance.value) return

  const instance = new Moveable(overlayRootRef.value, {
    draggable: true,
    scalable: true,
    rotatable: true,
    pinchable: ['scalable', 'rotatable'],
    origin: true,
    originDraggable: true,
    originRelative: true,
    keepRatio: true,
    snappable: true,
    snapGap: true,
    isDisplaySnapDigit: true,
    isDisplayInnerSnapDigit: true,
    useResizeObserver: true,
    zoom: props.canvasScale || 1,
    rotationPosition: 'top',
    renderDirections: [...RENDER_DIRECTIONS],
    controlPadding: 8,
    linePadding: 4,
    className: MOVEABLE_CLASS,
    checkInput: true,
  })

  bindMoveableEvents(instance)
  moveableInstance.value = instance
}

const observeStageMutations = () => {
  mutationObserver?.disconnect()
  mutationObserver = null

  const stageElement = overlayRootRef.value?.parentElement
  if (!stageElement || typeof MutationObserver === 'undefined') return

  mutationObserver = new MutationObserver(() => {
    scheduleStageSync()
  })

  mutationObserver.observe(stageElement, {
    childList: true,
    subtree: true,
  })
}

const getMarqueeBox = () => {
  if (!marquee.value) return null

  const left = Math.min(marquee.value.startX, marquee.value.currentX)
  const top = Math.min(marquee.value.startY, marquee.value.currentY)
  const right = Math.max(marquee.value.startX, marquee.value.currentX)
  const bottom = Math.max(marquee.value.startY, marquee.value.currentY)

  return { left, top, right, bottom }
}

const getPointerCanvasPosition = (clientX: number, clientY: number) => {
  const overlayRect = overlayRootRef.value?.getBoundingClientRect()
  if (!overlayRect) return null

  const canvasScale = getCanvasScale()
  const width = overlayRect.width / canvasScale
  const height = overlayRect.height / canvasScale

  return {
    x: clamp((clientX - overlayRect.left) / canvasScale, 0, width),
    y: clamp((clientY - overlayRect.top) / canvasScale, 0, height),
  }
}

const updateMarqueeSelection = () => {
  const overlayRect = overlayRootRef.value?.getBoundingClientRect()
  const marqueeBox = getMarqueeBox()
  if (!overlayRect || !marqueeBox || !marquee.value) return

  const canvasScale = getCanvasScale()

  const hitIds = props.items
    .filter((item) => {
      const element = overlayElements.get(item.clipId)
      if (!element) return false
      const rect = element.getBoundingClientRect()
      const left = (rect.left - overlayRect.left) / canvasScale
      const top = (rect.top - overlayRect.top) / canvasScale
      const right = left + rect.width / canvasScale
      const bottom = top + rect.height / canvasScale

      return !(
        right < marqueeBox.left ||
        left > marqueeBox.right ||
        bottom < marqueeBox.top ||
        top > marqueeBox.bottom
      )
    })
    .map((item) => item.clipId)

  const nextSelection = marquee.value.additive
    ? [...marquee.value.baseSelection, ...hitIds]
    : hitIds

  emitSelection(nextSelection, hitIds[0] ?? marquee.value.baseSelection[0] ?? null)
}

const commitTextEdit = () => {
  if (!textEditor.value) return

  const currentEditor = textEditor.value
  const item = itemByClipId.value.get(currentEditor.clipId)
  textEditor.value = null

  if (!item) return

  emit('commit', [
    {
      id: item.danmu.id,
      changes: {
        [currentEditor.field]: currentEditor.value,
      } as Partial<AnyDanmu>,
    },
  ])

  nextTick(() => {
    scheduleStageSync()
    syncMoveableTargets()
  })
}

const cancelTextEdit = () => {
  textEditor.value = null
  nextTick(() => {
    syncMoveableTargets()
  })
}

const startTextEdit = (clipId: string) => {
  const item = itemByClipId.value.get(clipId)
  if (!item) return

  if (item.danmu.type !== 'text' && item.danmu.type !== 'button') return

  emitSelection([clipId], clipId)

  textEditor.value = {
    clipId,
    field: item.danmu.type === 'text' ? 'content' : 'text',
    value: item.danmu.type === 'text' ? item.danmu.content ?? '' : item.danmu.text ?? '',
  }

  nextTick(() => {
    textEditorRef.value?.focus()
    textEditorRef.value?.select()
    syncMoveableTargets()
  })
}

const onTextEditorKeydown = (event: KeyboardEvent) => {
  const currentEditor = textEditor.value
  if (!currentEditor) return

  if (event.key === 'Escape') {
    event.preventDefault()
    cancelTextEdit()
    return
  }

  if (event.key === 'Enter' && (currentEditor.field === 'text' || event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    commitTextEdit()
  }
}

const onTargetPointerDown = (event: PointerEvent, clipId: string) => {
  if (event.button !== 0 || event.altKey) return

  if (textEditor.value && textEditor.value.clipId !== clipId) {
    commitTextEdit()
  }

  const additive = event.shiftKey || event.ctrlKey || event.metaKey
  const isSelected = selectedClipIdSet.value.has(clipId)

  if (additive) {
    emitSelection([...selectedClipIds.value, clipId], clipId)
    return
  }

  if (!isSelected) {
    emitSelection([clipId], clipId)
    startMoveableDrag(event, clipId, true)
    return
  }

  emitSelection(selectedClipIds.value, clipId)
  startMoveableDrag(event, clipId)
}

const onTargetDoubleClick = (clipId: string) => {
  startTextEdit(clipId)
}

const onStagePointerDown = (event: PointerEvent) => {
  if (event.button !== 0 || event.altKey) return
  if (!overlayRootRef.value) return

  const target = event.target as HTMLElement | null
  if (
    target?.closest('.moveable-control-box') ||
    target?.closest('.transform-target') ||
    target?.closest('.transform-text-editor')
  ) {
    return
  }

  if (textEditor.value) {
    commitTextEdit()
  }

  const point = getPointerCanvasPosition(event.clientX, event.clientY)
  if (!point) return

  marquee.value = {
    startX: point.x,
    startY: point.y,
    currentX: point.x,
    currentY: point.y,
    additive: event.shiftKey || event.ctrlKey || event.metaKey,
    baseSelection: event.shiftKey || event.ctrlKey || event.metaKey ? [...selectedClipIds.value] : [],
  }

  updateMarqueeSelection()
}

const onWindowPointerMove = (event: PointerEvent) => {
  if (!overlayRootRef.value || !marquee.value) return

  const point = getPointerCanvasPosition(event.clientX, event.clientY)
  if (!point) return

  marquee.value.currentX = point.x
  marquee.value.currentY = point.y
  updateMarqueeSelection()
}

const onWindowPointerUp = () => {
  marquee.value = null
}

onMounted(() => {
  createMoveableInstance()
  observeStageMutations()
  scheduleStageSync()
  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)
})

onBeforeUnmount(() => {
  if (syncFrame) {
    cancelAnimationFrame(syncFrame)
  }
  mutationObserver?.disconnect()
  mutationObserver = null
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
  moveableInstance.value?.destroy()
  moveableInstance.value = null
})

watch(
  () => props.selectedClipId,
  (clipId) => {
    if (marquee.value || activeGesture.value) return
    if (!clipId) {
      if (selectedClipIds.value.length) {
        emitSelection([], null)
      }
      return
    }
    if (!selectedClipIds.value.includes(clipId)) {
      emitSelection([clipId], clipId)
    }
  },
  { immediate: true }
)

watch(
  () => props.items,
  () => {
    scheduleStageSync()
  },
  { deep: true, immediate: true }
)

watch(
  () => props.canvasScale,
  () => {
    nextTick(() => {
      syncMoveableTargets()
    })
  }
)

watch(selectedClipIds, () => {
  nextTick(() => {
    syncMoveableTargets()
  })
})

watch(textEditor, () => {
  nextTick(() => {
    syncMoveableTargets()
  })
})
</script>

<template>
  <div
    ref="overlayRootRef"
    class="transform-controls absolute inset-0"
    @pointerdown="onStagePointerDown"
  >
    <div
      v-for="item in items"
      :key="item.clipId"
      :ref="(el) => setOverlayElement(item.clipId, el)"
      class="transform-target absolute"
      :class="{
        'transform-target--selected': selectedClipIdSet.has(item.clipId),
        'transform-target--editing': textEditor?.clipId === item.clipId,
      }"
      :data-clip-id="item.clipId"
      :style="getOverlayStyle(item.clipId)"
      @pointerdown="(event) => onTargetPointerDown(event, item.clipId)"
      @dblclick.stop="onTargetDoubleClick(item.clipId)"
    >
      <div class="transform-target__chrome" />
    </div>

    <textarea
      v-if="textEditor"
      ref="textEditorRef"
      v-model="textEditor.value"
      class="transform-text-editor absolute"
      :style="textEditorStyle"
      @blur="commitTextEdit"
      @keydown="onTextEditorKeydown"
    />

    <div
      v-if="marquee"
      class="transform-marquee absolute"
      :style="marqueeStyle"
    />
  </div>
</template>

<style scoped>
.transform-controls {
  z-index: 100;
  pointer-events: auto;
  isolation: isolate;
}

.transform-target {
  box-sizing: border-box;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  pointer-events: auto;
  will-change: transform;
  z-index: 1;
}

.transform-target:hover {
  border-color: color-mix(in oklab, var(--primary) 35%, transparent);
  background: color-mix(in oklab, var(--primary) 6%, transparent);
}

.transform-target--selected {
  border-color: color-mix(in oklab, var(--primary) 55%, transparent);
  background: color-mix(in oklab, var(--primary) 10%, transparent);
  z-index: 2;
}

.transform-target--editing {
  border-color: transparent;
  background: transparent;
  z-index: 3;
}

.transform-target__chrome {
  position: absolute;
  inset: 0;
  border: 1px dashed color-mix(in oklab, var(--primary) 25%, transparent);
  border-radius: 2px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease;
}

.transform-target:hover .transform-target__chrome,
.transform-target--selected .transform-target__chrome {
  opacity: 1;
}

.transform-text-editor {
  z-index: 40;
  box-sizing: border-box;
  min-width: 80px;
  min-height: 36px;
  padding: 8px 10px;
  border: 1px solid var(--primary);
  border-radius: 4px;
  background: rgb(0 0 0 / 0.88);
  color: white;
  resize: none;
  outline: none;
  box-shadow: 0 12px 30px rgb(0 0 0 / 0.28);
}

.transform-marquee {
  pointer-events: none;
  z-index: 30;
  border: 1px solid color-mix(in oklab, var(--primary) 90%, white 10%);
  outline: 1px solid color-mix(in oklab, var(--primary) 18%, transparent);
  outline-offset: -2px;
  background:
    linear-gradient(
      180deg,
      color-mix(in oklab, var(--primary) 20%, transparent),
      color-mix(in oklab, var(--primary) 10%, transparent)
    ),
    repeating-linear-gradient(
      135deg,
      color-mix(in oklab, var(--primary) 8%, transparent) 0 8px,
      transparent 8px 16px
    );
  border-radius: 4px;
  box-shadow:
    0 0 0 1px color-mix(in oklab, var(--background) 75%, transparent),
    inset 0 0 0 1px color-mix(in oklab, var(--primary) 22%, transparent);
}

:deep(.bas-transform-moveable .moveable-line),
:deep(.bas-transform-moveable .moveable-rotation-line) {
  background: color-mix(in oklab, var(--primary) 65%, transparent);
}

:deep(.bas-transform-moveable .moveable-control) {
  width: 10px;
  height: 10px;
  margin-left: -5px;
  margin-top: -5px;
  background: var(--primary);
  border: 2px solid white;
  border-radius: 2px;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.3);
}

:deep(.bas-transform-moveable .moveable-rotation-control) {
  width: 20px;
  height: 20px;
  margin-left: -10px;
  margin-top: -10px;
  background: var(--primary);
  border: 2px solid white;
  box-shadow: 0 2px 4px rgb(0 0 0 / 0.3);
}

:deep(.bas-transform-moveable .moveable-origin) {
  background: white;
  border: 2px solid var(--destructive);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.2);
}
</style>

