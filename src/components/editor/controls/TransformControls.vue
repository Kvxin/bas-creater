<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import type { AnyDanmu } from '@/types/danmu'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const MIN_SCALE = 0.1
const MIN_MEASURED_SIZE = 2
const HANDLE_SCREEN_SIZE = 10
const HANDLE_HIT_SCREEN_SIZE = 20
const ROTATION_HANDLE_SCREEN_OFFSET = 28
const SNAP_SCREEN_THRESHOLD = 8
const ROTATION_SNAP_STEP = 90
const ROTATION_SNAP_THRESHOLD = 5

type Corner = 'nw' | 'ne' | 'se' | 'sw'
type ActiveGesture = DragGesture | ScaleGesture | RotateGesture | AnchorGesture | null

interface TransformOverlayItem {
  clipId: string
  danmu: AnyDanmu
  coordinatePercentageMode?: {
    x: boolean
    y: boolean
  }
}

interface ElementRect {
  width: number
  height: number
}

interface Point {
  x: number
  y: number
}

interface DraftTransform {
  x: number
  y: number
  width: number
  height: number
  scale: number
  rotateX: number
  rotateY: number
  rotateZ: number
  anchorX: number
  anchorY: number
}

interface GestureSnapshot extends DraftTransform {
  clipId: string
}

interface CapturedGesture {
  pointerId: number
}

interface DragGesture extends CapturedGesture {
  type: 'drag'
  startPoint: Point
  snapshots: GestureSnapshot[]
  moved: boolean
}

interface ScaleGesture extends CapturedGesture {
  type: 'scale'
  clipId: string
  corner: Corner
  startDraft: DraftTransform
  center: Point
  startDistance: number
}

interface RotateGesture extends CapturedGesture {
  type: 'rotate'
  clipId: string
  startDraft: DraftTransform
  pivot: Point
  startAngle: number
}

interface AnchorGesture extends CapturedGesture {
  type: 'anchor'
  clipId: string
  startDraft: DraftTransform
  center: Point
  pointerOffset: Point
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

interface SnapLine {
  type: 'vertical' | 'horizontal'
  position: number
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
const activeGesture = ref<ActiveGesture>(null)
const selectedClipIds = ref<string[]>([])
const drafts = ref<Record<string, DraftTransform>>({})
const marquee = ref<MarqueeState | null>(null)
const textEditor = ref<TextEditorState | null>(null)
const snapLines = ref<SnapLine[]>([])

const overlayElements = new Map<string, HTMLElement>()
const actualElements = new Map<string, HTMLElement>()
const actualInnerElements = new Map<string, HTMLElement>()

let mutationObserver: MutationObserver | null = null
let syncFrame = 0

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const round = (value: number, digits = 4) => Number(value.toFixed(digits))
const clampScale = (value: number) => Math.max(MIN_SCALE, value)
const getCanvasScale = () => props.canvasScale || 1
const getInverseCanvasScale = () => 1 / getCanvasScale()
const getLogicalSnapThreshold = () => SNAP_SCREEN_THRESHOLD * getInverseCanvasScale()

const itemByClipId = computed(() => new Map(props.items.map((item) => [item.clipId, item])))
const selectedClipIdSet = computed(() => new Set(selectedClipIds.value))

const primarySelectedClipId = computed(() => {
  return selectedClipIds.value.length === 1 ? selectedClipIds.value[0] ?? null : null
})

const selectedDraft = computed(() => {
  const clipId = primarySelectedClipId.value
  return clipId ? getDraft(clipId) : null
})

const selectedSupportsTextTransform = computed(() => {
  const clipId = primarySelectedClipId.value
  return clipId ? itemByClipId.value.get(clipId)?.danmu.type === 'text' : false
})

const percentToPixels = (val: number | string | undefined, dimension: 'x' | 'y'): number => {
  const size = dimension === 'x' ? props.containerWidth : props.containerHeight

  if (val == null) return 0

  if (typeof val === 'string') {
    const trimmed = val.trim()
    if (trimmed.endsWith('%')) {
      const percent = parseFloat(trimmed)
      return Number.isFinite(percent) ? (percent / 100) * size : 0
    }
    const numericValue = parseFloat(trimmed)
    return Number.isFinite(numericValue) ? numericValue : 0
  }

  return Number.isFinite(val) ? val : 0
}

const pixelsToPercent = (px: number, dimension: 'x' | 'y'): number => {
  const size = dimension === 'x' ? props.containerWidth : props.containerHeight
  return size > 0 && Number.isFinite(px) ? (px / size) * 100 : 0
}

const shouldStoreCoordinateAsPercentage = (
  item: TransformOverlayItem,
  dimension: 'x' | 'y'
) => {
  const preferredMode = item.coordinatePercentageMode?.[dimension]
  if (preferredMode !== undefined) return preferredMode

  const value = item.danmu[dimension]
  return value == null ||
    (typeof value === 'string' && value.trim().endsWith('%'))
}

const sanitizeClipId = (clipId: string) => clipId.replace(/[^a-zA-Z0-9]/g, '_')

const cloneDraft = (draft: DraftTransform): DraftTransform => ({ ...draft })

const resolveFontSizePx = (danmu: AnyDanmu): number => {
  const raw = danmu.type === 'text'
    ? danmu.fontSize
    : danmu.type === 'button'
      ? danmu.fontSize
      : undefined

  const fallbackPx = 25

  if (typeof raw === 'number') {
    return raw
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim().toLowerCase()

    if (trimmed.endsWith('%')) {
      const parsedPercent = parseFloat(trimmed)
      return Number.isFinite(parsedPercent) ? (parsedPercent / 100) * props.containerWidth : fallbackPx
    }

    if (trimmed.endsWith('px')) {
      const parsedPx = parseFloat(trimmed)
      return Number.isFinite(parsedPx) ? parsedPx : fallbackPx
    }

    const parsed = parseFloat(trimmed)
    return Number.isFinite(parsed) ? parsed : fallbackPx
  }

  return fallbackPx
}

const parseDimension = (
  value: number | string | undefined,
  dimension: 'x' | 'y',
  fallback: number
) => {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.endsWith('%')) {
      const parsedPercent = parseFloat(trimmed)
      const size = dimension === 'x' ? props.containerWidth : props.containerHeight
      return Number.isFinite(parsedPercent) ? (parsedPercent / 100) * size : fallback
    }
    const parsed = parseFloat(trimmed)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
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
    return {
      width: Math.max(24, parseDimension(danmu.width, 'x', 120)),
      height: Math.max(24, parseDimension(danmu.height, 'y', 80)),
    }
  }

  if (danmu.type === 'button') {
    const text = danmu.text ?? ''
    const fontSize = resolveFontSizePx(danmu)
    return {
      width: Math.max(60, text.length * fontSize + 40),
      height: Math.max(32, fontSize + 20),
    }
  }

  const text = (danmu as any).text ?? ''
  return {
    width: Math.max(80, text.length * 14 + 40),
    height: 36,
  }
}

const measureElementRect = (element: HTMLElement | null): ElementRect | null => {
  if (!element) return null

  // Use layout size only. getBoundingClientRect() includes BAS transform,
  // editor zoom, and the draft scale, which would be multiplied again below.
  const width = Math.max(element.offsetWidth, element.clientWidth)
  const height = Math.max(element.offsetHeight, element.clientHeight)

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < MIN_MEASURED_SIZE ||
    height < MIN_MEASURED_SIZE
  ) {
    return null
  }

  return { width, height }
}

const resolveElementRect = (
  item: TransformOverlayItem,
  measurementTarget: HTMLElement | null,
  currentDraft: DraftTransform | undefined
): ElementRect => {
  const measuredRect = measureElementRect(measurementTarget)
  if (measuredRect) return measuredRect

  if (
    currentDraft &&
    currentDraft.width >= MIN_MEASURED_SIZE &&
    currentDraft.height >= MIN_MEASURED_SIZE
  ) {
    return {
      width: currentDraft.width,
      height: currentDraft.height,
    }
  }

  return estimateElementSize(item.danmu)
}

const createDraft = (danmu: AnyDanmu, rect: ElementRect): DraftTransform => ({
  x: percentToPixels(danmu.x, 'x'),
  y: percentToPixels(danmu.y, 'y'),
  width: rect.width,
  height: rect.height,
  scale: clampScale(danmu.scale ?? 1),
  rotateX: danmu.type === 'button' ? 0 : (danmu.rotateX ?? 0),
  rotateY: danmu.type === 'button' ? 0 : (danmu.rotateY ?? 0),
  rotateZ: danmu.type === 'button' ? 0 : (danmu.rotateZ ?? 0),
  anchorX: danmu.type === 'button' ? 0 : clamp(danmu.anchorX ?? 0, 0, 1),
  anchorY: danmu.type === 'button' ? 0 : clamp(danmu.anchorY ?? 0, 0, 1),
})

function getDraft(clipId: string) {
  return drafts.value[clipId] ?? null
}

function rotatePoint(x: number, y: number, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  }
}

function unrotatePoint(x: number, y: number, degrees: number): Point {
  return rotatePoint(x, y, -degrees)
}

function getDraftPoint(draft: DraftTransform, relX: number, relY: number): Point {
  const localX = (relX - draft.anchorX) * draft.width * draft.scale
  const localY = (relY - draft.anchorY) * draft.height * draft.scale
  const rotated = rotatePoint(localX, localY, draft.rotateZ)
  return {
    x: draft.x + rotated.x,
    y: draft.y + rotated.y,
  }
}

function getDraftCenter(draft: DraftTransform): Point {
  return getDraftPoint(draft, 0.5, 0.5)
}

function getAnchorPointForCenter(
  center: Point,
  draft: DraftTransform,
  anchorX = draft.anchorX,
  anchorY = draft.anchorY,
  scale = draft.scale,
  rotateZ = draft.rotateZ
): Point {
  const localX = (0.5 - anchorX) * draft.width * scale
  const localY = (0.5 - anchorY) * draft.height * scale
  const rotated = rotatePoint(localX, localY, rotateZ)
  return {
    x: center.x - rotated.x,
    y: center.y - rotated.y,
  }
}

function getDraftCorners(draft: DraftTransform) {
  return {
    nw: getDraftPoint(draft, 0, 0),
    ne: getDraftPoint(draft, 1, 0),
    se: getDraftPoint(draft, 1, 1),
    sw: getDraftPoint(draft, 0, 1),
  } satisfies Record<Corner, Point>
}

function getDraftAabb(draft: DraftTransform) {
  const corners = Object.values(getDraftCorners(draft))
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
    centerX: (Math.min(...xs) + Math.max(...xs)) / 2,
    centerY: (Math.min(...ys) + Math.max(...ys)) / 2,
  }
}

function getBoundsStyle(draft: DraftTransform): CSSProperties {
  const center = getDraftCenter(draft)
  const width = Math.max(1, draft.width * draft.scale)
  const height = Math.max(1, draft.height * draft.scale)

  return {
    left: `${center.x - width / 2}px`,
    top: `${center.y - height / 2}px`,
    width: `${width}px`,
    height: `${height}px`,
    transform: `rotate(${draft.rotateZ}deg)`,
  }
}

function getOverlayStyle(clipId: string): CSSProperties {
  const draft = getDraft(clipId)
  if (!draft) return {}

  return {
    left: `${draft.x - draft.width * draft.anchorX}px`,
    top: `${draft.y - draft.height * draft.anchorY}px`,
    width: `${draft.width}px`,
    height: `${draft.height}px`,
    transformOrigin: `${draft.anchorX * 100}% ${draft.anchorY * 100}%`,
    transform: `rotate(${draft.rotateZ}deg) scale(${draft.scale})`,
  }
}

function getHandleSizeStyle(size: number): CSSProperties {
  const logicalSize = size * getInverseCanvasScale()
  return {
    width: `${logicalSize}px`,
    height: `${logicalSize}px`,
    marginLeft: `${-logicalSize / 2}px`,
    marginTop: `${-logicalSize / 2}px`,
  }
}

function getHandlePositionStyle(point: Point, size = HANDLE_HIT_SCREEN_SIZE): CSSProperties {
  const logicalSize = size * getInverseCanvasScale()
  return {
    left: `${point.x}px`,
    top: `${point.y}px`,
    width: `${logicalSize}px`,
    height: `${logicalSize}px`,
    marginLeft: `${-logicalSize / 2}px`,
    marginTop: `${-logicalSize / 2}px`,
  }
}

function getCornerCursor(corner: Corner, rotateZ: number) {
  const baseAngle = corner === 'ne' || corner === 'sw' ? 45 : -45
  const normalized = ((baseAngle + rotateZ) % 180 + 180) % 180
  if (normalized < 22.5 || normalized >= 157.5) return 'ew-resize'
  if (normalized < 67.5) return 'nesw-resize'
  if (normalized < 112.5) return 'ns-resize'
  return 'nwse-resize'
}

const cornerEntries = computed(() => {
  const draft = selectedDraft.value
  if (!draft || textEditor.value) return []
  const corners = getDraftCorners(draft)
  return (Object.entries(corners) as Array<[Corner, Point]>).map(([corner, point]) => ({
    corner,
    point,
    cursor: getCornerCursor(corner, draft.rotateZ),
  }))
})

const selectedBoundsStyle = computed(() => {
  const draft = selectedDraft.value
  return draft && !textEditor.value ? getBoundsStyle(draft) : null
})

const anchorPoint = computed(() => {
  const draft = selectedDraft.value
  return draft && !textEditor.value ? { x: draft.x, y: draft.y } : null
})

const anchorHandlePoint = computed(() => {
  const draft = selectedDraft.value
  const point = anchorPoint.value
  if (!draft || !point || textEditor.value || !selectedSupportsTextTransform.value) return null

  const corners = Object.values(getDraftCorners(draft))
  const overlapThreshold = HANDLE_HIT_SCREEN_SIZE * getInverseCanvasScale()
  const overlapsCorner = corners.some((corner) => {
    return Math.hypot(corner.x - point.x, corner.y - point.y) <= overlapThreshold
  })

  if (!overlapsCorner) return point

  const center = getDraftCenter(draft)
  const dx = center.x - point.x
  const dy = center.y - point.y
  const length = Math.hypot(dx, dy) || 1
  const offset = HANDLE_HIT_SCREEN_SIZE * getInverseCanvasScale()

  return {
    x: point.x + (dx / length) * offset,
    y: point.y + (dy / length) * offset,
  }
})

const rotationHandlePoint = computed(() => {
  const draft = selectedDraft.value
  if (!draft || textEditor.value || !selectedSupportsTextTransform.value) return null

  const center = getDraftCenter(draft)
  const topCenter = getDraftPoint(draft, 0.5, 0)
  const radians = (draft.rotateZ * Math.PI) / 180
  const offset = ROTATION_HANDLE_SCREEN_OFFSET * getInverseCanvasScale()

  return {
    x: topCenter.x + Math.sin(radians) * offset,
    y: topCenter.y - Math.cos(radians) * offset,
    center,
  }
})

const groupBoundsStyle = computed(() => {
  if (selectedClipIds.value.length <= 1 || textEditor.value) return null

  const boxes = selectedClipIds.value
    .map((clipId) => getDraft(clipId))
    .filter((draft): draft is DraftTransform => !!draft)
    .map(getDraftAabb)

  if (!boxes.length) return null

  const left = Math.min(...boxes.map((box) => box.left))
  const top = Math.min(...boxes.map((box) => box.top))
  const right = Math.max(...boxes.map((box) => box.right))
  const bottom = Math.max(...boxes.map((box) => box.bottom))

  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${Math.max(1, right - left)}px`,
    height: `${Math.max(1, bottom - top)}px`,
  } satisfies CSSProperties
})

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
  } satisfies CSSProperties
})

const textEditorStyle = computed(() => {
  if (!textEditor.value) return {}
  return getOverlayStyle(textEditor.value.clipId)
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
  const container = overlayRootRef.value?.parentElement ?? document
  return container.querySelector(`.bas-danmaku-item--obj_${sanitizeClipId(clipId)}`) as HTMLElement | null
}

const buildInnerTransform = (anchorX: number, anchorY: number) => {
  return `translate(${round(-anchorX * 100)}%, ${round(-anchorY * 100)}%)`
}

const applyDraftToActualElement = (clipId: string) => {
  const draft = getDraft(clipId)
  const actualElement = actualElements.get(clipId)
  if (!draft || !actualElement) return

  actualElement.style.transformOrigin = '0 0'
  actualElement.style.transform = [
    `translate(${round(draft.x)}px, ${round(draft.y)}px)`,
    `rotateX(${round(draft.rotateX)}deg)`,
    `rotateY(${round(draft.rotateY)}deg)`,
    `rotate(${round(draft.rotateZ)}deg)`,
    `scale(${round(draft.scale)})`,
  ].join(' ')

  const innerElement = actualInnerElements.get(clipId)
  if (innerElement) {
    innerElement.style.transformOrigin = '0 0'
    innerElement.style.transform = buildInnerTransform(draft.anchorX, draft.anchorY)
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
    // 按钮弹幕在 BAS 中外层就是按钮容器（带 padding、背景、圆角），需直接测量 actualElement
    const measurementTarget = item.danmu.type === 'button'
      ? actualElement
      : ((actualElement?.querySelector('.bas-danmaku-item-inner') as HTMLElement | null) ?? actualElement)
    const currentDraft = drafts.value[item.clipId]
    const rect = resolveElementRect(item, measurementTarget, currentDraft)

    if (actualElement) {
      nextActualElements.set(item.clipId, actualElement)
    }
    // 仅 text 弹幕需要记录 actualInnerElements 应用 anchorX/anchorY 相对偏移
    if (item.danmu.type === 'text' && measurementTarget instanceof HTMLElement) {
      nextActualInnerElements.set(item.clipId, measurementTarget)
    }

    const shouldPreserveDraft = !!activeGesture.value && selectedClipIdSet.value.has(item.clipId)

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
}

function screenToCanvas(clientX: number, clientY: number, shouldClamp = false): Point | null {
  const overlayRect = overlayRootRef.value?.getBoundingClientRect()
  if (!overlayRect) return null

  const canvasScale = getCanvasScale()
  const rawPoint = {
    x: (clientX - overlayRect.left) / canvasScale,
    y: (clientY - overlayRect.top) / canvasScale,
  }

  if (!shouldClamp) return rawPoint

  return {
    x: clamp(rawPoint.x, 0, props.containerWidth),
    y: clamp(rawPoint.y, 0, props.containerHeight),
  }
}

function snapRotation(proposedRotation: number, enabled: boolean) {
  if (!enabled) return proposedRotation

  const nearest = Math.round(proposedRotation / ROTATION_SNAP_STEP) * ROTATION_SNAP_STEP
  const distance = Math.abs(proposedRotation - nearest)
  return distance <= ROTATION_SNAP_THRESHOLD ? nearest : proposedRotation
}

function snapDraftPosition(
  draft: DraftTransform,
  proposedX: number,
  proposedY: number,
  enabled: boolean
) {
  if (!enabled) {
    snapLines.value = []
    return { x: proposedX, y: proposedY }
  }

  const threshold = getLogicalSnapThreshold()
  const proposedDraft = { ...draft, x: proposedX, y: proposedY }
  const aabb = getDraftAabb(proposedDraft)
  const verticalTargets = [0, props.containerWidth / 2, props.containerWidth]
  const horizontalTargets = [0, props.containerHeight / 2, props.containerHeight]

  const xCandidates = verticalTargets.flatMap((target) => [
    { delta: target - aabb.left, distance: Math.abs(target - aabb.left), line: { type: 'vertical', position: target } as SnapLine },
    { delta: target - aabb.centerX, distance: Math.abs(target - aabb.centerX), line: { type: 'vertical', position: target } as SnapLine },
    { delta: target - aabb.right, distance: Math.abs(target - aabb.right), line: { type: 'vertical', position: target } as SnapLine },
  ])

  const yCandidates = horizontalTargets.flatMap((target) => [
    { delta: target - aabb.top, distance: Math.abs(target - aabb.top), line: { type: 'horizontal', position: target } as SnapLine },
    { delta: target - aabb.centerY, distance: Math.abs(target - aabb.centerY), line: { type: 'horizontal', position: target } as SnapLine },
    { delta: target - aabb.bottom, distance: Math.abs(target - aabb.bottom), line: { type: 'horizontal', position: target } as SnapLine },
  ])

  const xSnap = xCandidates
    .filter((candidate) => candidate.distance <= threshold)
    .sort((left, right) => left.distance - right.distance)[0]
  const ySnap = yCandidates
    .filter((candidate) => candidate.distance <= threshold)
    .sort((left, right) => left.distance - right.distance)[0]

  snapLines.value = [
    ...(xSnap ? [xSnap.line] : []),
    ...(ySnap ? [ySnap.line] : []),
  ]

  return {
    x: proposedX + (xSnap?.delta ?? 0),
    y: proposedY + (ySnap?.delta ?? 0),
  }
}

function applyGestureDraft(clipId: string, nextDraft: DraftTransform) {
  drafts.value[clipId] = nextDraft
  applyDraftToActualElement(clipId)
}

type DraftCommitField = 'x' | 'y' | 'scale' | 'rotateZ' | 'anchorX' | 'anchorY'

const DRAFT_CHANGE_EPSILON = 0.0001

function commitDrafts(
  clipIds: string[],
  fields: DraftCommitField[],
  initialDrafts?: ReadonlyMap<string, DraftTransform>
) {
  const updates = new Map<string, Partial<AnyDanmu>>()

  for (const clipId of clipIds) {
    const item = itemByClipId.value.get(clipId)
    const draft = getDraft(clipId)
    if (!item || !draft) continue

    const initialDraft = initialDrafts?.get(clipId)
    const changedFields = initialDraft
      ? fields.filter((field) => Math.abs(draft[field] - initialDraft[field]) > DRAFT_CHANGE_EPSILON)
      : fields
    if (!changedFields.length) continue

    const values: Record<DraftCommitField, number | string> = {
      x: shouldStoreCoordinateAsPercentage(item, 'x')
        ? `${round(pixelsToPercent(draft.x, 'x'))}%`
        : round(draft.x),
      y: shouldStoreCoordinateAsPercentage(item, 'y')
        ? `${round(pixelsToPercent(draft.y, 'y'))}%`
        : round(draft.y),
      scale: round(clampScale(draft.scale)),
      rotateZ: round(draft.rotateZ),
      anchorX: round(clamp(draft.anchorX, 0, 1)),
      anchorY: round(clamp(draft.anchorY, 0, 1)),
    }
    updates.set(
      item.danmu.id,
      Object.fromEntries(changedFields.map((field) => [field, values[field]])) as Partial<AnyDanmu>
    )
  }

  if (!updates.size) return

  emit(
    'commit',
    Array.from(updates.entries()).map(([id, changes]) => ({ id, changes }))
  )
}

function capturePointer(pointerId: number) {
  try {
    overlayRootRef.value?.setPointerCapture(pointerId)
  } catch {
    // Pointer capture can fail if the pointer is already gone.
  }
}

function releasePointer(pointerId: number) {
  const root = overlayRootRef.value
  if (!root) return
  try {
    if (root.hasPointerCapture(pointerId)) {
      root.releasePointerCapture(pointerId)
    }
  } catch {
    // Ignore stale pointer captures.
  }
}

function startDragGesture(event: PointerEvent, clipId: string) {
  const startPoint = screenToCanvas(event.clientX, event.clientY)
  if (!startPoint) return

  const dragClipIds = selectedClipIdSet.value.has(clipId) ? selectedClipIds.value : [clipId]
  const snapshots = dragClipIds
    .map((selectedClipId) => {
      const draft = getDraft(selectedClipId)
      return draft ? { clipId: selectedClipId, ...cloneDraft(draft) } : null
    })
    .filter((snapshot): snapshot is GestureSnapshot => !!snapshot)

  if (!snapshots.length) return

  activeGesture.value = {
    type: 'drag',
    pointerId: event.pointerId,
    startPoint,
    snapshots,
    moved: false,
  }
  capturePointer(event.pointerId)
}

function onCornerPointerDown(event: PointerEvent, corner: Corner) {
  const clipId = primarySelectedClipId.value
  const draft = clipId ? getDraft(clipId) : null
  const pointer = screenToCanvas(event.clientX, event.clientY)
  if (!clipId || !draft || !pointer) return

  event.preventDefault()
  event.stopPropagation()

  const center = getDraftCenter(draft)
  const startDistance = Math.max(
    1,
    Math.hypot(pointer.x - center.x, pointer.y - center.y)
  )

  activeGesture.value = {
    type: 'scale',
    pointerId: event.pointerId,
    clipId,
    corner,
    center,
    startDistance,
    startDraft: cloneDraft(draft),
  }
  capturePointer(event.pointerId)
}

function onRotatePointerDown(event: PointerEvent) {
  const clipId = primarySelectedClipId.value
  const draft = clipId ? getDraft(clipId) : null
  const pointer = screenToCanvas(event.clientX, event.clientY)
  if (!clipId || !draft || !pointer) return

  event.preventDefault()
  event.stopPropagation()

  // `x`/`y` are the canvas coordinates of the element's configured anchor.
  // Rotating must preserve that point, rather than the element's visual center.
  const pivot = { x: draft.x, y: draft.y }
  activeGesture.value = {
    type: 'rotate',
    pointerId: event.pointerId,
    clipId,
    pivot,
    startDraft: cloneDraft(draft),
    startAngle: Math.atan2(pointer.y - pivot.y, pointer.x - pivot.x) * (180 / Math.PI),
  }
  capturePointer(event.pointerId)
}

function onAnchorPointerDown(event: PointerEvent) {
  const clipId = primarySelectedClipId.value
  const draft = clipId ? getDraft(clipId) : null
  const pointer = screenToCanvas(event.clientX, event.clientY)
  if (!clipId || !draft || !pointer) return

  event.preventDefault()
  event.stopPropagation()

  activeGesture.value = {
    type: 'anchor',
    pointerId: event.pointerId,
    clipId,
    startDraft: cloneDraft(draft),
    center: getDraftCenter(draft),
    pointerOffset: {
      x: pointer.x - draft.x,
      y: pointer.y - draft.y,
    },
  }
  capturePointer(event.pointerId)
}

function updateDragGesture(gesture: DragGesture, point: Point, event: PointerEvent) {
  const deltaX = point.x - gesture.startPoint.x
  const deltaY = point.y - gesture.startPoint.y
  gesture.moved = gesture.moved || Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5

  const primary = gesture.snapshots[0]
  let snappedDelta = { x: deltaX, y: deltaY }

  if (primary) {
    const snapped = snapDraftPosition(
      primary,
      primary.x + deltaX,
      primary.y + deltaY,
      !event.shiftKey
    )
    snappedDelta = {
      x: snapped.x - primary.x,
      y: snapped.y - primary.y,
    }
  }

  for (const snapshot of gesture.snapshots) {
    applyGestureDraft(snapshot.clipId, {
      ...snapshot,
      x: snapshot.x + snappedDelta.x,
      y: snapshot.y + snappedDelta.y,
    })
  }
}

function updateScaleGesture(gesture: ScaleGesture, point: Point) {
  const currentDistance = Math.max(
    1,
    Math.hypot(point.x - gesture.center.x, point.y - gesture.center.y)
  )
  const nextScale = clampScale(gesture.startDraft.scale * (currentDistance / gesture.startDistance))
  const nextAnchorPoint = getAnchorPointForCenter(
    gesture.center,
    gesture.startDraft,
    gesture.startDraft.anchorX,
    gesture.startDraft.anchorY,
    nextScale,
    gesture.startDraft.rotateZ
  )

  applyGestureDraft(gesture.clipId, {
    ...gesture.startDraft,
    ...nextAnchorPoint,
    scale: nextScale,
  })
}

function updateRotateGesture(gesture: RotateGesture, point: Point, event: PointerEvent) {
  const currentAngle = Math.atan2(point.y - gesture.pivot.y, point.x - gesture.pivot.x) * (180 / Math.PI)
  let deltaAngle = currentAngle - gesture.startAngle
  if (deltaAngle > 180) deltaAngle -= 360
  if (deltaAngle < -180) deltaAngle += 360

  const nextRotateZ = snapRotation(gesture.startDraft.rotateZ + deltaAngle, !event.shiftKey)

  applyGestureDraft(gesture.clipId, {
    ...gesture.startDraft,
    rotateZ: nextRotateZ,
  })
}

function updateAnchorGesture(gesture: AnchorGesture, point: Point) {
  const draft = gesture.startDraft
  const effectivePoint = {
    x: point.x - gesture.pointerOffset.x,
    y: point.y - gesture.pointerOffset.y,
  }
  const vectorFromAnchor = {
    x: effectivePoint.x - draft.x,
    y: effectivePoint.y - draft.y,
  }
  const local = unrotatePoint(vectorFromAnchor.x, vectorFromAnchor.y, draft.rotateZ)
  const nextAnchorX = clamp(draft.anchorX + local.x / (draft.width * draft.scale), 0, 1)
  const nextAnchorY = clamp(draft.anchorY + local.y / (draft.height * draft.scale), 0, 1)
  const nextAnchorPoint = getAnchorPointForCenter(
    gesture.center,
    draft,
    nextAnchorX,
    nextAnchorY,
    draft.scale,
    draft.rotateZ
  )

  applyGestureDraft(gesture.clipId, {
    ...draft,
    ...nextAnchorPoint,
    anchorX: nextAnchorX,
    anchorY: nextAnchorY,
  })
}

function finishGesture(event?: PointerEvent) {
  const gesture = activeGesture.value
  if (!gesture) return

  activeGesture.value = null
  snapLines.value = []
  releasePointer(gesture.pointerId)

  if (gesture.type === 'drag') {
    if (gesture.moved) {
      commitDrafts(
        gesture.snapshots.map((snapshot) => snapshot.clipId),
        ['x', 'y'],
        new Map(gesture.snapshots.map((snapshot) => [snapshot.clipId, snapshot]))
      )
    }
    return
  }

  if (event?.type === 'pointercancel') {
    applyGestureDraft(gesture.clipId, cloneDraft(gesture.startDraft))
    return
  }

  if (gesture.type === 'scale') {
    commitDrafts(
      [gesture.clipId],
      ['x', 'y', 'scale'],
      new Map([[gesture.clipId, gesture.startDraft]])
    )
  } else if (gesture.type === 'rotate') {
    commitDrafts(
      [gesture.clipId],
      ['rotateZ'],
      new Map([[gesture.clipId, gesture.startDraft]])
    )
  } else {
    commitDrafts(
      [gesture.clipId],
      ['x', 'y', 'anchorX', 'anchorY'],
      new Map([[gesture.clipId, gesture.startDraft]])
    )
  }
}

function onTargetPointerDown(event: PointerEvent, clipId: string) {
  if (event.button !== 0 || event.altKey) return

  event.preventDefault()
  event.stopPropagation()

  if (textEditor.value && textEditor.value.clipId !== clipId) {
    commitTextEdit()
  }

  const additive = event.shiftKey || event.ctrlKey || event.metaKey
  const isSelected = selectedClipIdSet.value.has(clipId)

  if (additive) {
    const nextSelection = isSelected
      ? selectedClipIds.value.filter((selectedClipId) => selectedClipId !== clipId)
      : [...selectedClipIds.value, clipId]
    emitSelection(nextSelection, isSelected ? nextSelection[0] ?? null : clipId)
    return
  }

  if (!isSelected) {
    emitSelection([clipId], clipId)
  } else {
    emitSelection(selectedClipIds.value, clipId)
  }

  startDragGesture(event, clipId)
}

function onTargetDoubleClick(clipId: string) {
  startTextEdit(clipId)
}

function onStagePointerDown(event: PointerEvent) {
  if (event.button !== 0 || event.altKey) return
  if (!overlayRootRef.value) return

  const target = event.target as HTMLElement | null
  if (
    target?.closest('.transform-handle') ||
    target?.closest('.transform-target') ||
    target?.closest('.transform-text-editor')
  ) {
    return
  }

  if (textEditor.value) {
    commitTextEdit()
  }

  const point = screenToCanvas(event.clientX, event.clientY, true)
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

function getMarqueeBox() {
  if (!marquee.value) return null

  const left = Math.min(marquee.value.startX, marquee.value.currentX)
  const top = Math.min(marquee.value.startY, marquee.value.currentY)
  const right = Math.max(marquee.value.startX, marquee.value.currentX)
  const bottom = Math.max(marquee.value.startY, marquee.value.currentY)

  return { left, top, right, bottom }
}

function updateMarqueeSelection() {
  const marqueeBox = getMarqueeBox()
  if (!marqueeBox || !marquee.value) return

  const hitIds = props.items
    .filter((item) => {
      const draft = getDraft(item.clipId)
      if (!draft) return false
      const bounds = getDraftAabb(draft)
      return !(
        bounds.right < marqueeBox.left ||
        bounds.left > marqueeBox.right ||
        bounds.bottom < marqueeBox.top ||
        bounds.top > marqueeBox.bottom
      )
    })
    .map((item) => item.clipId)

  const nextSelection = marquee.value.additive
    ? [...marquee.value.baseSelection, ...hitIds]
    : hitIds

  emitSelection(nextSelection, hitIds[0] ?? marquee.value.baseSelection[0] ?? null)
}

function onWindowPointerMove(event: PointerEvent) {
  const gesture = activeGesture.value
  if (gesture) {
    const point = screenToCanvas(event.clientX, event.clientY)
    if (!point) return

    if (gesture.type === 'drag') {
      updateDragGesture(gesture, point, event)
    } else if (gesture.type === 'scale') {
      updateScaleGesture(gesture, point)
    } else if (gesture.type === 'rotate') {
      updateRotateGesture(gesture, point, event)
    } else {
      updateAnchorGesture(gesture, point)
    }
    return
  }

  if (!marquee.value) return
  const point = screenToCanvas(event.clientX, event.clientY, true)
  if (!point) return

  marquee.value.currentX = point.x
  marquee.value.currentY = point.y
  updateMarqueeSelection()
}

function onWindowPointerUp(event: PointerEvent) {
  if (activeGesture.value) {
    finishGesture(event)
    return
  }
  marquee.value = null
}

function commitTextEdit() {
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
  })
}

function cancelTextEdit() {
  textEditor.value = null
}

function startTextEdit(clipId: string) {
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
  })
}

function onTextEditorKeydown(event: KeyboardEvent) {
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

function observeStageMutations() {
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

onMounted(() => {
  observeStageMutations()
  scheduleStageSync()
  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)
  window.addEventListener('pointercancel', onWindowPointerUp)
})

onBeforeUnmount(() => {
  if (syncFrame) {
    cancelAnimationFrame(syncFrame)
  }
  mutationObserver?.disconnect()
  mutationObserver = null
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('pointercancel', onWindowPointerUp)
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
    scheduleStageSync()
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

    <div
      v-if="groupBoundsStyle"
      class="transform-group-bounds absolute"
      :style="groupBoundsStyle"
    />

    <div
      v-if="selectedBoundsStyle"
      class="transform-selection-bounds absolute"
      :style="selectedBoundsStyle"
    />

    <button
      v-for="entry in cornerEntries"
      :key="entry.corner"
      type="button"
      class="transform-handle transform-handle--corner absolute"
      :class="`transform-handle--${entry.corner}`"
      :style="{ ...getHandlePositionStyle(entry.point), cursor: entry.cursor }"
      :aria-label="t('preview.transform.scaleHandle', { corner: entry.corner })"
      @pointerdown="(event) => onCornerPointerDown(event, entry.corner)"
    >
      <span :style="getHandleSizeStyle(HANDLE_SCREEN_SIZE)" />
    </button>

    <button
      v-if="rotationHandlePoint"
      type="button"
      class="transform-handle transform-handle--rotate absolute"
      :style="getHandlePositionStyle(rotationHandlePoint)"
      :aria-label="t('preview.transform.rotateHandle')"
      @pointerdown="onRotatePointerDown"
    >
      <span :style="getHandleSizeStyle(18)" />
    </button>

    <button
      v-if="anchorHandlePoint"
      type="button"
      class="transform-handle transform-handle--anchor absolute"
      :style="getHandlePositionStyle(anchorHandlePoint, 18)"
      :aria-label="t('preview.transform.anchorHandle')"
      @pointerdown="onAnchorPointerDown"
    >
      <span :style="getHandleSizeStyle(8)" />
    </button>

    <div
      v-for="line in snapLines"
      :key="`${line.type}-${line.position}`"
      class="transform-snap-line absolute"
      :class="`transform-snap-line--${line.type}`"
      :style="line.type === 'vertical'
        ? { left: `${line.position}px`, width: `${getInverseCanvasScale()}px` }
        : { top: `${line.position}px`, height: `${getInverseCanvasScale()}px` }"
    />

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
  border-radius: 2px;
  background: transparent;
  pointer-events: auto;
  transform-box: border-box;
  will-change: transform;
  z-index: 1;
}

.transform-target:hover {
  border-color: color-mix(in oklab, var(--primary) 42%, transparent);
  background: color-mix(in oklab, var(--primary) 5%, transparent);
}

.transform-target--selected {
  border-color: transparent;
  background: transparent;
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
  border: 1px dashed color-mix(in oklab, var(--primary) 32%, transparent);
  border-radius: 2px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease;
}

.transform-target:hover .transform-target__chrome,
.transform-target--selected .transform-target__chrome {
  opacity: 1;
}

.transform-selection-bounds,
.transform-group-bounds {
  box-sizing: border-box;
  z-index: 18;
  pointer-events: none;
  transform-origin: center center;
}

.transform-selection-bounds {
  border: 1px solid rgb(255 255 255 / 0.76);
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 0.4),
    0 0 0 2px color-mix(in oklab, var(--primary) 45%, transparent);
}

.transform-group-bounds {
  border: 1px dashed color-mix(in oklab, var(--primary) 75%, white 15%);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.38);
}

.transform-handle {
  z-index: 24;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  padding: 0;
  background: transparent;
  pointer-events: auto;
  touch-action: none;
}

.transform-handle > span {
  display: block;
  box-sizing: border-box;
  pointer-events: none;
}

.transform-handle--corner > span {
  border-radius: 2px;
  background: white;
  border: 1px solid rgb(0 0 0 / 0.42);
  box-shadow:
    0 0 0 1px color-mix(in oklab, var(--primary) 68%, transparent),
    0 1px 3px rgb(0 0 0 / 0.32);
}

.transform-handle--corner {
  z-index: 27;
}

.transform-handle--rotate {
  z-index: 28;
  cursor: grab;
}

.transform-handle--rotate:active {
  cursor: grabbing;
}

.transform-handle--rotate > span {
  border-radius: 999px;
  background:
    radial-gradient(circle at 50% 50%, transparent 0 34%, rgb(18 18 18) 36% 46%, transparent 48%),
    white;
  border: 1px solid rgb(0 0 0 / 0.42);
  box-shadow:
    0 0 0 1px color-mix(in oklab, var(--primary) 62%, transparent),
    0 2px 5px rgb(0 0 0 / 0.35);
}

.transform-handle--anchor {
  z-index: 26;
  cursor: crosshair;
}

.transform-handle--anchor > span {
  border-radius: 999px;
  background: color-mix(in oklab, var(--primary) 82%, white 18%);
  border: 2px solid white;
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 0.42),
    0 1px 3px rgb(0 0 0 / 0.3);
}

.transform-snap-line {
  z-index: 16;
  pointer-events: none;
  background: rgb(255 255 255 / 0.72);
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--primary) 40%, transparent);
}

.transform-snap-line--vertical {
  top: 0;
  bottom: 0;
}

.transform-snap-line--horizontal {
  left: 0;
  right: 0;
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
</style>
