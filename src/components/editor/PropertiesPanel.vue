<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Settings, Plus, Trash2, FileText, Move, Palette, Sparkles, Music2, Volume2 } from "lucide-vue-next";
import { useDanmuStore } from "@/stores/danmu";
import { useTimelineStore } from "@/stores/timeline";
import { useAudioStore } from "@/stores/audio";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { AnyDanmu } from "@/types/danmu";
import type { TimelineKeyframeProperties } from "@/types/timeline";
import { VOLUME_DB_MIN, VOLUME_DB_MAX, VOLUME_STEP } from "@/utils/audio/constants";
import { formatNumberForDisplay } from "@/utils/audio/audio-math";
import {
  BASE_KEYFRAME_ID,
  clampKeyframeTime,
  createKeyframeSnapshot,
  getBaseKeyframeProperties,
  normalizeKeyframes,
  pickKeyframePropertiesForResource,
  resolveKeyframeProperties,
} from "@/utils/keyframes";

const danmuStore = useDanmuStore();
const timelineStore = useTimelineStore();
const audioStore = useAudioStore();
const selected = computed(() => danmuStore.selected);

// ---- 音频片段检测 ----

/** 当前选中的且为音频类型的片段 */
const selectedAudioClip = computed(() => {
  if (!timelineStore.selectedClipId) return null;
  for (const track of timelineStore.tracks) {
    const clip = track.clips.find((c) => c.id === timelineStore.selectedClipId);
    if (clip && audioStore.audioResources.some((r) => r.id === clip.resourceId)) {
      return clip;
    }
  }
  return null;
});

/** 音频片段对应的资源 */
const selectedAudioResource = computed(() => {
  if (!selectedAudioClip.value) return null;
  return audioStore.getById(selectedAudioClip.value.resourceId);
});

/** 音频片段的有效音量（dB） */
const audioVolumeDb = computed(() => {
  if (!selectedAudioClip.value) return 0;
  return timelineStore.getEffectiveVolume(selectedAudioClip.value);
});

/** 音频片段是否静音（元素级） */
const audioClipMuted = computed(() => {
  if (!selectedAudioClip.value) return false;
  return timelineStore.isClipMuted(selectedAudioClip.value);
});

/** 更新音频片段音量 */
function updateAudioVolume(db: number) {
  if (!selectedAudioClip.value) return;
  timelineStore.updateClipVolume(selectedAudioClip.value.id, Math.round(db / VOLUME_STEP) * VOLUME_STEP);
}

/** 切换音频片段静音 */
function toggleAudioClipMuted() {
  if (!selectedAudioClip.value) return;
  timelineStore.toggleClipMuted(selectedAudioClip.value.id);
}

const selectedClip = computed(() => {
    if (!timelineStore.selectedClipId) return null;
    for (const track of timelineStore.tracks) {
        const clip = track.clips.find(c => c.id === timelineStore.selectedClipId);
        if (clip) return clip;
    }
    return null;
});

type PropertyTabId = "identity" | "transform" | "style" | "animation";

const activeTab = ref<PropertyTabId>("identity");

const propertyTabs = [
  { id: "identity", label: "内容", title: "内容与标识", icon: FileText },
  { id: "transform", label: "变换", title: "几何变换", icon: Move },
  { id: "style", label: "样式", title: "样式与外观", icon: Palette },
  { id: "animation", label: "动画", title: "动画与关键帧", icon: Sparkles },
] as const;

const clipKeyframes = computed(() => {
  const clip = selectedClip.value;
  if (!clip) return [];

  const normalized = normalizeKeyframes(clip.keyframes, clip.duration);
  const resource = selected.value;
  if (!resource || clip.resourceId !== resource.id) return normalized;

  return normalized.map((keyframe) => ({
    ...keyframe,
    properties: pickKeyframePropertiesForResource(resource, keyframe.properties),
  }));
});

const activeKeyframeId = computed(() => timelineStore.selectedKeyframeId ?? BASE_KEYFRAME_ID);

const activeKeyframeProperties = computed<TimelineKeyframeProperties>(() => {
  if (!selected.value || !selectedClip.value) return {};
  return resolveKeyframeProperties(selected.value, selectedClip.value, activeKeyframeId.value);
});

const activeKeyframeStoredProperties = computed<TimelineKeyframeProperties>(() => {
  if (!selectedClip.value || activeKeyframeId.value === BASE_KEYFRAME_ID) return {};
  return clipKeyframes.value.find((keyframe) => keyframe.id === activeKeyframeId.value)?.properties ?? {};
});

const currentClipLocalTime = computed(() => {
  if (!selectedClip.value) return 0;
  return clampKeyframeTime(
    timelineStore.currentTime - selectedClip.value.startTime,
    selectedClip.value.duration
  );
});

const keyframeRows = computed(() => {
  if (!selected.value || !selectedClip.value) return [];

  return [
    {
      id: BASE_KEYFRAME_ID,
      index: 1,
      label: "基态",
      timeMs: 0,
      isBase: true,
      properties: getBaseKeyframeProperties(selected.value),
    },
    ...clipKeyframes.value.map((keyframe, index) => ({
      id: keyframe.id,
      index: index + 2,
      label: `关键帧 ${index + 2}`,
      timeMs: keyframe.timeMs,
      isBase: false,
      properties: keyframe.properties,
    })),
  ];
});

watch(
  () => timelineStore.selectedKeyframeId,
  (keyframeId) => {
    if (keyframeId) {
      activeTab.value = "animation";
    }
  }
);

const selectKeyframe = (keyframeId: string) => {
  if (selectedClip.value) {
    timelineStore.setSelectedClip(selectedClip.value.id);
  }
  timelineStore.setSelectedKeyframe(keyframeId);
  activeTab.value = "animation";
};

const formatAnimationTime = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(2)}s`;

const getNextKeyframeTime = () => {
  if (!selectedClip.value) return 0;
  const lastKeyframe = clipKeyframes.value[clipKeyframes.value.length - 1];
  const lastTime = lastKeyframe?.timeMs ?? 0;
  const current = currentClipLocalTime.value > 0 ? currentClipLocalTime.value : lastTime + 1000;
  return clampKeyframeTime(current, selectedClip.value.duration);
};

const addKeyframe = () => {
  if (!selected.value || !selectedClip.value) return;
  const timeMs = getNextKeyframeTime();
  const snapshot = createKeyframeSnapshot(selected.value, selectedClip.value, timeMs);
  const keyframe = timelineStore.addClipKeyframe(selectedClip.value.id, snapshot);
  if (keyframe) {
    activeTab.value = "animation";
  }
};

const removeSelectedKeyframe = () => {
  if (!selectedClip.value || activeKeyframeId.value === BASE_KEYFRAME_ID) return;
  timelineStore.removeClipKeyframe(selectedClip.value.id, activeKeyframeId.value);
};

const updateKeyframeTime = (value: string | number) => {
  if (!selectedClip.value || activeKeyframeId.value === BASE_KEYFRAME_ID) return;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return;
  timelineStore.updateClipKeyframe(selectedClip.value.id, activeKeyframeId.value, {
    timeMs: parsed,
  });
};

const updateKeyframeProperty = (
  key: keyof TimelineKeyframeProperties,
  value: string | number,
  asNumber = true
) => {
  if (!selected.value || !selectedClip.value) return;

  const parsedValue = asNumber ? Number(value) : value;
  if (asNumber && !Number.isFinite(parsedValue as number)) return;

  if (tryAutoKeyframeProperty(key, parsedValue)) return;

  if (
    timelineStore.autoKeyframe &&
    selected.value &&
    selectedClip.value?.resourceId === selected.value.id
  ) {
    updateResourceField(key, parsedValue);
    return;
  }

  if (activeKeyframeId.value === BASE_KEYFRAME_ID) {
    updateResourceField(key, parsedValue);
    return;
  }

  timelineStore.updateClipKeyframe(selectedClip.value.id, activeKeyframeId.value, {
    properties: {
      ...activeKeyframeStoredProperties.value,
      [key]: parsedValue,
    },
  });
};

const updateKeyframeColor = (key: keyof TimelineKeyframeProperties, htmlHex: string) => {
  updateKeyframeProperty(key, "0x" + htmlHex.replace("#", ""), false);
};

const activeKeyframeText = computed(() =>
  selected.value?.type === "button"
    ? activeKeyframeProperties.value.text
    : activeKeyframeProperties.value.content
);

const updateKeyframeText = (value: string | number) => {
  updateKeyframeProperty(selected.value?.type === "button" ? "text" : "content", value, false);
};

watch(selectedClip, (clip) => {
  if (clip && activeTab.value === "animation" && !timelineStore.selectedKeyframeId) {
    timelineStore.setSelectedKeyframe(BASE_KEYFRAME_ID);
  }
});

// ... (Existing helpers remain the same) ...
// 类型名称映射
const typeNames: Record<string, string> = {
  text: "文本弹幕",
  button: "按钮弹幕",
  path: "路径弹幕",
};

const updateResourceField = (key: string, value: unknown) => {
  danmuStore.updateSelected({ [key]: value } as Partial<AnyDanmu>);
};

const tryAutoKeyframeProperty = (key: string, value: unknown) => {
  const resource = selected.value;
  const clip = selectedClip.value;
  if (
    !timelineStore.autoKeyframe ||
    !resource ||
    !clip ||
    clip.resourceId !== resource.id
  ) {
    return false;
  }

  const properties = pickKeyframePropertiesForResource(
    resource,
    { [key]: value } as Partial<AnyDanmu>
  );
  if (Object.keys(properties).length === 0) return false;

  const rawLocalTimeMs = timelineStore.currentTime - clip.startTime;
  if (rawLocalTimeMs <= 0 || rawLocalTimeMs > clip.duration) return false;
  const localTimeMs = clampKeyframeTime(rawLocalTimeMs, clip.duration);

  timelineStore.upsertClipKeyframeAtTime(clip.id, localTimeMs, properties);
  return true;
};

// 更新字段的辅助函数
const updateField = (key: string, value: any, asNumber: boolean = false) => {
  let nextValue = value;
  if (asNumber) {
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return;
    nextValue = parsed;
  }

  if (tryAutoKeyframeProperty(key, nextValue)) return;
  updateResourceField(key, nextValue);
};

const updateDuration = (value: string | number) => {
  const durationMs = Number(value);
  if (!Number.isFinite(durationMs)) return;

  const nextDuration = Math.max(0, durationMs);
  danmuStore.updateSelected({ durationMs: nextDuration } as Partial<AnyDanmu>);

  // The resource duration is the default, while an on-canvas danmu is rendered
  // according to its timeline clip. Keep the active clip in sync when it uses
  // this selected resource so the change takes effect immediately.
  if (selected.value && selectedClip.value?.resourceId === selected.value.id) {
    timelineStore.updateClip(selectedClip.value.id, { duration: nextDuration });
  }
};

type PercentageField = "x" | "y" | "fontSize" | "width" | "height";
type KeyframePercentageField = Extract<PercentageField, "x" | "y" | "fontSize">;
type AnchorAxis = "x" | "y";

const anchorPercentageMode = ref<Record<AnchorAxis, boolean>>({ x: true, y: true });

const isPercentageValue = (field: PercentageField) => {
  const value = (selected.value as Record<string, unknown> | null)?.[field];
  return typeof value === "string" && value.trim().endsWith("%");
};

const setPercentageMode = (field: PercentageField, enabled: boolean) => {
  const value = (selected.value as Record<string, unknown> | null)?.[field];
  const numericValue = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(numericValue)) return;

  updateField(field, enabled ? `${numericValue}%` : numericValue);
};

const getAnchorValue = (axis: AnchorAxis) => {
  const key = axis === "x" ? "anchorX" : "anchorY";
  const value = selected.value?.[key] ?? 0;
  return anchorPercentageMode.value[axis] ? value * 100 : value;
};

const updateAnchorValue = (axis: AnchorAxis, value: string | number) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return;

  const normalizedValue = anchorPercentageMode.value[axis]
    ? numericValue / 100
    : numericValue;
  const key = axis === "x" ? "anchorX" : "anchorY";
  danmuStore.updateSelected({
    [key]: Math.min(1, Math.max(0, normalizedValue)),
  } as Partial<AnyDanmu>);
};

const isKeyframePercentageValue = (field: KeyframePercentageField) => {
  const value = activeKeyframeProperties.value[field];
  return typeof value === "string" && value.trim().endsWith("%");
};

const updateKeyframePercentageValue = (field: KeyframePercentageField, value: string | number) => {
  const numericValue = Number.parseFloat(String(value));
  if (!Number.isFinite(numericValue)) return;
  updateKeyframeProperty(field, isKeyframePercentageValue(field) ? `${numericValue}%` : numericValue, false);
};

const setKeyframePercentageMode = (field: KeyframePercentageField, enabled: boolean) => {
  const value = activeKeyframeProperties.value[field];
  const numericValue = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(numericValue)) return;
  updateKeyframeProperty(field, enabled ? `${numericValue}%` : numericValue, false);
};

// --- 颜色辅助函数 ---
const toHtmlColor = (val: string | number | undefined): string => {
  if (val === undefined) return "#000000";
  let hexStr = "";
  if (typeof val === "number") {
    hexStr = val.toString(16).padStart(6, "0");
  } else if (typeof val === "string") {
    if (val.startsWith("0x") || val.startsWith("0X")) {
      hexStr = val.slice(2);
    } else if (val.startsWith("#")) {
      return val;
    } else {
      return "#000000";
    }
  }
  return "#" + hexStr;
};

const updateColor = (key: string, htmlHex: string, asNumber: boolean) => {
  const cleanHex = htmlHex.replace("#", "");
  updateField(key, asNumber ? parseInt(cleanHex, 16) : "0x" + cleanHex);
};

const updateButtonAV = (val: string | number) => {
  const av = typeof val === 'string' ? parseInt(val) : val;
  if (!isNaN(av)) {
      danmuStore.updateSelected({
          target: { av: { av, page: 1, timeMs: 0 } }
      } as Partial<AnyDanmu>);
  }
}

const updateBoolean = (key: string, value: boolean) => {
  danmuStore.updateSelected({ [key]: value ? 1 : 0 } as Partial<AnyDanmu>);
};

const getButtonAV = (item: any): number | undefined => {
    if (item.target && 'av' in item.target) {
        return item.target.av.av;
    }
    return undefined;
}
</script>

<template>
  <div
    class="panel h-full w-full bg-background border border-border rounded-sm overflow-hidden flex flex-col text-sm"
    data-ui="properties-panel"
  >
    <!-- 头部 -->
    <div
      class="h-11 border-b border-border flex items-center px-3 font-medium text-foreground justify-between shrink-0 bg-background"
    >
      <div class="flex items-center gap-2">
          <span>属性设置</span>
      </div>
      <Settings class="size-4 text-muted-foreground" />
    </div>

    <!-- 常规资源编辑模式 -->
    <div v-if="selected" class="flex-1 min-h-0 flex overflow-hidden">
      <div class="min-w-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-hidden p-3">
        <!-- 第一阶段：内容与身份 (根据类型自适应) -->
        <div
          v-show="activeTab === 'identity'"
          id="properties-tab-identity"
          role="tabpanel"
          class="space-y-4 pb-10"
        >
        <div class="flex items-center justify-between select-none">
            <Label class="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-2 cursor-pointer">
            <span class="w-1 h-3 bg-primary rounded-full"></span>
            内容与标识
            </Label>
        </div>
        
        <div class="space-y-3 pt-1">
          <!-- 公共：自定义名称 -->
          <div class="space-y-1">
            <span class="text-[10px] text-muted-foreground uppercase font-medium">资源名称 (Identity Name)</span>
            <Input
              :model-value="selected.name"
              @update:model-value="(v) => updateField('name', v)"
              placeholder="用于资源列表显示的名称"
              class="h-8 text-xs"
            />
          </div>

          <!-- 文本特有：内容 -->
          <div v-if="selected.type === 'text'" class="space-y-1">
            <span class="text-[10px] text-muted-foreground uppercase font-medium">文本内容 (Content)</span>
            <Textarea
              :model-value="(selected as any).content"
              @update:model-value="(v) => updateField('content', v)"
              class="min-h-20 text-xs resize-y leading-extended"
              placeholder="请输入弹幕文本..."
            />
          </div>

          <!-- 按钮特有：文本与跳转 -->
          <template v-if="selected.type === 'button'">
            <div class="space-y-1">
              <span class="text-[10px] text-muted-foreground uppercase font-medium">按钮文字 (Display Text)</span>
              <Input
                :model-value="(selected as any).text"
                @update:model-value="(v) => updateField('text', v)"
                class="h-8 text-xs"
                placeholder="按钮上显示的文字"
              />
            </div>
            <div class="space-y-1">
              <span class="text-[10px] text-muted-foreground uppercase font-medium">跳转 AV 号 (Target AV)</span>
              <Input
                type="number"
                :model-value="getButtonAV(selected)"
                @update:model-value="updateButtonAV"
                class="h-8 text-xs font-mono"
                placeholder="例如: 1714157"
              />
            </div>
          </template>

          <!-- 路径特有：路径与画布 -->
          <template v-if="selected.type === 'path'">
            <div class="space-y-1">
              <span class="text-[10px] text-muted-foreground uppercase font-medium">SVG 路径 (Path Data - d)</span>
              <Textarea
                :model-value="(selected as any).d"
                @update:model-value="(v) => updateField('d', v)"
                class="min-h-20 text-xs font-mono resize-y"
                placeholder="M0 0 L10 10..."
              />
            </div>
            <div class="space-y-1">
              <span class="text-[10px] text-muted-foreground uppercase font-medium">画布范围 (ViewBox)</span>
              <Input
                :model-value="(selected as any).viewBox"
                @update:model-value="(v) => updateField('viewBox', v)"
                class="h-8 text-xs font-mono"
                placeholder="0 0 100 100"
              />
            </div>
          </template>
        </div>
      </div>

        <!-- 第二阶段：几何变换 (Transform) -->
        <div
          v-show="activeTab === 'transform'"
          id="properties-tab-transform"
          role="tabpanel"
          class="space-y-4 pb-10"
        >
        <div class="flex items-center justify-between select-none">
            <Label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2 cursor-pointer">
            <span class="w-1 h-3 bg-muted-foreground/50 rounded-full"></span>
            几何变换
            </Label>
        </div>
        
        <div class="space-y-3 pt-1">
            <div class="grid grid-cols-2 gap-x-4 gap-y-3">
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">X 坐标</span>
                <div class="flex gap-2">
                  <Input :model-value="selected.x" @update:model-value="(v) => updateField('x', v)" class="h-7 min-w-0 flex-1 text-xs font-mono bg-accent" />
                  <label class="flex items-center gap-1 text-[10px] text-muted-foreground" title="按画布宽度的百分比定位"><Switch :model-value="isPercentageValue('x')" @update:model-value="setPercentageMode('x', $event)" />%</label>
                </div>
            </div>
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">Y 坐标</span>
                <div class="flex gap-2">
                  <Input :model-value="selected.y" @update:model-value="(v) => updateField('y', v)" class="h-7 min-w-0 flex-1 text-xs font-mono bg-accent" />
                  <label class="flex items-center gap-1 text-[10px] text-muted-foreground" title="按画布高度的百分比定位"><Switch :model-value="isPercentageValue('y')" @update:model-value="setPercentageMode('y', $event)" />%</label>
                </div>
            </div>
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">缩放 (Scale)</span>
                <Input type="number" step="0.1" :model-value="selected.scale" @update:model-value="(v) => updateField('scale', v, true)" class="h-7 text-xs font-mono" />
            </div>
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">层级 (Z-Index)</span>
                <Input type="number" step="1" :model-value="selected.zIndex" @update:model-value="(v) => updateField('zIndex', v, true)" class="h-7 text-xs font-mono" />
            </div>
            </div>

            <div class="grid grid-cols-2 gap-4 pt-1">
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">锚点 X</span>
                <div class="flex gap-2">
                  <Input type="number" :step="anchorPercentageMode.x ? 1 : 0.01" :model-value="getAnchorValue('x')" @update:model-value="(v) => updateAnchorValue('x', v)" class="h-7 min-w-0 flex-1 text-xs font-mono" />
                  <label class="flex items-center gap-1 text-[10px] text-muted-foreground" title="以百分比编辑锚点；BAS 会保存为 0–1 的归一化值"><Switch v-model="anchorPercentageMode.x" />%</label>
                </div>
            </div>
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">锚点 Y</span>
                <div class="flex gap-2">
                  <Input type="number" :step="anchorPercentageMode.y ? 1 : 0.01" :model-value="getAnchorValue('y')" @update:model-value="(v) => updateAnchorValue('y', v)" class="h-7 min-w-0 flex-1 text-xs font-mono" />
                  <label class="flex items-center gap-1 text-[10px] text-muted-foreground" title="以百分比编辑锚点；BAS 会保存为 0–1 的归一化值"><Switch v-model="anchorPercentageMode.y" />%</label>
                </div>
            </div>
            </div>

            <div class="grid grid-cols-3 gap-2 pt-1">
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">旋转 X</span>
                <Input type="number" :model-value="selected.rotateX" @update:model-value="(v) => updateField('rotateX', v, true)" class="h-7 text-xs font-mono" />
            </div>
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">旋转 Y</span>
                <Input type="number" :model-value="selected.rotateY" @update:model-value="(v) => updateField('rotateY', v, true)" class="h-7 text-xs font-mono" />
            </div>
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">旋转 Z</span>
                <Input type="number" :model-value="selected.rotateZ" @update:model-value="(v) => updateField('rotateZ', v, true)" class="h-7 text-xs font-mono" />
            </div>
            </div>
        </div>
      </div>

        <!-- 第三阶段：外观、样式与时间 -->
        <div
          v-show="activeTab === 'style'"
          id="properties-tab-style"
          role="tabpanel"
          class="space-y-4 pb-10"
        >
        <div class="flex items-center justify-between select-none">
            <Label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2 cursor-pointer">
            <span class="w-1 h-3 bg-muted-foreground/50 rounded-full"></span>
            样式与外观
            </Label>
        </div>

        <div class="space-y-4 pt-1">
            <!-- 通用：不透明度与时长 -->
            <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1">
                <div class="flex justify-between items-center mb-1">
                    <span class="text-[10px] text-muted-foreground uppercase">不透明度</span>
                    <span class="text-[10px] text-muted-foreground font-mono">{{ ((selected.opacity ?? 1) * 100).toFixed(0) }}%</span>
                </div>
                <Slider
                    :model-value="[selected.opacity ?? 1]" :max="1" :step="0.01"
                    @update:model-value="(v) => v && updateField('opacity', v[0], true)"
                    class="w-full h-7"
                />
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">持续时间 (ms)</span>
                    <Input type="number" step="100" :model-value="selected.durationMs" @update:model-value="updateDuration" class="h-7 text-xs font-mono" />
                </div>
            </div>

            <!-- 文本样式 -->
            <div v-if="selected.type === 'text'" class="space-y-4 pt-2">
            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">字号</span>
                    <div class="flex gap-2">
                      <Input :model-value="(selected as any).fontSize" @update:model-value="(v) => updateField('fontSize', v)" class="h-7 min-w-0 flex-1 text-xs font-mono" />
                      <label class="flex items-center gap-1 text-[10px] text-muted-foreground" title="按画布宽度的百分比设置字号"><Switch :model-value="isPercentageValue('fontSize')" @update:model-value="setPercentageMode('fontSize', $event)" />%</label>
                    </div>
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">字体</span>
                    <Input :model-value="(selected as any).fontFamily" @update:model-value="(v) => updateField('fontFamily', v)" class="h-7 text-xs" />
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">文字颜色</span>
                    <div class="flex gap-2">
                        <Input type="color" :model-value="toHtmlColor((selected as any).color)" @input="(e: Event) => updateColor('color', (e.target as HTMLInputElement).value, false)" class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer shrink-0" />
                        <Input :model-value="(selected as any).color" @update:model-value="(v) => updateField('color', v)" class="h-7 text-[10px] font-mono flex-1" />
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">粗体</span>
                    <div class="h-7 flex items-center">
                        <button
                            type="button"
                            role="switch"
                            :aria-checked="!!(selected as any).bold"
                            @click="updateBoolean('bold', !(selected as any).bold)"
                            class="peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                            :class="!!(selected as any).bold ? 'bg-primary' : 'bg-input'"
                        >
                            <span
                            class="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform"
                            :class="!!(selected as any).bold ? 'translate-x-4' : 'translate-x-0'"
                            />
                        </button>
                    </div>
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">阴影</span>
                    <div class="h-7 flex items-center">
                        <button
                            type="button"
                            role="switch"
                            :aria-checked="!!(selected as any).textShadow"
                            @click="updateBoolean('textShadow', !(selected as any).textShadow)"
                            class="peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                            :class="!!(selected as any).textShadow ? 'bg-primary' : 'bg-input'"
                        >
                            <span
                            class="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform"
                            :class="!!(selected as any).textShadow ? 'translate-x-4' : 'translate-x-0'"
                            />
                        </button>
                    </div>
                </div>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">描边颜色</span>
                    <div class="flex gap-2">
                        <Input type="color" :model-value="toHtmlColor((selected as any).strokeColor)" @input="(e: Event) => updateColor('strokeColor', (e.target as HTMLInputElement).value, false)" class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer shrink-0" />
                        <Input :model-value="(selected as any).strokeColor" @update:model-value="(v) => updateField('strokeColor', v)" class="h-7 text-[10px] font-mono flex-1" />
                    </div>
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">描边宽度</span>
                    <Input type="number" step="0.5" :model-value="(selected as any).strokeWidth" @update:model-value="(v) => updateField('strokeWidth', v, true)" class="h-7 text-xs font-mono" />
                </div>
            </div>
            </div>

            <!-- 按钮样式 -->
            <div v-if="selected.type === 'button'" class="space-y-4 pt-2">
            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">字号</span>
                    <div class="flex gap-2">
                      <Input :model-value="(selected as any).fontSize" @update:model-value="(v) => updateField('fontSize', v)" class="h-7 min-w-0 flex-1 text-xs font-mono" />
                      <label class="flex items-center gap-1 text-[10px] text-muted-foreground" title="按画布宽度的百分比设置字号"><Switch :model-value="isPercentageValue('fontSize')" @update:model-value="setPercentageMode('fontSize', $event)" />%</label>
                    </div>
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">文字颜色</span>
                    <div class="flex items-center gap-2">
                    <Input type="color" :model-value="toHtmlColor((selected as any).textColor)" @input="(e: Event) => updateColor('textColor', (e.target as HTMLInputElement).value, true)" class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer shrink-0" />
                    <span class="text-[10px] font-mono uppercase">{{ toHtmlColor((selected as any).textColor) }}</span>
                    </div>
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">填充颜色</span>
                    <div class="flex items-center gap-2">
                    <Input type="color" :model-value="toHtmlColor((selected as any).fillColor)" @input="(e: Event) => updateColor('fillColor', (e.target as HTMLInputElement).value, true)" class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer shrink-0" />
                    <span class="text-[10px] font-mono uppercase">{{ toHtmlColor((selected as any).fillColor) }}</span>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">文字透</span>
                    <Input type="number" step="0.1" :min="0" :max="1" :model-value="(selected as any).textAlpha" @update:model-value="(v) => updateField('textAlpha', v, true)" class="h-7 text-[10px] font-mono" />
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">填充透</span>
                    <Input type="number" step="0.1" :min="0" :max="1" :model-value="(selected as any).fillAlpha" @update:model-value="(v) => updateField('fillAlpha', v, true)" class="h-7 text-[10px] font-mono" />
                </div>
                </div>
            </div>
            </div>

            <!-- 路径样式 -->
            <div v-if="selected.type === 'path'" class="space-y-4 pt-2">
            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">宽度 (Width)</span>
                    <div class="flex gap-2">
                      <Input :model-value="(selected as any).width" @update:model-value="(v) => updateField('width', v)" class="h-7 min-w-0 flex-1 text-xs font-mono" />
                      <label class="flex items-center gap-1 text-[10px] text-muted-foreground" title="按画布宽度的百分比设置；需要 ViewBox"><Switch :model-value="isPercentageValue('width')" @update:model-value="setPercentageMode('width', $event)" />%</label>
                    </div>
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">高度 (Height)</span>
                    <div class="flex gap-2">
                      <Input :model-value="(selected as any).height" @update:model-value="(v) => updateField('height', v)" class="h-7 min-w-0 flex-1 text-xs font-mono" />
                      <label class="flex items-center gap-1 text-[10px] text-muted-foreground" title="按画布高度的百分比设置；需要 ViewBox"><Switch :model-value="isPercentageValue('height')" @update:model-value="setPercentageMode('height', $event)" />%</label>
                    </div>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">填充颜色</span>
                    <div class="flex items-center gap-2">
                    <Input type="color" :model-value="toHtmlColor((selected as any).fillColor)" @input="(e: Event) => updateColor('fillColor', (e.target as HTMLInputElement).value, true)" class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer shrink-0" />
                    <span class="text-[10px] font-mono uppercase">{{ toHtmlColor((selected as any).fillColor) }}</span>
                    </div>
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">填充透明度</span>
                    <Input type="number" step="0.1" :min="0" :max="1" :model-value="(selected as any).fillAlpha" @update:model-value="(v) => updateField('fillAlpha', v, true)" class="h-7 text-xs font-mono" />
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">描边颜色</span>
                    <div class="flex items-center gap-2">
                    <Input type="color" :model-value="toHtmlColor((selected as any).borderColor)" @input="(e: Event) => updateColor('borderColor', (e.target as HTMLInputElement).value, true)" class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer shrink-0" />
                    <span class="text-[10px] font-mono uppercase">{{ toHtmlColor((selected as any).borderColor) }}</span>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">描边宽</span>
                    <Input type="number" step="0.5" :model-value="(selected as any).borderWidth" @update:model-value="(v) => updateField('borderWidth', v, true)" class="h-7 text-[10px] font-mono" />
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">描边透</span>
                    <Input type="number" step="0.1" :min="0" :max="1" :model-value="(selected as any).borderAlpha" @update:model-value="(v) => updateField('borderAlpha', v, true)" class="h-7 text-[10px] font-mono" />
                </div>
                </div>
            </div>
            </div>
        </div>
      </div>

        <!-- 第四阶段：动画与关键帧 -->
        <div
          v-show="activeTab === 'animation'"
          id="properties-tab-animation"
          role="tabpanel"
          class="space-y-4 pb-10"
        >
          <div class="flex items-center justify-between select-none">
            <Label class="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-2 cursor-pointer">
              <span class="w-1 h-3 bg-primary rounded-full"></span>
              动画与关键帧
            </Label>
            <label class="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Switch
                :model-value="timelineStore.autoKeyframe"
                @update:model-value="timelineStore.setAutoKeyframe"
              />
              自动
            </label>
          </div>

          <div v-if="selectedClip" class="space-y-4 pt-1">
            <div class="grid grid-cols-[1fr_auto] gap-2">
              <div class="rounded-sm border border-border bg-accent/40 px-2.5 py-2">
                <div class="text-[10px] text-muted-foreground uppercase">播放头局部时间</div>
                <div class="mt-1 font-mono text-xs text-foreground">
                  {{ formatAnimationTime(currentClipLocalTime) }}
                </div>
              </div>
              <button
                @click="addKeyframe"
                class="h-full min-w-9 rounded-sm border border-border bg-accent hover:bg-primary/10 hover:text-primary transition-colors inline-flex items-center justify-center"
                title="在播放头添加关键帧"
                aria-label="在播放头添加关键帧"
              >
                <Plus class="size-4" />
              </button>
            </div>

            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-[10px] text-muted-foreground uppercase font-medium">关键帧</span>
                <span class="text-[10px] text-muted-foreground font-mono">{{ keyframeRows.length }}</span>
              </div>

              <button
                v-for="keyframe in keyframeRows"
                :key="keyframe.id"
                type="button"
                class="w-full rounded-sm border px-2.5 py-2 text-left transition-colors"
                :class="activeKeyframeId === keyframe.id
                  ? 'border-primary/50 bg-primary/10 text-foreground'
                  : 'border-border bg-accent/40 hover:border-border/80 hover:bg-accent text-muted-foreground'"
                @click="selectKeyframe(keyframe.id)"
              >
                <div class="flex min-w-0 items-center justify-between gap-2">
                  <div class="flex min-w-0 items-center gap-2">
                    <span
                      class="size-2 rotate-45 rounded-[1px] shrink-0"
                      :class="keyframe.isBase ? 'bg-muted-foreground' : 'bg-primary'"
                    ></span>
                    <span class="truncate text-xs font-medium text-foreground">
                      {{ keyframe.label }}
                    </span>
                  </div>
                  <span class="shrink-0 text-[10px] font-mono text-muted-foreground">
                    {{ formatAnimationTime(keyframe.timeMs) }}
                  </span>
                </div>
                <div class="mt-1 truncate text-[10px] text-muted-foreground">
                  {{ Object.keys(keyframe.properties).join(', ') || '基础状态' }}
                </div>
              </button>
            </div>

            <div class="space-y-4 border-t border-border/70 pt-4">
              <div class="flex items-center justify-between">
                <Label class="text-xs font-semibold text-primary uppercase tracking-wider">
                  {{ activeKeyframeId === BASE_KEYFRAME_ID ? '基态属性' : '关键帧属性' }}
                </Label>
                <button
                  v-if="activeKeyframeId !== BASE_KEYFRAME_ID"
                  @click="removeSelectedKeyframe"
                  class="text-destructive hover:bg-destructive/10 size-7 rounded-sm inline-flex items-center justify-center transition-colors"
                  title="删除关键帧"
                >
                  <Trash2 class="size-4" />
                </button>
              </div>

              <div class="grid gap-3" :class="selected.type === 'text' ? 'grid-cols-2' : 'grid-cols-1'">
                <div class="space-y-1">
                  <Label class="text-[10px] text-muted-foreground uppercase">时间 (ms)</Label>
                  <Input
                    type="number"
                    step="100"
                    :disabled="activeKeyframeId === BASE_KEYFRAME_ID"
                    :model-value="activeKeyframeId === BASE_KEYFRAME_ID ? 0 : keyframeRows.find((item) => item.id === activeKeyframeId)?.timeMs"
                    @update:model-value="updateKeyframeTime"
                    class="h-8 text-xs font-mono"
                  />
                </div>
                <div v-if="selected.type === 'text'" class="space-y-1">
                  <Label class="text-[10px] text-muted-foreground uppercase">不透明度</Label>
                  <Input
                    type="number"
                    step="0.1"
                    :min="0"
                    :max="1"
                    :model-value="activeKeyframeProperties.opacity"
                    @update:model-value="(v) => updateKeyframeProperty('opacity', v)"
                    class="h-8 text-xs font-mono"
                  />
                </div>
              </div>

              <div v-if="selected.type === 'text' || selected.type === 'button'" class="space-y-1">
                <Label class="text-[10px] text-muted-foreground uppercase">
                  {{ selected.type === 'text' ? '文本内容' : '按钮文字' }}
                </Label>
                <Input
                  :model-value="activeKeyframeText"
                  @update:model-value="updateKeyframeText"
                  class="h-8 text-xs"
                />
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div class="space-y-1">
                  <Label class="text-[10px] text-muted-foreground uppercase">X 坐标</Label>
                  <div class="flex gap-2">
                    <Input :model-value="activeKeyframeProperties.x" @update:model-value="(v) => updateKeyframePercentageValue('x', v)" class="h-8 min-w-0 flex-1 text-xs font-mono" />
                    <label class="flex items-center gap-1 text-[10px] text-muted-foreground" title="按画布宽度的百分比设置关键帧"><Switch :model-value="isKeyframePercentageValue('x')" @update:model-value="setKeyframePercentageMode('x', $event)" />%</label>
                  </div>
                </div>
                <div class="space-y-1">
                  <Label class="text-[10px] text-muted-foreground uppercase">Y 坐标</Label>
                  <div class="flex gap-2">
                    <Input :model-value="activeKeyframeProperties.y" @update:model-value="(v) => updateKeyframePercentageValue('y', v)" class="h-8 min-w-0 flex-1 text-xs font-mono" />
                    <label class="flex items-center gap-1 text-[10px] text-muted-foreground" title="按画布高度的百分比设置关键帧"><Switch :model-value="isKeyframePercentageValue('y')" @update:model-value="setKeyframePercentageMode('y', $event)" />%</label>
                  </div>
                </div>
              </div>

              <div v-if="selected.type === 'text'" class="grid grid-cols-1 gap-3">
                <div class="space-y-1">
                  <Label class="text-[10px] text-muted-foreground uppercase">缩放</Label>
                  <Input
                    type="number"
                    step="0.1"
                    :model-value="activeKeyframeProperties.scale"
                    @update:model-value="(v) => updateKeyframeProperty('scale', v)"
                    class="h-8 text-xs font-mono"
                  />
                </div>
              </div>

              <div v-if="selected.type === 'text' || selected.type === 'button'" class="space-y-1">
                <Label class="text-[10px] text-muted-foreground uppercase">字号</Label>
                <div class="flex gap-2">
                  <Input :model-value="activeKeyframeProperties.fontSize" @update:model-value="(v) => updateKeyframePercentageValue('fontSize', v)" class="h-8 min-w-0 flex-1 text-xs font-mono" />
                  <label class="flex items-center gap-1 text-[10px] text-muted-foreground" title="按画布宽度的百分比设置关键帧字号"><Switch :model-value="isKeyframePercentageValue('fontSize')" @update:model-value="setKeyframePercentageMode('fontSize', $event)" />%</label>
                </div>
              </div>

              <div v-if="selected.type === 'text'" class="grid grid-cols-3 gap-2">
                <div class="space-y-1">
                  <span class="text-[10px] text-muted-foreground uppercase">旋转 X</span>
                  <Input type="number" :model-value="activeKeyframeProperties.rotateX" @update:model-value="(v) => updateKeyframeProperty('rotateX', v)" class="h-8 text-xs font-mono" />
                </div>
                <div class="space-y-1">
                  <span class="text-[10px] text-muted-foreground uppercase">旋转 Y</span>
                  <Input type="number" :model-value="activeKeyframeProperties.rotateY" @update:model-value="(v) => updateKeyframeProperty('rotateY', v)" class="h-8 text-xs font-mono" />
                </div>
                <div class="space-y-1">
                  <span class="text-[10px] text-muted-foreground uppercase">旋转 Z</span>
                  <Input type="number" :model-value="activeKeyframeProperties.rotateZ" @update:model-value="(v) => updateKeyframeProperty('rotateZ', v)" class="h-8 text-xs font-mono" />
                </div>
              </div>

              <div v-if="selected.type === 'text'" class="space-y-1">
                <Label class="text-[10px] text-muted-foreground uppercase">文本颜色</Label>
                <div class="flex items-center gap-2">
                  <Input
                    type="color"
                    :model-value="toHtmlColor(activeKeyframeProperties.color)"
                    @input="(e: Event) => updateKeyframeColor('color', (e.target as HTMLInputElement).value)"
                    class="h-8 w-9 p-0 border-0 overflow-hidden cursor-pointer shrink-0"
                  />
                  <Input
                    :model-value="activeKeyframeProperties.color"
                    @update:model-value="(v) => updateKeyframeProperty('color', v, false)"
                    class="h-8 text-[10px] font-mono"
                  />
                </div>
              </div>
            </div>
          </div>

          <div
            v-else
            class="rounded-sm border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground"
          >
            将资源添加到时间轴后可以编辑动画
          </div>
        </div>
      </div>

      <div
        class="w-14 shrink-0 border-l border-border bg-background/95 p-1.5 flex flex-col items-center gap-1"
        role="tablist"
        aria-label="属性分类"
      >
        <button
          v-for="tab in propertyTabs"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.id"
          :aria-controls="`properties-tab-${tab.id}`"
          :title="tab.title"
          class="group flex h-12 w-11 flex-col items-center justify-center gap-1 rounded-sm border text-[10px] leading-none transition-colors"
          :class="activeTab === tab.id
            ? 'border-primary/50 bg-primary/10 text-primary'
            : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'"
          @click="activeTab = tab.id"
        >
          <component :is="tab.icon" class="size-4 shrink-0" />
          <span class="max-w-full truncate">{{ tab.label }}</span>
        </button>
      </div>
    </div>

    <!-- 音频片段编辑模式 -->
    <div
      v-else-if="selectedAudioClip"
      class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-hidden p-3 space-y-4 pb-10"
    >
      <div class="flex items-center justify-between select-none">
        <Label class="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-2">
          <span class="w-1 h-3 bg-primary rounded-full"></span>
          音频片段属性
        </Label>
      </div>

      <div class="space-y-4 pt-1">
        <!-- 片段名称 -->
        <div class="rounded-sm border border-border bg-accent/40 px-3 py-3 space-y-2">
          <div class="flex items-center gap-2 text-xs text-muted-foreground">
            <Music2 class="size-3.5" />
            <span class="truncate font-medium text-foreground">{{ selectedAudioClip.name || '音频片段' }}</span>
          </div>
          <div v-if="selectedAudioResource" class="text-[10px] text-muted-foreground/70 truncate">
            {{ selectedAudioResource.file?.name ?? selectedAudioResource.name }}
          </div>
          <div class="text-[10px] text-muted-foreground/70">
            时长: {{ (selectedAudioClip.duration / 1000).toFixed(2) }}s
          </div>
        </div>

        <!-- 音量控制 -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <Label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Volume2 class="size-3" />
              音量
            </Label>
            <span class="text-xs font-mono text-muted-foreground">{{ formatNumberForDisplay(audioVolumeDb, 1) }} dB</span>
          </div>

          <div class="flex items-center gap-3">
            <span class="text-[10px] text-muted-foreground w-6 text-right">{{ VOLUME_DB_MIN }}</span>
            <Slider
              :model-value="[audioVolumeDb]"
              :min="VOLUME_DB_MIN"
              :max="VOLUME_DB_MAX"
              :step="VOLUME_STEP"
              @update:model-value="(v) => v && updateAudioVolume(v[0])"
              class="flex-1 h-7"
            />
            <span class="text-[10px] text-muted-foreground w-6">{{ VOLUME_DB_MAX }}</span>
          </div>
        </div>

        <!-- 静音切换 -->
        <div class="rounded-sm border border-border bg-accent/40 px-3 py-2.5 flex items-center justify-between">
          <span class="text-xs text-muted-foreground">静音此片段</span>
          <button
            type="button"
            role="switch"
            :aria-checked="audioClipMuted"
            @click="toggleAudioClipMuted"
            class="peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            :class="audioClipMuted ? 'bg-destructive' : 'bg-input'"
          >
            <span
              class="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform"
              :class="audioClipMuted ? 'translate-x-4' : 'translate-x-0'"
            />
          </button>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
      <div class="size-12 rounded-sm bg-accent flex items-center justify-center mb-3">
        <Settings class="size-6 opacity-50" />
      </div>
      <span class="font-medium">未选中</span>
      <span class="text-xs mt-1">在左侧列表中选择一个项目进行编辑</span>
    </div>
  </div>
</template>

<style scoped>
.scrollbar-custom::-webkit-scrollbar {
  width: 4px;
}

.scrollbar-custom::-webkit-scrollbar-track {
  background: transparent;
}

.scrollbar-custom::-webkit-scrollbar-thumb {
  background: color-mix(in oklab, var(--muted-foreground) 25%, transparent);
  border-radius: 20px;
}

.scrollbar-custom::-webkit-scrollbar-thumb:hover {
  background: color-mix(in oklab, var(--muted-foreground) 45%, transparent);
}
</style>
