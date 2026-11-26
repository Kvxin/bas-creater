<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Plus, Trash2 } from "lucide-vue-next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import ColorPicker from "@/components/ui/color-picker/ColorPicker.vue";
import { isCoordinateField, type CoordinateReferenceSize } from "@/core/coordinates";
import {
  BASE_KEYFRAME_ID,
  clampKeyframeTime,
  createKeyframeSnapshot,
  getBaseKeyframeProperties,
  getBaseKeyframeTimeMs,
  normalizeKeyframes,
  pickKeyframePropertiesForResource,
  resolveKeyframeProperties
} from "@/core/keyframes";
import { formatTimelineTime, getFrameDurationMs, roundTimelineMs } from "@/core/timeline";
import { useTimelineStore } from "@/stores/timeline";
import type { AnyDanmu } from "@/types/danmu";
import type { ResolvedDanmu } from "@/core/danmuDefaults";
import type { TimelineClip, TimelineKeyframeProperties } from "@/types/timeline";
import {
  convertPercentagePropertyValue,
  formatAnimationSeconds,
  handleNumericInputChange,
  handleNumericInputFocus,
  handleNumericInputKeydown,
  isUnsetPropertyValue,
  toHtmlColor,
  type KeyframePercentageField
} from "./propertyInputHelpers";

const props = defineProps<{
  selected: AnyDanmu;
  resolvedSelected: ResolvedDanmu<AnyDanmu> | null;
  selectedClip: TimelineClip | null;
  selectedKeyframeId: string | null;
  currentTimeMs: number;
  autoKeyframe: boolean;
  canvasReferenceSize: CoordinateReferenceSize | null;
}>();

const emit = defineEmits<{
  (e: "set-auto-keyframe", enabled: boolean): void;
  (e: "select-keyframe", keyframeId: string, absoluteTimeMs?: number): void;
  (e: "add-keyframe", clipId: string, snapshot: ReturnType<typeof createKeyframeSnapshot>): void;
  (e: "remove-keyframe", clipId: string, keyframeId: string): void;
  (e: "update-keyframe", clipId: string, keyframeId: string, patch: { timeMs?: number; properties?: TimelineKeyframeProperties }): void;
  (e: "update-resource-field", key: string, value: unknown): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();

const formatLocalTimeDisplay = (localTimeMs: number) => {
  const sign = localTimeMs < 0 ? "-" : "";
  const absMs = Math.abs(localTimeMs);
  if (timelineStore.timeDisplayMode === "milliseconds") return `${sign}${formatAnimationSeconds(absMs)}`;
  const code = formatTimelineTime(absMs, {
    mode: timelineStore.timeDisplayMode,
    fps: timelineStore.fps
  });
  return `${sign}${code} (${sign}${formatAnimationSeconds(absMs)})`;
};

const keyframeTimeStep = computed(() =>
  timelineStore.timeDisplayMode === "frames" ? roundTimelineMs(getFrameDurationMs(timelineStore.fps)) : 10
);

const keyframePercentageModeOverrides = ref<Record<string, boolean>>({});

const clipKeyframes = computed(() => {
  const clip = props.selectedClip;
  if (!clip) return [];

  const normalized = normalizeKeyframes(clip.keyframes);
  const resource = props.selected;
  if (!resource || clip.resourceId !== resource.id) return normalized;

  return normalized.map(keyframe => ({
    ...keyframe,
    properties: pickKeyframePropertiesForResource(resource, keyframe.properties)
  }));
});

const activeKeyframeId = computed(() => props.selectedKeyframeId ?? BASE_KEYFRAME_ID);

const activeKeyframeProperties = computed<TimelineKeyframeProperties>(() => {
  if (!props.resolvedSelected || !props.selectedClip) return {};
  return resolveKeyframeProperties(props.resolvedSelected, props.selectedClip, activeKeyframeId.value);
});

const activeKeyframeStoredProperties = computed<TimelineKeyframeProperties>(() => {
  if (!props.selectedClip || activeKeyframeId.value === BASE_KEYFRAME_ID) return {};
  return clipKeyframes.value.find(keyframe => keyframe.id === activeKeyframeId.value)?.properties ?? {};
});

const currentClipLocalTime = computed(() => {
  if (!props.selectedClip) return 0;
  return clampKeyframeTime(props.currentTimeMs - props.selectedClip.startTime, props.selectedClip.duration);
});

const keyframeRows = computed(() => {
  if (!props.resolvedSelected || !props.selectedClip) return [];
  const baseTimeMs = getBaseKeyframeTimeMs(props.selectedClip);
  const clipDuration = props.selectedClip.duration;

  return [
    {
      id: BASE_KEYFRAME_ID,
      index: 1,
      label: t("common.keyframeBase"),
      timeMs: baseTimeMs,
      isBase: true,
      isOutOfBounds: baseTimeMs < 0 || baseTimeMs > clipDuration,
      properties: getBaseKeyframeProperties(props.resolvedSelected)
    },
    ...clipKeyframes.value.map((keyframe, index) => ({
      id: keyframe.id,
      index: index + 2,
      label: t("common.keyframeLabel", { n: index + 2 }),
      timeMs: keyframe.timeMs,
      isBase: false,
      isOutOfBounds: keyframe.timeMs < 0 || keyframe.timeMs > clipDuration,
      properties: keyframe.properties
    }))
  ];
});

const selectKeyframe = (keyframeId: string) => {
  const keyframe = keyframeRows.value.find(row => row.id === keyframeId);
  const absoluteTimeMs =
    props.selectedClip && keyframe ? Math.max(0, props.selectedClip.startTime + keyframe.timeMs) : undefined;
  emit("select-keyframe", keyframeId, absoluteTimeMs);
};

const getNextKeyframeTime = () => {
  if (!props.selectedClip) return 0;
  const lastKeyframe = clipKeyframes.value[clipKeyframes.value.length - 1];
  const lastTime = lastKeyframe?.timeMs ?? 0;
  const current = currentClipLocalTime.value > 0 ? currentClipLocalTime.value : lastTime + 1000;
  return clampKeyframeTime(current, props.selectedClip.duration);
};

const addKeyframe = () => {
  if (!props.selected || !props.selectedClip) return;
  const timeMs = getNextKeyframeTime();
  const snapshot = createKeyframeSnapshot(props.selected, props.selectedClip, timeMs);
  emit("add-keyframe", props.selectedClip.id, snapshot);
};

const removeSelectedKeyframe = () => {
  if (!props.selectedClip || activeKeyframeId.value === BASE_KEYFRAME_ID) return;
  emit("remove-keyframe", props.selectedClip.id, activeKeyframeId.value);
};

const updateKeyframeTime = (value: string | number) => {
  if (!props.selectedClip || activeKeyframeId.value === BASE_KEYFRAME_ID) return;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return;
  emit("update-keyframe", props.selectedClip.id, activeKeyframeId.value, { timeMs: parsed });
};

const updateKeyframeProperty = (key: keyof TimelineKeyframeProperties, value: string | number, asNumber = true) => {
  if (!props.selected || !props.selectedClip) return;

  const parsedValue = asNumber ? Number(value) : value;
  if (asNumber && !Number.isFinite(parsedValue as number)) return;

  // 动画页签始终直接编辑当前选中的那一帧。
  if (activeKeyframeId.value === BASE_KEYFRAME_ID) {
    emit("update-resource-field", key, parsedValue);
    return;
  }

  emit("update-keyframe", props.selectedClip.id, activeKeyframeId.value, {
    properties: {
      ...activeKeyframeStoredProperties.value,
      [key]: parsedValue
    }
  });
};

const updateKeyframeColor = (key: keyof TimelineKeyframeProperties, htmlHex: string) => {
  updateKeyframeProperty(key, "0x" + htmlHex.replace("#", ""), false);
};

const activeKeyframeText = computed(() =>
  props.selected.type === "button" ? activeKeyframeProperties.value.text : activeKeyframeProperties.value.content
);

const updateKeyframeText = (value: string | number) => {
  updateKeyframeProperty(props.selected.type === "button" ? "text" : "content", value, false);
};

const getKeyframePercentageSource = (field: KeyframePercentageField) => {
  let value = props.selected ? getBaseKeyframeProperties(props.selected)[field] : undefined;
  if (activeKeyframeId.value !== BASE_KEYFRAME_ID) {
    for (const keyframe of clipKeyframes.value) {
      const storedValue = keyframe.properties[field];
      if (!isUnsetPropertyValue(storedValue)) value = storedValue;
      if (keyframe.id === activeKeyframeId.value) break;
    }
  }
  return value;
};

const isKeyframePercentageValue = (field: KeyframePercentageField) => {
  if (isCoordinateField(field)) return true;
  const overrideKey = `${props.selectedClip?.id ?? "none"}:${activeKeyframeId.value}:${field}`;
  const override = keyframePercentageModeOverrides.value[overrideKey];
  if (override !== undefined) return override;

  const value = getKeyframePercentageSource(field);
  if (isUnsetPropertyValue(value)) return true;
  return typeof value === "string" && value.trim().endsWith("%");
};

const getKeyframePercentageInputValue = (field: KeyframePercentageField) => {
  if (field === "fontSize" && isUnsetPropertyValue(getKeyframePercentageSource(field))) return "";
  return activeKeyframeProperties.value[field];
};

const updateKeyframePercentageValue = (field: KeyframePercentageField, value: string | number) => {
  const numericValue = Number.parseFloat(String(value));
  if (!Number.isFinite(numericValue)) return;
  updateKeyframeProperty(field, isKeyframePercentageValue(field) ? `${numericValue}%` : numericValue, false);
};

const setKeyframePercentageMode = (field: KeyframePercentageField, enabled: boolean) => {
  const value = convertPercentagePropertyValue(
    field,
    activeKeyframeProperties.value[field],
    enabled,
    props.canvasReferenceSize
  );
  if (value !== null && (typeof value === "string" || typeof value === "number")) {
    updateKeyframeProperty(field, value, false);
  }
};
</script>

<template>
  <div id="properties-tab-animation" role="tabpanel" class="space-y-4 pb-4">
    <div class="flex items-center justify-between select-none">
      <Label class="text-xs font-semibold text-primary flex items-center gap-2 cursor-pointer">
        <span class="w-1 h-3 bg-primary rounded-full"></span>
        {{ t("properties.tabs.animation.title") }}
      </Label>
      <label class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Switch :model-value="props.autoKeyframe" @update:model-value="emit('set-auto-keyframe', $event)" />
        {{ t("properties.animation.autoKeyframe") }}
      </label>
    </div>

    <div v-if="props.selectedClip" class="space-y-4 pt-1">
      <div class="grid grid-cols-[1fr_auto] gap-2">
        <div class="rounded-sm border border-border bg-accent/40 px-2.5 py-2">
          <div class="text-xs text-muted-foreground">{{ t("properties.animation.localTime") }}</div>
          <div class="mt-1 font-mono text-xs tabular-nums text-foreground">
            {{ formatLocalTimeDisplay(currentClipLocalTime) }}
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
          <span class="text-xs text-muted-foreground font-medium">{{ t("properties.animation.keyframes") }}</span>
          <span class="text-xs text-muted-foreground font-mono">{{ keyframeRows.length }}</span>
        </div>

        <button
          v-for="keyframe in keyframeRows"
          :key="keyframe.id"
          type="button"
          class="w-full rounded-sm border px-2.5 py-2 text-left transition-colors"
          :class="[
            activeKeyframeId === keyframe.id
              ? 'border-primary/50 bg-primary/10 text-foreground'
              : 'border-border bg-accent/40 hover:border-border/80 hover:bg-accent text-muted-foreground',
            keyframe.isOutOfBounds ? 'opacity-60' : ''
          ]"
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
            <span class="shrink-0 text-xs font-mono tabular-nums text-muted-foreground">
              {{ formatLocalTimeDisplay(keyframe.timeMs) }}
            </span>
          </div>
          <div class="mt-1 truncate text-xs text-muted-foreground">
            {{ Object.keys(keyframe.properties).join(", ") || t("properties.animation.baseState") }}
          </div>
        </button>
      </div>

      <div class="space-y-4 border-t border-border/70 pt-4">
        <div class="flex items-center justify-between">
          <Label class="text-xs font-semibold text-primary">
            {{
              activeKeyframeId === BASE_KEYFRAME_ID
                ? t("properties.animation.baseProperties")
                : t("properties.animation.keyframeProperties")
            }}
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

        <div class="grid gap-3" :class="props.selected.type === 'text' ? 'grid-cols-2' : 'grid-cols-1'">
          <div class="space-y-1">
            <Label class="text-xs text-muted-foreground">{{ t("properties.animation.timeMs") }}</Label>
            <Input
              type="number"
              :step="keyframeTimeStep"
              :disabled="activeKeyframeId === BASE_KEYFRAME_ID"
              :model-value="
                activeKeyframeId === BASE_KEYFRAME_ID
                  ? getBaseKeyframeTimeMs(props.selectedClip)
                  : keyframeRows.find(item => item.id === activeKeyframeId)?.timeMs
              "
              @update:model-value="updateKeyframeTime"
              class="h-8 text-xs font-mono"
            />
          </div>
          <div v-if="props.selected.type === 'text'" class="space-y-1">
            <Label class="text-xs text-muted-foreground">{{ t("properties.style.opacity") }}</Label>
            <Input
              type="number"
              step="0.1"
              :min="0"
              :max="1"
              :model-value="activeKeyframeProperties.opacity"
              @focus="handleNumericInputFocus"
              @keydown="handleNumericInputKeydown"
              @change="(e: Event) => handleNumericInputChange(e, v => updateKeyframeProperty('opacity', v))"
              class="h-8 text-xs font-mono"
            />
          </div>
        </div>

        <div v-if="props.selected.type === 'text' || props.selected.type === 'button'" class="space-y-1">
          <Label class="text-xs text-muted-foreground">
            {{
              props.selected.type === "text"
                ? t("properties.animation.textContent")
                : t("properties.animation.buttonText")
            }}
          </Label>
          <Input :model-value="activeKeyframeText" @update:model-value="updateKeyframeText" class="h-8 text-xs" />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <Label class="text-xs text-muted-foreground">{{ t("properties.transform.x") }}</Label>
            <div class="flex gap-2">
              <Input
                :model-value="getKeyframePercentageInputValue('x')"
                @focus="handleNumericInputFocus"
                @keydown="handleNumericInputKeydown"
                @change="(e: Event) => handleNumericInputChange(e, v => updateKeyframePercentageValue('x', v))"
                class="h-8 min-w-0 flex-1 text-xs font-mono"
              />
            </div>
          </div>
          <div class="space-y-1">
            <Label class="text-xs text-muted-foreground">{{ t("properties.transform.y") }}</Label>
            <div class="flex gap-2">
              <Input
                :model-value="getKeyframePercentageInputValue('y')"
                @focus="handleNumericInputFocus"
                @keydown="handleNumericInputKeydown"
                @change="(e: Event) => handleNumericInputChange(e, v => updateKeyframePercentageValue('y', v))"
                class="h-8 min-w-0 flex-1 text-xs font-mono"
              />
            </div>
          </div>
        </div>

        <div v-if="props.selected.type === 'text'" class="grid grid-cols-1 gap-3">
          <div class="space-y-1">
            <Label class="text-xs text-muted-foreground">{{ t("properties.animation.scale") }}</Label>
            <Input
              type="number"
              step="0.1"
              :model-value="activeKeyframeProperties.scale"
              @focus="handleNumericInputFocus"
              @keydown="handleNumericInputKeydown"
              @change="(e: Event) => handleNumericInputChange(e, v => updateKeyframeProperty('scale', v))"
              class="h-8 text-xs font-mono"
            />
          </div>
        </div>

        <div v-if="props.selected.type === 'text' || props.selected.type === 'button'" class="space-y-1">
          <Label class="text-xs text-muted-foreground">{{ t("properties.style.fontSize") }}</Label>
          <div class="flex gap-2">
            <Input
              :model-value="getKeyframePercentageInputValue('fontSize')"
              @focus="handleNumericInputFocus"
              @keydown="handleNumericInputKeydown"
              @change="(e: Event) => handleNumericInputChange(e, v => updateKeyframePercentageValue('fontSize', v))"
              class="h-8 min-w-0 flex-1 text-xs font-mono"
              :placeholder="t('properties.animation.fontSizePlaceholder')"
            />
            <label
              class="flex items-center gap-1 text-xs text-muted-foreground"
              :title="t('properties.animation.fontSizePercentHint')"
              ><Switch
                :model-value="isKeyframePercentageValue('fontSize')"
                :disabled="!props.canvasReferenceSize"
                @update:model-value="setKeyframePercentageMode('fontSize', $event)"
              />%</label
            >
          </div>
        </div>

        <div v-if="props.selected.type === 'text'" class="grid grid-cols-3 gap-2">
          <div class="space-y-1">
            <span class="text-xs text-muted-foreground">{{ t("properties.transform.rotateX") }}</span>
            <Input
              type="number"
              :model-value="activeKeyframeProperties.rotateX"
              @focus="handleNumericInputFocus"
              @keydown="handleNumericInputKeydown"
              @change="(e: Event) => handleNumericInputChange(e, v => updateKeyframeProperty('rotateX', v))"
              class="h-8 text-xs font-mono"
            />
          </div>
          <div class="space-y-1">
            <span class="text-xs text-muted-foreground">{{ t("properties.transform.rotateY") }}</span>
            <Input
              type="number"
              :model-value="activeKeyframeProperties.rotateY"
              @focus="handleNumericInputFocus"
              @keydown="handleNumericInputKeydown"
              @change="(e: Event) => handleNumericInputChange(e, v => updateKeyframeProperty('rotateY', v))"
              class="h-8 text-xs font-mono"
            />
          </div>
          <div class="space-y-1">
            <span class="text-xs text-muted-foreground">{{ t("properties.transform.rotateZ") }}</span>
            <Input
              type="number"
              :model-value="activeKeyframeProperties.rotateZ"
              @focus="handleNumericInputFocus"
              @keydown="handleNumericInputKeydown"
              @change="(e: Event) => handleNumericInputChange(e, v => updateKeyframeProperty('rotateZ', v))"
              class="h-8 text-xs font-mono"
            />
          </div>
        </div>

        <div v-if="props.selected.type === 'text'" class="space-y-1">
          <Label class="text-xs text-muted-foreground">{{ t("properties.animation.textColor") }}</Label>
          <div class="flex items-center gap-2">
            <ColorPicker
              :model-value="toHtmlColor(activeKeyframeProperties.color)"
              aria-label="Keyframe text color"
              @update:model-value="value => updateKeyframeColor('color', value)"
            />
            <Input
              :model-value="activeKeyframeProperties.color"
              @update:model-value="v => updateKeyframeProperty('color', v, false)"
              class="h-8 text-xs font-mono"
            />
          </div>
        </div>
      </div>
    </div>

    <div
      v-else
      class="rounded-sm border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground"
    >
      {{ t("properties.animation.noClipHint") }}
    </div>
  </div>
</template>
