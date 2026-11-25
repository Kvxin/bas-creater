<script setup lang="ts">
import { isCoordinateField } from "@/core/coordinates";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Settings, FileText, Move, Palette, Sparkles } from "lucide-vue-next";
import { useDanmuStore } from "@/stores/danmu";
import { useTimelineStore } from "@/stores/timeline";
import { useAudioStore } from "@/stores/audio";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AnyDanmu } from "@/types/danmu";
import type { TimelineKeyframe, TimelineKeyframeProperties } from "@/types/timeline";
import { VOLUME_STEP } from "@/utils/audio/constants";
import { resolveDanmuDefaults } from "@/core/danmuDefaults";
import { flattenTimelineClips } from "@/core/timelineGroups";
import {
  BASE_KEYFRAME_ID,
  clampKeyframeTime,
  getEffectiveDanmuAtTime,
  pickKeyframePropertiesForResource
} from "@/core/keyframes";
import AudioClipProperties from "./properties/AudioClipProperties.vue";
import PropertiesAnimationTab from "./properties/PropertiesAnimationTab.vue";
import PropertiesIdentityTab from "./properties/PropertiesIdentityTab.vue";
import PropertiesStyleTab from "./properties/PropertiesStyleTab.vue";
import PropertiesTransformTab from "./properties/PropertiesTransformTab.vue";
import {
  convertPercentagePropertyValue,
  isUnsetPropertyValue,
  type AnchorAxis,
  type PercentageField
} from "./properties/propertyInputHelpers";

const { t } = useI18n();

const danmuStore = useDanmuStore();
const timelineStore = useTimelineStore();
const audioStore = useAudioStore();

const selectedClip = computed(() => {
  if (!timelineStore.selectedClipId) return null;
  for (const track of timelineStore.tracks) {
    const clip = track.clips.find(c => c.id === timelineStore.selectedClipId);
    if (clip) return clip;
  }
  return null;
});

const selected = computed(() => {
  if (timelineStore.selectedClipIds.length > 1 || selectedClip.value?.kind === "group") return null;
  const resource = danmuStore.selected;
  const clip = selectedClip.value;
  return resource && clip?.kind === "resource" && clip.resourceId === resource.id
    ? ({ ...resource, ...clip.overrides, id: resource.id, type: resource.type } as AnyDanmu)
    : resource;
});

const effectiveSelection = computed(() => {
  if (!selected.value) return { value: null, error: false };
  const clip = selectedClip.value;
  if (!clip || clip.kind !== "resource" || clip.resourceId !== selected.value.id) {
    return { value: resolveDanmuDefaults(selected.value), error: false };
  }
  try {
    return {
      value: resolveDanmuDefaults(
        getEffectiveDanmuAtTime(
          selected.value,
          clip,
          timelineStore.currentTime,
          null,
          timelineStore.canvasReferenceSize ?? undefined
        )
      ),
      error: false
    };
  } catch {
    return { value: resolveDanmuDefaults(selected.value), error: true };
  }
});

const resolvedSelected = computed(() => effectiveSelection.value.value);

// ---- 音频片段检测 ----

const selectedAudioClip = computed(() => {
  if (timelineStore.selectedClipIds.length > 1) return null;
  if (!timelineStore.selectedClipId) return null;
  for (const track of timelineStore.tracks) {
    const clip = track.clips.find(c => c.id === timelineStore.selectedClipId);
    if (clip && audioStore.audioResources.some(r => r.id === clip.resourceId)) {
      return clip;
    }
  }
  return null;
});

const selectedAudioResource = computed(() => {
  if (!selectedAudioClip.value) return null;
  return audioStore.getById(selectedAudioClip.value.kind === "resource" ? selectedAudioClip.value.resourceId : "");
});

const audioVolumeDb = computed(() => {
  if (!selectedAudioClip.value) return 0;
  return timelineStore.getEffectiveVolume(selectedAudioClip.value);
});

const audioClipMuted = computed(() => {
  if (!selectedAudioClip.value) return false;
  return timelineStore.isClipMuted(selectedAudioClip.value);
});

const updateAudioVolume = (db: number) => {
  if (!selectedAudioClip.value) return;
  timelineStore.updateClipVolume(selectedAudioClip.value.id, Math.round(db / VOLUME_STEP) * VOLUME_STEP);
};

const toggleAudioClipMuted = () => {
  if (!selectedAudioClip.value) return;
  timelineStore.toggleClipMuted(selectedAudioClip.value.id);
};

const selectedGroup = computed(() => (selectedClip.value?.kind === "group" ? selectedClip.value : null));

const parentCandidates = computed(() => {
  const clips = flattenTimelineClips(timelineStore.rootTracks).filter(clip =>
    danmuStore.danmus.some(resource => resource.id === clip.resourceId && resource.type === "text")
  );
  const byId = new Map(clips.map(clip => [clip.id, clip]));
  return clips.filter(clip => {
    const seen = new Set([selectedClip.value?.id]);
    let current: typeof clip | undefined = clip;
    while (current) {
      if (seen.has(current.id)) return false;
      seen.add(current.id);
      current = current.parentClipId ? byId.get(current.parentClipId) : undefined;
    }
    return true;
  });
});

const updateParentClip = (parentClipId: string | undefined) => {
  const clip = selectedClip.value;
  if (clip?.kind !== "resource") return;
  timelineStore.updateClip(clip.id, { parentClipId });
};

const isSelectedTrackLocked = computed(() =>
  timelineStore.tracks.some(track => track.id === selectedClip.value?.trackId && track.locked)
);

const updateGroupStart = (value: string | number) => {
  const startTime = Number(value);
  if (selectedGroup.value && Number.isFinite(startTime)) {
    timelineStore.updateClip(selectedGroup.value.id, { startTime });
  }
};

type PropertyTabId = "identity" | "transform" | "style" | "animation";

const activeTab = ref<PropertyTabId>("identity");

const propertyTabs = computed(
  () =>
    [
      {
        id: "identity",
        label: t("properties.tabs.identity.label"),
        title: t("properties.tabs.identity.title"),
        icon: FileText
      },
      {
        id: "transform",
        label: t("properties.tabs.transform.label"),
        title: t("properties.tabs.transform.title"),
        icon: Move
      },
      { id: "style", label: t("properties.tabs.style.label"), title: t("properties.tabs.style.title"), icon: Palette },
      {
        id: "animation",
        label: t("properties.tabs.animation.label"),
        title: t("properties.tabs.animation.title"),
        icon: Sparkles
      }
    ] as const
);

watch(selectedClip, clip => {
  if (clip && activeTab.value === "animation" && !timelineStore.selectedKeyframeId) {
    timelineStore.setSelectedKeyframe(BASE_KEYFRAME_ID);
  }
});

const handleSelectKeyframe = (keyframeId: string, absoluteTimeMs?: number) => {
  if (selectedClip.value) {
    timelineStore.setSelectedClip(selectedClip.value.id);
    if (absoluteTimeMs !== undefined) {
      timelineStore.setCurrentTime(absoluteTimeMs);
    }
  }
  timelineStore.setSelectedKeyframe(keyframeId);
  activeTab.value = "animation";
};

const handleAddKeyframe = (clipId: string, snapshot: TimelineKeyframe) => {
  const keyframe = timelineStore.addClipKeyframe(clipId, snapshot);
  if (keyframe) {
    activeTab.value = "animation";
  }
};

const handleRemoveKeyframe = (clipId: string, keyframeId: string) => {
  timelineStore.removeClipKeyframe(clipId, keyframeId);
};

const handleUpdateKeyframe = (
  clipId: string,
  keyframeId: string,
  patch: { timeMs?: number; properties?: TimelineKeyframeProperties }
) => {
  timelineStore.updateClipKeyframe(clipId, keyframeId, patch);
};

const updateResourceField = (key: string, value: unknown) => {
  const clip = selectedClip.value;
  if (clip?.kind === "resource" && clip.resourceId === selected.value?.id) {
    timelineStore.updateClip(clip.id, { overrides: { ...clip.overrides, [key]: value } as Partial<AnyDanmu> });
  } else {
    danmuStore.updateSelected({ [key]: value } as Partial<AnyDanmu>);
  }
};

const tryAutoKeyframeProperty = (key: string, value: unknown) => {
  const resource = selected.value;
  const clip = selectedClip.value;
  if (!timelineStore.autoKeyframe || !resource || !clip || clip.resourceId !== resource.id) {
    return false;
  }

  const properties = pickKeyframePropertiesForResource(resource, { [key]: value } as Partial<AnyDanmu>);
  if (Object.keys(properties).length === 0) return false;

  const rawLocalTimeMs = timelineStore.currentTime - clip.startTime;
  if (rawLocalTimeMs <= 0 || rawLocalTimeMs > clip.duration) return false;
  const localTimeMs = clampKeyframeTime(rawLocalTimeMs, clip.duration);

  timelineStore.upsertClipKeyframeAtTime(clip.id, localTimeMs, properties);
  return true;
};

const updateField = (key: string, value: unknown, asNumber = false) => {
  let nextValue = value;
  if (asNumber) {
    const parsed = Number.parseFloat(String(value));
    if (Number.isNaN(parsed)) return;
    nextValue = parsed;
  }

  if (tryAutoKeyframeProperty(key, nextValue)) return;
  updateResourceField(key, nextValue);
};

const updateDuration = (value: string | number) => {
  const durationMs = Number(value);
  if (!Number.isFinite(durationMs)) return;

  const nextDuration = Math.max(0, durationMs);
  if (selected.value && selectedClip.value?.resourceId === selected.value.id) {
    timelineStore.updateClip(selectedClip.value.id, { duration: nextDuration });
  } else {
    danmuStore.updateSelected({ durationMs: nextDuration } as Partial<AnyDanmu>);
  }
};

const anchorPercentageMode = ref<Record<AnchorAxis, boolean>>({ x: true, y: true });
const updateAnchorPercentageMode = (axis: AnchorAxis, enabled: boolean) => {
  anchorPercentageMode.value[axis] = enabled;
};
const percentageModeOverrides = ref<Record<string, boolean>>({});

const getPercentageModeKey = (field: PercentageField) => `${selected.value?.id ?? "none"}:${field}`;

const getRawPercentageValue = (field: PercentageField) =>
  (resolvedSelected.value as unknown as Record<string, unknown> | null)?.[field];

const getPercentageInputValue = (field: PercentageField): string | number | undefined => {
  const rawValue = getRawPercentageValue(field);
  if (field === "fontSize" && isUnsetPropertyValue(rawValue)) return "";
  const value = isUnsetPropertyValue(rawValue)
    ? (resolvedSelected.value as unknown as Record<string, unknown> | null)?.[field]
    : rawValue;
  return typeof value === "string" || typeof value === "number" ? value : undefined;
};

const isPercentageValue = (field: PercentageField) => {
  if (isCoordinateField(field)) return true;
  const override = percentageModeOverrides.value[getPercentageModeKey(field)];
  if (override !== undefined) return override;

  const value = getRawPercentageValue(field);
  if (isUnsetPropertyValue(value)) return true;
  return typeof value === "string" && value.trim().endsWith("%");
};

const updatePercentageValue = (field: PercentageField, value: string | number) => {
  const numericValue = Number.parseFloat(String(value));
  if (!Number.isFinite(numericValue)) return;

  updateField(field, isPercentageValue(field) ? `${numericValue}%` : numericValue);
};

const setPercentageMode = (field: PercentageField, enabled: boolean) => {
  const value = convertPercentagePropertyValue(
    field,
    getPercentageInputValue(field),
    enabled,
    timelineStore.canvasReferenceSize
  );
  if (value !== null) updateField(field, value);
};
</script>

<template>
  <div class="panel workbench-panel h-full w-full overflow-hidden flex flex-col text-sm" data-ui="properties-panel">
    <!-- 头部 -->
    <div
      class="panel-heading flex items-center px-3 font-semibold text-foreground justify-between shrink-0 bg-background"
    >
      <div class="flex items-center gap-2">
        <span>{{ t("properties.title") }}</span>
      </div>
      <Settings class="size-4 text-muted-foreground" />
    </div>

    <!-- 多选分组模式 -->
    <div v-if="timelineStore.selectedClipIds.length > 1" class="flex-1 overflow-y-auto p-3 space-y-3">
      <p class="font-medium">{{ t("groups.selection", { n: timelineStore.selectedClipIds.length }) }}</p>
      <p class="text-xs text-muted-foreground">{{ t("groups.selectionHint") }}</p>
      <button
        type="button"
        class="rounded-sm border border-border px-3 py-2 hover:bg-accent disabled:opacity-40"
        :disabled="!timelineStore.canCreateGroup()"
        @click="timelineStore.createGroup()"
      >
        {{ t("groups.create") }}
      </button>
    </div>

    <!-- 分组属性模式 -->
    <div v-else-if="selectedGroup" class="flex-1 overflow-y-auto p-3 space-y-4" data-ui="group-properties">
      <div class="space-y-2">
        <Label for="group-name">{{ t("groups.name") }}</Label>
        <Input
          id="group-name"
          :model-value="selectedGroup.name"
          :disabled="isSelectedTrackLocked"
          @update:model-value="value => timelineStore.updateClip(selectedGroup!.id, { name: String(value) })"
        />
      </div>
      <div class="space-y-2">
        <Label for="group-start">{{ t("groups.start") }}</Label>
        <Input
          id="group-start"
          type="number"
          min="0"
          step="1"
          :model-value="selectedGroup.startTime"
          :disabled="isSelectedTrackLocked"
          @update:model-value="updateGroupStart"
        />
      </div>
      <div class="space-y-2">
        <Label>{{ t("groups.duration") }}</Label>
        <p class="font-mono">{{ (selectedGroup.duration / 1000).toFixed(3) }} s</p>
        <p class="text-xs text-muted-foreground">{{ t("groups.durationHint") }}</p>
      </div>
      <button
        type="button"
        class="rounded-sm border border-border px-3 py-2 hover:bg-accent"
        @click="timelineStore.enterGroup(selectedGroup.id)"
      >
        {{ t("groups.enter") }}
      </button>
    </div>

    <!-- 常规弹幕资源编辑模式 -->
    <div v-else-if="selected" class="flex-1 min-h-0 flex overflow-hidden">
      <div class="min-w-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-hidden p-3">
        <p v-if="effectiveSelection.error" role="alert" class="mb-3 text-xs text-destructive">
          无法获取混合单位的参照尺寸，当前值不可编辑。
        </p>

        <PropertiesIdentityTab
          v-show="activeTab === 'identity'"
          :selected="selected"
          :resolved-selected="resolvedSelected"
          :selected-clip="selectedClip"
          :parent-candidates="parentCandidates"
          :inert="effectiveSelection.error"
          @update-field="updateField"
          @update-resource-field="updateResourceField"
          @update-parent-clip="updateParentClip"
        />

        <PropertiesTransformTab
          v-show="activeTab === 'transform'"
          :selected="selected"
          :resolved-selected="resolvedSelected"
          :anchor-percentage-mode="anchorPercentageMode"
          :get-percentage-input-value="getPercentageInputValue"
          :inert="effectiveSelection.error"
          @update-field="updateField"
          @update-resource-field="updateResourceField"
          @update-percentage-value="updatePercentageValue"
          @update-anchor-percentage-mode="updateAnchorPercentageMode"
        />

        <PropertiesStyleTab
          v-show="activeTab === 'style'"
          :selected="selected"
          :resolved-selected="resolvedSelected"
          :selected-clip="selectedClip"
          :has-canvas-reference-size="Boolean(timelineStore.canvasReferenceSize)"
          :get-percentage-input-value="getPercentageInputValue"
          :is-percentage-value="isPercentageValue"
          :inert="effectiveSelection.error"
          @update-field="updateField"
          @update-resource-field="updateResourceField"
          @update-duration="updateDuration"
          @update-percentage-value="updatePercentageValue"
          @set-percentage-mode="setPercentageMode"
        />

        <PropertiesAnimationTab
          v-show="activeTab === 'animation'"
          :selected="selected"
          :resolved-selected="resolvedSelected"
          :selected-clip="selectedClip"
          :selected-keyframe-id="timelineStore.selectedKeyframeId"
          :current-time-ms="timelineStore.currentTime"
          :auto-keyframe="timelineStore.autoKeyframe"
          :canvas-reference-size="timelineStore.canvasReferenceSize"
          @set-auto-keyframe="timelineStore.setAutoKeyframe"
          @select-keyframe="handleSelectKeyframe"
          @add-keyframe="handleAddKeyframe"
          @remove-keyframe="handleRemoveKeyframe"
          @update-keyframe="handleUpdateKeyframe"
          @update-resource-field="updateResourceField"
        />
      </div>

      <div
        class="w-12 shrink-0 border-l border-divider bg-workspace p-1 flex flex-col items-center gap-1"
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
          class="group flex h-11 w-full flex-col items-center justify-center gap-1 rounded-sm border text-[11px] leading-none transition-colors"
          :class="
            activeTab === tab.id
              ? 'border-primary/50 bg-primary/10 text-primary'
              : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
          "
          @click="activeTab = tab.id"
        >
          <component :is="tab.icon" class="size-4 shrink-0" />
          <span class="max-w-full truncate">{{ tab.label }}</span>
        </button>
      </div>
    </div>

    <!-- 音频片段编辑模式 -->
    <AudioClipProperties
      v-else-if="selectedAudioClip"
      :clip="selectedAudioClip"
      :resource="selectedAudioResource"
      :volume-db="audioVolumeDb"
      :muted="audioClipMuted"
      @update-volume="updateAudioVolume"
      @toggle-mute="toggleAudioClipMuted"
    />

    <!-- 空状态 -->
    <div v-else class="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
      <div class="size-12 rounded-sm bg-accent flex items-center justify-center mb-3">
        <Settings class="size-6 opacity-50" />
      </div>
      <span class="font-medium">{{ t("properties.empty.title") }}</span>
      <span class="text-xs mt-1">{{ t("properties.empty.hint") }}</span>
    </div>
  </div>
</template>
