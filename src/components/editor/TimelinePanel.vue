<script setup lang="ts">
import { ref, computed, watch, reactive, onMounted, onUnmounted, nextTick } from "vue";
import { useElementSize } from "@vueuse/core";
import {
  Clock,
  ZoomIn,
  ZoomOut,
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
  Captions,
  Music2,
  Video
} from "lucide-vue-next";
import TimeRuler from "./TimeRuler.vue";
import { formatTime } from "@/utils/timeline";
import { getItemName } from "@/utils/resourceUtils";
import { useTimelineStore } from "@/stores/timeline";
import { useDanmuStore } from "@/stores/danmu";
import { useAudioStore } from "@/stores/audio";
import { compileTimelineToBas } from "@/utils/compiler";
import basService from "@/utils/bas";
import { useContextMenuStore } from "@/stores/contextMenu";
import { BASE_KEYFRAME_ID, clampKeyframeTime, normalizeKeyframes } from "@/utils/keyframes";

import type { AnimationSegment, TimelineClip, TimelineTrack, TimelineTrackType } from "@/types/timeline";
import AudioWaveform from "./audio/AudioWaveform.vue";
import AudioVolumeLine from "./audio/AudioVolumeLine.vue";
import { dBToLinear } from "@/utils/audio/audio-math";
import { WAVEFORM_GAIN_SAMPLE_COUNT } from "@/utils/audio/constants";

const timelineStore = useTimelineStore();
const danmuStore = useDanmuStore();
const audioStore = useAudioStore();
const contextMenu = useContextMenuStore();

const TIMELINE_CLIP_THEME: Record<string, { backgroundColor: string; borderColor: string }> = {
  text: { backgroundColor: "#5DBAA0", borderColor: "#75D2B8" },
  button: { backgroundColor: "#BA5D7A", borderColor: "#D17B95" },
  path: { backgroundColor: "#5d93ba", borderColor: "#78ADD2" },
  audio: { backgroundColor: "#8F5DBA", borderColor: "#A979D1" },
  default: { backgroundColor: "#5d93ba", borderColor: "#78ADD2" }
};

const getClipThemeStyle = (clip: any) => {
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
    // 音频片段使用独立的右键菜单（不包含"查看详情"等弹幕专属功能）
    const menuId = isAudioClip(data) ? "timeline-audio-clip" : "timeline-clip";
    contextMenu.show(e, menuId, data);
  } else {
    // 背景右键：检测光标所在轨道和对应时间点
    const trackId = getTrackIdAtPoint(e);
    const rect = timelineContentRef.value!.getBoundingClientRect();
    const clickX = e.clientX - rect.left + scrollLeft.value;
    const clickTime = Math.max(0, (clickX / pixelsPerSecond.value) * 1000);
    contextMenu.show(e, "timeline-bg", { trackId, time: clickTime });
  }
};

// 计算动画片段的样式
const getAnimationSegmentStyle = (clip: any, anim: AnimationSegment, index: number) => {
  let startOffset = 0;

  // Check if dragging or resizing this specific animation
  const isDragging = isDraggingAnimation.value && draggedAnimationId.value === anim.id;
  const isResizing = isResizingAnimation.value && resizingAnimationId.value === anim.id;

  // Use temp state if active
  const delay = isDragging && anim.type === "set" ? tempAnimationState.delay : anim.delay || 0;
  const duration = isResizing ? tempAnimationState.duration : anim.duration;

  if (anim.type === "set") {
    startOffset = delay;
  } else {
    // For 'then', calculate start based on previous items
    for (let i = 0; i < index; i++) {
      const prev = clip.animations[i];
      if (!prev) continue;

      // If prev is being resized, use its temp duration
      const prevDuration =
        isResizingAnimation.value && resizingAnimationId.value === prev.id
          ? tempAnimationState.duration
          : prev.duration;
      const prevDelay =
        isDraggingAnimation.value && draggedAnimationId.value === prev.id && prev.type === "set"
          ? tempAnimationState.delay
          : prev.delay || 0;

      // Check if prev is a 'then' block being dragged (inserting gap AFTER it? No, insert BEFORE it)
      // If dragging prev (then block), it visually shifts right.
      // Does it affect subsequent blocks? Yes, subsequent blocks shift right too.
      const prevGap =
        isDraggingAnimation.value && draggedAnimationId.value === prev.id && prev.type === "then"
          ? tempAnimationState.delay
          : 0;

      startOffset += prevDuration + prevDelay + prevGap;
    }

    // If current block is 'then' and being dragged, add its own gap offset
    if (isDragging && anim.type === "then") {
      startOffset += tempAnimationState.delay;
    }
  }

  const leftPercent = (startOffset / clip.duration) * 100;
  const widthPercent = (duration / clip.duration) * 100;

  // Colors
  const bgColor = anim.type === "set" ? "rgba(93, 186, 160, 0.88)" : "rgba(93, 147, 186, 0.88)";
  const borderColor = anim.type === "set" ? "rgba(117, 210, 184, 1)" : "rgba(120, 173, 210, 1)";

  return {
    left: `${leftPercent}%`,
    width: `${widthPercent}%`,
    height: "80%", // Fill most of the expanded row height
    top: "10%",
    backgroundColor: bgColor,
    borderColor: borderColor,
    borderWidth: "1px",
    borderRadius: "3px",
    zIndex: isDragging || isResizing ? 20 : 15
  };
};

const handleAnimationClick = (clip: any, anim: AnimationSegment, e: MouseEvent) => {
  e.stopPropagation();
  timelineStore.setSelectedClip(clip.id);
  timelineStore.setSelectedAnimation(anim.id);
  danmuStore.select(clip.resourceId);
};

const TIMELINE_END_PADDING_MS = 10000;
const MAX_TIMELINE_ZOOM = 500;

// 像素/秒 计算
const pixelsPerSecond = computed(() => timelineStore.zoomScale * 2);
const timelineContentRef = ref<HTMLElement | null>(null);
const { width: timelineViewportWidth } = useElementSize(timelineContentRef);

// 内容宽度由真实时长驱动，右侧余量只用于视图操作，不写入项目时长。
const totalWidth = computed(() => {
  const viewPaddingMs = timelineStore.duration > 0 ? TIMELINE_END_PADDING_MS : 0;
  const contentWidth = ((timelineStore.duration + viewPaddingMs) / 1000) * pixelsPerSecond.value;
  return Math.max(timelineViewportWidth.value, contentWidth, 1);
});

// 滚动容器
const trackListRef = ref<HTMLElement | null>(null);
const scrollLeft = ref(0);

const handleScroll = (e: Event) => {
  const target = e.target as HTMLElement;
  scrollLeft.value = target.scrollLeft;

  // 同步左侧轨道列表的垂直滚动
  if (trackListRef.value) {
    trackListRef.value.scrollTop = target.scrollTop;
  }
};

// 缩放控制：缩放前后保持 Playhead 在视口中的横向位置不变。
const setTimelineZoom = async (nextZoom: number) => {
  const container = timelineContentRef.value;
  const previousPixelsPerSecond = pixelsPerSecond.value;
  const currentScrollLeft = container?.scrollLeft ?? scrollLeft.value;
  const playheadOffset =
    (timelineStore.currentTime / 1000) * previousPixelsPerSecond - currentScrollLeft;
  const clampedZoom = Math.max(10, Math.min(MAX_TIMELINE_ZOOM, nextZoom));

  if (clampedZoom === timelineStore.zoomScale) return;

  timelineStore.zoomScale = clampedZoom;
  await nextTick();

  if (!container) return;

  const nextScrollLeft =
    (timelineStore.currentTime / 1000) * pixelsPerSecond.value - playheadOffset;
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

// 格式化当前时间显示
const currentTimeDisplay = computed(() => {
  const { h, m, s, ms } = formatTime(timelineStore.currentTime);
  const frames = Math.floor((ms / 1000) * 30);
  return `${h > 0 ? String(h).padStart(2, "0") + ":" : ""}${String(m).padStart(
    2,
    "0"
  )}:${String(s).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
});

// 处理拖拽放置
const handleDrop = (event: DragEvent, trackId: string) => {
  const data = event.dataTransfer?.getData("application/json");
  if (data && timelineContentRef.value) {
    try {
      const item = JSON.parse(data);
      // 计算拖放位置的时间
      const rect = timelineContentRef.value.getBoundingClientRect();
      // 这里 relativeX 直接用 clientX - rect.left + scrollLeft 即可
      // 因为 timelineContentRef 现在就是单纯的滚动容器
      const relativeX = event.clientX - rect.left + scrollLeft.value;

      const timeMs = Math.max(0, Math.floor((relativeX / pixelsPerSecond.value) * 1000));

      timelineStore.addClip(item, trackId, timeMs);
    } catch (e) {
      console.error("解析拖拽数据失败", e);
    }
  }
};

// 添加轨道
const handleAddTrack = () => {
  timelineStore.addTrack();
};

// 删除轨道
const handleRemoveTrack = (trackId: string) => {
  timelineStore.removeTrack(trackId);
};

const toggleTrackVisibility = (trackId: string) => {
  timelineStore.toggleTrackVisibility(trackId);
};

const toggleTrackMute = (trackId: string) => {
  timelineStore.toggleTrackMute(trackId);
};

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

const getTrackTypeLabel = (track: TimelineTrack) => {
  const type = getTrackType(track);
  if (type === "audio") return "音频轨道";
  if (type === "danmu") return "弹幕轨道";
  return "空轨道";
};

const getTrackTypeIcon = (track: TimelineTrack) => {
  const type = getTrackType(track);
  if (type === "audio") return Music2;
  return Captions;
};

const getTrackPrimaryIcon = (track: TimelineTrack) => {
  if (getTrackType(track) === "audio") {
    return track.muted ? VolumeX : Volume2;
  }
  return track.visible ? Eye : EyeOff;
};

const getTrackPrimaryLabel = (track: TimelineTrack) => {
  if (getTrackType(track) === "audio") {
    return track.muted ? "取消静音轨道" : "静音轨道";
  }
  return track.visible ? "隐藏轨道" : "显示轨道";
};

const isTrackPrimaryActive = (track: TimelineTrack) => {
  return getTrackType(track) === "audio" ? Boolean(track.muted) : track.visible;
};

const toggleTrackPrimaryAction = (track: TimelineTrack) => {
  if (getTrackType(track) === "audio") {
    toggleTrackMute(track.id);
    return;
  }
  toggleTrackVisibility(track.id);
};

// 临时状态，用于拖拽/调整大小时的高性能更新
const tempState = reactive({
  startTime: 0,
  duration: 0
});

const tooltipPosition = reactive({ x: 0, y: 0 });

// 获取 Clip 样式
const getClipStyle = (clip: any) => {
  let startTime = clip.startTime;
  let duration = clip.duration;
  let zIndex = 1;

  // 如果正在拖拽这个片段，使用临时状态
  if (isDraggingClip.value && draggedClipId.value === clip.id) {
    startTime = tempState.startTime;
    zIndex = 100;
  }
  // 如果正在调整这个片段大小，使用临时状态
  else if (isResizingClip.value && resizingClipId.value === clip.id) {
    startTime = tempState.startTime;
    duration = tempState.duration;
    zIndex = 100;
  }

  const left = (startTime / 1000) * pixelsPerSecond.value;
  const width = (duration / 1000) * pixelsPerSecond.value;

  return {
    left: `${left}px`,
    width: `${width}px`,
    zIndex
  };
};

const getClipName = (clip: any) => {
  const danmu = danmuStore.danmus.find(d => d.id === clip.resourceId);
  if (danmu) {
    return getItemName(danmu);
  }
  return clip.name || "Unknown Clip";
};

const getClipKeyframeMarkers = (clip: TimelineClip) => [
  {
    id: BASE_KEYFRAME_ID,
    timeMs: 0,
    isBase: true,
    label: "基态"
  },
  ...normalizeKeyframes(clip.keyframes, clip.duration).map((keyframe, index) => ({
    id: keyframe.id,
    timeMs: keyframe.timeMs,
    isBase: false,
    label: `关键帧 ${index + 2}`
  }))
];

const isKeyframeSelected = (clip: TimelineClip, keyframeId: string) =>
  timelineStore.selectedClipId === clip.id && timelineStore.selectedKeyframeId === keyframeId;

const getKeyframeMarkerStyle = (clip: TimelineClip, marker: { id: string; timeMs: number }) => {
  const timeMs =
    isDraggingKeyframe.value && draggedKeyframeClipId.value === clip.id && draggedKeyframeId.value === marker.id
      ? tempKeyframeTime.value
      : marker.timeMs;
  const leftPercent = (clampKeyframeTime(timeMs, clip.duration) / Math.max(1, clip.duration)) * 100;

  return {
    left: `${leftPercent}%`
  };
};

const selectKeyframeMarker = (clip: TimelineClip, marker: { id: string; isBase: boolean }, event?: MouseEvent) => {
  event?.stopPropagation();
  timelineStore.setSelectedClip(clip.id);
  timelineStore.setSelectedKeyframe(marker.id);
  danmuStore.select(clip.resourceId);
};

/** 双击关键帧 → 将播放头定位到关键帧所在时间 */
const handleKeyframeDblClick = (clip: TimelineClip, marker: { timeMs: number }) => {
  const absoluteTime = clip.startTime + marker.timeMs;
  timelineStore.setCurrentTime(absoluteTime);
  if (!timelineStore.isPlaying) {
    basService.seek(absoluteTime / 1000, true);
  }
};

// 游标位置 (相对于内容区域)
type PlayheadSemanticSnapCandidate = {
  timeMs: number;
  label: "片段开始" | "片段结束" | "关键帧";
};
// 吸附像素大小
const PLAYHEAD_SEMANTIC_SNAP_SCREEN_PX = 5;
const playheadSnapLabel = ref<PlayheadSemanticSnapCandidate["label"] | null>(null);
const playheadTooltipClientX = ref(0);
const playheadTooltipTop = ref(0);

const playheadSemanticSnapCandidates = computed<PlayheadSemanticSnapCandidate[]>(() => {
  const candidates = new Map<string, PlayheadSemanticSnapCandidate>();
  const addCandidate = (timeMs: number, label: PlayheadSemanticSnapCandidate["label"]) => {
    const clampedTime = Math.min(Math.max(0, timeMs), timelineStore.duration);
    if (!Number.isFinite(clampedTime)) return;
    const key = clampedTime.toFixed(3);
    if (!candidates.has(key)) candidates.set(key, { timeMs: clampedTime, label });
  };

  for (const track of timelineStore.tracks) {
    for (const clip of track.clips) {
      addCandidate(clip.startTime, "片段开始");
      addCandidate(clip.startTime + clip.duration, "片段结束");
      for (const keyframe of normalizeKeyframes(clip.keyframes, clip.duration)) {
        addCandidate(clip.startTime + keyframe.timeMs, "关键帧");
      }
    }
  }

  return [...candidates.values()].sort((left, right) => left.timeMs - right.timeMs);
});

const resolvePlayheadSemanticSnap = (rawTimeMs: number, disabled = false) => {
  const clampedTime = Math.min(Math.max(0, rawTimeMs), timelineStore.duration);
  if (disabled) return { timeMs: clampedTime, label: null };

  const candidates = playheadSemanticSnapCandidates.value;
  let low = 0;
  let high = candidates.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((candidates[middle]?.timeMs ?? 0) < clampedTime) low = middle + 1;
    else high = middle;
  }

  let nearest: PlayheadSemanticSnapCandidate | null = null;
  for (const candidate of [candidates[low - 1], candidates[low]]) {
    if (!candidate) continue;
    if (!nearest || Math.abs(candidate.timeMs - clampedTime) < Math.abs(nearest.timeMs - clampedTime)) {
      nearest = candidate;
    }
  }

  const thresholdMs = (PLAYHEAD_SEMANTIC_SNAP_SCREEN_PX / pixelsPerSecond.value) * 1000;
  if (nearest && Math.abs(nearest.timeMs - clampedTime) <= thresholdMs) {
    return { timeMs: nearest.timeMs, label: nearest.label };
  }

  return { timeMs: clampedTime, label: null };
};

const playheadTooltipStyle = computed(() => ({
  left: `${Math.min(Math.max(80, playheadTooltipClientX.value), window.innerWidth - 80)}px`,
  top: `${playheadTooltipTop.value}px`
}));

const playheadStyle = computed(() => {
  const left = (timelineStore.currentTime / 1000) * pixelsPerSecond.value;
  return {
    left: `${left}px`
  };
});

// 标尺区域的游标位置 (相对于视口，需要减去 scrollLeft)
const rulerPlayheadStyle = computed(() => {
  const rawLeft = (timelineStore.currentTime / 1000) * pixelsPerSecond.value;
  return {
    left: `${rawLeft - scrollLeft.value}px`,
    display: rawLeft - scrollLeft.value >= 0 ? "block" : "none" // 简单优化，视口外隐藏
  };
});

// 处理 TimeRuler 发出的点击事件
const handleRulerClick = (timeMs: number) => {
  updateTime(timeMs);
};

// 处理轨道区域点击
const handleTimelineClick = (e: MouseEvent) => {
  // 如果正在拖拽 Playhead，不处理点击
  if (isDraggingPlayhead.value) return;

  const rect = timelineContentRef.value!.getBoundingClientRect();
  const clickX = e.clientX - rect.left + scrollLeft.value;
  // 计算时间 (ms)
  const time = Math.max(0, (clickX / pixelsPerSecond.value) * 1000);

  updateTime(time);

  // 点击空白区域取消选中
  timelineStore.setSelectedClip(null);
  timelineStore.setSelectedAnimation(null);
  danmuStore.select(null);
};

const updateTime = (time: number, disableSnap = false) => {
  const resolved = resolvePlayheadSemanticSnap(time, disableSnap);
  playheadSnapLabel.value = resolved.label;
  timelineStore.setCurrentTime(resolved.timeMs);
  // 如果是暂停状态，也要同步 BAS 引擎时间，方便预览静态帧
  if (!timelineStore.isPlaying) {
    basService.seek(timelineStore.currentTime / 1000, true);
  }
};

// Clip 拖拽逻辑
const isDraggingClip = ref(false);
const draggedClipId = ref<string | null>(null);
const initialClipStartTime = ref(0);
const dragStartX = ref(0);
const originalClipTrackId = ref<string | null>(null);
const dragTargetTrackId = ref<string | null>(null);
const draggedClipType = ref<TimelineTrackType | null>(null);
const isAltDragCopy = ref(false);

const draggedClip = computed(() => {
  if (!draggedClipId.value) return null;

  for (const track of timelineStore.tracks) {
    const clip = track.clips.find(trackClip => trackClip.id === draggedClipId.value);
    if (clip) return clip;
  }

  return null;
});

const getTrackIdAtPoint = (event: MouseEvent) => {
  const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
  const trackElement = element?.closest<HTMLElement>("[data-timeline-track-id]");
  const trackId = trackElement?.dataset.timelineTrackId ?? null;

  if (!trackId || !timelineStore.tracks.some(track => track.id === trackId)) {
    return null;
  }

  return trackId;
};

const canDropDraggedClipOnTrack = (track: TimelineTrack) => {
  if (!isDraggingClip.value || !draggedClipId.value || !draggedClipType.value) return false;
  if (track.id === originalClipTrackId.value) return true;

  const targetType = getTrackType(track);
  if (targetType && targetType !== draggedClipType.value) return false;

  return track.clips.length === 0 || targetType === draggedClipType.value;
};

const isDragTargetTrack = (track: TimelineTrack) => {
  return isDraggingClip.value && dragTargetTrackId.value === track.id;
};

const isInvalidDragTargetTrack = (track: TimelineTrack) => {
  return isDragTargetTrack(track) && !canDropDraggedClipOnTrack(track);
};

const isDraggedClipLeavingTrack = (clip: TimelineClip) => {
  return (
    isDraggingClip.value &&
    draggedClipId.value === clip.id &&
    Boolean(dragTargetTrackId.value) &&
    dragTargetTrackId.value !== clip.trackId
  );
};

const getDragGhostClipStyle = (clip: TimelineClip) => {
  const left = (tempState.startTime / 1000) * pixelsPerSecond.value;
  const width = (clip.duration / 1000) * pixelsPerSecond.value;

  return {
    left: `${left}px`,
    width: `${width}px`,
    zIndex: 110
  };
};

const handleClipClick = (clip: any, e: MouseEvent) => {
  timelineStore.setSelectedClip(clip.id);
  danmuStore.select(clip.resourceId);
};

const startDragClip = (e: MouseEvent, clip: any) => {
  // 左键点击才触发
  if (e.button !== 0) return;

  // 如果点击的是 resize handle，不要触发拖拽移动
  if ((e.target as HTMLElement).dataset.handle) return;

  e.stopPropagation(); // 阻止冒泡
  e.preventDefault();

  // 拖拽时同时也选中
  timelineStore.setSelectedClip(clip.id);

  isDraggingClip.value = true;
  draggedClipId.value = clip.id;
  initialClipStartTime.value = clip.startTime;
  dragStartX.value = e.clientX;
  originalClipTrackId.value = clip.trackId;
  dragTargetTrackId.value = clip.trackId;
  draggedClipType.value = getClipTimelineType(clip);
  isAltDragCopy.value = false;

  // 初始化临时状态
  tempState.startTime = clip.startTime;
  tempState.duration = clip.duration;

  // 初始化 tooltip 位置
  tooltipPosition.x = e.clientX + 15;
  tooltipPosition.y = e.clientY + 15;

  document.body.style.cursor = "move";
  window.addEventListener("mousemove", onDragClip);
  window.addEventListener("mouseup", stopDragClip);
};

const onDragClip = (e: MouseEvent) => {
  if (!isDraggingClip.value || !draggedClipId.value) return;

  const deltaX = e.clientX - dragStartX.value;
  const deltaMs = (deltaX / pixelsPerSecond.value) * 1000;

  let newStartTime = initialClipStartTime.value + deltaMs;
  newStartTime = Math.max(0, newStartTime); // 限制最小时间为 0

  // 只更新本地临时状态，不触发 Store 更新
  tempState.startTime = newStartTime;
  dragTargetTrackId.value = getTrackIdAtPoint(e) ?? dragTargetTrackId.value;

  // 跟踪 Alt 键状态：Alt + 跨轨道拖拽 = 复制
  isAltDragCopy.value = e.altKey;
  const crossingTracks = dragTargetTrackId.value !== originalClipTrackId.value;
  document.body.style.cursor = e.altKey && crossingTracks ? "copy" : "move";

  // 更新 tooltip 位置
  tooltipPosition.x = e.clientX + 15;
  tooltipPosition.y = e.clientY + 15;
};

const stopDragClip = () => {
  if (isDraggingClip.value && draggedClipId.value) {
    const targetTrackId = dragTargetTrackId.value ?? originalClipTrackId.value;
    const targetTrack = timelineStore.tracks.find(track => track.id === targetTrackId);

    // Alt + 跨轨道拖拽 = 复制到目标轨道。弹幕会同时复制资源，
    // 使两个片段之后能独立编辑；音频仍复用同一文件资源。
    if (isAltDragCopy.value && targetTrackId && targetTrackId !== originalClipTrackId.value && targetTrack) {
      const sourceClip = timelineStore.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.id === draggedClipId.value);
      const sourceDanmu = sourceClip
        ? danmuStore.danmus.find((danmu) => danmu.id === sourceClip.resourceId)
        : undefined;

      if (sourceDanmu) {
        const duplicatedDanmu = danmuStore.duplicate(sourceDanmu.id);
        const copiedClip = duplicatedDanmu && timelineStore.copyClipToTrack(
          draggedClipId.value,
          targetTrackId,
          {
            startTime: tempState.startTime,
            resourceId: duplicatedDanmu.id,
            name: getItemName(duplicatedDanmu),
          },
        );

        if (!copiedClip && duplicatedDanmu) {
          danmuStore.remove(duplicatedDanmu.id);
        }
      } else {
        timelineStore.copyClipToTrack(draggedClipId.value, targetTrackId, {
          startTime: tempState.startTime,
        });
      }
    } else {
      const moved =
        Boolean(targetTrackId) &&
        Boolean(targetTrack) &&
        timelineStore.moveClipToTrack(
          draggedClipId.value,
          targetTrackId!,
          { startTime: tempState.startTime },
          {
            clipType: draggedClipType.value ?? undefined,
            targetTrackType: targetTrack ? getTrackType(targetTrack) : null
          }
        );

      if (!moved && originalClipTrackId.value) {
        timelineStore.moveClipToTrack(
          draggedClipId.value,
          originalClipTrackId.value,
          { startTime: tempState.startTime },
          { clipType: draggedClipType.value ?? undefined }
        );
      }
    }
  }

  isDraggingClip.value = false;
  draggedClipId.value = null;
  originalClipTrackId.value = null;
  dragTargetTrackId.value = null;
  draggedClipType.value = null;
  isAltDragCopy.value = false;
  document.body.style.cursor = "";
  window.removeEventListener("mousemove", onDragClip);
  window.removeEventListener("mouseup", stopDragClip);
};

// Clip 调整大小逻辑 (Resize)
const isResizingClip = ref(false);
const resizingClipId = ref<string | null>(null);
const resizingHandle = ref<"left" | "right" | null>(null);
const initialResizeStartTime = ref(0);
const initialResizeDuration = ref(0);
const resizeStartX = ref(0);

const startResizeClip = (e: MouseEvent, clip: any, handle: "left" | "right") => {
  e.stopPropagation();
  e.preventDefault(); // 防止选中文本

  isResizingClip.value = true;
  resizingClipId.value = clip.id;
  resizingHandle.value = handle;
  initialResizeStartTime.value = clip.startTime;
  initialResizeDuration.value = clip.duration;
  resizeStartX.value = e.clientX;

  // 初始化临时状态
  tempState.startTime = clip.startTime;
  tempState.duration = clip.duration;

  // 初始化 tooltip 位置
  tooltipPosition.x = e.clientX + 15;
  tooltipPosition.y = e.clientY + 15;

  document.body.style.cursor = handle === "left" ? "w-resize" : "e-resize";
  window.addEventListener("mousemove", onResizeClip);
  window.addEventListener("mouseup", stopResizeClip);
};

const onResizeClip = (e: MouseEvent) => {
  if (!isResizingClip.value || !resizingClipId.value) return;

  const deltaX = e.clientX - resizeStartX.value;
  const deltaMs = (deltaX / pixelsPerSecond.value) * 1000;

  if (resizingHandle.value === "right") {
    // 右侧拖拽：只改变时长
    let newDuration = initialResizeDuration.value + deltaMs;
    newDuration = Math.max(100, newDuration); // 最小 100ms

    // 更新临时状态
    tempState.duration = newDuration;
  } else {
    // 左侧拖拽：改变开始时间和时长
    let newStartTime = initialResizeStartTime.value + deltaMs;
    let newDuration = initialResizeDuration.value - deltaMs;

    // 限制
    if (newStartTime < 0) {
      newStartTime = 0;
      newDuration = initialResizeStartTime.value + initialResizeDuration.value;
    }
    if (newDuration < 100) {
      newDuration = 100;
      newStartTime = initialResizeStartTime.value + initialResizeDuration.value - 100;
    }

    // 更新临时状态
    tempState.startTime = newStartTime;
    tempState.duration = newDuration;
  }

  // 更新 tooltip 位置
  tooltipPosition.x = e.clientX + 15;
  tooltipPosition.y = e.clientY + 15;
};

const stopResizeClip = () => {
  if (isResizingClip.value && resizingClipId.value) {
    // 调整结束，一次性提交到 Store
    timelineStore.updateClip(resizingClipId.value, {
      startTime: tempState.startTime,
      duration: tempState.duration
    });
  }

  isResizingClip.value = false;
  resizingClipId.value = null;
  resizingHandle.value = null;
  document.body.style.cursor = "";
  window.removeEventListener("mousemove", onResizeClip);
  window.removeEventListener("mouseup", stopResizeClip);
};

const isDraggingKeyframe = ref(false);
const draggedKeyframeId = ref<string | null>(null);
const draggedKeyframeClipId = ref<string | null>(null);
const initialKeyframeTime = ref(0);
const dragKeyframeStartX = ref(0);
const tempKeyframeTime = ref(0);

const startDragKeyframe = (
  event: MouseEvent,
  clip: TimelineClip,
  marker: { id: string; timeMs: number; isBase: boolean }
) => {
  if (event.button !== 0) return;

  selectKeyframeMarker(clip, marker, event);
  if (marker.isBase) return;

  event.preventDefault();
  isDraggingKeyframe.value = true;
  draggedKeyframeId.value = marker.id;
  draggedKeyframeClipId.value = clip.id;
  initialKeyframeTime.value = marker.timeMs;
  tempKeyframeTime.value = marker.timeMs;
  dragKeyframeStartX.value = event.clientX;
  document.body.style.cursor = "ew-resize";
  window.addEventListener("mousemove", onDragKeyframe);
  window.addEventListener("mouseup", stopDragKeyframe);
};

const onDragKeyframe = (event: MouseEvent) => {
  if (!isDraggingKeyframe.value || !draggedKeyframeClipId.value) return;
  const clip = timelineStore.tracks.flatMap(track => track.clips).find(item => item.id === draggedKeyframeClipId.value);
  if (!clip) return;

  const deltaMs = ((event.clientX - dragKeyframeStartX.value) / pixelsPerSecond.value) * 1000;
  tempKeyframeTime.value = clampKeyframeTime(initialKeyframeTime.value + deltaMs, clip.duration);
};

const stopDragKeyframe = () => {
  if (isDraggingKeyframe.value && draggedKeyframeClipId.value && draggedKeyframeId.value) {
    timelineStore.updateClipKeyframe(draggedKeyframeClipId.value, draggedKeyframeId.value, {
      timeMs: tempKeyframeTime.value
    });
  }

  isDraggingKeyframe.value = false;
  draggedKeyframeId.value = null;
  draggedKeyframeClipId.value = null;
  document.body.style.cursor = "";
  window.removeEventListener("mousemove", onDragKeyframe);
  window.removeEventListener("mouseup", stopDragKeyframe);
};

// Animation Drag/Resize Logic
const isDraggingAnimation = ref(false);
const draggedAnimationId = ref<string | null>(null);
const initialAnimationDelay = ref(0);
const dragAnimStartX = ref(0);

const isResizingAnimation = ref(false);
const resizingAnimationId = ref<string | null>(null);
const initialAnimationDuration = ref(0);
const resizeAnimStartX = ref(0);

const tempAnimationState = reactive({
  delay: 0,
  duration: 0
});

// Helper to find animation start time (offset) within clip
const getAnimationStartOffset = (clip: any, anim: AnimationSegment, index: number) => {
  let startOffset = 0;
  if (anim.type === "set") {
    startOffset = anim.delay || 0;
  } else {
    // 'then': cumulative
    for (let i = 0; i < index; i++) {
      const prev = clip.animations[i];
      startOffset += prev.duration + (prev.delay || 0);
    }
  }
  return startOffset;
};

const startDragAnimation = (e: MouseEvent, clip: any, anim: AnimationSegment) => {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).dataset.handle) return; // Ignore resize handle

  e.stopPropagation();

  timelineStore.setSelectedClip(clip.id);
  timelineStore.setSelectedAnimation(anim.id);

  isDraggingAnimation.value = true;
  draggedAnimationId.value = anim.id;
  dragAnimStartX.value = e.clientX;

  // For 'set', we track absolute delay. For 'then', we track the *new gap* (delta).
  if (anim.type === "set") {
    initialAnimationDelay.value = anim.delay || 0;
    tempAnimationState.delay = anim.delay || 0;
  } else {
    initialAnimationDelay.value = 0; // Represents gap
    tempAnimationState.delay = 0;
  }

  document.body.style.cursor = "move";
  window.addEventListener("mousemove", onDragAnimation);
  window.addEventListener("mouseup", stopDragAnimation);
};

const onDragAnimation = (e: MouseEvent) => {
  if (!isDraggingAnimation.value || !draggedAnimationId.value) return;

  const deltaX = e.clientX - dragAnimStartX.value;
  const deltaMs = (deltaX / pixelsPerSecond.value) * 1000;

  // Determine type from selected animation
  // Note: We need access to the animation object or type here.
  // We can infer it or look it up.
  // Simple way: check selectedAnimationId in store? Or just assume logic based on initialization.
  // Let's look it up.
  const clip = timelineStore.tracks
    .find(t => t.clips.some(c => c.id === timelineStore.selectedClipId))
    ?.clips.find(c => c.id === timelineStore.selectedClipId);
  const anim = clip?.animations?.find(a => a.id === draggedAnimationId.value);

  if (!anim) return;

  if (anim.type === "set") {
    let newDelay = initialAnimationDelay.value + deltaMs;
    newDelay = Math.max(0, newDelay);
    tempAnimationState.delay = newDelay;
  } else {
    // 'then': dragging right creates a gap
    let gap = deltaMs; // initialAnimationDelay is 0
    gap = Math.max(0, gap);
    tempAnimationState.delay = gap;
  }
};

const stopDragAnimation = () => {
  if (isDraggingAnimation.value && draggedAnimationId.value && timelineStore.selectedClipId) {
    const clip = timelineStore.tracks
      .find(t => t.clips.some(c => c.id === timelineStore.selectedClipId))
      ?.clips.find(c => c.id === timelineStore.selectedClipId);
    const anim = clip?.animations?.find(a => a.id === draggedAnimationId.value);

    if (clip && anim) {
      if (anim.type === "set") {
        timelineStore.updateClipAnimation(timelineStore.selectedClipId, draggedAnimationId.value, {
          delay: tempAnimationState.delay
        });
      } else if (tempAnimationState.delay > 50) {
        // Threshold to create gap
        // Create 'gap' animation
        const index = clip.animations!.findIndex(a => a.id === anim.id);
        if (index !== -1) {
          const gapAnim: AnimationSegment = {
            id: `anim_${Date.now()}`,
            type: "then",
            duration: tempAnimationState.delay,
            properties: {} // Empty properties = maintain state
          };
          timelineStore.insertClipAnimation(timelineStore.selectedClipId, index, gapAnim);
        }
      }
    }
  }
  isDraggingAnimation.value = false;
  draggedAnimationId.value = null;
  document.body.style.cursor = "";
  window.removeEventListener("mousemove", onDragAnimation);
  window.removeEventListener("mouseup", stopDragAnimation);
};

const startResizeAnimation = (e: MouseEvent, clip: any, anim: AnimationSegment) => {
  e.stopPropagation();
  e.preventDefault();

  timelineStore.setSelectedClip(clip.id);
  timelineStore.setSelectedAnimation(anim.id);

  isResizingAnimation.value = true;
  resizingAnimationId.value = anim.id;
  initialAnimationDuration.value = anim.duration;
  resizeAnimStartX.value = e.clientX;

  tempAnimationState.duration = anim.duration;

  document.body.style.cursor = "e-resize";
  window.addEventListener("mousemove", onResizeAnimation);
  window.addEventListener("mouseup", stopResizeAnimation);
};

const onResizeAnimation = (e: MouseEvent) => {
  if (!isResizingAnimation.value || !resizingAnimationId.value) return;

  const deltaX = e.clientX - resizeAnimStartX.value;
  const deltaMs = (deltaX / pixelsPerSecond.value) * 1000;

  let newDuration = initialAnimationDuration.value + deltaMs;
  newDuration = Math.max(100, newDuration); // Min 100ms

  tempAnimationState.duration = newDuration;
};

const stopResizeAnimation = () => {
  if (isResizingAnimation.value && resizingAnimationId.value && timelineStore.selectedClipId) {
    timelineStore.updateClipAnimation(timelineStore.selectedClipId, resizingAnimationId.value, {
      duration: tempAnimationState.duration
    });
  }
  isResizingAnimation.value = false;
  resizingAnimationId.value = null;
  document.body.style.cursor = "";
  window.removeEventListener("mousemove", onResizeAnimation);
  window.removeEventListener("mouseup", stopResizeAnimation);
};

// Playhead 拖拽逻辑
const isDraggingPlayhead = ref(false);

const startDragPlayhead = (e: MouseEvent) => {
  e.preventDefault();
  isDraggingPlayhead.value = true;
  playheadSnapLabel.value = null;
  playheadTooltipClientX.value = e.clientX;
  playheadTooltipTop.value = (timelineContentRef.value?.getBoundingClientRect().top ?? 0) + 8;
  document.body.style.cursor = "ew-resize";
  window.addEventListener("mousemove", onDragPlayhead);
  window.addEventListener("mouseup", stopDragPlayhead);
};

const onDragPlayhead = (e: MouseEvent) => {
  if (!isDraggingPlayhead.value || !timelineContentRef.value) return;

  const rect = timelineContentRef.value.getBoundingClientRect();
  const moveX = e.clientX - rect.left + scrollLeft.value;
  const rawTime = (moveX / pixelsPerSecond.value) * 1000;
  const resolved = resolvePlayheadSemanticSnap(rawTime, e.shiftKey);

  playheadSnapLabel.value = resolved.label;
  playheadTooltipClientX.value = e.clientX;
  timelineStore.setCurrentTime(resolved.timeMs);
  if (!timelineStore.isPlaying) {
    basService.seek(timelineStore.currentTime / 1000, true);
  }
};

const stopDragPlayhead = () => {
  isDraggingPlayhead.value = false;
  playheadSnapLabel.value = null;
  document.body.style.cursor = "";
  window.removeEventListener("mousemove", onDragPlayhead);
  window.removeEventListener("mouseup", stopDragPlayhead);

  if (!timelineStore.isPlaying) {
    basService.seek(timelineStore.currentTime / 1000, true);
  }
};

// 键盘事件处理 (删除片段)
const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === "Delete" || e.key === "Backspace") {
    // 如果焦点在输入框中，不触发删除
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
    } else if (timelineStore.selectedAnimationId && timelineStore.selectedClipId) {
      timelineStore.removeClipAnimation(timelineStore.selectedClipId, timelineStore.selectedAnimationId);
      timelineStore.selectedAnimationId = null;
    } else if (timelineStore.selectedClipId) {
      timelineStore.removeClip(timelineStore.selectedClipId);
      timelineStore.selectedClipId = null;
    }
  }
};

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
});

// ============================================================
// 音频相关辅助函数
// ============================================================

/** 获取音频资源的 Blob URL */
function getAudioUrl(clip: TimelineClip): string {
  const resource = audioStore.audioResources.find(r => r.id === clip.resourceId);
  return resource?.url ?? "";
}

/** 判断 clip 是否为音频类型 */
function isAudioClip(clip: TimelineClip): boolean {
  return audioStore.audioResources.some(r => r.id === clip.resourceId);
}

/** 获取 clip 的有效音量参数（考虑预览覆盖） */
function getClipVolume(clip: TimelineClip): number {
  return timelineStore.getEffectiveVolume(clip);
}

/** 判断 clip 是否被静音（元素级） */
function isClipMuted(clip: TimelineClip): boolean {
  return timelineStore.isClipMuted(clip);
}

/** 为波形生成增益采样数组 */
function buildGainSamples(clip: TimelineClip): number[] {
  const durationSec = Math.max(0.001, clip.duration / 1000);
  const volumeDb = getClipVolume(clip);
  const muted = isClipMuted(clip);

  // 查找所属轨道
  const track = timelineStore.tracks.find(t => t.clips.some(c => c.id === clip.id));
  const trackMuted = track?.muted === true;

  if (muted || trackMuted) {
    // 静音 → 全部返回 0 增益
    return new Array(WAVEFORM_GAIN_SAMPLE_COUNT).fill(0);
  }

  const linearGain = dBToLinear(volumeDb);
  return new Array(WAVEFORM_GAIN_SAMPLE_COUNT).fill(linearGain);
}

// ---- 音量线事件处理 ----

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
    danmuStore.select(clip.resourceId);
  }
}
</script>

<template>
  <div
    class="panel h-full w-full bg-background border border-border rounded-sm overflow-hidden flex flex-col select-none"
    data-ui="timeline-panel"
  >
    <!-- 顶部工具栏 -->
    <div
      class="h-10 bg-background border-b border-border flex items-center justify-between px-2 py-1 text-xs text-muted-foreground gap-4 shrink-0"
    >
      <div class="flex items-center gap-2">
        <Clock class="size-3.5" />
        <span class="font-mono text-foreground/80">{{ currentTimeDisplay }}</span>
      </div>

      <div class="flex items-center gap-2">
        <span class="text-[10px] w-8 text-right">{{ timelineStore.zoomScale }}%</span>
        <div class="flex gap-0.5 border border-border rounded-sm overflow-hidden bg-accent">
          <button
            class="size-7 inline-flex items-center justify-center hover:bg-foreground/10 cursor-pointer"
            @click="zoomOut"
          >
            <ZoomOut class="size-3" />
          </button>
          <div class="w-px bg-border"></div>
          <button
            class="size-7 inline-flex items-center justify-center hover:bg-foreground/10 cursor-pointer"
            @click="zoomIn"
          >
            <ZoomIn class="size-3" />
          </button>
        </div>
      </div>
    </div>

    <!-- 头部区域 (Header Row) -->
    <div class="flex h-[30px] shrink-0 bg-background border-b border-border">
      <!-- 左上角：轨道列表头 -->
      <div
        class="w-56 shrink-0 border-r border-border bg-background flex items-center justify-between px-3 text-xs font-medium text-muted-foreground z-20"
      >
        轨道列表
      </div>

      <!-- 右侧：时间刻度尺 (固定视口，内部 canvas 重绘) -->
      <div class="flex-1 relative overflow-hidden cursor-pointer bg-background">
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
      <div class="w-56 border-r border-border bg-background flex flex-col shrink-0 overflow-hidden" ref="trackListRef">
        <!-- 轨道头列表 -->
        <template v-for="track in timelineStore.tracks" :key="track.id">
          <div
            class="h-10 grid grid-cols-[1.25rem_minmax(4.5rem,1fr)_1.5rem_1.5rem_1.5rem_1.5rem] items-center gap-1 px-2 text-xs group border-b border-border/60 hover:bg-accent/50 transition-colors shrink-0"
            :class="{ 'text-muted-foreground/55': !track.visible }"
            @contextmenu="handleContextMenu($event, 'track', track.id)"
          >
            <button
              @click="timelineStore.toggleTrackExpand(track.id)"
              class="size-5 hover:bg-accent rounded-sm transition-colors inline-flex items-center justify-center"
              aria-label="展开轨道动画"
            >
              <component :is="track.expanded ? ChevronDown : ChevronRight" class="size-3 text-muted-foreground" />
            </button>

            <div
              class="min-w-0 truncate text-left font-medium text-muted-foreground group-hover:text-foreground"
              :title="track.name"
            >
              {{ track.name }}
            </div>
            <button
              class="size-5 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              :class="{ 'text-primary bg-primary/10': isTrackPrimaryActive(track) }"
              :aria-label="getTrackPrimaryLabel(track)"
              :title="getTrackPrimaryLabel(track)"
              @click.stop="toggleTrackPrimaryAction(track)"
            >
              <component :is="getTrackPrimaryIcon(track)" class="size-3" />
            </button>
            <span
              class="size-5 inline-flex items-center justify-center rounded-sm border border-border/70 bg-background/80 text-muted-foreground"
              :aria-label="`${getTrackTypeLabel(track)}，轨道类型由首次放入的资源锁定`"
              :title="`${getTrackTypeLabel(track)} · 首次放入资源后锁定类型`"
            >
              <component :is="getTrackTypeIcon(track)" class="size-3" />
            </span>
            <span
              class="size-5 inline-flex items-center justify-center rounded-sm border border-border/50 bg-background/50 text-muted-foreground/45"
              title="视频轨道占位，暂未启用"
              aria-label="视频轨道占位，暂未启用"
            >
              <Video class="size-3" />
            </span>
            <button
              class="opacity-0 group-hover:opacity-100 size-5 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-opacity"
              aria-label="删除轨道"
              title="删除轨道"
              @click.stop="handleRemoveTrack(track.id)"
            >
              <Trash2 class="size-3" />
            </button>
          </div>

          <!-- Expanded Panel Header -->
          <div
            v-if="track.expanded"
            class="h-16 bg-muted/30 border-b border-border/60 flex items-center justify-end px-3 text-[10px] text-muted-foreground shrink-0"
            :class="{ 'opacity-55': !track.visible }"
          >
            <span class="opacity-70">动画关键帧</span>
          </div>
        </template>

        <button
          @click="handleAddTrack"
          class="w-full h-8 flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-primary hover:bg-accent transition-colors mt-1 shrink-0"
        >
          <Plus class="size-3" />
          添加轨道
        </button>

        <!-- 底部占位，防止内容被遮挡 -->
        <div class="h-20 shrink-0"></div>
      </div>

      <!-- 右侧：时间轴内容 (主滚动容器) -->
      <div
        class="flex-1 min-h-0 min-w-0 flex flex-col overflow-auto scrollbar-thin relative bg-background"
        ref="timelineContentRef"
        @scroll="handleScroll"
      >
        <!-- Tracks Container -->
        <div
          class="timeline-track-surface relative shrink-0"
          :style="{ width: totalWidth + 'px' }"
          @mousedown.self="handleTimelineClick"
          @contextmenu.prevent="handleContextMenu($event, 'background')"
        >
          <!-- 轨道行 -->
          <template v-for="track in timelineStore.tracks" :key="track.id">
            <div
              class="h-10 relative group border-b border-border/60 hover:bg-accent/35 transition-colors"
              :class="{
                'opacity-55': !track.visible,
                'bg-primary/10 ring-1 ring-inset ring-primary/30':
                  isDragTargetTrack(track) && canDropDraggedClipOnTrack(track),
                'bg-destructive/10 ring-1 ring-inset ring-destructive/30': isInvalidDragTargetTrack(track)
              }"
              :data-timeline-track-id="track.id"
              @dragover.prevent
              @drop="handleDrop($event, track.id)"
            >
              <!-- Clips -->
              <div
                v-for="clip in track.clips"
                :key="clip.id"
                class="absolute top-1 bottom-1 rounded-sm border text-[10px] flex items-center px-2 text-white overflow-hidden cursor-move select-none shadow-sm hover:brightness-110 group/audio"
                :class="{
                  'ring-1 ring-primary z-10': timelineStore.selectedClipId === clip.id,
                  'opacity-35': isDraggedClipLeavingTrack(clip)
                }"
                :style="{ ...getClipStyle(clip), ...getClipThemeStyle(clip) }"
                :data-clip-id="clip.id"
                :title="getClipName(clip)"
                @click.stop="handleClipClick(clip, $event)"
                @mousedown.stop="startDragClip($event, clip)"
                @contextmenu.stop="handleContextMenu($event, 'clip', clip)"
              >
                <!-- 音频波形（渲染在内容下方） -->
                <AudioWaveform
                  v-if="isAudioClip(clip)"
                  class="absolute inset-0"
                  :audio-url="getAudioUrl(clip)"
                  :clip-duration-ms="clip.duration"
                  :gain-samples="buildGainSamples(clip)"
                  :pixels-per-second="pixelsPerSecond"
                  :scroll-left="scrollLeft"
                  :track-width="timelineViewportWidth"
                />

                <span class="truncate text-white/90 font-medium z-10 relative pointer-events-none">{{
                  getClipName(clip)
                }}</span>

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
                <template v-if="timelineStore.selectedClipId === clip.id">
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
                class="absolute top-1 bottom-1 rounded-sm border text-[10px] flex items-center px-2 text-white overflow-hidden pointer-events-none opacity-80 shadow-md"
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
                  class="ml-1 px-1 text-[9px] font-bold bg-green-400 text-green-900 rounded-sm shrink-0"
                  >+</span
                >
              </div>
            </div>

            <!-- Expanded Animation Row -->
            <div
              v-if="track.expanded"
              class="h-16 relative bg-muted/30 border-b border-border/60"
              :class="{
                'bg-primary/10': isDragTargetTrack(track) && canDropDraggedClipOnTrack(track),
                'bg-destructive/10': isInvalidDragTargetTrack(track)
              }"
              :data-timeline-track-id="track.id"
            >
              <!-- Keyframe Containers (aligned with clips) -->
              <div
                v-for="clip in track.clips"
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
            title="拖动定位；Shift 暂时关闭片段与关键帧吸附"
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
      class="pointer-events-none fixed z-50 -translate-x-1/2 rounded-sm border border-border bg-popover px-2 py-1 font-mono text-[10px] text-popover-foreground shadow-md"
      :style="playheadTooltipStyle"
    >
      {{ formatTime(timelineStore.currentTime).str }}
      <span v-if="playheadSnapLabel" class="ml-1 text-primary"> 吸附 · {{ playheadSnapLabel }} </span>
    </div>

    <!-- Drag/Resize Tooltip -->
    <div
      v-if="isDraggingClip || isResizingClip"
      class="fixed z-50 pointer-events-none bg-popover text-popover-foreground px-2 py-1.5 rounded-sm shadow-md border border-border text-xs font-mono whitespace-pre flex flex-col gap-0.5"
      :style="{ top: tooltipPosition.y + 'px', left: tooltipPosition.x + 'px' }"
    >
      <div v-if="isDraggingClip">
        <template v-if="isAltDragCopy && dragTargetTrackId !== originalClipTrackId"
          >Copy to: {{ formatTime(tempState.startTime).str }}</template
        >
        <template v-else>Start: {{ formatTime(tempState.startTime).str }}</template>
      </div>
      <div v-else-if="isResizingClip">
        Start: {{ formatTime(tempState.startTime).str }} Duration: {{ formatTime(tempState.duration).str }} End:
        {{ formatTime(tempState.startTime + tempState.duration).str }}
      </div>
    </div>
  </div>
</template>

<style scoped>
[data-ui="timeline-panel"] {
  --timeline-playhead-core: color-mix(in oklab, var(--primary) 94%, var(--primary-foreground) 6%);
  --timeline-playhead-edge: color-mix(in oklab, var(--primary) 76%, var(--primary-foreground) 24%);
  --timeline-playhead-glow: color-mix(in oklab, var(--primary) 22%, transparent);
}

.timeline-track-surface {
  min-height: 100%;
}

.timeline-playhead::before {
  position: absolute;
  inset: 0;
  content: "";
  background: linear-gradient(
    180deg,
    var(--timeline-playhead-core),
    color-mix(in oklab, var(--timeline-playhead-core) 86%, transparent)
  );
  box-shadow:
    0 0 0 1px color-mix(in oklab, var(--primary) 12%, transparent),
    0 0 8px var(--timeline-playhead-glow);
  pointer-events: none;
  transition: box-shadow 140ms ease;
}

.timeline-playhead--ruler::before {
  top: 14px;
}

.timeline-playhead--content:hover::before {
  box-shadow:
    0 0 0 1px color-mix(in oklab, var(--primary) 18%, transparent),
    0 0 10px color-mix(in oklab, var(--primary) 30%, transparent);
}

.timeline-playhead__head {
  position: absolute;
  top: 2px;
  left: 50%;
  width: 14px;
  height: 11px;
  transform: translateX(-50%);
  border: 1px solid var(--timeline-playhead-edge);
  border-radius: 4px 4px 3px 3px;
  background: linear-gradient(
    180deg,
    color-mix(in oklab, var(--primary) 82%, var(--primary-foreground) 18%),
    var(--primary)
  );
  box-shadow:
    0 0 0 1px color-mix(in oklab, var(--background) 76%, transparent),
    0 3px 10px color-mix(in oklab, var(--primary) 30%, transparent),
    inset 0 1px 0 color-mix(in oklab, var(--primary-foreground) 30%, transparent);
}

.timeline-playhead__head::before {
  position: absolute;
  top: 2px;
  right: 3px;
  left: 3px;
  height: 1px;
  border-radius: 999px;
  content: "";
  background: color-mix(in oklab, var(--primary-foreground) 55%, transparent);
}

.timeline-playhead__head::after {
  position: absolute;
  bottom: -4px;
  left: 50%;
  width: 6px;
  height: 6px;
  transform: translateX(-50%) rotate(45deg);
  border-right: 1px solid var(--timeline-playhead-edge);
  border-bottom: 1px solid var(--timeline-playhead-edge);
  border-radius: 0 0 2px;
  content: "";
  background: var(--primary);
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

@media (prefers-reduced-motion: reduce) {
  .timeline-playhead::before {
    transition: none;
  }
}
</style>
