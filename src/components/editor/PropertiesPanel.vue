<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
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
import { resolveDanmuDefaults } from "@/utils/danmuDefaults";
import {
  BASE_KEYFRAME_ID,
  clampKeyframeTime,
  createKeyframeSnapshot,
  getBaseKeyframeProperties,
  normalizeKeyframes,
  pickKeyframePropertiesForResource,
  resolveKeyframeProperties,
} from "@/utils/keyframes";

const { t } = useI18n();

const danmuStore = useDanmuStore();
const timelineStore = useTimelineStore();
const audioStore = useAudioStore();
const selected = computed(() => timelineStore.selectedClipIds.length > 1 ? null : danmuStore.selected);
const resolvedSelected = computed(() =>
  selected.value ? resolveDanmuDefaults(selected.value) : null
);

// ---- 音频片段检测 ----

/** 当前选中的且为音频类型的片段 */
const selectedAudioClip = computed(() => {
  if (timelineStore.selectedClipIds.length > 1) return null;
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
  return audioStore.getById(selectedAudioClip.value.kind === "resource" ? selectedAudioClip.value.resourceId : "");
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

const selectedGroup = computed(() => selectedClip.value?.kind === "group" ? selectedClip.value : null);
const isSelectedTrackLocked = computed(() => timelineStore.tracks.some((track) =>
  track.id === selectedClip.value?.trackId && track.locked
));
const updateGroupStart = (value: string | number) => {
  const startTime = Number(value);
  if (selectedGroup.value && Number.isFinite(startTime)) {
    timelineStore.updateClip(selectedGroup.value.id, { startTime });
  }
};

type PropertyTabId = "identity" | "transform" | "style" | "animation";

const activeTab = ref<PropertyTabId>("identity");

// Labels come from the message tree, so the list has to be computed: a plain
// array would freeze the strings of the locale active at setup time.
const propertyTabs = computed(() => [
  { id: "identity", label: t("properties.tabs.identity.label"), title: t("properties.tabs.identity.title"), icon: FileText },
  { id: "transform", label: t("properties.tabs.transform.label"), title: t("properties.tabs.transform.title"), icon: Move },
  { id: "style", label: t("properties.tabs.style.label"), title: t("properties.tabs.style.title"), icon: Palette },
  { id: "animation", label: t("properties.tabs.animation.label"), title: t("properties.tabs.animation.title"), icon: Sparkles },
] as const);

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
  if (!resolvedSelected.value || !selectedClip.value) return {};
  return resolveKeyframeProperties(
    resolvedSelected.value,
    selectedClip.value,
    activeKeyframeId.value
  );
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
  if (!resolvedSelected.value || !selectedClip.value) return [];

  return [
    {
      id: BASE_KEYFRAME_ID,
      index: 1,
      label: t("common.keyframeBase"),
      timeMs: 0,
      isBase: true,
      properties: getBaseKeyframeProperties(resolvedSelected.value),
    },
    ...clipKeyframes.value.map((keyframe, index) => ({
      id: keyframe.id,
      index: index + 2,
      label: t("common.keyframeLabel", { n: index + 2 }),
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
    const keyframe = keyframeRows.value.find(row => row.id === keyframeId);
    if (keyframe) {
      timelineStore.setCurrentTime(selectedClip.value.startTime + keyframe.timeMs);
    }
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
const typeNames = computed<Record<string, string>>(() => ({
  text: t("danmu.type.text"),
  button: t("danmu.type.button"),
  path: t("danmu.type.path"),
}));

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
const percentageModeOverrides = ref<Record<string, boolean>>({});
const keyframePercentageModeOverrides = ref<Record<string, boolean>>({});

const isUnsetValue = (value: unknown) =>
  value === undefined || value === null || value === "";

const getPercentageModeKey = (field: PercentageField) =>
  `${selected.value?.id ?? "none"}:${field}`;

const getRawPercentageValue = (field: PercentageField) =>
  (selected.value as Record<string, unknown> | null)?.[field];

const getPercentageInputValue = (
  field: PercentageField
): string | number | undefined => {
  const rawValue = getRawPercentageValue(field);
  if (field === "fontSize" && isUnsetValue(rawValue)) return "";
  const value = isUnsetValue(rawValue)
    ? (resolvedSelected.value as unknown as Record<string, unknown> | null)?.[field]
    : rawValue;
  return typeof value === "string" || typeof value === "number" ? value : undefined;
};

const isPercentageValue = (field: PercentageField) => {
  const override = percentageModeOverrides.value[getPercentageModeKey(field)];
  if (override !== undefined) return override;

  const value = getRawPercentageValue(field);
  if (isUnsetValue(value)) return true;
  return typeof value === "string" && value.trim().endsWith("%");
};

const updatePercentageValue = (field: PercentageField, value: string | number) => {
  const numericValue = Number.parseFloat(String(value));
  if (!Number.isFinite(numericValue)) return;

  updateField(field, isPercentageValue(field) ? `${numericValue}%` : numericValue);
};

const setPercentageMode = (field: PercentageField, enabled: boolean) => {
  percentageModeOverrides.value = {
    ...percentageModeOverrides.value,
    [getPercentageModeKey(field)]: enabled,
  };

  const value = getRawPercentageValue(field);
  if (isUnsetValue(value)) {
    const resolvedValue = (resolvedSelected.value as unknown as Record<string, unknown> | null)?.[field];
    const numericValue = Number.parseFloat(String(resolvedValue));
    if (!Number.isFinite(numericValue)) return;
    updateField(field, enabled ? `${numericValue}%` : numericValue);
    return;
  }

  const numericValue = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(numericValue)) return;

  updateField(field, enabled ? `${numericValue}%` : numericValue);
};

const getAnchorValue = (axis: AnchorAxis) => {
  const key = axis === "x" ? "anchorX" : "anchorY";
  const value = resolvedSelected.value?.[key] ?? 0;
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

const getKeyframePercentageSource = (field: KeyframePercentageField) => {
  let value = getRawPercentageValue(field);
  if (activeKeyframeId.value !== BASE_KEYFRAME_ID) {
    for (const keyframe of clipKeyframes.value) {
      const storedValue = keyframe.properties[field];
      if (!isUnsetValue(storedValue)) value = storedValue;
      if (keyframe.id === activeKeyframeId.value) break;
    }
  }
  return value;
};

const isKeyframePercentageValue = (field: KeyframePercentageField) => {
  const overrideKey = `${selectedClip.value?.id ?? "none"}:${activeKeyframeId.value}:${field}`;
  const override = keyframePercentageModeOverrides.value[overrideKey];
  if (override !== undefined) return override;

  const value = getKeyframePercentageSource(field);
  if (isUnsetValue(value)) return true;
  return typeof value === "string" && value.trim().endsWith("%");
};

const getKeyframePercentageInputValue = (field: KeyframePercentageField) => {
  if (field === "fontSize" && isUnsetValue(getKeyframePercentageSource(field))) return "";
  return activeKeyframeProperties.value[field];
};

const updateKeyframePercentageValue = (field: KeyframePercentageField, value: string | number) => {
  const numericValue = Number.parseFloat(String(value));
  if (!Number.isFinite(numericValue)) return;
  updateKeyframeProperty(field, isKeyframePercentageValue(field) ? `${numericValue}%` : numericValue, false);
};

const setKeyframePercentageMode = (field: KeyframePercentageField, enabled: boolean) => {
  const overrideKey = `${selectedClip.value?.id ?? "none"}:${activeKeyframeId.value}:${field}`;
  keyframePercentageModeOverrides.value = {
    ...keyframePercentageModeOverrides.value,
    [overrideKey]: enabled,
  };

  const value = activeKeyframeId.value === BASE_KEYFRAME_ID
    ? getRawPercentageValue(field)
    : activeKeyframeStoredProperties.value[field];
  if (isUnsetValue(value)) {
    if (activeKeyframeId.value === BASE_KEYFRAME_ID) {
      setPercentageMode(field, enabled);
      return;
    }

    const effectiveValue = activeKeyframeProperties.value[field];
    const numericValue = Number.parseFloat(String(effectiveValue));
    if (!Number.isFinite(numericValue)) return;
    updateKeyframeProperty(field, enabled ? `${numericValue}%` : numericValue, false);
    return;
  }

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
          <span>{{ t('properties.title') }}</span>
      </div>
      <Settings class="size-4 text-muted-foreground" />
    </div>

    <!-- 常规资源编辑模式 -->
    <div v-if="timelineStore.selectedClipIds.length > 1" class="flex-1 overflow-y-auto p-3 space-y-3">
      <p class="font-medium">{{ t('groups.selection', { n: timelineStore.selectedClipIds.length }) }}</p>
      <p class="text-xs text-muted-foreground">{{ t('groups.selectionHint') }}</p>
      <button type="button" class="rounded-sm border border-border px-3 py-2 hover:bg-accent disabled:opacity-40"
        :disabled="!timelineStore.canCreateGroup()" @click="timelineStore.createGroup()">{{ t('groups.create') }}</button>
    </div>
    <div v-else-if="selectedGroup" class="flex-1 overflow-y-auto p-3 space-y-4" data-ui="group-properties">
      <div class="space-y-2">
        <Label for="group-name">{{ t('groups.name') }}</Label>
        <Input id="group-name" :model-value="selectedGroup.name" :disabled="isSelectedTrackLocked"
          @update:model-value="(value) => timelineStore.updateClip(selectedGroup!.id, { name: String(value) })" />
      </div>
      <div class="space-y-2">
        <Label for="group-start">{{ t('groups.start') }}</Label>
        <Input id="group-start" type="number" min="0" step="1" :model-value="selectedGroup.startTime"
          :disabled="isSelectedTrackLocked" @update:model-value="updateGroupStart" />
      </div>
      <div class="space-y-2">
        <Label>{{ t('groups.duration') }}</Label>
        <p class="font-mono">{{ (selectedGroup.duration / 1000).toFixed(3) }} s</p>
        <p class="text-xs text-muted-foreground">{{ t('groups.durationHint') }}</p>
      </div>
      <button type="button" class="rounded-sm border border-border px-3 py-2 hover:bg-accent"
        @click="timelineStore.enterGroup(selectedGroup.id)">{{ t('groups.enter') }}</button>
    </div>
    <div v-else-if="selected" class="flex-1 min-h-0 flex overflow-hidden">
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
            {{ t('properties.tabs.identity.title') }}
            </Label>
        </div>
        
        <div class="space-y-3 pt-1">
          <!-- 公共：自定义名称 -->
          <div class="space-y-1">
            <span class="text-[10px] text-muted-foreground uppercase font-medium">{{ t('properties.identity.name') }}</span>
            <Input
              :model-value="selected.name"
              @update:model-value="(v) => updateField('name', v)"
              :placeholder="t('properties.identity.namePlaceholder')"
              class="h-8 text-xs"
            />
          </div>

          <!-- 文本特有：内容 -->
          <div v-if="selected.type === 'text'" class="space-y-1">
            <span class="text-[10px] text-muted-foreground uppercase font-medium">{{ t('properties.identity.content') }}</span>
            <Textarea
              :model-value="(resolvedSelected as any)?.content"
              @update:model-value="(v) => updateField('content', v)"
              class="min-h-20 text-xs resize-y leading-extended"
              :placeholder="t('properties.identity.contentPlaceholder')"
            />
          </div>

          <!-- 按钮特有：文本与跳转 -->
          <template v-if="selected.type === 'button'">
            <div class="space-y-1">
              <span class="text-[10px] text-muted-foreground uppercase font-medium">{{ t('properties.identity.buttonText') }}</span>
              <Input
                :model-value="(resolvedSelected as any)?.text"
                @update:model-value="(v) => updateField('text', v)"
                class="h-8 text-xs"
                :placeholder="t('properties.identity.buttonTextPlaceholder')"
              />
            </div>
            <div class="space-y-1">
              <span class="text-[10px] text-muted-foreground uppercase font-medium">{{ t('properties.identity.targetAv') }}</span>
              <Input
                type="number"
                :model-value="getButtonAV(selected)"
                @update:model-value="updateButtonAV"
                class="h-8 text-xs font-mono"
                :placeholder="t('properties.identity.targetAvPlaceholder')"
              />
            </div>
          </template>

          <!-- 路径特有：路径与画布 -->
          <template v-if="selected.type === 'path'">
            <div class="space-y-1">
              <span class="text-[10px] text-muted-foreground uppercase font-medium">{{ t('properties.identity.pathData') }}</span>
              <Textarea
                :model-value="(resolvedSelected as any)?.d"
                @update:model-value="(v) => updateField('d', v)"
                class="min-h-20 text-xs font-mono resize-y"
                placeholder="M0 0 L10 10..."
              />
            </div>
            <div class="space-y-1">
              <span class="text-[10px] text-muted-foreground uppercase font-medium">{{ t('properties.identity.viewBox') }}</span>
              <Input
                :model-value="(resolvedSelected as any)?.viewBox"
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
            {{ t('properties.tabs.transform.title') }}
            </Label>
        </div>
        
        <div class="space-y-3 pt-1">
            <div class="grid grid-cols-2 gap-x-4 gap-y-3">
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.transform.x') }}</span>
                <div class="flex gap-2">
                  <Input :model-value="getPercentageInputValue('x')" @update:model-value="(v) => updatePercentageValue('x', v)" class="h-7 min-w-0 flex-1 text-xs font-mono bg-accent" />
                  <label class="flex items-center gap-1 text-[10px] text-muted-foreground" :title="t('properties.transform.xPercentHint')"><Switch :model-value="isPercentageValue('x')" @update:model-value="setPercentageMode('x', $event)" />%</label>
                </div>
            </div>
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.transform.y') }}</span>
                <div class="flex gap-2">
                  <Input :model-value="getPercentageInputValue('y')" @update:model-value="(v) => updatePercentageValue('y', v)" class="h-7 min-w-0 flex-1 text-xs font-mono bg-accent" />
                  <label class="flex items-center gap-1 text-[10px] text-muted-foreground" :title="t('properties.transform.yPercentHint')"><Switch :model-value="isPercentageValue('y')" @update:model-value="setPercentageMode('y', $event)" />%</label>
                </div>
            </div>
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.transform.scale') }}</span>
                <Input type="number" step="0.1" :model-value="resolvedSelected?.scale" @update:model-value="(v) => updateField('scale', v, true)" class="h-7 text-xs font-mono" />
            </div>
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.transform.zIndex') }}</span>
                <Input type="number" step="1" :model-value="resolvedSelected?.zIndex" @update:model-value="(v) => updateField('zIndex', v, true)" class="h-7 text-xs font-mono" />
            </div>
            </div>

            <div v-if="selected.type === 'text'" class="grid grid-cols-2 gap-4 pt-1">
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.transform.anchorX') }}</span>
                <div class="flex gap-2">
                  <Input type="number" :step="anchorPercentageMode.x ? 1 : 0.01" :model-value="getAnchorValue('x')" @update:model-value="(v) => updateAnchorValue('x', v)" class="h-7 min-w-0 flex-1 text-xs font-mono" />
                  <label class="flex items-center gap-1 text-[10px] text-muted-foreground" :title="t('properties.transform.anchorHint')"><Switch v-model="anchorPercentageMode.x" />%</label>
                </div>
            </div>
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.transform.anchorY') }}</span>
                <div class="flex gap-2">
                  <Input type="number" :step="anchorPercentageMode.y ? 1 : 0.01" :model-value="getAnchorValue('y')" @update:model-value="(v) => updateAnchorValue('y', v)" class="h-7 min-w-0 flex-1 text-xs font-mono" />
                  <label class="flex items-center gap-1 text-[10px] text-muted-foreground" :title="t('properties.transform.anchorHint')"><Switch v-model="anchorPercentageMode.y" />%</label>
                </div>
            </div>
            </div>

            <div v-if="selected.type === 'text'" class="grid grid-cols-3 gap-2 pt-1">
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.transform.rotateX') }}</span>
                <Input type="number" :model-value="resolvedSelected?.rotateX" @update:model-value="(v) => updateField('rotateX', v, true)" class="h-7 text-xs font-mono" />
            </div>
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.transform.rotateY') }}</span>
                <Input type="number" :model-value="resolvedSelected?.rotateY" @update:model-value="(v) => updateField('rotateY', v, true)" class="h-7 text-xs font-mono" />
            </div>
            <div class="space-y-1">
                <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.transform.rotateZ') }}</span>
                <Input type="number" :model-value="resolvedSelected?.rotateZ" @update:model-value="(v) => updateField('rotateZ', v, true)" class="h-7 text-xs font-mono" />
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
            {{ t('properties.tabs.style.title') }}
            </Label>
        </div>

        <div class="space-y-4 pt-1">
            <!-- 文本不透明度与通用时长 -->
            <div class="grid grid-cols-2 gap-4">
            <div v-if="selected.type === 'text'" class="space-y-1">
                <div class="flex justify-between items-center mb-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.opacity') }}</span>
                    <span class="text-[10px] text-muted-foreground font-mono">{{ ((resolvedSelected?.opacity ?? 1) * 100).toFixed(0) }}%</span>
                </div>
                <Slider
                    :model-value="[resolvedSelected?.opacity ?? 1]" :max="1" :step="0.01"
                    @update:model-value="(v) => v && updateField('opacity', v[0], true)"
                    class="w-full h-7"
                />
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.durationMs') }}</span>
                    <Input type="number" step="100" :model-value="selected.durationMs" @update:model-value="updateDuration" class="h-7 text-xs font-mono" />
                </div>
            </div>

            <!-- 文本样式 -->
            <div v-if="selected.type === 'text'" class="space-y-4 pt-2">
            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.fontSize') }}</span>
                    <div class="flex gap-2">
                      <Input :model-value="getPercentageInputValue('fontSize')" @update:model-value="(v) => updatePercentageValue('fontSize', v)" class="h-7 min-w-0 flex-1 text-xs font-mono" :placeholder="t('properties.style.fontSizePlaceholder')" />
                      <label class="flex items-center gap-1 text-[10px] text-muted-foreground" :title="t('properties.style.fontSizePercentHint')"><Switch :model-value="isPercentageValue('fontSize')" @update:model-value="setPercentageMode('fontSize', $event)" />%</label>
                    </div>
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.fontFamily') }}</span>
                    <Input :model-value="(resolvedSelected as any)?.fontFamily" @update:model-value="(v) => updateField('fontFamily', v)" class="h-7 text-xs" />
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.textColor') }}</span>
                    <div class="flex gap-2">
                        <Input type="color" :model-value="toHtmlColor((resolvedSelected as any)?.color)" @input="(e: Event) => updateColor('color', (e.target as HTMLInputElement).value, false)" class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer shrink-0" />
                        <Input :model-value="(resolvedSelected as any)?.color" @update:model-value="(v) => updateField('color', v)" class="h-7 text-[10px] font-mono flex-1" />
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.bold') }}</span>
                    <div class="h-7 flex items-center">
                        <button
                            type="button"
                            role="switch"
                            :aria-checked="!!(resolvedSelected as any)?.bold"
                            @click="updateBoolean('bold', !(resolvedSelected as any)?.bold)"
                            class="peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                            :class="!!(resolvedSelected as any)?.bold ? 'bg-primary' : 'bg-input'"
                        >
                            <span
                            class="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform"
                            :class="!!(resolvedSelected as any)?.bold ? 'translate-x-4' : 'translate-x-0'"
                            />
                        </button>
                    </div>
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.textShadow') }}</span>
                    <div class="h-7 flex items-center">
                        <button
                            type="button"
                            role="switch"
                            :aria-checked="!!(resolvedSelected as any)?.textShadow"
                            @click="updateBoolean('textShadow', !(resolvedSelected as any)?.textShadow)"
                            class="peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                            :class="!!(resolvedSelected as any)?.textShadow ? 'bg-primary' : 'bg-input'"
                        >
                            <span
                            class="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform"
                            :class="!!(resolvedSelected as any)?.textShadow ? 'translate-x-4' : 'translate-x-0'"
                            />
                        </button>
                    </div>
                </div>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.strokeColor') }}</span>
                    <div class="flex gap-2">
                        <Input type="color" :model-value="toHtmlColor((resolvedSelected as any)?.strokeColor)" @input="(e: Event) => updateColor('strokeColor', (e.target as HTMLInputElement).value, false)" class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer shrink-0" />
                        <Input :model-value="(resolvedSelected as any)?.strokeColor" @update:model-value="(v) => updateField('strokeColor', v)" class="h-7 text-[10px] font-mono flex-1" />
                    </div>
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.strokeWidth') }}</span>
                    <Input type="number" step="0.5" :model-value="(resolvedSelected as any)?.strokeWidth" @update:model-value="(v) => updateField('strokeWidth', v, true)" class="h-7 text-xs font-mono" />
                </div>
            </div>
            </div>

            <!-- 按钮样式 -->
            <div v-if="selected.type === 'button'" class="space-y-4 pt-2">
            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.fontSize') }}</span>
                    <div class="flex gap-2">
                      <Input :model-value="getPercentageInputValue('fontSize')" @update:model-value="(v) => updatePercentageValue('fontSize', v)" class="h-7 min-w-0 flex-1 text-xs font-mono" :placeholder="t('properties.style.fontSizePlaceholder')" />
                      <label class="flex items-center gap-1 text-[10px] text-muted-foreground" :title="t('properties.style.fontSizePercentHint')"><Switch :model-value="isPercentageValue('fontSize')" @update:model-value="setPercentageMode('fontSize', $event)" />%</label>
                    </div>
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.textColor') }}</span>
                    <div class="flex items-center gap-2">
                    <Input type="color" :model-value="toHtmlColor((resolvedSelected as any)?.textColor)" @input="(e: Event) => updateColor('textColor', (e.target as HTMLInputElement).value, true)" class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer shrink-0" />
                    <span class="text-[10px] font-mono uppercase">{{ toHtmlColor((resolvedSelected as any)?.textColor) }}</span>
                    </div>
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.fillColor') }}</span>
                    <div class="flex items-center gap-2">
                    <Input type="color" :model-value="toHtmlColor((resolvedSelected as any)?.fillColor)" @input="(e: Event) => updateColor('fillColor', (e.target as HTMLInputElement).value, true)" class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer shrink-0" />
                    <span class="text-[10px] font-mono uppercase">{{ toHtmlColor((resolvedSelected as any)?.fillColor) }}</span>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.buttonTextAlpha') }}</span>
                    <Input type="number" step="0.1" :min="0" :max="1" :model-value="(resolvedSelected as any)?.textAlpha" @update:model-value="(v) => updateField('textAlpha', v, true)" class="h-7 text-[10px] font-mono" />
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.buttonFillAlpha') }}</span>
                    <Input type="number" step="0.1" :min="0" :max="1" :model-value="(resolvedSelected as any)?.fillAlpha" @update:model-value="(v) => updateField('fillAlpha', v, true)" class="h-7 text-[10px] font-mono" />
                </div>
                </div>
            </div>
            </div>

            <!-- 路径样式 -->
            <div v-if="selected.type === 'path'" class="space-y-4 pt-2">
            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.width') }}</span>
                    <div class="flex gap-2">
                      <Input :model-value="getPercentageInputValue('width')" @update:model-value="(v) => updatePercentageValue('width', v)" class="h-7 min-w-0 flex-1 text-xs font-mono" />
                      <label class="flex items-center gap-1 text-[10px] text-muted-foreground" :title="t('properties.style.widthPercentHint')"><Switch :model-value="isPercentageValue('width')" @update:model-value="setPercentageMode('width', $event)" />%</label>
                    </div>
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.height') }}</span>
                    <div class="flex gap-2">
                      <Input :model-value="getPercentageInputValue('height')" @update:model-value="(v) => updatePercentageValue('height', v)" class="h-7 min-w-0 flex-1 text-xs font-mono" />
                      <label class="flex items-center gap-1 text-[10px] text-muted-foreground" :title="t('properties.style.heightPercentHint')"><Switch :model-value="isPercentageValue('height')" @update:model-value="setPercentageMode('height', $event)" />%</label>
                    </div>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.fillColor') }}</span>
                    <div class="flex items-center gap-2">
                    <Input type="color" :model-value="toHtmlColor((resolvedSelected as any)?.fillColor)" @input="(e: Event) => updateColor('fillColor', (e.target as HTMLInputElement).value, true)" class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer shrink-0" />
                    <span class="text-[10px] font-mono uppercase">{{ toHtmlColor((resolvedSelected as any)?.fillColor) }}</span>
                    </div>
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.pathFillAlpha') }}</span>
                    <Input type="number" step="0.1" :min="0" :max="1" :model-value="(resolvedSelected as any)?.fillAlpha" @update:model-value="(v) => updateField('fillAlpha', v, true)" class="h-7 text-xs font-mono" />
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.strokeColor') }}</span>
                    <div class="flex items-center gap-2">
                    <Input type="color" :model-value="toHtmlColor((resolvedSelected as any)?.borderColor)" @input="(e: Event) => updateColor('borderColor', (e.target as HTMLInputElement).value, true)" class="h-7 w-8 p-0 border-0 overflow-hidden cursor-pointer shrink-0" />
                    <span class="text-[10px] font-mono uppercase">{{ toHtmlColor((resolvedSelected as any)?.borderColor) }}</span>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.borderWidth') }}</span>
                    <Input type="number" step="0.5" :model-value="(resolvedSelected as any)?.borderWidth" @update:model-value="(v) => updateField('borderWidth', v, true)" class="h-7 text-[10px] font-mono" />
                </div>
                <div class="space-y-1">
                    <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.borderAlpha') }}</span>
                    <Input type="number" step="0.1" :min="0" :max="1" :model-value="(resolvedSelected as any)?.borderAlpha" @update:model-value="(v) => updateField('borderAlpha', v, true)" class="h-7 text-[10px] font-mono" />
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
              {{ t('properties.tabs.animation.title') }}
            </Label>
            <label class="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Switch
                :model-value="timelineStore.autoKeyframe"
                @update:model-value="timelineStore.setAutoKeyframe"
              />
              {{ t('properties.animation.autoKeyframe') }}
            </label>
          </div>

          <div v-if="selectedClip" class="space-y-4 pt-1">
            <div class="grid grid-cols-[1fr_auto] gap-2">
              <div class="rounded-sm border border-border bg-accent/40 px-2.5 py-2">
                <div class="text-[10px] text-muted-foreground uppercase">{{ t('properties.animation.localTime') }}</div>
                <div class="mt-1 font-mono text-xs text-foreground">
                  {{ formatAnimationTime(currentClipLocalTime) }}
                </div>
              </div>
              <button
                @click="addKeyframe"
                class="h-full min-w-9 rounded-sm border border-border bg-accent hover:bg-primary/10 hover:text-primary transition-colors inline-flex items-center justify-center"
                :title="t('properties.animation.addKeyframe')"
                :aria-label="t('properties.animation.addKeyframe')"
              >
                <Plus class="size-4" />
              </button>
            </div>

            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-[10px] text-muted-foreground uppercase font-medium">{{ t('properties.animation.keyframes') }}</span>
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
                  {{ Object.keys(keyframe.properties).join(', ') || t('properties.animation.baseState') }}
                </div>
              </button>
            </div>

            <div class="space-y-4 border-t border-border/70 pt-4">
              <div class="flex items-center justify-between">
                <Label class="text-xs font-semibold text-primary uppercase tracking-wider">
                  {{ activeKeyframeId === BASE_KEYFRAME_ID ? t('properties.animation.baseProperties') : t('properties.animation.keyframeProperties') }}
                </Label>
                <button
                  v-if="activeKeyframeId !== BASE_KEYFRAME_ID"
                  @click="removeSelectedKeyframe"
                  class="text-destructive hover:bg-destructive/10 size-7 rounded-sm inline-flex items-center justify-center transition-colors"
                  :title="t('properties.animation.removeKeyframe')"
                >
                  <Trash2 class="size-4" />
                </button>
              </div>

              <div class="grid gap-3" :class="selected.type === 'text' ? 'grid-cols-2' : 'grid-cols-1'">
                <div class="space-y-1">
                  <Label class="text-[10px] text-muted-foreground uppercase">{{ t('properties.animation.timeMs') }}</Label>
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
                  <Label class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.opacity') }}</Label>
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
                  {{ selected.type === 'text' ? t('properties.animation.textContent') : t('properties.animation.buttonText') }}
                </Label>
                <Input
                  :model-value="activeKeyframeText"
                  @update:model-value="updateKeyframeText"
                  class="h-8 text-xs"
                />
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div class="space-y-1">
                  <Label class="text-[10px] text-muted-foreground uppercase">{{ t('properties.transform.x') }}</Label>
                  <div class="flex gap-2">
                    <Input :model-value="getKeyframePercentageInputValue('x')" @update:model-value="(v) => updateKeyframePercentageValue('x', v)" class="h-8 min-w-0 flex-1 text-xs font-mono" />
                    <label class="flex items-center gap-1 text-[10px] text-muted-foreground" :title="t('properties.animation.xPercentHint')"><Switch :model-value="isKeyframePercentageValue('x')" @update:model-value="setKeyframePercentageMode('x', $event)" />%</label>
                  </div>
                </div>
                <div class="space-y-1">
                  <Label class="text-[10px] text-muted-foreground uppercase">{{ t('properties.transform.y') }}</Label>
                  <div class="flex gap-2">
                    <Input :model-value="getKeyframePercentageInputValue('y')" @update:model-value="(v) => updateKeyframePercentageValue('y', v)" class="h-8 min-w-0 flex-1 text-xs font-mono" />
                    <label class="flex items-center gap-1 text-[10px] text-muted-foreground" :title="t('properties.animation.yPercentHint')"><Switch :model-value="isKeyframePercentageValue('y')" @update:model-value="setKeyframePercentageMode('y', $event)" />%</label>
                  </div>
                </div>
              </div>

              <div v-if="selected.type === 'text'" class="grid grid-cols-1 gap-3">
                <div class="space-y-1">
                  <Label class="text-[10px] text-muted-foreground uppercase">{{ t('properties.animation.scale') }}</Label>
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
                <Label class="text-[10px] text-muted-foreground uppercase">{{ t('properties.style.fontSize') }}</Label>
                <div class="flex gap-2">
                  <Input :model-value="getKeyframePercentageInputValue('fontSize')" @update:model-value="(v) => updateKeyframePercentageValue('fontSize', v)" class="h-8 min-w-0 flex-1 text-xs font-mono" :placeholder="t('properties.animation.fontSizePlaceholder')" />
                  <label class="flex items-center gap-1 text-[10px] text-muted-foreground" :title="t('properties.animation.fontSizePercentHint')"><Switch :model-value="isKeyframePercentageValue('fontSize')" @update:model-value="setKeyframePercentageMode('fontSize', $event)" />%</label>
                </div>
              </div>

              <div v-if="selected.type === 'text'" class="grid grid-cols-3 gap-2">
                <div class="space-y-1">
                  <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.transform.rotateX') }}</span>
                  <Input type="number" :model-value="activeKeyframeProperties.rotateX" @update:model-value="(v) => updateKeyframeProperty('rotateX', v)" class="h-8 text-xs font-mono" />
                </div>
                <div class="space-y-1">
                  <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.transform.rotateY') }}</span>
                  <Input type="number" :model-value="activeKeyframeProperties.rotateY" @update:model-value="(v) => updateKeyframeProperty('rotateY', v)" class="h-8 text-xs font-mono" />
                </div>
                <div class="space-y-1">
                  <span class="text-[10px] text-muted-foreground uppercase">{{ t('properties.transform.rotateZ') }}</span>
                  <Input type="number" :model-value="activeKeyframeProperties.rotateZ" @update:model-value="(v) => updateKeyframeProperty('rotateZ', v)" class="h-8 text-xs font-mono" />
                </div>
              </div>

              <div v-if="selected.type === 'text'" class="space-y-1">
                <Label class="text-[10px] text-muted-foreground uppercase">{{ t('properties.animation.textColor') }}</Label>
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
            {{ t('properties.animation.noClipHint') }}
          </div>
        </div>
      </div>

      <div
        class="w-14 shrink-0 border-l border-border bg-background/95 p-1.5 flex flex-col items-center gap-1"
        role="tablist"
        :aria-label="t('properties.tabs.ariaLabel')"
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
          {{ t('properties.audio.title') }}
        </Label>
      </div>

      <div class="space-y-4 pt-1">
        <!-- 片段名称 -->
        <div class="rounded-sm border border-border bg-accent/40 px-3 py-3 space-y-2">
          <div class="flex items-center gap-2 text-xs text-muted-foreground">
            <Music2 class="size-3.5" />
            <span class="truncate font-medium text-foreground">{{ selectedAudioClip.name || t('properties.audio.clipFallbackName') }}</span>
          </div>
          <div v-if="selectedAudioResource" class="text-[10px] text-muted-foreground/70 truncate">
            {{ selectedAudioResource.file?.name ?? selectedAudioResource.name }}
          </div>
          <div class="text-[10px] text-muted-foreground/70">
            {{ t('properties.audio.duration', { value: (selectedAudioClip.duration / 1000).toFixed(2) }) }}
          </div>
        </div>

        <!-- 音量控制 -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <Label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Volume2 class="size-3" />
              {{ t('properties.audio.volume') }}
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
              @update:model-value="(v) => updateAudioVolume(v?.[0] ?? audioVolumeDb)"
              class="flex-1 h-7"
            />
            <span class="text-[10px] text-muted-foreground w-6">{{ VOLUME_DB_MAX }}</span>
          </div>
        </div>

        <!-- 静音切换 -->
        <div class="rounded-sm border border-border bg-accent/40 px-3 py-2.5 flex items-center justify-between">
          <span class="text-xs text-muted-foreground">{{ t('properties.audio.muteClip') }}</span>
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
      <span class="font-medium">{{ t('properties.empty.title') }}</span>
      <span class="text-xs mt-1">{{ t('properties.empty.hint') }}</span>
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
