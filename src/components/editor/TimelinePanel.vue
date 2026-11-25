<script setup lang="ts">
import { ref, computed, watch, reactive, onMounted, onUnmounted, nextTick } from "vue";
import { useI18n } from "vue-i18n";
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
  Scissors,
  ScissorsLineDashed,
  Video,
  FolderOpen,
  FolderPlus,
  Ungroup,
  ArrowLeft
} from "lucide-vue-next";
import TimeRuler from "./TimeRuler.vue";
import { formatTime } from "@/core/timeline";
import { getItemName } from "@/utils/resourceUtils";
import { useTimelineStore } from "@/stores/timeline";
import { useDanmuStore } from "@/stores/danmu";
import { useAudioStore } from "@/stores/audio";
import { useContextMenuStore } from "@/stores/contextMenu";
import { BASE_KEYFRAME_ID, clampKeyframeTime, normalizeKeyframes } from "@/core/keyframes";
import { runSplitAction } from "@/utils/splitAction";

import type { TimelineClip, TimelineTrack, TimelineTrackType } from "@/types/timeline";
import AudioWaveform from "./audio/AudioWaveform.vue";
import AudioVolumeLine from "./audio/AudioVolumeLine.vue";
import { dBToLinear } from "@/utils/audio/audio-math";
import { Input } from "@/components/ui/input";
import { WAVEFORM_GAIN_SAMPLE_COUNT } from "@/utils/audio/constants";

const { t } = useI18n();

const timelineStore = useTimelineStore();
const danmuStore = useDanmuStore();
const audioStore = useAudioStore();
const contextMenu = useContextMenuStore();
const editingGroupId = ref<string | null>(null);
const editingGroupName = ref("");
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

const getClipThemeStyle = (clip: any) => {
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
  timelineStore.timelineScroll = { left: target.scrollLeft, top: target.scrollTop };

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
  if (type === "audio") return t("timeline.track.type.audio");
  if (type === "danmu") return t("timeline.track.type.danmu");
  return t("timeline.track.type.empty");
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
    return track.muted ? t("timeline.track.unmute") : t("timeline.track.mute");
  }
  return track.visible ? t("timeline.track.hide") : t("timeline.track.show");
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
    width: `${Math.max(clip.kind === "group" ? 28 : 1, width)}px`,
    zIndex
  };
};

const getClipName = (clip: any) => {
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
  if (clip.kind !== "resource") return;
  event?.stopPropagation();
  timelineStore.setSelectedClip(clip.id);
  timelineStore.setSelectedKeyframe(marker.id);
  danmuStore.select(clip.resourceId);
};

/** 双击关键帧 → 将播放头定位到关键帧所在时间 */
const handleKeyframeDblClick = (clip: TimelineClip, marker: { timeMs: number }) => {
  const absoluteTime = clip.startTime + marker.timeMs;
  timelineStore.setCurrentTime(absoluteTime);
};

// 游标位置 (相对于内容区域)
/** 吸附候选的语义种类；显示文本在渲染时通过 t() 解析。 */
type PlayheadSemanticSnapKind = "clipStart" | "clipEnd" | "keyframe";
type PlayheadSemanticSnapCandidate = {
  timeMs: number;
  kind: PlayheadSemanticSnapKind;
};
// 吸附像素大小
const PLAYHEAD_SEMANTIC_SNAP_SCREEN_PX = 5;
const playheadSnapKind = ref<PlayheadSemanticSnapKind | null>(null);
const playheadTooltipClientX = ref(0);
const playheadTooltipTop = ref(0);

const getPlayheadSnapText = (kind: PlayheadSemanticSnapKind) => {
  if (kind === "clipStart") return t("timeline.snap.clipStart");
  if (kind === "clipEnd") return t("timeline.snap.clipEnd");
  return t("timeline.snap.keyframe");
};

const playheadSnapText = computed(() => (playheadSnapKind.value ? getPlayheadSnapText(playheadSnapKind.value) : ""));

const playheadSemanticSnapCandidates = computed<PlayheadSemanticSnapCandidate[]>(() => {
  const candidates = new Map<string, PlayheadSemanticSnapCandidate>();
  const addCandidate = (timeMs: number, kind: PlayheadSemanticSnapKind) => {
    const clampedTime = Math.min(Math.max(0, timeMs), timelineStore.duration);
    if (!Number.isFinite(clampedTime)) return;
    const key = clampedTime.toFixed(3);
    if (!candidates.has(key)) candidates.set(key, { timeMs: clampedTime, kind });
  };

  for (const track of timelineStore.tracks) {
    for (const clip of track.clips) {
      addCandidate(clip.startTime, "clipStart");
      addCandidate(clip.startTime + clip.duration, "clipEnd");
      for (const keyframe of normalizeKeyframes(clip.keyframes, clip.duration)) {
        addCandidate(clip.startTime + keyframe.timeMs, "keyframe");
      }
    }
  }

  return [...candidates.values()].sort((left, right) => left.timeMs - right.timeMs);
});

const resolvePlayheadSemanticSnap = (rawTimeMs: number, disabled = false) => {
  const clampedTime = Math.min(Math.max(0, rawTimeMs), timelineStore.duration);
  if (disabled) return { timeMs: clampedTime, kind: null };

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
    return { timeMs: nearest.timeMs, kind: nearest.kind };
  }

  return { timeMs: clampedTime, kind: null };
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
  danmuStore.select(null);
};

const updateTime = (time: number, disableSnap = false) => {
  const resolved = resolvePlayheadSemanticSnap(time, disableSnap);
  playheadSnapKind.value = resolved.kind;
  timelineStore.setCurrentTime(resolved.timeMs);
};

// Clip 拖拽逻辑
const isDraggingClip = ref(false);
const draggedClipId = ref<string | null>(null);
const initialClipStartTime = ref(0);
const dragStartX = ref(0);
const originalClipTrackId = ref<string | null>(null);
const dragTargetTrackId = ref<string | null>(null);
const dragTargetGroupId = ref<string | null>(null);
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

/**
 * 获取鼠标位置下可作为拖拽目标的分组 ID。
 *
 * 使用 elementsFromPoint 兼容拖拽源覆盖目标的情况，并排除当前拖拽片段自身，
 * 避免拖动分组时把源分组误判为嵌套目标。
 *
 * @param event 当前鼠标事件，用于读取屏幕坐标
 * @returns 命中的目标分组 ID；没有合法目标时返回 null
 */
const getGroupIdAtPoint = (event: MouseEvent) => {
  const elements = document.elementsFromPoint(event.clientX, event.clientY);
  const groupElement = elements
    .map(element => element.closest<HTMLElement>('[data-clip-kind="group"]'))
    .find((element): element is HTMLElement => element !== null && element.dataset.clipId !== draggedClipId.value);
  const groupId = groupElement?.dataset.clipId ?? null;
  if (!groupId) return null;

  const group = timelineStore.tracks.flatMap(track => track.clips).find(clip => clip.id === groupId);
  return group?.kind === "group" ? groupId : null;
};

/**
 * 判断当前拖拽片段是否允许投放到指定分组。
 *
 * @param groupId 待检测的目标分组 ID
 * @returns 允许投放时返回 true，否则返回 false
 */
const canDropDraggedClipIntoGroup = (groupId: string) =>
  timelineStore.canMoveClipIntoGroup(draggedClipId.value, groupId);

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
    ((Boolean(dragTargetGroupId.value) && dragTargetGroupId.value !== clip.id) ||
      (Boolean(dragTargetTrackId.value) && dragTargetTrackId.value !== clip.trackId))
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
  if (e.ctrlKey || e.metaKey || e.shiftKey) {
    timelineStore.toggleClipSelection(clip.id);
    return;
  }
  timelineStore.setSelectedClip(clip.id);
};

const startDragClip = (e: MouseEvent, clip: any) => {
  // 左键点击才触发
  if (e.button !== 0) return;
  if (e.ctrlKey || e.metaKey || e.shiftKey || editingGroupId.value === clip.id) return;
  if (timelineStore.tracks.find(track => track.id === clip.trackId)?.locked) return;

  // 如果点击的是 resize handle，不要触发拖拽移动
  if ((e.target as HTMLElement).dataset.handle) return;

  e.stopPropagation(); // 阻止冒泡
  e.preventDefault();

  // 拖拽时同时也选中
  if (!timelineStore.selectedClipIds.includes(clip.id)) timelineStore.setSelectedClip(clip.id);

  isDraggingClip.value = true;
  draggedClipId.value = clip.id;
  initialClipStartTime.value = clip.startTime;
  dragStartX.value = e.clientX;
  originalClipTrackId.value = clip.trackId;
  dragTargetTrackId.value = clip.trackId;
  dragTargetGroupId.value = null;
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
  const groupId = getGroupIdAtPoint(e);
  dragTargetGroupId.value = groupId;
  dragTargetTrackId.value = groupId ? null : (getTrackIdAtPoint(e) ?? dragTargetTrackId.value);

  // 跟踪 Alt 键状态：Alt + 跨轨道拖拽 = 复制
  isAltDragCopy.value = e.altKey;
  const crossingTracks = Boolean(groupId) || dragTargetTrackId.value !== originalClipTrackId.value;
  document.body.style.cursor = e.altKey && crossingTracks ? "copy" : "move";

  // 更新 tooltip 位置
  tooltipPosition.x = e.clientX + 15;
  tooltipPosition.y = e.clientY + 15;
};

const stopDragClip = () => {
  if (isDraggingClip.value && draggedClipId.value) {
    if (dragTargetGroupId.value) {
      if (isAltDragCopy.value) {
        timelineStore.copyClipIntoGroup(draggedClipId.value, dragTargetGroupId.value);
      } else {
        timelineStore.moveClipIntoGroup(draggedClipId.value, dragTargetGroupId.value);
      }
    } else {
      const targetTrackId = dragTargetTrackId.value ?? originalClipTrackId.value;
      const targetTrack = timelineStore.tracks.find(track => track.id === targetTrackId);

      // Alt + 跨轨道拖拽复制片段，并保留其素材引用。
      if (isAltDragCopy.value && targetTrackId && targetTrackId !== originalClipTrackId.value && targetTrack) {
        timelineStore.copyClipToTrack(draggedClipId.value, targetTrackId, {
          startTime: tempState.startTime
        });
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
  }

  isDraggingClip.value = false;
  draggedClipId.value = null;
  originalClipTrackId.value = null;
  dragTargetTrackId.value = null;
  dragTargetGroupId.value = null;
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
const initialResizeSourceInMs = ref(0);
const resizeAudioDurationMs = ref<number | null>(null);
const resizingAudio = ref(false);

const startResizeClip = (e: MouseEvent, clip: any, handle: "left" | "right") => {
  if (clip.kind === "group" || timelineStore.tracks.find(track => track.id === clip.trackId)?.locked) return;
  e.stopPropagation();
  e.preventDefault(); // 防止选中文本

  isResizingClip.value = true;
  resizingClipId.value = clip.id;
  resizingHandle.value = handle;
  initialResizeStartTime.value = clip.startTime;
  initialResizeDuration.value = clip.duration;
  initialResizeSourceInMs.value = clip.sourceInMs ?? 0;
  const audio = audioStore.audioResources.find(resource => resource.id === clip.resourceId);
  resizingAudio.value = Boolean(audio);
  resizeAudioDurationMs.value = audio?.duration && audio.duration > 0 ? audio.duration : null;
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
    if (resizeAudioDurationMs.value !== null) {
      newDuration = Math.min(newDuration, Math.max(0, resizeAudioDurationMs.value - initialResizeSourceInMs.value));
    }

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
    if (resizingAudio.value && newStartTime < initialResizeStartTime.value - initialResizeSourceInMs.value) {
      newStartTime = initialResizeStartTime.value - initialResizeSourceInMs.value;
      newDuration = initialResizeStartTime.value + initialResizeDuration.value - newStartTime;
    }
    const minimumDuration = Math.min(100, initialResizeDuration.value);
    if (newDuration < minimumDuration) {
      newDuration = minimumDuration;
      newStartTime = initialResizeStartTime.value + initialResizeDuration.value - minimumDuration;
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
    const updates = { startTime: tempState.startTime, duration: tempState.duration };
    if (resizingAudio.value && resizingHandle.value === "left") {
      timelineStore.updateClip(resizingClipId.value, {
        ...updates,
        sourceInMs: initialResizeSourceInMs.value + tempState.startTime - initialResizeStartTime.value
      });
    } else {
      timelineStore.updateClip(resizingClipId.value, updates);
    }
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

// Playhead 拖拽逻辑
const isDraggingPlayhead = ref(false);

const startDragPlayhead = (e: MouseEvent) => {
  e.preventDefault();
  isDraggingPlayhead.value = true;
  playheadSnapKind.value = null;
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

  playheadSnapKind.value = resolved.kind;
  playheadTooltipClientX.value = e.clientX;
  timelineStore.setCurrentTime(resolved.timeMs);
};

const stopDragPlayhead = () => {
  isDraggingPlayhead.value = false;
  playheadSnapKind.value = null;
  document.body.style.cursor = "";
  window.removeEventListener("mousemove", onDragPlayhead);
  window.removeEventListener("mouseup", stopDragPlayhead);

};

// 键盘事件处理 (删除片段)
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
    } else if (timelineStore.selectedClipId) {
      timelineStore.removeSelectedClips();
    }
  }
};

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
});

watch(
  () => timelineStore.navigationRevision,
  async () => {
    contextMenu.hide();
    editingGroupId.value = null;
    isDraggingClip.value = false;
    isResizingClip.value = false;
    isDraggingKeyframe.value = false;
    stopDragClip();
    stopResizeClip();
    stopDragKeyframe();
    stopDragPlayhead();
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
    danmuStore.select(clip.kind === "resource" ? clip.resourceId : null);
  }
}
</script>

<template>
  <div class="panel workbench-panel h-full w-full overflow-hidden flex flex-col select-none" data-ui="timeline-panel">
    <!-- 顶部工具栏 -->
    <div
      class="toolbar h-10 bg-panel flex items-center justify-between px-2 py-1 text-xs text-muted-foreground gap-4 shrink-0"
    >
      <div class="flex items-center gap-2">
        <Clock class="size-3.5" />
        <span class="font-mono text-foreground/80">{{ currentTimeDisplay }}</span>
        <button
          type="button"
          class="size-7 inline-flex items-center justify-center rounded-sm hover:bg-accent disabled:opacity-40"
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
          class="size-7 inline-flex items-center justify-center rounded-sm hover:bg-accent disabled:opacity-40"
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
          class="size-7 inline-flex items-center justify-center rounded-sm hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
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
          class="size-7 inline-flex items-center justify-center rounded-sm hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
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
          class="size-7 inline-flex items-center justify-center rounded-sm hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
          data-ui="split-right"
          :title="t('menus.splitRight')"
          :aria-label="t('menus.splitRight')"
          :disabled="!timelineStore.canSplitClip(timelineStore.selectedClipId)"
          @click="runSplitAction(() => timelineStore.splitClipRight(timelineStore.selectedClipId))"
        >
          <ScissorsLineDashed class="size-3.5" />
        </button>
      </div>

      <div class="flex items-center gap-2">
        <span class="text-xs w-10 text-right tabular-nums">{{ timelineStore.zoomScale }}%</span>
        <div class="flex gap-0.5 border border-border rounded-sm overflow-hidden bg-accent">
          <button
            class="size-7 inline-flex items-center justify-center hover:bg-foreground/10 cursor-pointer"
            @click="zoomOut"
            :aria-label="t('preview.zoom.out')"
            :title="t('preview.zoom.out')"
            data-ui="timeline-zoom-out"
          >
            <ZoomOut class="size-3" />
          </button>
          <div class="w-px bg-border"></div>
          <button
            class="size-7 inline-flex items-center justify-center hover:bg-foreground/10 cursor-pointer"
            @click="zoomIn"
            :aria-label="t('preview.zoom.in')"
            :title="t('preview.zoom.in')"
            data-ui="timeline-zoom-in"
          >
            <ZoomIn class="size-3" />
          </button>
        </div>
      </div>
    </div>

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
      <div
        class="w-56 border-r border-divider bg-track-header flex flex-col shrink-0 overflow-hidden"
        ref="trackListRef"
        data-ui="track-headers"
      >
        <!-- 轨道头列表 -->
        <template v-for="track in timelineStore.tracks" :key="track.id">
          <div
            class="h-10 grid grid-cols-[1rem_minmax(0,1fr)_1.25rem_1.25rem_1.25rem_1.25rem] items-center gap-1 px-2 text-xs group border-b border-divider hover:bg-accent/50 transition-colors shrink-0"
            :class="{ 'text-muted-foreground/55': !track.visible }"
            :data-track-header-id="track.id"
            @contextmenu="handleContextMenu($event, 'track', track.id)"
          >
            <button
              @click="timelineStore.toggleTrackExpand(track.id)"
              class="size-5 hover:bg-accent rounded-sm transition-colors inline-flex items-center justify-center"
              :aria-label="t('timeline.track.expand')"
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
              :aria-label="t('timeline.track.typeLockedAria', { type: getTrackTypeLabel(track) })"
              :title="t('timeline.track.typeLockedTitle', { type: getTrackTypeLabel(track) })"
            >
              <component :is="getTrackTypeIcon(track)" class="size-3" />
            </span>
            <span
              class="size-5 inline-flex items-center justify-center rounded-sm border border-border/50 bg-background/50 text-muted-foreground/45"
              :title="t('timeline.track.videoPlaceholder')"
              :aria-label="t('timeline.track.videoPlaceholder')"
            >
              <Video class="size-3" />
            </span>
            <button
              class="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 size-5 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-opacity"
              :aria-label="t('timeline.track.remove')"
              :title="t('timeline.track.remove')"
              @click.stop="handleRemoveTrack(track.id)"
            >
              <Trash2 class="size-3" />
            </button>
          </div>

          <!-- Expanded Panel Header -->
          <div
            v-if="track.expanded"
            class="h-16 bg-muted/30 border-b border-divider flex items-center justify-end px-3 text-xs text-muted-foreground shrink-0"
            :class="{ 'opacity-55': !track.visible }"
          >
            <span class="opacity-70">{{ t("timeline.keyframes") }}</span>
          </div>
        </template>

        <button
          @click="handleAddTrack"
          class="w-full h-8 flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-primary hover:bg-accent transition-colors mt-1 shrink-0"
        >
          <Plus class="size-3" />
          {{ t("timeline.addTrack") }}
        </button>

        <!-- 底部占位，防止内容被遮挡 -->
        <div class="h-20 shrink-0"></div>
      </div>

      <!-- 右侧：时间轴内容 (主滚动容器) -->
      <div
        class="flex-1 min-h-0 min-w-0 flex flex-col overflow-auto scrollbar-thin relative bg-timeline"
        ref="timelineContentRef"
        data-ui="timeline-content"
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
              class="h-10 relative group border-b border-divider hover:bg-accent/35 transition-colors"
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
                class="absolute top-1 bottom-1 rounded-sm border text-xs flex items-center px-2 text-white overflow-hidden cursor-move select-none transition-[filter,outline-color] hover:brightness-110 group/audio"
                :class="{
                  'outline outline-1 outline-primary outline-offset-0 z-10': timelineStore.selectedClipIds.includes(
                    clip.id
                  ),
                  'outline outline-2 outline-primary z-20':
                    dragTargetGroupId === clip.id && canDropDraggedClipIntoGroup(clip.id),
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
                  :source-start-sec="clip.kind === 'resource' ? ((clip.sourceInMs ?? 0) + (isResizingClip && resizingClipId === clip.id && resizingHandle === 'left' ? tempState.startTime - initialResizeStartTime : 0)) / 1000 : 0"
                  :clip-start-ms="isDraggingClip && draggedClipId === clip.id ? tempState.startTime : isResizingClip && resizingClipId === clip.id ? tempState.startTime : clip.startTime"
                  :gain-samples="buildGainSamples(clip)"
                  :pixels-per-second="pixelsPerSecond"
                  :scroll-left="scrollLeft"
                  :track-width="timelineViewportWidth"
                />

                <FolderOpen v-if="clip.kind === 'group'" class="size-3 shrink-0 mr-1" />
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
