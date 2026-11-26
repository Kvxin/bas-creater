<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { AnyDanmu } from "@/types/danmu";
import type { TimelineClip, TimelineResourceClip } from "@/types/timeline";
import { computeFilmstripLayout, sampleClipDanmusAtTime } from "@/core/filmstrip";
import { flattenTimelineClips } from "@/core/timelineGroups";
import { useAudioStore } from "@/stores/audio";
import { useDanmuStore } from "@/stores/danmu";
import { useTimelineStore } from "@/stores/timeline";
import { renderFilmstripCanvas } from "@/utils/danmuFilmstripRenderer";

const props = defineProps<{
  clip: TimelineClip;
  clipStartMs: number;
  clipDurationMs: number;
  timeOffsetMs?: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  viewportWidth: number;
  canvasWidth: number;
  canvasHeight: number;
}>();

const danmuStore = useDanmuStore();
const audioStore = useAudioStore();
const timelineStore = useTimelineStore();

const containerRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const stripHeight = ref(0);

let resizeObserver: ResizeObserver | null = null;
let drawFrameId: number | null = null;

// 只跟踪当前片段实际引用的弹幕资源，避免编辑其他弹幕时触发无关胶片条重绘。
const referencedResourceIds = computed(() => {
  const ids = new Set<string>();
  if (props.clip.kind === "resource") {
    ids.add(props.clip.resourceId);
    let parentId = props.clip.parentClipId;
    const seen = new Set<string>([props.clip.id]);
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parentClip = allClipsById.value.get(parentId);
      if (!parentClip) break;
      ids.add(parentClip.resourceId);
      parentId = parentClip.parentClipId;
    }
  } else {
    for (const child of flattenTimelineClips(props.clip.tracks, 0)) {
      ids.add(child.resourceId);
    }
  }
  return ids;
});

const allClipsById = computed(() => {
  const map = new Map<string, TimelineResourceClip>();
  for (const track of timelineStore.tracks) {
    for (const item of track.clips) {
      if (item.kind === "resource") map.set(item.id, item);
    }
  }
  return map;
});

const referencedResources = computed<AnyDanmu[]>(() => {
  const ids = referencedResourceIds.value;
  return danmuStore.danmus.filter(item => ids.has(item.id));
});

const parentClips = computed<TimelineResourceClip[]>(() => {
  if (props.clip.kind !== "resource" || !props.clip.parentClipId) return [];
  const chain: TimelineResourceClip[] = [];
  const seen = new Set<string>([props.clip.id]);
  let parentId: string | undefined = props.clip.parentClipId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = allClipsById.value.get(parentId);
    if (!parent) break;
    chain.push(parent);
    parentId = parent.parentClipId;
  }
  return chain;
});

const drawNow = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const layout = computeFilmstripLayout({
    clipStartMs: props.clipStartMs,
    clipDurationMs: props.clipDurationMs,
    pixelsPerSecond: props.pixelsPerSecond,
    scrollLeft: props.scrollLeft,
    viewportWidth: props.viewportWidth,
    stripHeight: stripHeight.value,
    canvasWidth: props.canvasWidth,
    canvasHeight: props.canvasHeight,
    minClipWidthPx: props.clip.kind === "group" ? 28 : 2,
    timeOffsetMs: props.timeOffsetMs ?? 0,
    sourceDurationMs: props.clip.duration
  });

  const resourcesById = new Map<string, AnyDanmu>(referencedResources.value.map(item => [item.id, item]));
  const audioResourceIds = new Set(audioStore.audioResources.map(item => item.id));
  const reference = { width: props.canvasWidth, height: props.canvasHeight };

  renderFilmstripCanvas({
    canvas,
    layout,
    canvasWidth: props.canvasWidth,
    canvasHeight: props.canvasHeight,
    dpr: window.devicePixelRatio || 1,
    sampleFrame: localTimeMs =>
      sampleClipDanmusAtTime({
        clip: props.clip,
        localTimeMs,
        resourcesById,
        allClipsById: allClipsById.value,
        reference,
        audioResourceIds
      })
  });
};

const scheduleDraw = () => {
  if (drawFrameId !== null) return;
  drawFrameId = requestAnimationFrame(() => {
    drawFrameId = null;
    drawNow();
  });
};

onMounted(() => {
  const container = containerRef.value;
  if (container) {
    stripHeight.value = container.clientHeight;
    resizeObserver = new ResizeObserver(entries => {
      const nextHeight = entries[0]?.contentRect.height ?? container.clientHeight;
      if (nextHeight !== stripHeight.value) {
        stripHeight.value = nextHeight;
      }
      scheduleDraw();
    });
    resizeObserver.observe(container);
  }
  scheduleDraw();
});

onUnmounted(() => {
  if (drawFrameId !== null) {
    cancelAnimationFrame(drawFrameId);
    drawFrameId = null;
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
});

watch(
  () => [
    props.clipStartMs,
    props.clipDurationMs,
    props.timeOffsetMs,
    props.pixelsPerSecond,
    props.scrollLeft,
    props.viewportWidth,
    props.canvasWidth,
    props.canvasHeight,
    stripHeight.value
  ],
  () => scheduleDraw()
);

watch([() => props.clip, referencedResources, parentClips], () => scheduleDraw(), { deep: true });
</script>

<template>
  <div
    ref="containerRef"
    class="relative size-full overflow-hidden bg-[#0b0b0f] pointer-events-none select-none"
    data-clip-filmstrip
  >
    <canvas ref="canvasRef" class="absolute top-0 bottom-0 pointer-events-none" />
  </div>
</template>
