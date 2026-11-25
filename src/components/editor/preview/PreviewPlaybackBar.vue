<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { onClickOutside } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { Check, ChevronDown, Play, Pause, SkipBack, SkipForward, RotateCcw } from "lucide-vue-next";
import {
  CANVAS_MAX_SIZE,
  CANVAS_MIN_SIZE,
  CANVAS_PRESETS,
  ZOOM_PRESETS,
  clampCanvasDimension,
  type CanvasPreset
} from "./previewConstants";

const props = defineProps<{
  currentTimecode: string;
  durationTimecode: string;
  isPlaying: boolean;
  zoomDisplayLabel: string;
  isAtFit: boolean;
  zoomPercent: number;
  canvasWidth: number;
  canvasHeight: number;
}>();

const emit = defineEmits<{
  (e: "play-from-start"): void;
  (e: "seek-to-start"): void;
  (e: "toggle-play"): void;
  (e: "skip-forward"): void;
  (e: "fit-to-screen"): void;
  (e: "set-viewport-percent", percent: number): void;
  (e: "set-canvas-resolution", width: number, height: number): void;
}>();

const { t } = useI18n();

const isZoomMenuOpen = ref(false);
const isResolutionMenuOpen = ref(false);
const zoomMenuRef = ref<HTMLElement | null>(null);
const resolutionMenuRef = ref<HTMLElement | null>(null);

const editWidth = ref<number | string>(props.canvasWidth);
const editHeight = ref<number | string>(props.canvasHeight);

watch(
  () => [props.canvasWidth, props.canvasHeight] as const,
  ([width, height]) => {
    editWidth.value = width;
    editHeight.value = height;
  }
);

onClickOutside(zoomMenuRef, () => {
  isZoomMenuOpen.value = false;
});
onClickOutside(resolutionMenuRef, () => {
  isResolutionMenuOpen.value = false;
});

const currentPresetLabel = computed(() => {
  const match = CANVAS_PRESETS.find(p => p.width === props.canvasWidth && p.height === props.canvasHeight);
  return match?.label ?? null;
});

const canvasSizeLabel = computed(() => currentPresetLabel.value ?? `${props.canvasWidth}×${props.canvasHeight}`);

const isCanvasPresetSelected = (preset: CanvasPreset) =>
  props.canvasWidth === preset.width && props.canvasHeight === preset.height;

const isZoomPresetSelected = (preset: number) => !props.isAtFit && props.zoomPercent === preset;

const applyCustomResolution = () => {
  const w = clampCanvasDimension(editWidth.value);
  const h = clampCanvasDimension(editHeight.value);
  editWidth.value = w;
  editHeight.value = h;
  emit("set-canvas-resolution", w, h);
  isResolutionMenuOpen.value = false;
};
</script>

<template>
  <div
    class="preview-playback z-20 grid shrink-0 items-center gap-x-3 border-t border-divider bg-panel px-3 text-foreground"
    data-ui="preview-playback"
  >
    <!-- Left: Timecode -->
    <div class="preview-timecode flex min-w-0 items-center gap-1.5 font-mono text-xs tabular-nums select-none">
      <span class="shrink-0 rounded-sm bg-surface px-1.5 py-1 font-medium text-foreground">{{
        props.currentTimecode
      }}</span>
      <span class="text-muted-foreground/60">/</span>
      <span class="truncate text-muted-foreground" :title="props.durationTimecode">{{ props.durationTimecode }}</span>
    </div>

    <!-- Center: Transport -->
    <div class="preview-transport flex items-center gap-1">
      <button @click="emit('play-from-start')" class="transport-button" :title="t('preview.playback.fromStart')">
        <RotateCcw class="size-3.5" />
      </button>
      <button @click="emit('seek-to-start')" class="transport-button" :title="t('preview.playback.seekToStart')">
        <SkipBack class="size-4 fill-current" />
      </button>
      <button
        @click="emit('toggle-play')"
        class="preview-play-button mx-1 inline-flex h-8 w-10 items-center justify-center rounded-md text-primary-foreground transition-colors"
        :title="props.isPlaying ? t('preview.playback.pause') : t('preview.playback.play')"
      >
        <Pause v-if="props.isPlaying" class="size-4 fill-current" />
        <Play v-else class="ml-0.5 size-4 fill-current" />
      </button>
      <button @click="emit('skip-forward')" class="transport-button" :title="t('preview.playback.skipForward')">
        <SkipForward class="size-4 fill-current" />
      </button>
    </div>

    <!-- Right: Zoom + Resolution -->
    <div class="preview-settings flex items-center gap-1.5 justify-self-end">
      <!-- Zoom Select -->
      <div class="relative" ref="zoomMenuRef">
        <button
          @click.stop="
            isZoomMenuOpen = !isZoomMenuOpen;
            isResolutionMenuOpen = false;
          "
          class="preview-menu-trigger"
          :aria-expanded="isZoomMenuOpen"
          :title="t('preview.zoom.menu')"
        >
          <span>{{ props.zoomDisplayLabel }}</span>
          <ChevronDown class="size-3.5 text-muted-foreground" />
        </button>
        <div
          v-if="isZoomMenuOpen"
          class="preview-menu absolute right-0 bottom-full z-50 mb-2 w-44 overflow-hidden rounded-lg border border-border bg-popover p-1.5 text-popover-foreground"
        >
          <button
            @click.stop="
              emit('fit-to-screen');
              isZoomMenuOpen = false;
            "
            :class="[
              'flex h-8 w-full items-center justify-between rounded-sm px-2.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
              props.isAtFit ? 'bg-accent text-accent-foreground' : ''
            ]"
          >
            <span>{{ t("preview.zoom.fit") }}</span>
            <Check v-if="props.isAtFit" class="size-4" />
          </button>
          <div class="my-1.5 h-px bg-border"></div>
          <button
            v-for="preset in ZOOM_PRESETS"
            :key="preset"
            @click.stop="
              emit('set-viewport-percent', preset);
              isZoomMenuOpen = false;
            "
            :class="[
              'flex h-8 w-full items-center justify-between rounded-sm px-2.5 text-left font-mono text-sm tabular-nums transition-colors hover:bg-accent hover:text-accent-foreground',
              isZoomPresetSelected(preset) ? 'bg-accent text-accent-foreground' : ''
            ]"
          >
            <span>{{ preset }}%</span>
            <Check v-if="isZoomPresetSelected(preset)" class="size-4" />
          </button>
        </div>
      </div>

      <!-- Resolution -->
      <div class="relative" ref="resolutionMenuRef">
        <button
          @click.stop="
            isResolutionMenuOpen = !isResolutionMenuOpen;
            isZoomMenuOpen = false;
          "
          class="preview-menu-trigger"
          :aria-expanded="isResolutionMenuOpen"
          :title="t('preview.resolution.menu')"
        >
          <span>{{ canvasSizeLabel }}</span>
          <ChevronDown class="size-3.5 text-muted-foreground" />
        </button>
        <div
          v-if="isResolutionMenuOpen"
          class="preview-menu absolute right-0 bottom-full z-50 mb-2 w-72 overflow-hidden rounded-lg border border-border bg-popover p-2 text-popover-foreground"
        >
          <!-- 快捷预设 -->
          <div class="flex flex-col gap-1">
            <button
              v-for="preset in CANVAS_PRESETS"
              :key="preset.label"
              @click.stop="
                emit('set-canvas-resolution', preset.width, preset.height);
                isResolutionMenuOpen = false;
              "
              :class="[
                'flex h-10 w-full items-center gap-3 rounded-sm px-2.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground',
                isCanvasPresetSelected(preset) ? 'bg-accent text-accent-foreground' : ''
              ]"
            >
              <span :class="['shrink-0 rounded-[2px] border border-current opacity-70', preset.previewClass]"></span>
              <span class="min-w-0 flex-1">
                <span class="block font-mono text-sm tabular-nums">{{ preset.label }}</span>
                <span class="block text-xs text-muted-foreground">{{ preset.aspect }}</span>
              </span>
              <Check v-if="isCanvasPresetSelected(preset)" class="size-4 shrink-0" />
            </button>
          </div>
          <div class="my-2 h-px bg-border"></div>
          <!-- 自定义宽高 -->
          <div class="grid grid-cols-[1fr_auto_1fr_2.25rem] items-end gap-2">
            <label class="min-w-0">
              <span class="mb-1 block text-xs text-muted-foreground">{{ t("preview.resolution.width") }}</span>
              <input
                v-model.number="editWidth"
                type="number"
                :min="CANVAS_MIN_SIZE"
                :max="CANVAS_MAX_SIZE"
                inputmode="numeric"
                :aria-label="t('preview.resolution.canvasWidth')"
                class="h-8 w-full rounded-sm border border-border bg-input px-2 text-center font-mono text-xs tabular-nums text-foreground [appearance:textfield] focus:border-ring focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                @keydown.enter.stop="applyCustomResolution()"
              />
            </label>
            <span class="pb-2 text-xs text-muted-foreground">×</span>
            <label class="min-w-0">
              <span class="mb-1 block text-xs text-muted-foreground">{{ t("preview.resolution.height") }}</span>
              <input
                v-model.number="editHeight"
                type="number"
                :min="CANVAS_MIN_SIZE"
                :max="CANVAS_MAX_SIZE"
                inputmode="numeric"
                :aria-label="t('preview.resolution.canvasHeight')"
                class="h-8 w-full rounded-sm border border-border bg-input px-2 text-center font-mono text-xs tabular-nums text-foreground [appearance:textfield] focus:border-ring focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                @keydown.enter.stop="applyCustomResolution()"
              />
            </label>
            <button
              @click.stop="applyCustomResolution()"
              class="inline-flex size-8 items-center justify-center rounded-sm bg-primary text-primary-foreground transition-colors hover:brightness-110"
              :title="t('preview.resolution.applyCustomSize')"
            >
              <Check class="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.preview-playback {
  min-height: 3rem;
  grid-template-columns: minmax(0, 1fr) auto minmax(max-content, 1fr);
  grid-template-areas: "time transport settings";
}

.preview-timecode {
  grid-area: time;
}

.preview-transport {
  grid-area: transport;
  justify-self: center;
}

.preview-transport .transport-button {
  border-radius: var(--radius-sm);
}

.preview-settings {
  grid-area: settings;
}

.preview-play-button {
  background: var(--primary-button);
}

.preview-play-button:hover {
  background: var(--primary-button-hover);
}

.preview-play-button:active {
  background: color-mix(in oklab, var(--primary-button-hover) 84%, black);
}

.preview-menu-trigger {
  display: inline-flex;
  min-height: 1.75rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.375rem;
  padding-inline: 0.375rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  transition: background-color var(--motion-fast) ease, border-color var(--motion-fast) ease;
}

.preview-menu-trigger:hover {
  background: var(--accent);
}

.preview-menu-trigger[aria-expanded="true"] {
  border-color: var(--secondary-border);
  background: var(--secondary);
}

.preview-menu {
  max-width: calc(100cqw - 1.5rem);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.2);
}

.preview-playback button:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}

@container preview-panel (width < 28rem) {
  .preview-playback {
    grid-template-columns: minmax(0, 1fr) max-content;
    grid-template-areas:
      "transport transport"
      "time settings";
    gap: 0.25rem 0.5rem;
    padding-block: 0.25rem;
  }
}
</style>
