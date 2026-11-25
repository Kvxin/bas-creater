<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import ColorPicker from "@/components/ui/color-picker/ColorPicker.vue";
import type { AnyDanmu } from "@/types/danmu";
import type { ResolvedDanmu } from "@/core/danmuDefaults";
import type { TimelineClip } from "@/types/timeline";
import {
  handleNumericInputChange,
  handleNumericInputFocus,
  handleNumericInputKeydown,
  toHtmlColor,
  type PercentageField
} from "./propertyInputHelpers";

const props = defineProps<{
  selected: AnyDanmu;
  resolvedSelected: ResolvedDanmu<AnyDanmu> | null;
  selectedClip: TimelineClip | null;
  hasCanvasReferenceSize: boolean;
  getPercentageInputValue: (field: PercentageField) => string | number | undefined;
  isPercentageValue: (field: PercentageField) => boolean;
  inert?: boolean;
}>();

const emit = defineEmits<{
  (e: "update-field", key: string, value: unknown, asNumber?: boolean): void;
  (e: "update-resource-field", key: string, value: unknown): void;
  (e: "update-duration", value: string | number): void;
  (e: "update-percentage-value", field: PercentageField, value: string | number): void;
  (e: "set-percentage-mode", field: PercentageField, enabled: boolean): void;
}>();

const { t } = useI18n();

const updateColor = (key: string, htmlHex: string, asNumber: boolean) => {
  const cleanHex = htmlHex.replace("#", "");
  emit("update-field", key, asNumber ? Number.parseInt(cleanHex, 16) : "0x" + cleanHex);
};

const updateBoolean = (key: string, value: boolean) => {
  emit("update-resource-field", key, value ? 1 : 0);
};
</script>

<template>
  <div :inert="props.inert" id="properties-tab-style" role="tabpanel" class="space-y-4 pb-4">
    <div class="flex items-center justify-between select-none">
      <Label class="text-xs font-semibold text-muted-foreground flex items-center gap-2 cursor-pointer">
        <span class="w-1 h-3 bg-muted-foreground/50 rounded-full"></span>
        {{ t("properties.tabs.style.title") }}
      </Label>
    </div>

    <div class="space-y-4 pt-1">
      <!-- 文本不透明度与通用时长 -->
      <div class="grid grid-cols-2 gap-4">
        <div v-if="props.selected.type === 'text'" class="space-y-1">
          <div class="flex justify-between items-center mb-1">
            <span class="text-xs text-muted-foreground">{{ t("properties.style.opacity") }}</span>
            <span class="text-xs text-muted-foreground font-mono"
              >{{ ((props.resolvedSelected?.opacity ?? 1) * 100).toFixed(0) }}%</span
            >
          </div>
          <Slider
            :model-value="[props.resolvedSelected?.opacity ?? 1]"
            :max="1"
            :step="0.01"
            @update:model-value="v => v && emit('update-field', 'opacity', v[0], true)"
            class="w-full h-7"
          />
        </div>
        <div class="space-y-1">
          <span class="text-xs text-muted-foreground">{{ t("properties.style.durationMs") }}</span>
          <Input
            type="number"
            step="100"
            :model-value="
              props.selectedClip?.kind === 'resource' ? props.selectedClip.duration : props.selected.durationMs
            "
            @update:model-value="v => emit('update-duration', v)"
            class="h-7 text-xs font-mono"
          />
        </div>
      </div>

      <!-- 文本样式 -->
      <div v-if="props.selected.type === 'text'" class="space-y-4 pt-2">
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-1">
            <span class="text-xs text-muted-foreground">{{ t("properties.style.fontSize") }}</span>
            <div class="flex gap-2">
              <Input
                :model-value="props.getPercentageInputValue('fontSize')"
                @focus="handleNumericInputFocus"
                @keydown="handleNumericInputKeydown"
                @change="(e: Event) => handleNumericInputChange(e, v => emit('update-percentage-value', 'fontSize', v))"
                class="h-7 min-w-0 flex-1 text-xs font-mono"
                :placeholder="t('properties.style.fontSizePlaceholder')"
              />
              <label
                class="flex items-center gap-1 text-xs text-muted-foreground"
                :title="t('properties.style.fontSizePercentHint')"
                ><Switch
                  :model-value="props.isPercentageValue('fontSize')"
                  :disabled="!props.hasCanvasReferenceSize"
                  @update:model-value="emit('set-percentage-mode', 'fontSize', $event)"
                />%</label
              >
            </div>
          </div>
          <div class="space-y-1">
            <span class="text-xs text-muted-foreground">{{ t("properties.style.fontFamily") }}</span>
            <Input
              :model-value="(props.resolvedSelected as any)?.fontFamily"
              @update:model-value="v => emit('update-field', 'fontFamily', v)"
              class="h-7 text-xs"
            />
          </div>
          <div class="space-y-1">
            <span class="text-xs text-muted-foreground">{{ t("properties.style.textColor") }}</span>
            <div class="flex gap-2">
              <ColorPicker
                :model-value="toHtmlColor((props.resolvedSelected as any)?.color)"
                aria-label="Text color"
                @update:model-value="value => updateColor('color', value, false)"
              />
              <Input
                :model-value="(props.resolvedSelected as any)?.color"
                @update:model-value="v => emit('update-field', 'color', v)"
                class="h-7 text-xs font-mono flex-1"
              />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div class="space-y-1">
              <span class="text-xs text-muted-foreground">{{ t("properties.style.bold") }}</span>
              <div class="h-7 flex items-center">
                <button
                  type="button"
                  role="switch"
                  :aria-checked="!!(props.resolvedSelected as any)?.bold"
                  @click="updateBoolean('bold', !(props.resolvedSelected as any)?.bold)"
                  class="peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                  :class="!!(props.resolvedSelected as any)?.bold ? 'bg-primary' : 'bg-input'"
                >
                  <span
                    class="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-none ring-0 transition-transform"
                    :class="!!(props.resolvedSelected as any)?.bold ? 'translate-x-4' : 'translate-x-0'"
                  />
                </button>
              </div>
            </div>
            <div class="space-y-1">
              <span class="text-xs text-muted-foreground">{{ t("properties.style.textShadow") }}</span>
              <div class="h-7 flex items-center">
                <button
                  type="button"
                  role="switch"
                  :aria-checked="!!(props.resolvedSelected as any)?.textShadow"
                  @click="updateBoolean('textShadow', !(props.resolvedSelected as any)?.textShadow)"
                  class="peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                  :class="!!(props.resolvedSelected as any)?.textShadow ? 'bg-primary' : 'bg-input'"
                >
                  <span
                    class="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-none ring-0 transition-transform"
                    :class="!!(props.resolvedSelected as any)?.textShadow ? 'translate-x-4' : 'translate-x-0'"
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-1">
            <span class="text-xs text-muted-foreground">{{ t("properties.style.strokeColor") }}</span>
            <div class="flex gap-2">
              <ColorPicker
                :model-value="toHtmlColor((props.resolvedSelected as any)?.strokeColor)"
                aria-label="Stroke color"
                @update:model-value="value => updateColor('strokeColor', value, false)"
              />
              <Input
                :model-value="(props.resolvedSelected as any)?.strokeColor"
                @update:model-value="v => emit('update-field', 'strokeColor', v)"
                class="h-7 text-xs font-mono flex-1"
              />
            </div>
          </div>
          <div class="space-y-1">
            <span class="text-xs text-muted-foreground">{{ t("properties.style.strokeWidth") }}</span>
            <Input
              type="number"
              step="0.5"
              :model-value="(props.resolvedSelected as any)?.strokeWidth"
              @update:model-value="v => emit('update-field', 'strokeWidth', v, true)"
              class="h-7 text-xs font-mono"
            />
          </div>
        </div>
      </div>

      <!-- 按钮样式 -->
      <div v-if="props.selected.type === 'button'" class="space-y-4 pt-2">
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-1">
            <span class="text-xs text-muted-foreground">{{ t("properties.style.fontSize") }}</span>
            <div class="flex gap-2">
              <Input
                :model-value="props.getPercentageInputValue('fontSize')"
                @focus="handleNumericInputFocus"
                @keydown="handleNumericInputKeydown"
                @change="(e: Event) => handleNumericInputChange(e, v => emit('update-percentage-value', 'fontSize', v))"
                class="h-7 min-w-0 flex-1 text-xs font-mono"
                :placeholder="t('properties.style.fontSizePlaceholder')"
              />
              <label
                class="flex items-center gap-1 text-xs text-muted-foreground"
                :title="t('properties.style.fontSizePercentHint')"
                ><Switch
                  :model-value="props.isPercentageValue('fontSize')"
                  :disabled="!props.hasCanvasReferenceSize"
                  @update:model-value="emit('set-percentage-mode', 'fontSize', $event)"
                />%</label
              >
            </div>
          </div>
          <div class="space-y-1">
            <span class="text-xs text-muted-foreground">{{ t("properties.style.textColor") }}</span>
            <div class="flex items-center gap-2">
              <ColorPicker
                :model-value="toHtmlColor((props.resolvedSelected as any)?.textColor)"
                aria-label="Button text color"
                @update:model-value="value => updateColor('textColor', value, true)"
              />
              <span class="text-xs font-mono uppercase">{{
                toHtmlColor((props.resolvedSelected as any)?.textColor)
              }}</span>
            </div>
          </div>
          <div class="space-y-1">
            <span class="text-xs text-muted-foreground">{{ t("properties.style.fillColor") }}</span>
            <div class="flex items-center gap-2">
              <ColorPicker
                :model-value="toHtmlColor((props.resolvedSelected as any)?.fillColor)"
                aria-label="Fill color"
                @update:model-value="value => updateColor('fillColor', value, true)"
              />
              <span class="text-xs font-mono uppercase">{{
                toHtmlColor((props.resolvedSelected as any)?.fillColor)
              }}</span>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div class="space-y-1">
              <span class="text-xs text-muted-foreground">{{ t("properties.style.buttonTextAlpha") }}</span>
              <Input
                type="number"
                step="0.1"
                :min="0"
                :max="1"
                :model-value="(props.resolvedSelected as any)?.textAlpha"
                @update:model-value="v => emit('update-field', 'textAlpha', v, true)"
                class="h-7 text-xs font-mono"
              />
            </div>
            <div class="space-y-1">
              <span class="text-xs text-muted-foreground">{{ t("properties.style.buttonFillAlpha") }}</span>
              <Input
                type="number"
                step="0.1"
                :min="0"
                :max="1"
                :model-value="(props.resolvedSelected as any)?.fillAlpha"
                @update:model-value="v => emit('update-field', 'fillAlpha', v, true)"
                class="h-7 text-xs font-mono"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 路径样式 -->
      <div v-if="props.selected.type === 'path'" class="space-y-4 pt-2">
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-1">
            <span class="text-xs text-muted-foreground">{{ t("properties.style.width") }}</span>
            <div class="flex gap-2">
              <Input
                :model-value="props.getPercentageInputValue('width')"
                @focus="handleNumericInputFocus"
                @keydown="handleNumericInputKeydown"
                @change="(e: Event) => handleNumericInputChange(e, v => emit('update-percentage-value', 'width', v))"
                class="h-7 min-w-0 flex-1 text-xs font-mono"
              />
              <label
                class="flex items-center gap-1 text-xs text-muted-foreground"
                :title="t('properties.style.widthPercentHint')"
                ><Switch
                  :model-value="props.isPercentageValue('width')"
                  :disabled="!props.hasCanvasReferenceSize"
                  @update:model-value="emit('set-percentage-mode', 'width', $event)"
                />%</label
              >
            </div>
          </div>
          <div class="space-y-1">
            <span class="text-xs text-muted-foreground">{{ t("properties.style.height") }}</span>
            <div class="flex gap-2">
              <Input
                :model-value="props.getPercentageInputValue('height')"
                @focus="handleNumericInputFocus"
                @keydown="handleNumericInputKeydown"
                @change="(e: Event) => handleNumericInputChange(e, v => emit('update-percentage-value', 'height', v))"
                class="h-7 min-w-0 flex-1 text-xs font-mono"
              />
              <label
                class="flex items-center gap-1 text-xs text-muted-foreground"
                :title="t('properties.style.heightPercentHint')"
                ><Switch
                  :model-value="props.isPercentageValue('height')"
                  :disabled="!props.hasCanvasReferenceSize"
                  @update:model-value="emit('set-percentage-mode', 'height', $event)"
                />%</label
              >
            </div>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-1">
            <span class="text-xs text-muted-foreground">{{ t("properties.style.fillColor") }}</span>
            <div class="flex items-center gap-2">
              <ColorPicker
                :model-value="toHtmlColor((props.resolvedSelected as any)?.fillColor)"
                aria-label="Fill color"
                @update:model-value="value => updateColor('fillColor', value, true)"
              />
              <span class="text-xs font-mono uppercase">{{
                toHtmlColor((props.resolvedSelected as any)?.fillColor)
              }}</span>
            </div>
          </div>
          <div class="space-y-1">
            <span class="text-xs text-muted-foreground">{{ t("properties.style.pathFillAlpha") }}</span>
            <Input
              type="number"
              step="0.1"
              :min="0"
              :max="1"
              :model-value="(props.resolvedSelected as any)?.fillAlpha"
              @update:model-value="v => emit('update-field', 'fillAlpha', v, true)"
              class="h-7 text-xs font-mono"
            />
          </div>
          <div class="space-y-1">
            <span class="text-xs text-muted-foreground">{{ t("properties.style.strokeColor") }}</span>
            <div class="flex items-center gap-2">
              <ColorPicker
                :model-value="toHtmlColor((props.resolvedSelected as any)?.borderColor)"
                aria-label="Border color"
                @update:model-value="value => updateColor('borderColor', value, true)"
              />
              <span class="text-xs font-mono uppercase">{{
                toHtmlColor((props.resolvedSelected as any)?.borderColor)
              }}</span>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div class="space-y-1">
              <span class="text-xs text-muted-foreground">{{ t("properties.style.borderWidth") }}</span>
              <Input
                type="number"
                step="0.5"
                :model-value="(props.resolvedSelected as any)?.borderWidth"
                @update:model-value="v => emit('update-field', 'borderWidth', v, true)"
                class="h-7 text-xs font-mono"
              />
            </div>
            <div class="space-y-1">
              <span class="text-xs text-muted-foreground">{{ t("properties.style.borderAlpha") }}</span>
              <Input
                type="number"
                step="0.1"
                :min="0"
                :max="1"
                :model-value="(props.resolvedSelected as any)?.borderAlpha"
                @update:model-value="v => emit('update-field', 'borderAlpha', v, true)"
                class="h-7 text-xs font-mono"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
