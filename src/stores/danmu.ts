import { computed, reactive, ref } from "vue"
import { defineStore } from "pinia"
import type { AnyDanmu, DanmuType } from "@/types/danmu"
import { createDanmuByKey } from "@/utils/danmuFactory"

const clamp = (val: number, min: number, max: number) => Math.min(max, Math.max(min, val))

export type ViewportState = {
  scale: number
  offsetX: number
  offsetY: number
}

export const useDanmuStore = defineStore("danmu", () => {
  const danmus = ref<AnyDanmu[]>([
    createDanmuByKey("text"),
    createDanmuByKey("button"),
    createDanmuByKey("path"),
  ])
  const selectedId = ref<string | null>(danmus.value[0]?.id ?? null)
  const viewport = reactive<ViewportState>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  })

  const selected = computed(() => danmus.value.find((dm) => dm.id === selectedId.value) ?? null)

  function select(id: string | null) {
    selectedId.value = id
  }

  function add(type: DanmuType) {
    const dm = createDanmuByKey(type)
    danmus.value.push(dm)
    select(dm.id)
    return dm
  }

  function remove(id: string) {
    const next = danmus.value.filter((dm) => dm.id !== id)
    danmus.value = next
    if (selectedId.value === id) {
      selectedId.value = next.at(-1)?.id ?? null
    }
  }

  function updateSelected(payload: Partial<AnyDanmu>) {
    const idx = danmus.value.findIndex((dm) => dm.id === selectedId.value)
    if (idx === -1) return
    danmus.value[idx] = { ...danmus.value[idx], ...payload } as AnyDanmu
  }

  function moveSelected(x: number, y: number) {
    updateSelected({ x, y })
  }

  function setViewport(next: Partial<ViewportState>) {
    viewport.scale = clamp(next.scale ?? viewport.scale, 0.2, 3)
    viewport.offsetX = next.offsetX ?? viewport.offsetX
    viewport.offsetY = next.offsetY ?? viewport.offsetY
  }

  function zoom(delta: number, anchor?: { x: number; y: number }) {
    const before = viewport.scale
    const target = clamp(before + delta, 0.2, 3)
    if (anchor) {
      const ratio = target / before
      viewport.offsetX = anchor.x - (anchor.x - viewport.offsetX) * ratio
      viewport.offsetY = anchor.y - (anchor.y - viewport.offsetY) * ratio
    }
    viewport.scale = target
  }

  function pan(deltaX: number, deltaY: number) {
    viewport.offsetX += deltaX
    viewport.offsetY += deltaY
  }

  function resetViewport() {
    viewport.scale = 1
    viewport.offsetX = 0
    viewport.offsetY = 0
  }

  return {
    danmus,
    selectedId,
    selected,
    viewport,
    add,
    remove,
    select,
    updateSelected,
    moveSelected,
    setViewport,
    zoom,
    pan,
    resetViewport,
  }
})
