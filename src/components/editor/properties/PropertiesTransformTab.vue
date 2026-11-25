<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AnyDanmu } from "@/types/danmu";
import type { ResolvedDanmu } from "@/core/danmuDefaults";
import {
  handleNumericInputChange,
  handleNumericInputFocus,
  handleNumericInputKeydown,
  type AnchorAxis,
  type PercentageField
} from "./propertyInputHelpers";

const props = defineProps<{
  selected: AnyDanmu;
  resolvedSelected: ResolvedDanmu<AnyDanmu> | null;
  anchorPercentageMode: Record<AnchorAxis, boolean>;
  getPercentageInputValue: (field: PercentageField) => string | number | undefined;
  inert?: boolean;
}>();

const emit = defineEmits<{
  (e: "update-field", key: string, value: unknown, asNumber?: boolean): void;
  (e: "update-resource-field", key: string, value: unknown): void;
  (e: "update-percentage-value", field: PercentageField, value: string | number): void;
  (e: "update-anchor-percentage-mode", axis: AnchorAxis, enabled: boolean): void;
}>();

const { t } = useI18n();

const getAnchorValue = (axis: AnchorAxis) => {
  const key = axis === "x" ? "anchorX" : "anchorY";
  const value = props.resolvedSelected?.[key] ?? 0;
  return props.anchorPercentageMode[axis] ? value * 100 : value;
};

const updateAnchorValue = (axis: AnchorAxis, value: string | number) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return;

  const normalizedValue = props.anchorPercentageMode[axis] ? numericValue / 100 : numericValue;
  const key = axis === "x" ? "anchorX" : "anchorY";
  emit("update-resource-field", key, Math.min(1, Math.max(0, normalizedValue)));
};
</script>

<template>
  <div :inert="props.inert" id="properties-tab-transform" role="tabpanel" class="space-y-4 pb-4">
    <div class="flex items-center justify-between select-none">
      <Label class="text-xs font-semibold text-muted-foreground flex items-center gap-2 cursor-pointer">
        <span class="w-1 h-3 bg-muted-foreground/50 rounded-full"></span>
        {{ t("properties.tabs.transform.title") }}
      </Label>
    </div>

    <div class="space-y-3 pt-1">
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <div class="space-y-1">
          <span class="text-xs text-muted-foreground">{{ t("properties.transform.x") }}</span>
          <div class="flex gap-2">
            <Input
              :model-value="props.getPercentageInputValue('x')"
              @focus="handleNumericInputFocus"
              @keydown="handleNumericInputKeydown"
              @change="(e: Event) => handleNumericInputChange(e, v => emit('update-percentage-value', 'x', v))"
              class="h-7 min-w-0 flex-1 text-xs font-mono bg-accent"
            />
          </div>
        </div>
        <div class="space-y-1">
          <span class="text-xs text-muted-foreground">{{ t("properties.transform.y") }}</span>
          <div class="flex gap-2">
            <Input
              :model-value="props.getPercentageInputValue('y')"
              @focus="handleNumericInputFocus"
              @keydown="handleNumericInputKeydown"
              @change="(e: Event) => handleNumericInputChange(e, v => emit('update-percentage-value', 'y', v))"
              class="h-7 min-w-0 flex-1 text-xs font-mono bg-accent"
            />
          </div>
        </div>
        <div class="space-y-1">
          <span class="text-xs text-muted-foreground">{{ t("properties.transform.scale") }}</span>
          <Input
            type="number"
            step="0.1"
            :model-value="props.resolvedSelected?.scale"
            @focus="handleNumericInputFocus"
            @keydown="handleNumericInputKeydown"
            @change="(e: Event) => handleNumericInputChange(e, v => emit('update-field', 'scale', v, true))"
            class="h-7 text-xs font-mono"
          />
        </div>
        <div class="space-y-1">
          <span class="text-xs text-muted-foreground">{{ t("properties.transform.zIndex") }}</span>
          <Input
            type="number"
            step="1"
            :model-value="props.resolvedSelected?.zIndex"
            @update:model-value="v => emit('update-field', 'zIndex', v, true)"
            class="h-7 text-xs font-mono"
          />
        </div>
      </div>

      <div v-if="props.selected.type === 'text'" class="grid grid-cols-2 gap-4 pt-1">
        <div class="space-y-1">
          <span class="text-xs text-muted-foreground">{{ t("properties.transform.anchorX") }}</span>
          <div class="flex gap-2">
            <Input
              type="number"
              :step="props.anchorPercentageMode.x ? 1 : 0.01"
              :model-value="getAnchorValue('x')"
              @update:model-value="v => updateAnchorValue('x', v)"
              class="h-7 min-w-0 flex-1 text-xs font-mono"
            />
            <label
              class="flex items-center gap-1 text-xs text-muted-foreground"
              :title="t('properties.transform.anchorHint')"
              ><Switch
                :model-value="props.anchorPercentageMode.x"
                @update:model-value="emit('update-anchor-percentage-mode', 'x', $event)"
              />%</label
            >
          </div>
        </div>
        <div class="space-y-1">
          <span class="text-xs text-muted-foreground">{{ t("properties.transform.anchorY") }}</span>
          <div class="flex gap-2">
            <Input
              type="number"
              :step="props.anchorPercentageMode.y ? 1 : 0.01"
              :model-value="getAnchorValue('y')"
              @update:model-value="v => updateAnchorValue('y', v)"
              class="h-7 min-w-0 flex-1 text-xs font-mono"
            />
            <label
              class="flex items-center gap-1 text-xs text-muted-foreground"
              :title="t('properties.transform.anchorHint')"
              ><Switch
                :model-value="props.anchorPercentageMode.y"
                @update:model-value="emit('update-anchor-percentage-mode', 'y', $event)"
              />%</label
            >
          </div>
        </div>
      </div>

      <div v-if="props.selected.type === 'text'" class="grid grid-cols-3 gap-2 pt-1">
        <div class="space-y-1">
          <span class="text-xs text-muted-foreground">{{ t("properties.transform.rotateX") }}</span>
          <Input
            type="number"
            :model-value="props.resolvedSelected?.rotateX"
            @focus="handleNumericInputFocus"
            @keydown="handleNumericInputKeydown"
            @change="(e: Event) => handleNumericInputChange(e, v => emit('update-field', 'rotateX', v, true))"
            class="h-7 text-xs font-mono"
          />
        </div>
        <div class="space-y-1">
          <span class="text-xs text-muted-foreground">{{ t("properties.transform.rotateY") }}</span>
          <Input
            type="number"
            :model-value="props.resolvedSelected?.rotateY"
            @focus="handleNumericInputFocus"
            @keydown="handleNumericInputKeydown"
            @change="(e: Event) => handleNumericInputChange(e, v => emit('update-field', 'rotateY', v, true))"
            class="h-7 text-xs font-mono"
          />
        </div>
        <div class="space-y-1">
          <span class="text-xs text-muted-foreground">{{ t("properties.transform.rotateZ") }}</span>
          <Input
            type="number"
            :model-value="props.resolvedSelected?.rotateZ"
            @focus="handleNumericInputFocus"
            @keydown="handleNumericInputKeydown"
            @change="(e: Event) => handleNumericInputChange(e, v => emit('update-field', 'rotateZ', v, true))"
            class="h-7 text-xs font-mono"
          />
        </div>
      </div>
    </div>
  </div>
</template>
