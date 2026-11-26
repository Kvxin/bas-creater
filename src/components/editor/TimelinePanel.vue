<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { useElementSize } from "@vueuse/core";
import { FolderOpen } from "lucide-vue-next";
import TimeRuler from "./TimeRuler.vue";
import TimelineToolbar from "./timeline/TimelineToolbar.vue";
import TimelineTrackHeaders from "./timeline/TimelineTrackHeaders.vue";
import { formatTime } from "@/core/timeline";
import { getItemName } from "@/utils/resourceUtils";
import { useTimelineStore } from "@/stores/timeline";
import { useDanmuStore } from "@/stores/danmu";
import { useAudioStore } from "@/stores/audio";
import { useContextMenuStore } from "@/stores/contextMenu";
import { useTimelinePlayhead } from "@/composables/useTimelinePlayhead";
import { useTimelineInteractions } from "@/composables/useTimelineInteractions";
import { BASE_KEYFRAME_ID, normalizeKeyframes } from "@/core/keyframes";
import { draggedEffect, EFFECT_DRAG_TYPE, effectCatalog } from "@/effects/registry";
import { effectText, isDynamicEffect, matchesEffect, type EffectInstance } from "@/core/effects";
import { runSplitAction } from "@/utils/splitAction";
import type { TimelineClip, TimelineTrack, TimelineTrackType } from "@/types/timeline";
import AudioWaveform from "./audio/AudioWaveform.vue";
import AudioVolumeLine from "./audio/AudioVolumeLine.vue";
import { dBToLinear } from "@/utils/audio/audio-math";
import { Input } from "@/components/ui/input";
import { WAVEFORM_GAIN_SAMPLE_COUNT } from "@/utils/audio/constants";

const { t, locale } = useI18n();

const timelineStore = useTimelineStore();
const danmuStore = useDanmuStore();
const audioStore = useAudioStore();
const contextMenu = useContextMenuStore();

const editingGroupId = ref<string | null>(null);
const editingGroupName = ref("");
const timelineContentRef = ref<HTMLElement | null>(null);
const trackHeadersRef = ref<InstanceType<typeof TimelineTrackHeaders> | null>(null);
const scrollLeft = ref(0);

const TIMELINE_END_PADDING_MS = 10000;
const MAX_TIMELINE_ZOOM = 500;

const pixelsPerSecond = computed(() => timelineStore.zoomScale * 2);
const { width: timelineViewportWidth } = useElementSize(timelineContentRef);

// 内容宽度由真实时长驱动，右侧余量只用于视图操作，不写入项目时长。
const totalWidth = computed(() => {
  const viewPaddingMs = timelineStore.duration > 0 ? TIMELINE_END_PADDING_MS : 0;
  const contentWidth = ((timelineStore.duration + viewPaddingMs) / 1000) * pixelsPerSecond.value;
  return Math.max(timelineViewportWidth.value, contentWidth, 1);
});

const inferTrackTypeFromClips = (track: TimelineTrack): TimelineTrackType | null => {
  if (track.clips.length === 0) return null;
  return track.clips.some(clip => audioStore.audioResources.some(resource => resource.id === clip.resourceId))
    ? "audio"
    : "danmu";
};

const getTrackType = (track: TimelineTrack): TimelineTrackType | null => {
  return track.type ?? inferTrackTypeFromClips(track);
};

const getClipTimelineType = (clip: TimelineClip): TimelineTrackType => {
  const sourceTrack = timelineStore.tracks.find(track => track.clips.some(trackClip => trackClip.id === clip.id));
  if (sourceTrack?.type) return sourceTrack.type;

  return audioStore.audioResources.some(resource => resource.id === clip.resourceId) ? "audio" : "danmu";
};

const {
  isDraggingPlayhead,
  playheadSnapKind,
  playheadSnapText,
  playheadTooltipStyle,
  playheadStyle,
  rulerPlayheadStyle,
  updateTime,
  startDragPlayhead,
  stopDragPlayhead
} = useTimelinePlayhead({
  tracks: computed(() => timelineStore.tracks),
  duration: computed(() => timelineStore.duration),
  currentTime: computed(() => timelineStore.currentTime),
  pixelsPerSecond,
  scrollLeft,
  timelineContentRef,
  setCurrentTime: timeMs => timelineStore.setCurrentTime(timeMs),
  translate: key => t(key)
});

const {
  tempState,
  tooltipPosition,
  isDraggingClip,
  draggedClipId,
  originalClipTrackId,
  dragTargetTrackId,
  dragTargetGroupId,
  isAltDragCopy,
  draggedClip,
  isResizingClip,
  resizingClipId,
  resizingHandle,
  initialResizeStartTime,
  isDraggingKeyframe,
  getTrackIdAtPoint,
  canDropDraggedClipIntoGroup,
  canDropDraggedClipOnTrack,
  isDragTargetTrack,
  isInvalidDragTargetTrack,
  isDraggedClipLeavingTrack,
  getClipStyle,
  getDragGhostClipStyle,
  startDragClip,
  startResizeClip,
  selectKeyframeMarker,
  getKeyframeMarkerStyle,
  startDragKeyframe,
  cancelAllInteractions
} = useTimelineInteractions({
  timelineStore,
  danmuStore,
  audioStore,
  pixelsPerSecond,
  editingGroupId,
  getTrackType,
  getClipTimelineType
});

const beginGroupRename = (clip: TimelineClip) => {
  if (clip.kind !== "group" || timelineStore.tracks.find(track => track.id === clip.trackId)?.locked) return;
  editingGroupName.value = clip.name ?? "";
  editingGroupId.value = clip.id;
  nextTick(() => {
    const input = timelineContentRef.value?.querySelector<HTMLInputElement>("[data-ui='group-rename']");
    input?.focus();
    input?.select();
  });
};

const finishGroupRename = () => {
  if (editingGroupId.value && editingGroupName.value.trim()) {
    timelineStore.updateClip(editingGroupId.value, { name: editingGroupName.value.trim() });
  }
  editingGroupId.value = null;
};

const TIMELINE_CLIP_THEME: Record<string, { backgroundColor: string; borderColor: string }> = {
  text: { backgroundColor: "var(--clip-text)", borderColor: "var(--clip-text-border)" },
  button: { backgroundColor: "var(--clip-button)", borderColor: "var(--clip-button-border)" },
  path: { backgroundColor: "var(--clip-path)", borderColor: "var(--clip-path-border)" },
  audio: { backgroundColor: "var(--clip-audio)", borderColor: "var(--clip-audio-border)" },
  default: { backgroundColor: "var(--clip-path)", borderColor: "var(--clip-path-border)" }
};

const getClipThemeStyle = (clip: TimelineClip) => {
  if (clip.kind === "group") return { backgroundColor: "var(--clip-group)", borderColor: "var(--clip-group-border)" };
  const danmu = danmuStore.danmus.find(d => d.id === clip.resourceId);
  const isAudio = audioStore.audioResources.some(resource => resource.id === clip.resourceId);
  const type = isAudio ? "audio" : (danmu?.type ?? "default");
  return TIMELINE_CLIP_THEME[type] ?? TIMELINE_CLIP_THEME.default;
};

const handleContextMenu = (e: MouseEvent, type: "track" | "clip" | "background", data?: any) => {
  e.preventDefault();
  e.stopPropagation();

  if (type === "track") {
    contextMenu.show(e, "track-header", { id: data });
  } else if (type === "clip") {
    if (!timelineStore.selectedClipIds.includes(data.id)) timelineStore.setSelectedClip(data.id);
    // 音频片段使用独立的右键菜单（不包含"查看详情"等弹幕专属功能）
    const menuId =
      data.kind === "group" ? "timeline-group-clip" : isAudioClip(data) ? "timeline-audio-clip" : "timeline-clip";
    contextMenu.show(e, menuId, data, { "group.rename": () => beginGroupRename(data) });
  } else {
    // 背景右键：检测光标所在轨道和对应时间点
    const trackId = getTrackIdAtPoint(e);
    const rect = timelineContentRef.value!.getBoundingClientRect();
    const clickX = e.clientX - rect.left + scrollLeft.value;
    const clickTime = Math.max(0, (clickX / pixelsPerSecond.value) * 1000);
    contextMenu.show(e, "timeline-bg", { trackId, time: clickTime });
  }
};

const handleScroll = (e: Event) => {
  const target = e.target as HTMLElement;
  scrollLeft.value = target.scrollLeft;
  timelineStore.timelineScroll = { left: target.scrollLeft, top: target.scrollTop };
  trackHeadersRef.value?.setScrollTop(target.scrollTop);
  effectTrackMenu.value = null;
};

// 缩放控制：缩放前后保持 Playhead 在视口中的横向位置不变。
const setTimelineZoom = async (nextZoom: number) => {
  const container = timelineContentRef.value;
  const previousPixelsPerSecond = pixelsPerSecond.value;
  const currentScrollLeft = container?.scrollLeft ?? scrollLeft.value;
  const playheadOffset = (timelineStore.currentTime / 1000) * previousPixelsPerSecond - currentScrollLeft;
  const clampedZoom = Math.max(10, Math.min(MAX_TIMELINE_ZOOM, nextZoom));

  if (clampedZoom === timelineStore.zoomScale) return;

  timelineStore.zoomScale = clampedZoom;
  await nextTick();

  if (!container) return;

  const nextScrollLeft = (timelineStore.currentTime / 1000) * pixelsPerSecond.value - playheadOffset;
  const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
  container.scrollLeft = Math.max(0, Math.min(nextScrollLeft, maxScrollLeft));
  scrollLeft.value = container.scrollLeft;
};

const zoomIn = () => {
  void setTimelineZoom(timelineStore.zoomScale + 10);
};

const zoomOut = () => {
  void setTimelineZoom(timelineStore.zoomScale - 10);
};

const currentTimeDisplay = computed(() => {
  const { h, m, s, ms } = formatTime(timelineStore.currentTime);
  const frames = Math.floor((ms / 1000) * 30);
  return `${h > 0 ? String(h).padStart(2, "0") + ":" : ""}${String(m).padStart(
    2,
    "0"
  )}:${String(s).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
});

const effectHoverId = ref<string | null>(null);
const effectDropError = ref("");
const effectTrackMenu = ref<{ trackId: string; x: number; y: number } | null>(null);
const effectDragMode = ref<"move" | "left" | "right" | null>(null);
const effectDragClipId = ref<string | null>(null);
const effectDragId = ref<string | null>(null);
const effectDragStartX = ref(0);
const effectDragInitialSpan = ref<[number, number]>([0, 0]);
const effectDragSpan = ref<[number, number]>([0, 0]);

const getEffectTitle = (effect: EffectInstance) => {
  const plugin = effectCatalog.value?.plugins.find(item => matchesEffect(item, effect));
  return plugin ? effectText(plugin.title, locale.value) : effect.pluginId;
};

const getEffectSpan = (effect: EffectInstance): [number, number] =>
  effectDragId.value === effect.id ? effectDragSpan.value : effect.span;

const getEffectSpanStyle = (clip: TimelineClip, effect: EffectInstance) => {
  const [start, end] = getEffectSpan(effect);
  return {
    left: `${(start / Math.max(1, clip.duration)) * 100}%`,
    width: `${((end - start) / Math.max(1, clip.duration)) * 100}%`,
    minWidth: "10px"
  };
};

/** 只在区间足够宽时显示名称，避免短特效里挤出一两个字。 */
const getEffectSpanLabel = (clip: TimelineClip, effect: EffectInstance) => {
  const [start, end] = getEffectSpan(effect);
  const widthPx = ((end - start) / Math.max(1, clip.duration)) * (clip.duration / 1000) * pixelsPerSecond.value;
  return widthPx >= 44 ? getEffectTitle(effect) : "";
};

const isEditingEffect = (clip: TimelineClip, effect: EffectInstance) =>
  timelineStore.editingEffect?.clip.id === clip.id && timelineStore.editingEffect.effect.id === effect.id;

const selectEffect = (clip: TimelineClip, effect: EffectInstance) => {
  timelineStore.setSelectedClip(clip.id);
  timelineStore.setEditingEffect(clip.id, effect.id);
  effectTrackMenu.value = null;
};

/** 轨道内带有特效的资源片段，用于轨道头的 FX 列表。 */
const getTrackEffectClips = (track: TimelineTrack) =>
  track.clips.filter(clip => clip.kind === "resource" && clip.effects?.length);

const getTrackEffectCount = (track: TimelineTrack) =>
  getTrackEffectClips(track).reduce((count, clip) => count + (clip.effects?.length ?? 0), 0);

const trackEffectMenuTrack = computed(
  () => timelineStore.tracks.find(track => track.id === effectTrackMenu.value?.trackId) ?? null
);

const toggleTrackEffectMenu = (event: MouseEvent, track: TimelineTrack) => {
  if (getTrackEffectCount(track) === 0) return;
  if (effectTrackMenu.value?.trackId === track.id) {
    effectTrackMenu.value = null;
    return;
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  effectTrackMenu.value = {
    trackId: track.id,
    x: rect.right + 8,
    y: Math.max(8, Math.min(rect.top - 4, window.innerHeight - 260))
  };
};

const startDragEffect = (e: MouseEvent, clip: TimelineClip, effect: EffectInstance, mode: "move" | "left" | "right") => {
  if (
    clip.kind !== "resource" ||
    !isDynamicEffect(effect) ||
    timelineStore.tracks.find(track => track.clips.some(item => item.id === clip.id))?.locked
  ) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  selectEffect(clip, effect);
  effectDragMode.value = mode;
  effectDragClipId.value = clip.id;
  effectDragId.value = effect.id;
  effectDragStartX.value = e.clientX;
  effectDragInitialSpan.value = [...effect.span];
  effectDragSpan.value = [...effect.span];
  document.body.style.cursor = mode === "move" ? "grabbing" : mode === "left" ? "w-resize" : "e-resize";
  window.addEventListener("mousemove", onDragEffect);
  window.addEventListener("mouseup", stopDragEffect);
};

const onDragEffect = (e: MouseEvent) => {
  if (!effectDragMode.value || !effectDragClipId.value || !effectDragId.value) return;
  const clip = timelineStore.tracks.flatMap(track => track.clips).find(item => item.id === effectDragClipId.value);
  if (!clip || clip.kind !== "resource") return;
  const deltaMs = ((e.clientX - effectDragStartX.value) / pixelsPerSecond.value) * 1000;
  const [initialStart, initialEnd] = effectDragInitialSpan.value;
  const minDuration = Math.min(100, clip.duration);
  let start = initialStart;
  let end = initialEnd;
  if (effectDragMode.value === "move") {
    const duration = initialEnd - initialStart;
    start = Math.max(0, Math.min(clip.duration - duration, initialStart + deltaMs));
    end = start + duration;
  } else if (effectDragMode.value === "left") {
    start = Math.max(0, Math.min(initialEnd - minDuration, initialStart + deltaMs));
  } else {
    end = Math.min(clip.duration, Math.max(initialStart + minDuration, initialEnd + deltaMs));
  }
  effectDragSpan.value = [Math.round(start), Math.round(end)];
};

const stopDragEffect = () => {
  if (effectDragClipId.value && effectDragId.value) {
    try {
      timelineStore.updateEffectSpan(effectDragClipId.value, effectDragId.value, effectDragSpan.value);
    } catch (error) {
      effectDropError.value = error instanceof Error ? error.message : String(error);
    }
  }
  effectDragMode.value = null;
  effectDragClipId.value = null;
  effectDragId.value = null;
  document.body.style.cursor = "";
  window.removeEventListener("mousemove", onDragEffect);
  window.removeEventListener("mouseup", stopDragEffect);
};

const handleDocumentMouseDown = (e: MouseEvent) => {
  if (!(e.target as HTMLElement).closest("[data-effect-menu]")) effectTrackMenu.value = null;
};

watch(draggedEffect, plugin => {
  effectHoverId.value = null;
  if (plugin) effectDropError.value = "";
});

const isEffectDrag = (event: DragEvent) => event.dataTransfer?.types.includes(EFFECT_DRAG_TYPE);

function trackDragOver(event: DragEvent) {
  event.preventDefault();
  if (isEffectDrag(event) && event.dataTransfer) {
    effectHoverId.value = null;
    event.dataTransfer.dropEffect = "none";
  }
}

function clipDragOver(event: DragEvent, id: string) {
  if (!isEffectDrag(event) || !event.dataTransfer) return;
  event.stopPropagation();
  event.preventDefault();
  const target = timelineStore.getEffectTarget(id);
  const compatible = target && draggedEffect.value?.targets.includes(target.resource.type);
  effectHoverId.value = compatible ? id : null;
  event.dataTransfer.dropEffect = compatible ? "copy" : "none";
}

function dropEffect(event: DragEvent, id: string) {
  if (!isEffectDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  effectHoverId.value = null;
  const pluginId = event.dataTransfer?.getData(EFFECT_DRAG_TYPE);
  const plugin = effectCatalog.value?.plugins.find(item => item.id === pluginId);
  if (!plugin) return;
  try {
    timelineStore.attachEffect(id, plugin);
  } catch (error) {
    effectDropError.value = error instanceof Error ? error.message : String(error);
  }
}

const handleDrop = (event: DragEvent, trackId: string) => {
  const data = event.dataTransfer?.getData("application/json");
  if (data && timelineContentRef.value) {
    try {
      const item = JSON.parse(data);
      const rect = timelineContentRef.value.getBoundingClientRect();
      const relativeX = event.clientX - rect.left + scrollLeft.value;
      const timeMs = Math.max(0, Math.floor((relativeX / pixelsPerSecond.value) * 1000));
      timelineStore.addClip(item, trackId, timeMs);
    } catch (e) {
      console.error("解析拖拽数据失败", e);
    }
  }
};

const getClipName = (clip: TimelineClip) => {
  const danmu = danmuStore.danmus.find(d => d.id === clip.resourceId);
  if (danmu) {
    return getItemName(danmu);
  }
  return clip.name || t("common.unknown");
};

const getClipKeyframeMarkers = (clip: TimelineClip) =>
  clip.kind === "group"
    ? []
    : [
        {
          id: BASE_KEYFRAME_ID,
          timeMs: 0,
          isBase: true,
          label: t("common.keyframeBase")
        },
        ...normalizeKeyframes(clip.keyframes, clip.duration).map((keyframe, index) => ({
          id: keyframe.id,
          timeMs: keyframe.timeMs,
          isBase: false,
          label: t("common.keyframeLabel", { n: index + 2 })
        }))
      ];

const isKeyframeSelected = (clip: TimelineClip, keyframeId: string) =>
  timelineStore.selectedClipId === clip.id && timelineStore.selectedKeyframeId === keyframeId;

/** 双击关键帧 → 将播放头定位到关键帧所在时间 */
const handleKeyframeDblClick = (clip: TimelineClip, marker: { timeMs: number }) => {
  const absoluteTime = clip.startTime + marker.timeMs;
  timelineStore.setCurrentTime(absoluteTime);
};

const handleRulerClick = (timeMs: number) => {
  updateTime(timeMs);
};

const handleTimelineClick = (e: MouseEvent) => {
  if (isDraggingPlayhead.value) return;

  const rect = timelineContentRef.value!.getBoundingClientRect();
  const clickX = e.clientX - rect.left + scrollLeft.value;
  const time = Math.max(0, (clickX / pixelsPerSecond.value) * 1000);

  updateTime(time);

  timelineStore.setSelectedClip(null);
  danmuStore.select(null);
};

const handleClipClick = (clip: TimelineClip, e: MouseEvent) => {
  if (e.ctrlKey || e.metaKey || e.shiftKey) {
    timelineStore.toggleClipSelection(clip.id);
    return;
  }
  timelineStore.setSelectedClip(clip.id);
};

const handleKeyDown = (e: KeyboardEvent) => {
  const activeElement = document.activeElement as HTMLElement | null;
  if (activeElement?.matches("input, textarea, select") || activeElement?.isContentEditable) return;
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyG" && !e.altKey) {
    e.preventDefault();
    if (!e.repeat) {
      if (e.shiftKey) timelineStore.ungroupClip();
      else timelineStore.createGroup();
    }
    return;
  }
  if (e.code === "KeyS" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.repeat) {
    if (timelineStore.canSplitClip(timelineStore.selectedClipId)) {
      e.preventDefault();
      runSplitAction(() => timelineStore.splitClip(timelineStore.selectedClipId));
    }
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    const activeTag = document.activeElement?.tagName.toLowerCase();
    if (
      activeTag === "input" ||
      activeTag === "textarea" ||
      (document.activeElement as HTMLElement).isContentEditable
    ) {
      return;
    }

    if (
      timelineStore.selectedKeyframeId &&
      timelineStore.selectedKeyframeId !== BASE_KEYFRAME_ID &&
      timelineStore.selectedClipId
    ) {
      timelineStore.removeClipKeyframe(timelineStore.selectedClipId, timelineStore.selectedKeyframeId);
    } else if (timelineStore.selectedClipId) {
      timelineStore.removeSelectedClips();
    }
  }
};

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("mousedown", handleDocumentMouseDown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
  window.removeEventListener("mousedown", handleDocumentMouseDown);
  stopDragEffect();
});

watch(
  () => timelineStore.navigationRevision,
  async () => {
    contextMenu.hide();
    editingGroupId.value = null;
    cancelAllInteractions();
    stopDragPlayhead();
    stopDragEffect();
    await nextTick();
    if (timelineContentRef.value) {
      timelineContentRef.value.scrollLeft = timelineStore.timelineScroll.left;
      timelineContentRef.value.scrollTop = timelineStore.timelineScroll.top;
      scrollLeft.value = timelineContentRef.value.scrollLeft;
    }
  }
);

// ============================================================
// 音频相关辅助函数
// ============================================================

function getAudioUrl(clip: TimelineClip): string {
  const resource = audioStore.audioResources.find(r => r.id === clip.resourceId);
  return resource?.url ?? "";
}

function isAudioClip(clip: TimelineClip): boolean {
  return audioStore.audioResources.some(r => r.id === clip.resourceId);
}

function getClipVolume(clip: TimelineClip): number {
  return timelineStore.getEffectiveVolume(clip);
}

function isClipMuted(clip: TimelineClip): boolean {
  return timelineStore.isClipMuted(clip);
}

function buildGainSamples(clip: TimelineClip): number[] {
  const volumeDb = getClipVolume(clip);
  const muted = isClipMuted(clip);

  const track = timelineStore.tracks.find(t => t.clips.some(c => c.id === clip.id));
  const trackMuted = track?.muted === true;

  if (muted || trackMuted) {
    return new Array(WAVEFORM_GAIN_SAMPLE_COUNT).fill(0);
  }

  const linearGain = dBToLinear(volumeDb);
  return new Array(WAVEFORM_GAIN_SAMPLE_COUNT).fill(linearGain);
}

function handleVolumeChange(clipId: string, db: number) {
  timelineStore.previewClipParams(clipId, { volume: db });
}

function handleVolumeCommit(clipId: string, db: number) {
  timelineStore.previewClipParams(clipId, { volume: db });
  timelineStore.commitPreview();
}

function handleVolumeDiscard() {
  timelineStore.discardPreview();
}

function handleVolumeSelect(clipId: string) {
  timelineStore.setSelectedClip(clipId);
  const clip = timelineStore.tracks.flatMap(t => t.clips).find(c => c.id === clipId);
  if (clip) {
    danmuStore.select(clip.kind === "resource" ? clip.resourceId : null);
  }
}
</script>

<template>
  <div class="panel workbench-panel h-full w-full overflow-hidden flex flex-col select-none" data-ui="timeline-panel">
    <p v-if="effectDropError" role="alert" class="px-3 py-1 text-xs text-destructive">{{ effectDropError }}</p>
    <TimelineToolbar :current-time-display="currentTimeDisplay" @zoom-in="zoomIn" @zoom-out="zoomOut" />

    <!-- 头部区域 (Header Row) -->
    <div class="flex h-8 shrink-0 bg-track-header border-b border-divider">
      <!-- 左上角：轨道列表头 -->
      <div
        class="w-56 shrink-0 border-r border-divider bg-track-header flex items-center justify-between px-3 text-xs font-medium text-muted-foreground z-20"
      >
        {{ t("timeline.trackList") }}
      </div>

      <!-- 右侧：时间刻度尺 (固定视口，内部 canvas 重绘) -->
      <div class="flex-1 relative overflow-hidden cursor-pointer bg-timeline">
        <TimeRuler
          :scale="timelineStore.zoomScale"
          :scroll-left="scrollLeft"
          :padding-left="0"
          @click="handleRulerClick"
        />
        <!-- 标尺上的游标指示器 -->
        <div
          class="timeline-playhead timeline-playhead--ruler absolute top-0 bottom-0 w-px z-30 pointer-events-none"
          :style="rulerPlayheadStyle"
        >
          <div class="timeline-playhead__head"></div>
        </div>
      </div>
    </div>

    <!-- 主体区域 (Body Row) -->
    <div class="flex-1 min-h-0 flex overflow-hidden">
      <!-- 左侧：轨道列表 (无滚动条，由右侧控制 scrollTop) -->
      <TimelineTrackHeaders
        ref="trackHeadersRef"
        :tracks="timelineStore.tracks"
        :selected-track-id="timelineStore.selectedTrackId"
        :effect-menu-track-id="effectTrackMenu?.trackId ?? null"
        :get-track-type="getTrackType"
        :get-track-effect-count="getTrackEffectCount"
        @select-track="timelineStore.selectTrack"
        @toggle-track-effect-menu="toggleTrackEffectMenu"
        @toggle-expand="timelineStore.toggleTrackExpand"
        @toggle-visibility="timelineStore.toggleTrackVisibility"
        @toggle-mute="timelineStore.toggleTrackMute"
        @remove-track="timelineStore.removeTrack"
        @add-track="timelineStore.addTrack"
        @track-contextmenu="(event, trackId) => handleContextMenu(event, 'track', trackId)"
      />

      <!-- 右侧：时间轴内容区 (主滚动区域) -->
      <div
        class="flex-1 overflow-auto relative bg-timeline"
        ref="timelineContentRef"
        data-ui="timeline-tracks"
        @scroll="handleScroll"
        @click="handleTimelineClick"
        @contextmenu="handleContextMenu($event, 'background')"
      >
        <div class="timeline-track-surface relative" :style="{ width: totalWidth + 'px' }">
          <!-- 轨道列表 -->
          <template v-for="track in timelineStore.tracks" :key="track.id">
            <!-- Main Track Row -->
            <div
              class="h-10 relative transition-colors border-b border-divider"
              :class="{
                'opacity-45 saturate-50': !track.visible,
                'bg-primary/10 ring-1 ring-inset ring-primary/35':
                  isDragTargetTrack(track) && canDropDraggedClipOnTrack(track),
                'bg-destructive/10 ring-1 ring-inset ring-destructive/30': isInvalidDragTargetTrack(track)
              }"
              :data-timeline-track-id="track.id"
              @dragover="trackDragOver"
              @drop="handleDrop($event, track.id)"
            >
              <!-- Clips -->
              <div
                v-for="clip in track.clips"
                :key="clip.id"
                class="absolute top-1 bottom-1 rounded-sm border text-xs flex items-center px-2 text-white overflow-visible cursor-move select-none transition-[filter,outline-color] hover:brightness-110 group/audio"
                :class="{
                  'outline outline-1 outline-primary outline-offset-0 z-10': timelineStore.selectedClipIds.includes(
                    clip.id
                  ),
                  'outline outline-2 outline-primary z-20':
                    effectHoverId === clip.id ||
                    (dragTargetGroupId === clip.id && canDropDraggedClipIntoGroup(clip.id)),
                  'outline outline-2 outline-destructive z-20':
                    dragTargetGroupId === clip.id && !canDropDraggedClipIntoGroup(clip.id),
                  'opacity-35': isDraggedClipLeavingTrack(clip)
                }"
                :style="{ ...getClipStyle(clip), ...getClipThemeStyle(clip) }"
                :data-clip-id="clip.id"
                :data-clip-kind="clip.kind"
                :title="
                  clip.kind === 'group' && dragTargetGroupId === clip.id ? t('groups.dropIntoHint') : getClipName(clip)
                "
                @dragover="clipDragOver($event, clip.id)"
                @dragleave="effectHoverId === clip.id && (effectHoverId = null)"
                @drop="dropEffect($event, clip.id)"
                @click.stop="handleClipClick(clip, $event)"
                @dblclick.stop="clip.kind === 'group' && timelineStore.enterGroup(clip.id)"
                @mousedown.stop="startDragClip($event, clip)"
                @contextmenu.stop="handleContextMenu($event, 'clip', clip)"
              >
                <!-- 音频波形（渲染在内容下方） -->
                <AudioWaveform
                  v-if="isAudioClip(clip)"
                  class="absolute inset-0"
                  :audio-url="getAudioUrl(clip)"
                  :clip-duration-ms="isResizingClip && resizingClipId === clip.id ? tempState.duration : clip.duration"
                  :source-start-sec="
                    clip.kind === 'resource'
                      ? ((clip.sourceInMs ?? 0) +
                          (isResizingClip && resizingClipId === clip.id && resizingHandle === 'left'
                            ? tempState.startTime - initialResizeStartTime
                            : 0)) /
                        1000
                      : 0
                  "
                  :clip-start-ms="
                    isDraggingClip && draggedClipId === clip.id
                      ? tempState.startTime
                      : isResizingClip && resizingClipId === clip.id
                        ? tempState.startTime
                        : clip.startTime
                  "
                  :gain-samples="buildGainSamples(clip)"
                  :pixels-per-second="pixelsPerSecond"
                  :scroll-left="scrollLeft"
                  :track-width="timelineViewportWidth"
                />

                <FolderOpen v-if="clip.kind === 'group'" class="size-3 shrink-0 mr-1" />
                <div
                  v-if="clip.kind === 'resource' && clip.effects?.length"
                  class="pointer-events-none absolute inset-x-0 bottom-[3px] z-30 h-2.5"
                  data-effect-rail
                >
                  <div class="absolute inset-x-0 bottom-0 h-px rounded-full bg-white/15"></div>
                  <div
                    v-for="effect in clip.effects"
                    :key="`span-${effect.id}`"
                    class="pointer-events-auto absolute rounded-[2px] border transition-colors duration-150"
                    :class="
                      isEditingEffect(clip, effect)
                        ? 'inset-y-0 z-10 flex items-center border-primary/80 bg-primary/70'
                        : 'bottom-[3px] top-[3px] z-0 border-transparent bg-white/30 hover:bg-white/55'
                    "
                    :style="getEffectSpanStyle(clip, effect)"
                    :data-effect-span="effect.id"
                    :title="
                      isEditingEffect(clip, effect)
                        ? t('effects.editSpan', { name: getEffectTitle(effect) })
                        : t('effects.spanLabel', { name: getEffectTitle(effect) })
                    "
                    @mousedown.stop.prevent="
                      isEditingEffect(clip, effect)
                        ? startDragEffect($event, clip, effect, 'move')
                        : selectEffect(clip, effect)
                    "
                  >
                    <template v-if="isEditingEffect(clip, effect)">
                      <span
                        v-if="getEffectSpanLabel(clip, effect)"
                        class="pointer-events-none min-w-0 truncate px-1 text-[9px] font-medium leading-none text-white/90"
                      >
                        {{ getEffectSpanLabel(clip, effect) }}
                      </span>
                      <span
                        class="absolute -inset-y-1 left-0 w-2 cursor-w-resize"
                        :aria-label="t('effects.editSpan', { name: getEffectTitle(effect) })"
                        @mousedown.stop.prevent="startDragEffect($event, clip, effect, 'left')"
                      >
                        <span class="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-white/85"></span>
                      </span>
                      <span
                        class="absolute -inset-y-1 right-0 w-2 cursor-e-resize"
                        :aria-label="t('effects.editSpan', { name: getEffectTitle(effect) })"
                        @mousedown.stop.prevent="startDragEffect($event, clip, effect, 'right')"
                      >
                        <span class="absolute inset-y-1.5 right-0 w-0.5 rounded-full bg-white/85"></span>
                      </span>
                    </template>
                  </div>
                </div>
                <Input
                  v-if="editingGroupId === clip.id"
                  v-model="editingGroupName"
                  data-ui="group-rename"
                  class="h-6 min-w-8 text-xs"
                  :aria-label="t('groups.name')"
                  @mousedown.stop
                  @click.stop
                  @dblclick.stop
                  @blur="finishGroupRename"
                  @keydown.enter.prevent="finishGroupRename"
                  @keydown.esc.prevent="editingGroupId = null"
                />
                <span v-else class="truncate text-white/90 font-medium z-10 relative pointer-events-none">{{
                  getClipName(clip)
                }}</span>
                <span
                  v-if="clip.kind === 'group' && editingGroupId !== clip.id"
                  class="ml-2 shrink-0 text-[11px] text-white/75 pointer-events-none"
                >
                  {{ formatTime(clip.duration).str }} ·
                  {{
                    t("groups.members", {
                      n: clip.tracks.reduce((count, childTrack) => count + childTrack.clips.length, 0)
                    })
                  }}
                </span>
                <span
                  v-if="clip.kind === 'group' && dragTargetGroupId === clip.id"
                  class="ml-2 shrink-0 rounded-sm bg-black/25 px-1 text-[11px] font-semibold pointer-events-none"
                >
                  {{ canDropDraggedClipIntoGroup(clip.id) ? t("groups.dropInto") : t("groups.dropIntoUnavailable") }}
                </span>

                <!-- 音频音量线 -->
                <AudioVolumeLine
                  v-if="isAudioClip(clip)"
                  :clip-id="clip.id"
                  :current-volume="getClipVolume(clip)"
                  @volume-change="(db: number) => handleVolumeChange(clip.id, db)"
                  @volume-commit="(db: number) => handleVolumeCommit(clip.id, db)"
                  @volume-discard="handleVolumeDiscard()"
                  @select="handleVolumeSelect(clip.id)"
                />

                <!-- Resize Handles -->
                <template
                  v-if="
                    clip.kind === 'resource' &&
                    timelineStore.selectedClipIds.length === 1 &&
                    timelineStore.selectedClipId === clip.id &&
                    !track.locked
                  "
                >
                  <div
                    class="absolute left-0 top-0 bottom-0 w-2 cursor-w-resize hover:bg-white/20 z-20 flex items-center justify-center group/handle"
                    data-handle="left"
                    @mousedown.stop="startResizeClip($event, clip, 'left')"
                  >
                    <div class="w-0.5 h-4 bg-white/60 rounded-full group-hover/handle:bg-white"></div>
                  </div>

                  <div
                    class="absolute right-0 top-0 bottom-0 w-2 cursor-e-resize hover:bg-white/20 z-20 flex items-center justify-center group/handle"
                    data-handle="right"
                    @mousedown.stop="startResizeClip($event, clip, 'right')"
                  >
                    <div class="w-0.5 h-4 bg-white/60 rounded-full group-hover/handle:bg-white"></div>
                  </div>
                </template>
              </div>

              <div
                v-if="draggedClip && dragTargetTrackId === track.id && draggedClip.trackId !== track.id"
                class="absolute top-1 bottom-1 rounded-sm border text-xs flex items-center px-2 text-white overflow-hidden pointer-events-none opacity-80 shadow-md"
                :class="{
                  'ring-1 ring-primary/80': canDropDraggedClipOnTrack(track) && !isAltDragCopy,
                  'ring-1 ring-green-400/80 border-green-400': canDropDraggedClipOnTrack(track) && isAltDragCopy,
                  'ring-1 ring-destructive/80 saturate-50': isInvalidDragTargetTrack(track)
                }"
                :style="{ ...getDragGhostClipStyle(draggedClip), ...getClipThemeStyle(draggedClip) }"
              >
                <span class="truncate text-white/90 font-medium">{{ getClipName(draggedClip) }}</span>
                <span
                  v-if="isAltDragCopy && canDropDraggedClipOnTrack(track)"
                  class="ml-1 px-1 text-[11px] font-bold bg-green-400 text-green-900 rounded-sm shrink-0"
                  >+</span
                >
              </div>
            </div>

            <!-- Expanded Animation Row -->
            <div
              v-if="track.expanded"
              class="h-16 relative bg-muted/30 border-b border-divider"
              :class="{
                'bg-primary/10': isDragTargetTrack(track) && canDropDraggedClipOnTrack(track),
                'bg-destructive/10': isInvalidDragTargetTrack(track)
              }"
              :data-timeline-track-id="track.id"
            >
              <!-- Keyframe Containers (aligned with clips) -->
              <div
                v-for="clip in track.clips.filter(item => item.kind === 'resource')"
                :key="clip.id"
                class="absolute top-0 bottom-0 pointer-events-none"
                :style="{ ...getClipStyle(clip), border: 'none', background: 'transparent' }"
              >
                <div class="absolute inset-x-1 top-1/2 h-px bg-border/70"></div>
                <div class="absolute inset-0">
                  <button
                    v-for="marker in getClipKeyframeMarkers(clip)"
                    :key="marker.id"
                    type="button"
                    class="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border pointer-events-auto transition-colors"
                    :class="[
                      marker.isBase
                        ? 'border-muted-foreground/60 bg-muted-foreground/70'
                        : 'border-primary/80 bg-primary',
                      isKeyframeSelected(clip, marker.id)
                        ? 'ring-2 ring-primary/45 ring-offset-1 ring-offset-background'
                        : 'hover:ring-2 hover:ring-primary/30'
                    ]"
                    :style="getKeyframeMarkerStyle(clip, marker)"
                    :title="`${marker.label} · ${formatTime(marker.timeMs).str}`"
                    @click="selectKeyframeMarker(clip, marker, $event)"
                    @dblclick.stop="handleKeyframeDblClick(clip, marker)"
                    @mousedown.stop="startDragKeyframe($event, clip, marker)"
                  ></button>
                </div>
              </div>
            </div>
          </template>

          <!-- 底部占位 -->
          <div class="h-20"></div>

          <!-- Playhead Line (内容区域) -->
          <div
            class="timeline-playhead timeline-playhead--content absolute top-0 bottom-0 w-px z-30 cursor-ew-resize"
            :style="playheadStyle"
            :title="t('timeline.playhead.dragHint')"
            @mousedown.stop="startDragPlayhead"
          >
            <!-- 保持较宽的透明命中区域，视觉线条仍为 1px -->
            <div class="timeline-playhead__hit-area"></div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="isDraggingPlayhead"
      class="pointer-events-none fixed z-50 -translate-x-1/2 rounded-sm border border-border bg-popover px-2 py-1 font-mono text-xs text-popover-foreground shadow-md"
      :style="playheadTooltipStyle"
    >
      {{ formatTime(timelineStore.currentTime).str }}
      <span v-if="playheadSnapKind" class="ml-1 text-primary">
        {{ t("timeline.snap.indicator", { label: playheadSnapText }) }}
      </span>
    </div>

    <!-- Drag/Resize Tooltip -->
    <div
      v-if="isDraggingClip || isResizingClip"
      class="fixed z-50 pointer-events-none bg-popover text-popover-foreground px-2 py-1.5 rounded-sm shadow-md border border-border text-xs font-mono whitespace-pre flex flex-col gap-0.5"
      :style="{ top: tooltipPosition.y + 'px', left: tooltipPosition.x + 'px' }"
    >
      <div v-if="isDraggingClip">
        <template v-if="isAltDragCopy && dragTargetTrackId !== originalClipTrackId">{{
          t("timeline.tooltip.copyTo", { time: formatTime(tempState.startTime).str })
        }}</template>
        <template v-else>{{ t("timeline.tooltip.start", { time: formatTime(tempState.startTime).str }) }}</template>
      </div>
      <div v-else-if="isResizingClip">
        {{
          t("timeline.tooltip.resize", {
            start: formatTime(tempState.startTime).str,
            duration: formatTime(tempState.duration).str,
            end: formatTime(tempState.startTime + tempState.duration).str
          })
        }}
      </div>
    </div>

    <!-- 轨道特效列表：固定定位，避免被轨道头容器的 overflow 裁剪 -->
    <Teleport to="body">
      <div
        v-if="effectTrackMenu && trackEffectMenuTrack && getTrackEffectCount(trackEffectMenuTrack) > 0"
        class="fixed z-50 max-h-72 w-60 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        :style="{ left: effectTrackMenu.x + 'px', top: effectTrackMenu.y + 'px' }"
        data-effect-menu
        @mousedown.stop
      >
        <p class="px-2 pb-1 pt-1 text-[10px] uppercase tracking-[0.08em] text-tertiary">
          {{ t("effects.applied") }}
        </p>
        <template v-for="clip in getTrackEffectClips(trackEffectMenuTrack)" :key="clip.id">
          <p class="flex items-baseline gap-2 px-2 pb-1 pt-2 text-[10px] text-tertiary">
            <span class="min-w-0 flex-1 truncate font-medium text-muted-foreground">{{ getClipName(clip) }}</span>
            <span class="shrink-0 font-mono tabular-nums">{{ formatTime(clip.startTime).str }}</span>
          </p>
          <button
            v-for="effect in clip.effects ?? []"
            :key="effect.id"
            type="button"
            class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
            :class="{ 'bg-accent text-accent-foreground': isEditingEffect(clip, effect) }"
            @click.stop="selectEffect(clip, effect)"
          >
            <span
              class="size-1.5 shrink-0 rounded-full"
              :class="isEditingEffect(clip, effect) ? 'bg-primary' : 'bg-tertiary/60'"
            ></span>
            <span class="min-w-0 flex-1 truncate">{{ getEffectTitle(effect) }}</span>
            <span class="shrink-0 font-mono text-[10px] tabular-nums text-tertiary">
              {{ formatTime(effect.span[1] - effect.span[0]).str }}
            </span>
          </button>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.timeline-track-surface {
  min-height: 100%;
}
.timeline-playhead::before {
  position: absolute;
  inset: 0;
  content: "";
  background: var(--primary);
  pointer-events: none;
}
.timeline-playhead--ruler::before {
  top: 13px;
}
.timeline-playhead__head {
  position: absolute;
  top: 2px;
  left: 50%;
  width: 10px;
  height: 13px;
  transform: translateX(-50%);
  background: var(--primary);
  clip-path: polygon(0 0, 100% 0, 100% 65%, 50% 100%, 0 65%);
}
.timeline-playhead__hit-area {
  position: absolute;
  inset-block: 0;
  left: 50%;
  width: 16px;
  transform: translateX(-50%);
  background: transparent;
  cursor: ew-resize;
}
</style>
