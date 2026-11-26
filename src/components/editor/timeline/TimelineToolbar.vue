<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { onClickOutside, useEventListener } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import {
  ArrowLeft,
  Bookmark,
  ChevronDown,
  ChevronFirst,
  ChevronLast,
  ChevronRight,
  Clock,
  FolderPlus,
  Magnet,
  Scissors,
  ScissorsLineDashed,
  Trash2,
  Ungroup,
  ZoomIn,
  ZoomOut
} from "lucide-vue-next";
import {
  getKeyframeToleranceMs,
  MAX_TIMELINE_FPS,
  MIN_TIMELINE_FPS,
  TIMELINE_FPS_PRESETS
} from "@/core/timeline";
import { useTimelineStore } from "@/stores/timeline";
import type { TimelineDisplayMode } from "@/types/timeline";
import { runSplitAction } from "@/utils/splitAction";

const props = defineProps<{
  currentTimeDisplay: string;
}>();

const emit = defineEmits<{
  (e: "zoom-in"): void;
  (e: "zoom-out"): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();

const isTimebaseOpen = ref(false);
const triggerRef = ref<HTMLButtonElement | null>(null);
const popoverRef = ref<HTMLDivElement | null>(null);
const popoverPosition = ref({ left: 8, top: 44 });

const customFpsInput = ref<number | string>(timelineStore.fps);

watch(
  () => timelineStore.fps,
  value => {
    customFpsInput.value = value;
  }
);

const updatePopoverPosition = () => {
  const rect = triggerRef.value?.getBoundingClientRect();
  if (!rect) return;
  const width = 280;
  const maxLeft = Math.max(8, window.innerWidth - width - 8);
  const maxTop = Math.max(8, window.innerHeight - 200);
  popoverPosition.value = {
    left: Math.min(Math.max(8, rect.left), maxLeft),
    top: Math.min(rect.bottom + 4, maxTop)
  };
};

const toggleTimebasePopover = () => {
  isTimebaseOpen.value = !isTimebaseOpen.value;
  if (isTimebaseOpen.value) updatePopoverPosition();
};

onClickOutside(
  popoverRef,
  () => {
    isTimebaseOpen.value = false;
  },
  { ignore: [triggerRef] }
);

useEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key === "Escape" && isTimebaseOpen.value) {
    isTimebaseOpen.value = false;
  }
});
useEventListener("resize", () => {
  if (isTimebaseOpen.value) updatePopoverPosition();
});

onUnmounted(() => {
  isTimebaseOpen.value = false;
});

const modeBadgeText = computed(() => {
  if (timelineStore.timeDisplayMode === "milliseconds") return "ms";
  return `${timelineStore.fps} FPS`;
});

const modeOptions = computed<Array<{ value: TimelineDisplayMode; label: string }>>(() => [
  { value: "frames", label: t("timeline.timebase.modes.frames") },
  { value: "milliseconds", label: t("timeline.timebase.modes.milliseconds") }
]);

const hasMarkerAtPlayhead = computed(() => {
  const tolerance = getKeyframeToleranceMs(timelineStore.fps);
  return timelineStore.markers.some(marker => Math.abs(marker.timeMs - timelineStore.currentTime) <= tolerance);
});

const commitCustomFps = () => {
  const parsed = Number(customFpsInput.value);
  if (Number.isFinite(parsed) && parsed > 0) {
    timelineStore.setFps(parsed);
  }
  customFpsInput.value = timelineStore.fps;
};
</script>

<template>
  <!-- 顶部工具栏 (VS Code Modern UI Action Bar) -->
  <div
    class="toolbar h-10 bg-panel flex items-center justify-between px-2 py-1 text-xs text-muted-foreground gap-3 shrink-0"
  >
    <div class="flex min-w-0 items-center gap-1">
      <!-- 时间码与参考帧率触发器 -->
      <button
        ref="triggerRef"
        type="button"
        class="timebase-trigger"
        :aria-expanded="isTimebaseOpen"
        :title="t('timeline.timebase.triggerTitle')"
        data-ui="timebase-trigger"
        @click="toggleTimebasePopover"
      >
        <Clock class="size-3.5 shrink-0 text-muted-foreground" />
        <span class="font-mono text-foreground tabular-nums">{{ props.currentTimeDisplay }}</span>
        <span class="h-3 w-px bg-border shrink-0"></span>
        <span class="font-mono text-[11px] text-muted-foreground tabular-nums">{{ modeBadgeText }}</span>
        <ChevronDown class="size-3 shrink-0 text-muted-foreground" />
      </button>

      <div class="mx-0.5 h-4 w-px bg-divider shrink-0"></div>

      <!-- 磁吸开关 & 时间轴标记 -->
      <button
        type="button"
        class="ui-icon-button border border-transparent"
        :class="{ 'border-secondary-border': timelineStore.snapEnabled }"
        :aria-pressed="timelineStore.snapEnabled"
        :title="t('timeline.snap.toggle')"
        :aria-label="t('timeline.snap.toggle')"
        data-ui="timeline-snap-toggle"
        @click="timelineStore.toggleSnap()"
      >
        <Magnet class="size-3.5" />
      </button>

      <button
        type="button"
        class="ui-icon-button border border-transparent"
        :class="{ 'marker-button--active': hasMarkerAtPlayhead }"
        :aria-pressed="hasMarkerAtPlayhead"
        :title="t('timeline.markers.toggleAtPlayhead')"
        :aria-label="t('timeline.markers.toggleAtPlayhead')"
        data-ui="timeline-marker-toggle"
        @click="timelineStore.toggleMarkerAtCurrentTime()"
      >
        <Bookmark class="size-3.5" :class="{ 'fill-current': hasMarkerAtPlayhead }" />
      </button>

      <div
        v-if="timelineStore.markers.length > 0"
        class="inline-flex h-7 items-center rounded-sm border border-border bg-surface overflow-hidden shrink-0"
        data-ui="timeline-marker-nav"
      >
        <button
          type="button"
          class="inline-flex size-6 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
          :title="t('timeline.markers.previous')"
          :aria-label="t('timeline.markers.previous')"
          @click="timelineStore.seekToAdjacentMarker(-1)"
        >
          <ChevronFirst class="size-3.5" />
        </button>
        <span
          class="px-1 font-mono text-[11px] tabular-nums text-muted-foreground"
          :title="t('timeline.markers.count', { n: timelineStore.markers.length })"
        >
          {{ timelineStore.markers.length }}
        </span>
        <button
          type="button"
          class="inline-flex size-6 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
          :title="t('timeline.markers.next')"
          :aria-label="t('timeline.markers.next')"
          @click="timelineStore.seekToAdjacentMarker(1)"
        >
          <ChevronLast class="size-3.5" />
        </button>
        <div class="h-3.5 w-px bg-border"></div>
        <button
          type="button"
          class="inline-flex size-6 items-center justify-center text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
          :title="t('timeline.markers.clearAll')"
          :aria-label="t('timeline.markers.clearAll')"
          data-ui="timeline-markers-clear"
          @click="timelineStore.clearMarkers()"
        >
          <Trash2 class="size-3" />
        </button>
      </div>

      <div class="mx-0.5 h-4 w-px bg-divider shrink-0"></div>

      <!-- 编组与分割工具 -->
      <button
        type="button"
        class="ui-icon-button"
        data-ui="create-group"
        :title="t('groups.createHint')"
        :aria-label="t('groups.create')"
        :disabled="!timelineStore.canCreateGroup()"
        @click="timelineStore.createGroup()"
      >
        <FolderPlus class="size-4" />
      </button>
      <button
        type="button"
        class="ui-icon-button"
        data-ui="ungroup"
        :title="t('groups.ungroupHint')"
        :aria-label="t('groups.ungroup')"
        :disabled="!timelineStore.canUngroupClip()"
        @click="timelineStore.ungroupClip()"
      >
        <Ungroup class="size-4" />
      </button>
      <button
        type="button"
        class="ui-icon-button"
        data-ui="split-element"
        :title="t('menus.splitElement')"
        :aria-label="t('menus.splitElement')"
        :disabled="!timelineStore.canSplitClip(timelineStore.selectedClipId)"
        @click="runSplitAction(() => timelineStore.splitClip(timelineStore.selectedClipId))"
      >
        <Scissors class="size-3.5" />
      </button>
      <button
        type="button"
        class="ui-icon-button"
        data-ui="split-left"
        :title="t('menus.splitLeft')"
        :aria-label="t('menus.splitLeft')"
        :disabled="!timelineStore.canSplitClip(timelineStore.selectedClipId)"
        @click="runSplitAction(() => timelineStore.splitClipLeft(timelineStore.selectedClipId))"
      >
        <ScissorsLineDashed class="size-3.5 rotate-180" />
      </button>
      <button
        type="button"
        class="ui-icon-button"
        data-ui="split-right"
        :title="t('menus.splitRight')"
        :aria-label="t('menus.splitRight')"
        :disabled="!timelineStore.canSplitClip(timelineStore.selectedClipId)"
        @click="runSplitAction(() => timelineStore.splitClipRight(timelineStore.selectedClipId))"
      >
        <ScissorsLineDashed class="size-3.5" />
      </button>
    </div>

    <div class="flex items-center gap-2 shrink-0">
      <span class="font-mono text-xs w-12 text-right tabular-nums">{{ timelineStore.zoomScale }}%</span>
      <div class="flex gap-0.5 border border-border rounded-sm overflow-hidden bg-surface">
        <button
          class="size-7 inline-flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
          @click="emit('zoom-out')"
          :aria-label="t('preview.zoom.out')"
          :title="t('preview.zoom.out')"
          data-ui="timeline-zoom-out"
        >
          <ZoomOut class="size-3.5" />
        </button>
        <div class="w-px bg-border"></div>
        <button
          class="size-7 inline-flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
          @click="emit('zoom-in')"
          :aria-label="t('preview.zoom.in')"
          :title="t('preview.zoom.in')"
          data-ui="timeline-zoom-in"
        >
          <ZoomIn class="size-3.5" />
        </button>
      </div>
    </div>
  </div>

  <!-- 分组层级面包屑 -->
  <nav
    class="flex min-h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 text-xs"
    data-ui="group-breadcrumb"
    :aria-label="t('groups.root')"
  >
    <button
      v-if="timelineStore.activeGroupPath.length"
      type="button"
      class="inline-flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-accent"
      :title="t('groups.back')"
      :aria-label="t('groups.back')"
      @click="timelineStore.leaveGroup()"
    >
      <ArrowLeft class="size-3.5" />
    </button>
    <button
      type="button"
      class="shrink-0 rounded-sm px-2 py-1 hover:bg-accent"
      @click="timelineStore.navigateToGroup(0)"
    >
      {{ t("groups.root") }}
    </button>
    <template v-for="(group, index) in timelineStore.activeGroups" :key="group.id">
      <ChevronRight class="size-3 shrink-0 text-muted-foreground" />
      <button
        type="button"
        class="max-w-48 shrink-0 truncate rounded-sm px-2 py-1 hover:bg-accent"
        :class="{ 'text-primary font-medium': index === timelineStore.activeGroups.length - 1 }"
        @click="timelineStore.navigateToGroup(index + 1)"
      >
        {{ group.name }}
      </button>
    </template>
  </nav>

  <!-- VS Code Modern UI 时间基准与参考帧率配置浮层 -->
  <Teleport to="body">
    <div
      v-if="isTimebaseOpen"
      ref="popoverRef"
      class="timebase-popover fixed z-50 w-72 rounded-md border border-border bg-popover p-2.5 text-popover-foreground select-none"
      :style="{ left: `${popoverPosition.left}px`, top: `${popoverPosition.top}px` }"
      data-ui="timebase-popover"
    >
      <!-- 1. 刻度模式切换 -->
      <div class="space-y-1.5">
        <span class="block text-[11px] font-medium text-muted-foreground">{{
          t("timeline.timebase.modeLabel")
        }}</span>
        <div class="grid grid-cols-2 gap-0.5 rounded-sm border border-border bg-surface p-0.5">
          <button
            v-for="option in modeOptions"
            :key="option.value"
            type="button"
            class="h-6 rounded-[3px] border px-1.5 text-[11px] font-medium transition-colors truncate"
            :class="
              timelineStore.timeDisplayMode === option.value
                ? 'border-secondary-border bg-secondary text-secondary-foreground'
                : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
            "
            :data-ui="`timebase-mode-${option.value}`"
            @click="timelineStore.setTimeDisplayMode(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div class="my-2.5 h-px bg-divider"></div>

      <!-- 2. 参考帧率 (FPS) -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-medium text-muted-foreground">{{ t("timeline.timebase.fpsLabel") }}</span>
          <span class="font-mono text-[11px] tabular-nums text-tertiary">{{
            `${(1000 / timelineStore.fps).toFixed(2)} ms/f`
          }}</span>
        </div>
        <div class="grid grid-cols-[repeat(4,minmax(0,1fr))_4.25rem] gap-1">
          <button
            v-for="preset in TIMELINE_FPS_PRESETS"
            :key="preset"
            type="button"
            class="h-7 rounded-sm border font-mono text-xs tabular-nums transition-colors"
            :class="
              timelineStore.fps === preset
                ? 'border-secondary-border bg-secondary text-secondary-foreground font-medium'
                : 'border-border bg-surface text-foreground hover:bg-accent'
            "
            :data-ui="`fps-preset-${preset}`"
            @click="
              timelineStore.setFps(preset);
              timelineStore.setTimeDisplayMode('frames');
            "
          >
            {{ preset }}
          </button>
          <input
            v-model.number="customFpsInput"
            type="number"
            :min="MIN_TIMELINE_FPS"
            :max="MAX_TIMELINE_FPS"
            step="1"
            :aria-label="t('timeline.timebase.customFps')"
            class="vscode-number-input"
            @change="commitCustomFps"
            @keydown.enter.stop="($event.target as HTMLInputElement).blur()"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.timebase-trigger {
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-inline: 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  flex-shrink: 0;
}

.timebase-trigger:hover {
  background: var(--accent);
  border-color: var(--tertiary);
}

.timebase-trigger[aria-expanded="true"] {
  border-color: var(--secondary-border);
  background: var(--secondary);
}

.marker-button--active {
  background: color-mix(in oklab, var(--caution) 18%, var(--surface)) !important;
  border-color: color-mix(in oklab, var(--caution) 48%, var(--border)) !important;
  color: var(--caution) !important;
}

.timebase-popover {
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.24);
}

.vscode-number-input {
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--input);
  padding-inline: 6px;
  text-align: center;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--foreground);
  appearance: textfield;
}

.vscode-number-input::-webkit-inner-spin-button,
.vscode-number-input::-webkit-outer-spin-button {
  appearance: none;
}

.vscode-number-input:focus {
  border-color: var(--primary);
  outline: none;
}
</style>
