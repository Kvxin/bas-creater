<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useElementSize, useMutationObserver } from "@vueuse/core";
import {
  DEFAULT_TIMELINE_BPM,
  DEFAULT_TIMELINE_FPS,
  formatTimelineTime,
  getGridPixel,
  getPixelsPerSecond,
  getRulerTicks,
  roundTimelineMs
} from "@/core/timeline";
import type { TimelineDisplayMode, TimelineMarker } from "@/types/timeline";

type Props = {
  scale?: number; // 缩放比例 (10-1200)
  scrollLeft?: number; // 滚动偏移量（像素）
  paddingLeft?: number; // 左侧内边距（像素），用于对齐轨道
  mode?: TimelineDisplayMode;
  fps?: number;
  bpm?: number;
  beatOffsetMs?: number;
  markers?: TimelineMarker[];
};

const props = withDefaults(defineProps<Props>(), {
  scale: 50,
  scrollLeft: 0,
  paddingLeft: 8,
  mode: "frames",
  fps: DEFAULT_TIMELINE_FPS,
  bpm: DEFAULT_TIMELINE_BPM,
  beatOffsetMs: 0,
  markers: () => []
});

const emit = defineEmits<{
  (e: "click", timeMs: number, shiftKey: boolean): void;
  (e: "select-marker", timeMs: number): void;
  (e: "remove-marker", markerId: string): void;
}>();

const { t } = useI18n();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);
const { width: containerWidth } = useElementSize(containerRef);
let resizeObserver: ResizeObserver | null = null;

// 根据点击位置计算对应的原始时间（毫秒）
const getTimeFromX = (clientX: number): number => {
  const container = containerRef.value;
  if (!container) return 0;

  const rect = container.getBoundingClientRect();
  const relativeX = clientX - rect.left - props.paddingLeft + props.scrollLeft;
  const pps = getPixelsPerSecond(props.scale);
  if (pps <= 0) return 0;

  return roundTimelineMs(Math.max(0, (relativeX / pps) * 1000));
};

const handleClick = (event: MouseEvent) => {
  const timeMs = getTimeFromX(event.clientX);
  emit("click", timeMs, event.shiftKey);
};

const visibleMarkers = computed(() => {
  const maxWidth = containerWidth.value || 1600;
  return props.markers
    .map(marker => ({
      marker,
      x: props.paddingLeft + getGridPixel(props.scale, marker.timeMs) - props.scrollLeft
    }))
    .filter(item => item.x >= -16 && item.x <= maxWidth + 16);
});

const formatMarkerLabel = (timeMs: number) =>
  formatTimelineTime(timeMs, {
    mode: props.mode,
    fps: props.fps,
    bpm: props.bpm,
    beatOffsetMs: props.beatOffsetMs
  });

const handleMarkerClick = (event: MouseEvent, marker: TimelineMarker) => {
  if (event.altKey) {
    emit("remove-marker", marker.id);
    return;
  }
  emit("select-marker", marker.timeMs);
};

// 颜色配置
const getThemeColors = () => {
  // 面板会覆盖主题变量，Canvas 应使用标尺所在面板的实际配色。
  const styles = getComputedStyle(containerRef.value ?? document.documentElement);
  const foreground = styles.getPropertyValue("--foreground").trim() || "hsl(0 0% 87%)";
  const muted = styles.getPropertyValue("--muted-foreground").trim() || "hsl(0 0% 56%)";
  const tertiary = styles.getPropertyValue("--tertiary").trim() || muted;

  return {
    background: "transparent",
    majorTick: foreground,
    mediumTick: muted,
    minorTick: `color-mix(in oklab, ${muted} 45%, transparent)`,
    text: foreground,
    subText: tertiary
  };
};

const tickHeight = {
  major: 13,
  medium: 8,
  minor: 4
};

const textAreaHeight = 14;

const drawRuler = () => {
  const canvas = canvasRef.value;
  const container = containerRef.value;
  if (!canvas || !container) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = container.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const colors = getThemeColors();

  ctx.clearRect(0, 0, width, height);

  const pps = getPixelsPerSecond(props.scale);
  if (pps <= 0) return;

  const bufferPixel = 100;
  const startPixel = -bufferPixel;
  const endPixel = width + bufferPixel;

  const rawStartTime = ((startPixel - props.paddingLeft + props.scrollLeft) * 1000) / pps;
  const rawEndTime = ((endPixel - props.paddingLeft + props.scrollLeft) * 1000) / pps;

  const ticks = getRulerTicks({
    startTimeMs: rawStartTime,
    endTimeMs: rawEndTime,
    scale: props.scale,
    mode: props.mode,
    fps: props.fps,
    bpm: props.bpm,
    beatOffsetMs: props.beatOffsetMs
  });

  for (const tick of ticks) {
    const x = props.paddingLeft + getGridPixel(props.scale, tick.timeMs) - props.scrollLeft;
    if (x < -60 || x > width + 60) continue;

    let tickH = tickHeight.minor;
    let tickColor = colors.minorTick;

    if (tick.kind === "major") {
      tickH = tickHeight.major;
      tickColor = colors.majorTick;
      if (tick.label) {
        ctx.fillStyle = colors.text;
        ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        ctx.textAlign = tick.timeMs <= 0.05 ? "left" : "center";
        ctx.fillText(tick.label, tick.timeMs <= 0.05 ? x + 2 : x, textAreaHeight - 2);
      }
    } else if (tick.kind === "medium") {
      tickH = tickHeight.medium;
      tickColor = colors.mediumTick;
      if (tick.label) {
        ctx.fillStyle = colors.subText;
        ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        ctx.textAlign = "center";
        ctx.fillText(tick.label, x, textAreaHeight - 2);
      }
    }

    ctx.beginPath();
    ctx.strokeStyle = tickColor;
    ctx.lineWidth = 1;
    const tickX = Math.round(x) + 0.5;
    ctx.moveTo(tickX, height);
    ctx.lineTo(tickX, height - tickH);
    ctx.stroke();
  }
};

useMutationObserver(() => document.documentElement, drawRuler, {
  attributes: true,
  attributeFilter: ["class"]
});

watch(
  () => [props.scale, props.scrollLeft, props.paddingLeft, props.mode, props.fps, props.bpm, props.beatOffsetMs],
  drawRuler,
  { immediate: false }
);

onMounted(() => {
  drawRuler();
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      drawRuler();
    });
    resizeObserver.observe(containerRef.value);
  }
});

onUnmounted(() => {
  resizeObserver?.disconnect();
});
</script>

<template>
  <div ref="containerRef" class="time-ruler w-full h-full relative cursor-pointer" @click="handleClick">
    <canvas ref="canvasRef" class="time-ruler-canvas absolute inset-0 pointer-events-none"></canvas>
    <button
      v-for="{ marker, x } in visibleMarkers"
      :key="marker.id"
      type="button"
      class="ruler-marker"
      :style="{ left: `${x}px` }"
      :title="t('timeline.markers.itemTitle', { time: formatMarkerLabel(marker.timeMs) })"
      :aria-label="t('timeline.markers.itemTitle', { time: formatMarkerLabel(marker.timeMs) })"
      data-ui="timeline-ruler-marker"
      @click.stop="handleMarkerClick($event, marker)"
      @contextmenu.prevent.stop="emit('remove-marker', marker.id)"
    ></button>
  </div>
</template>

<style scoped>
.time-ruler {
  min-height: 22px;
}

.ruler-marker {
  position: absolute;
  top: 2px;
  width: 9px;
  height: 11px;
  padding: 0;
  border: none;
  transform: translateX(-50%);
  background: var(--caution);
  clip-path: polygon(0 0, 100% 0, 100% 62%, 50% 100%, 0 62%);
  z-index: 25;
  opacity: 0.92;
  transition: transform var(--motion-fast) ease, filter var(--motion-fast) ease;
}

.ruler-marker:hover {
  opacity: 1;
  filter: brightness(1.12);
  transform: translateX(-50%) scale(1.12);
}
</style>
