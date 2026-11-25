<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Music2, Volume2 } from "lucide-vue-next";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { VOLUME_DB_MIN, VOLUME_DB_MAX, VOLUME_STEP } from "@/utils/audio/constants";
import { formatNumberForDisplay } from "@/utils/audio/audio-math";
import type { TimelineClip } from "@/types/timeline";
import type { AudioResource } from "@/types/resource";

const props = defineProps<{
  clip: TimelineClip;
  resource: AudioResource | null | undefined;
  volumeDb: number;
  muted: boolean;
}>();

const emit = defineEmits<{
  (e: "update-volume", db: number): void;
  (e: "toggle-mute"): void;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-hidden p-3 space-y-4 pb-4">
    <div class="flex items-center justify-between select-none">
      <Label class="text-xs font-semibold text-primary flex items-center gap-2">
        <span class="w-1 h-3 bg-primary rounded-full"></span>
        {{ t("properties.audio.title") }}
      </Label>
    </div>

    <div class="space-y-4 pt-1">
      <!-- 片段名称 -->
      <div class="rounded-sm border border-border bg-accent/40 px-3 py-3 space-y-2">
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <Music2 class="size-3.5" />
          <span class="truncate font-medium text-foreground">{{
            props.clip.name || t("properties.audio.clipFallbackName")
          }}</span>
        </div>
        <div v-if="props.resource" class="text-xs text-muted-foreground/70 truncate">
          {{ props.resource.file?.name ?? props.resource.name }}
        </div>
        <div class="text-xs text-muted-foreground/70">
          {{ t("properties.audio.duration", { value: (props.clip.duration / 1000).toFixed(2) }) }}
        </div>
      </div>

      <!-- 音量控制 -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <Label class="text-xs font-semibold text-muted-foreground flex items-center gap-2">
            <Volume2 class="size-3" />
            {{ t("properties.audio.volume") }}
          </Label>
          <span class="text-xs font-mono text-muted-foreground">{{ formatNumberForDisplay(props.volumeDb, 1) }} dB</span>
        </div>

        <div class="flex items-center gap-3">
          <span class="text-xs text-muted-foreground w-6 text-right">{{ VOLUME_DB_MIN }}</span>
          <Slider
            :model-value="[props.volumeDb]"
            :min="VOLUME_DB_MIN"
            :max="VOLUME_DB_MAX"
            :step="VOLUME_STEP"
            @update:model-value="v => emit('update-volume', v?.[0] ?? props.volumeDb)"
            class="flex-1 h-7"
          />
          <span class="text-xs text-muted-foreground w-6">{{ VOLUME_DB_MAX }}</span>
        </div>
      </div>

      <!-- 静音切换 -->
      <div class="rounded-sm border border-border bg-accent/40 px-3 py-2.5 flex items-center justify-between">
        <span class="text-xs text-muted-foreground">{{ t("properties.audio.muteClip") }}</span>
        <button
          type="button"
          role="switch"
          :aria-checked="props.muted"
          @click="emit('toggle-mute')"
          class="peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          :class="props.muted ? 'bg-destructive' : 'bg-input'"
        >
          <span
            class="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-none ring-0 transition-transform"
            :class="props.muted ? 'translate-x-4' : 'translate-x-0'"
          />
        </button>
      </div>
    </div>
  </div>
</template>
