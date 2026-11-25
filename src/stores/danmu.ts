import { computed, reactive, ref } from "vue"
import { defineStore } from "pinia"
import type { AnyDanmu, DanmuType } from "@/types/danmu"
import { i18n } from "@/i18n"
import { createDanmuByKey } from "@/core/danmuFactory"
import { getItemName } from "@/utils/resourceUtils"
import { useAssetsStore } from "@/stores/assets"

const clamp = (val: number, min: number, max: number) => Math.min(max, Math.max(min, val))

export type ViewportState = {
  scale: number
  offsetX: number
  offsetY: number
}

/** 新建弹幕的默认文字随界面语言变化；core 层只知道 BAS 自身的默认值。 */
const localizedIdentity = (type: DanmuType): Partial<AnyDanmu> => {
  if (type === "text") return { content: i18n.global.t("danmu.defaultText") }
  if (type === "button") return { text: i18n.global.t("danmu.defaultButtonText") }
  return {}
}

export const useDanmuStore = defineStore("danmu", () => {
  const assets = useAssetsStore()
  // 弹幕数据唯一存放在 assets store；这里只是按资源顺序派生的视图，写入会回写到 assets。
  const danmus = computed<AnyDanmu[]>({
    get: () => assets.assets.flatMap((asset) => (asset.type === "audio-file" ? [] : [asset.danmu])),
    set: (next) => assets.replaceDanmus(next),
  })
  const selectedId = ref<string | null>(null)
  const viewport = reactive<ViewportState>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  })

  const selected = computed(() => danmus.value.find((dm) => dm.id === selectedId.value) ?? null)

  function select(id: string | null) {
    selectedId.value = id
  }

  /**
   * 新增弹幕资源。
   *
   * @param type 资源类型
   * @param payload 初始字段
   * @param options `select: false` 时不切换选中项，供批量导入使用
   */
  function add(type: DanmuType, payload: Partial<AnyDanmu> = {}, options: { select?: boolean } = {}) {
    const dm = createDanmuByKey(type, { ...localizedIdentity(type), ...payload })
    assets.upsertAsset({ id: dm.id, type: dm.type, binId: null, danmu: dm })
    if (options.select !== false) select(dm.id)
    return dm
  }

  /** 创建可独立编辑的弹幕资源副本。 */
  function duplicate(id: string) {
    const source = danmus.value.find((dm) => dm.id === id)
    if (!source) return null

    const sourceData = JSON.parse(JSON.stringify(source)) as AnyDanmu
    const { id: _id, type: _type, name: _name, ...payload } = sourceData
    const dm = createDanmuByKey(source.type, {
      ...payload,
      name: i18n.global.t("common.duplicateName", { name: getItemName(source) }),
    })

    const sourceBinId = assets.assets.find((asset) => asset.id === id)?.binId ?? null
    assets.upsertAsset({ id: dm.id, type: dm.type, binId: sourceBinId, danmu: dm })
    select(dm.id)
    return dm
  }

  function remove(id: string) {
    const next = danmus.value.filter((dm) => dm.id !== id)
    danmus.value = next
    if (selectedId.value === id) {
      selectedId.value = next[next.length - 1]?.id ?? null
    }
  }

  function updateSelected(payload: Partial<AnyDanmu>) {
    if (selectedId.value) updateDanmu(selectedId.value, payload)
  }

  function updateDanmu(id: string, payload: Partial<AnyDanmu>) {
    const asset = assets.assets.find((item) => item.id === id)
    if (!asset || asset.type === "audio-file") return
    const danmu = { ...asset.danmu, ...payload } as AnyDanmu
    assets.upsertAsset({ ...asset, type: danmu.type, danmu })
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
    duplicate,
    remove,
    select,
    updateSelected,
    updateDanmu,
    setViewport,
    zoom,
    pan,
    resetViewport,
  }
})
