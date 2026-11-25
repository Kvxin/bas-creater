<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AnyDanmu } from "@/types/danmu";
import type { ResolvedDanmu } from "@/core/danmuDefaults";
import type { TimelineClip, TimelineResourceClip } from "@/types/timeline";

const props = defineProps<{
  selected: AnyDanmu;
  resolvedSelected: ResolvedDanmu<AnyDanmu> | null;
  selectedClip: TimelineClip | null;
  parentCandidates: TimelineResourceClip[];
  inert?: boolean;
}>();

const emit = defineEmits<{
  (e: "update-field", key: string, value: unknown): void;
  (e: "update-resource-field", key: string, value: unknown): void;
  (e: "update-parent-clip", parentClipId: string | undefined): void;
}>();

const { t } = useI18n();

const onParentChange = (event: Event) => {
  const value = (event.target as HTMLSelectElement).value;
  emit("update-parent-clip", value || undefined);
};

const getButtonAV = (item: AnyDanmu): number | undefined => {
  if (item.type === "button" && item.target && "av" in item.target) {
    return item.target.av.av;
  }
  return undefined;
};

const updateButtonAV = (val: string | number) => {
  const av = typeof val === "string" ? Number.parseInt(val, 10) : val;
  if (!Number.isNaN(av)) {
    emit("update-resource-field", "target", { av: { av, page: 1, timeMs: 0 } });
  }
};
</script>

<template>
  <div :inert="props.inert" id="properties-tab-identity" role="tabpanel" class="space-y-4 pb-4">
    <div class="flex items-center justify-between select-none">
      <Label class="text-xs font-semibold text-primary flex items-center gap-2 cursor-pointer">
        <span class="w-1 h-3 bg-primary rounded-full"></span>
        {{ t("properties.tabs.identity.title") }}
      </Label>
    </div>

    <div class="space-y-3 pt-1">
      <!-- 公共：自定义名称 -->
      <div class="space-y-1">
        <span class="text-xs text-muted-foreground font-medium">{{ t("properties.identity.name") }}</span>
        <Input
          :model-value="props.selected.name"
          @update:model-value="v => emit('update-field', 'name', v)"
          :placeholder="t('properties.identity.namePlaceholder')"
          class="h-8 text-xs"
        />
      </div>
      <div v-if="props.selectedClip?.kind === 'resource'" class="space-y-1">
        <label class="text-xs text-muted-foreground font-medium" for="parent-clip">{{ t("properties.parentClip") }}</label>
        <select
          id="parent-clip"
          class="w-full h-8 rounded border border-input bg-background px-2 text-xs"
          :value="props.selectedClip.parentClipId ?? ''"
          @change="onParentChange"
        >
          <option value="">{{ t("properties.noParent") }}</option>
          <option v-for="clip in props.parentCandidates" :key="clip.id" :value="clip.id">
            {{ clip.name || clip.id }}
          </option>
        </select>
      </div>

      <!-- 文本特有：内容 -->
      <div v-if="props.selected.type === 'text'" class="space-y-1">
        <span class="text-xs text-muted-foreground font-medium">{{ t("properties.identity.content") }}</span>
        <Textarea
          :model-value="(props.resolvedSelected as any)?.content"
          @update:model-value="v => emit('update-field', 'content', v)"
          class="min-h-20 text-xs resize-y leading-extended"
          :placeholder="t('properties.identity.contentPlaceholder')"
        />
      </div>

      <!-- 按钮特有：文本与跳转 -->
      <template v-if="props.selected.type === 'button'">
        <div class="space-y-1">
          <span class="text-xs text-muted-foreground font-medium">{{ t("properties.identity.buttonText") }}</span>
          <Input
            :model-value="(props.resolvedSelected as any)?.text"
            @update:model-value="v => emit('update-field', 'text', v)"
            class="h-8 text-xs"
            :placeholder="t('properties.identity.buttonTextPlaceholder')"
          />
        </div>
        <div class="space-y-1">
          <span class="text-xs text-muted-foreground font-medium">{{ t("properties.identity.targetAv") }}</span>
          <Input
            type="number"
            :model-value="getButtonAV(props.selected)"
            @update:model-value="updateButtonAV"
            class="h-8 text-xs font-mono"
            :placeholder="t('properties.identity.targetAvPlaceholder')"
          />
        </div>
      </template>

      <!-- 路径特有：路径与画布 -->
      <template v-if="props.selected.type === 'path'">
        <div class="space-y-1">
          <span class="text-xs text-muted-foreground font-medium">{{ t("properties.identity.pathData") }}</span>
          <Textarea
            :model-value="(props.resolvedSelected as any)?.d"
            @update:model-value="v => emit('update-field', 'd', v)"
            class="min-h-20 text-xs font-mono resize-y"
            placeholder="M0 0 L10 10..."
          />
        </div>
        <div class="space-y-1">
          <span class="text-xs text-muted-foreground font-medium">{{ t("properties.identity.viewBox") }}</span>
          <Input
            :model-value="(props.resolvedSelected as any)?.viewBox"
            @update:model-value="v => emit('update-field', 'viewBox', v)"
            class="h-8 text-xs font-mono"
            placeholder="0 0 100 100"
          />
        </div>
      </template>
    </div>
  </div>
</template>
