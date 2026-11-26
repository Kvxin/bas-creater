import { computed, getCurrentScope, onScopeDispose, reactive, ref, type Ref } from "vue";
import { clampKeyframeTime } from "@/core/keyframes";
import {
  collectTimelineSnapCandidates,
  getMinClipDurationMs,
  resolveTimelineSnap,
  roundTimelineMs
} from "@/core/timeline";
import type {
  TimelineClip,
  TimelineSnapCandidate,
  TimelineSnapKind,
  TimelineTrack,
  TimelineTrackType
} from "@/types/timeline";
import type { useTimelineStore } from "@/stores/timeline";
import type { useDanmuStore } from "@/stores/danmu";
import type { useAudioStore } from "@/stores/audio";

export type UseTimelineInteractionsParams = {
  timelineStore: ReturnType<typeof useTimelineStore>;
  danmuStore: ReturnType<typeof useDanmuStore>;
  audioStore: ReturnType<typeof useAudioStore>;
  pixelsPerSecond: Ref<number>;
  editingGroupId: Ref<string | null>;
  getTrackType: (track: TimelineTrack) => TimelineTrackType | null;
  getClipTimelineType: (clip: TimelineClip) => TimelineTrackType;
};

/** 管理时间轴片段的拖拽跨轨/复制、边缘拉伸、网格/语义吸附与关键帧拖拽交互。 */
export function useTimelineInteractions(params: UseTimelineInteractionsParams) {
  const {
    timelineStore,
    danmuStore,
    audioStore,
    pixelsPerSecond,
    editingGroupId,
    getTrackType,
    getClipTimelineType
  } = params;

  const tempState = reactive({
    startTime: 0,
    duration: 0
  });

  const tooltipPosition = reactive({ x: 0, y: 0 });
  const interactionSnapKind = ref<TimelineSnapKind | null>(null);
  let activeSnapCandidates: TimelineSnapCandidate[] = [];

  // ---- Clip 拖拽逻辑 ----
  const isDraggingClip = ref(false);
  const draggedClipId = ref<string | null>(null);
  const initialClipStartTime = ref(0);
  const dragStartX = ref(0);
  const originalClipTrackId = ref<string | null>(null);
  const dragTargetTrackId = ref<string | null>(null);
  const dragTargetGroupId = ref<string | null>(null);
  const draggedClipType = ref<TimelineTrackType | null>(null);
  const isAltDragCopy = ref(false);

  // ---- Clip 调整大小逻辑 (Resize) ----
  const isResizingClip = ref(false);
  const resizingClipId = ref<string | null>(null);
  const resizingHandle = ref<"left" | "right" | null>(null);
  const initialResizeStartTime = ref(0);
  const initialResizeDuration = ref(0);
  const resizeStartX = ref(0);
  const initialResizeSourceInMs = ref(0);
  const resizeAudioDurationMs = ref<number | null>(null);
  const resizingAudio = ref(false);

  // ---- Keyframe 拖拽逻辑 ----
  const isDraggingKeyframe = ref(false);
  const draggedKeyframeId = ref<string | null>(null);
  const draggedKeyframeClipId = ref<string | null>(null);
  const initialKeyframeTime = ref(0);
  const dragKeyframeStartX = ref(0);
  const tempKeyframeTime = ref(0);

  const buildSnapCandidates = (excludeClipId?: string | null, excludeKeyframeId?: string | null) =>
    collectTimelineSnapCandidates({
      tracks: timelineStore.tracks,
      markers: timelineStore.markers,
      playheadTimeMs: timelineStore.currentTime,
      excludeClipId,
      excludeKeyframeId
    });

  const snapTime = (rawTimeMs: number, disableSnap = false, clipDurationMs?: number) =>
    resolveTimelineSnap(rawTimeMs, {
      candidates: activeSnapCandidates,
      pixelsPerSecond: pixelsPerSecond.value,
      mode: timelineStore.timeDisplayMode,
      fps: timelineStore.fps,
      bpm: timelineStore.bpm,
      beatOffsetMs: timelineStore.activeBeatOffsetMs,
      snapEnabled: timelineStore.snapEnabled,
      disableSnap,
      clipDurationMs
    });

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

  const getClipStyle = (clip: TimelineClip) => {
    let startTime = clip.startTime;
    let duration = clip.duration;
    let zIndex = 1;

    if (isDraggingClip.value && draggedClipId.value === clip.id) {
      startTime = tempState.startTime;
      zIndex = 100;
    } else if (isResizingClip.value && resizingClipId.value === clip.id) {
      startTime = tempState.startTime;
      duration = tempState.duration;
      zIndex = 100;
    }

    const left = (startTime / 1000) * pixelsPerSecond.value;
    const width = (duration / 1000) * pixelsPerSecond.value;

    return {
      left: `${left}px`,
      width: `${Math.max(clip.kind === "group" ? 28 : 2, width)}px`,
      zIndex
    };
  };

  const getDragGhostClipStyle = (clip: TimelineClip) => {
    const left = (tempState.startTime / 1000) * pixelsPerSecond.value;
    const width = (clip.duration / 1000) * pixelsPerSecond.value;

    return {
      left: `${left}px`,
      width: `${Math.max(clip.kind === "group" ? 28 : 2, width)}px`,
      zIndex: 110
    };
  };

  const onDragClip = (e: MouseEvent) => {
    if (!isDraggingClip.value || !draggedClipId.value) return;

    const deltaX = e.clientX - dragStartX.value;
    const deltaMs = (deltaX / pixelsPerSecond.value) * 1000;
    const rawStartTime = Math.max(0, initialClipStartTime.value + deltaMs);
    const snapped = snapTime(rawStartTime, Boolean(e.shiftKey), tempState.duration);

    tempState.startTime = snapped.timeMs;
    interactionSnapKind.value = snapped.kind;

    const groupId = getGroupIdAtPoint(e);
    dragTargetGroupId.value = groupId;
    dragTargetTrackId.value = groupId ? null : (getTrackIdAtPoint(e) ?? dragTargetTrackId.value);

    isAltDragCopy.value = Boolean(e.altKey);
    const crossingTracks = Boolean(groupId) || dragTargetTrackId.value !== originalClipTrackId.value;
    document.body.style.cursor = e.altKey && crossingTracks ? "copy" : "move";

    tooltipPosition.x = e.clientX + 15;
    tooltipPosition.y = e.clientY + 15;
  };

  const cancelDragClip = () => {
    const wasActive = isDraggingClip.value;
    isDraggingClip.value = false;
    draggedClipId.value = null;
    originalClipTrackId.value = null;
    dragTargetTrackId.value = null;
    dragTargetGroupId.value = null;
    draggedClipType.value = null;
    isAltDragCopy.value = false;
    interactionSnapKind.value = null;
    activeSnapCandidates = [];
    if (typeof window !== "undefined") {
      window.removeEventListener("mousemove", onDragClip);
      window.removeEventListener("mouseup", stopDragClip);
    }
    if (wasActive && typeof document !== "undefined") {
      document.body.style.cursor = "";
    }
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

    cancelDragClip();
  };

  const startDragClip = (e: MouseEvent, clip: TimelineClip) => {
    if (e.button !== 0) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || editingGroupId.value === clip.id) return;
    if (timelineStore.tracks.find(track => track.id === clip.trackId)?.locked) return;

    if ((e.target as HTMLElement | null)?.dataset?.handle) return;

    e.stopPropagation();
    e.preventDefault();

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
    interactionSnapKind.value = null;
    activeSnapCandidates = buildSnapCandidates(clip.id);

    tempState.startTime = clip.startTime;
    tempState.duration = clip.duration;

    tooltipPosition.x = e.clientX + 15;
    tooltipPosition.y = e.clientY + 15;

    document.body.style.cursor = "move";
    window.addEventListener("mousemove", onDragClip);
    window.addEventListener("mouseup", stopDragClip);
  };

  const onResizeClip = (e: MouseEvent) => {
    if (!isResizingClip.value || !resizingClipId.value) return;

    const deltaX = e.clientX - resizeStartX.value;
    const deltaMs = (deltaX / pixelsPerSecond.value) * 1000;
    const minFrameDuration = Math.min(getMinClipDurationMs(timelineStore.fps), initialResizeDuration.value);

    if (resizingHandle.value === "right") {
      const rawEndTime = Math.max(initialResizeStartTime.value + minFrameDuration, initialResizeStartTime.value + initialResizeDuration.value + deltaMs);
      const snapped = snapTime(rawEndTime, Boolean(e.shiftKey));
      let newDuration = roundTimelineMs(snapped.timeMs - initialResizeStartTime.value);
      newDuration = Math.max(minFrameDuration, newDuration);
      if (resizeAudioDurationMs.value !== null) {
        newDuration = Math.min(newDuration, roundTimelineMs(Math.max(0, resizeAudioDurationMs.value - initialResizeSourceInMs.value)));
      }

      tempState.duration = newDuration;
      interactionSnapKind.value = snapped.kind;
    } else {
      const initialEnd = initialResizeStartTime.value + initialResizeDuration.value;
      const rawStart = Math.max(0, initialResizeStartTime.value + deltaMs);
      const snapped = snapTime(rawStart, Boolean(e.shiftKey));
      let newStartTime = snapped.timeMs;
      let newDuration = roundTimelineMs(initialEnd - newStartTime);

      if (newStartTime < 0) {
        newStartTime = 0;
        newDuration = roundTimelineMs(initialEnd);
      }
      if (resizingAudio.value && newStartTime < initialResizeStartTime.value - initialResizeSourceInMs.value) {
        newStartTime = roundTimelineMs(initialResizeStartTime.value - initialResizeSourceInMs.value);
        newDuration = roundTimelineMs(initialEnd - newStartTime);
      }
      if (newDuration < minFrameDuration) {
        newDuration = minFrameDuration;
        newStartTime = roundTimelineMs(initialEnd - minFrameDuration);
      }

      tempState.startTime = newStartTime;
      tempState.duration = newDuration;
      interactionSnapKind.value = snapped.kind;
    }

    tooltipPosition.x = e.clientX + 15;
    tooltipPosition.y = e.clientY + 15;
  };

  const cancelResizeClip = () => {
    const wasActive = isResizingClip.value;
    isResizingClip.value = false;
    resizingClipId.value = null;
    resizingHandle.value = null;
    interactionSnapKind.value = null;
    activeSnapCandidates = [];
    if (typeof window !== "undefined") {
      window.removeEventListener("mousemove", onResizeClip);
      window.removeEventListener("mouseup", stopResizeClip);
    }
    if (wasActive && typeof document !== "undefined") {
      document.body.style.cursor = "";
    }
  };

  const stopResizeClip = () => {
    if (isResizingClip.value && resizingClipId.value) {
      const updates = { startTime: tempState.startTime, duration: tempState.duration };
      if (resizingAudio.value && resizingHandle.value === "left") {
        timelineStore.updateClip(resizingClipId.value, {
          ...updates,
          sourceInMs: roundTimelineMs(initialResizeSourceInMs.value + tempState.startTime - initialResizeStartTime.value)
        });
      } else {
        timelineStore.trimClip(resizingClipId.value, updates.startTime, updates.duration);
      }
    }

    cancelResizeClip();
  };

  const startResizeClip = (e: MouseEvent, clip: TimelineClip, handle: "left" | "right") => {
    if (clip.kind === "group" || timelineStore.tracks.find(track => track.id === clip.trackId)?.locked) return;
    e.stopPropagation();
    e.preventDefault();

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
    interactionSnapKind.value = null;
    activeSnapCandidates = buildSnapCandidates(clip.id);

    tempState.startTime = clip.startTime;
    tempState.duration = clip.duration;

    tooltipPosition.x = e.clientX + 15;
    tooltipPosition.y = e.clientY + 15;

    document.body.style.cursor = handle === "left" ? "w-resize" : "e-resize";
    window.addEventListener("mousemove", onResizeClip);
    window.addEventListener("mouseup", stopResizeClip);
  };

  const selectKeyframeMarker = (clip: TimelineClip, marker: { id: string; isBase: boolean }, event?: MouseEvent) => {
    if (clip.kind !== "resource") return;
    event?.stopPropagation();
    timelineStore.setSelectedClip(clip.id);
    timelineStore.setSelectedKeyframe(marker.id);
    danmuStore.select(clip.resourceId);
  };

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

  const onDragKeyframe = (event: MouseEvent) => {
    if (!isDraggingKeyframe.value || !draggedKeyframeClipId.value) return;
    const clip = timelineStore.tracks.flatMap(track => track.clips).find(item => item.id === draggedKeyframeClipId.value);
    if (!clip) return;

    const deltaMs = ((event.clientX - dragKeyframeStartX.value) / pixelsPerSecond.value) * 1000;
    const rawAbsoluteMs = clip.startTime + initialKeyframeTime.value + deltaMs;
    const snapped = snapTime(rawAbsoluteMs, Boolean(event.shiftKey));
    interactionSnapKind.value = snapped.kind;
    tempKeyframeTime.value = clampKeyframeTime(snapped.timeMs - clip.startTime, clip.duration);
  };

  const cancelDragKeyframe = () => {
    const wasActive = isDraggingKeyframe.value;
    isDraggingKeyframe.value = false;
    draggedKeyframeId.value = null;
    draggedKeyframeClipId.value = null;
    interactionSnapKind.value = null;
    activeSnapCandidates = [];
    if (typeof window !== "undefined") {
      window.removeEventListener("mousemove", onDragKeyframe);
      window.removeEventListener("mouseup", stopDragKeyframe);
    }
    if (wasActive && typeof document !== "undefined") {
      document.body.style.cursor = "";
    }
  };

  const stopDragKeyframe = () => {
    if (isDraggingKeyframe.value && draggedKeyframeClipId.value && draggedKeyframeId.value) {
      timelineStore.updateClipKeyframe(draggedKeyframeClipId.value, draggedKeyframeId.value, {
        timeMs: tempKeyframeTime.value
      });
    }

    cancelDragKeyframe();
  };

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
    interactionSnapKind.value = null;
    activeSnapCandidates = buildSnapCandidates(clip.id, marker.id);
    document.body.style.cursor = "ew-resize";
    window.addEventListener("mousemove", onDragKeyframe);
    window.addEventListener("mouseup", stopDragKeyframe);
  };

  const cancelAllInteractions = () => {
    cancelDragClip();
    cancelResizeClip();
    cancelDragKeyframe();
  };

  if (getCurrentScope()) {
    onScopeDispose(cancelAllInteractions);
  }

  return {
    tempState,
    tooltipPosition,
    interactionSnapKind,
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
    stopDragClip,
    cancelDragClip,
    startResizeClip,
    stopResizeClip,
    cancelResizeClip,
    selectKeyframeMarker,
    getKeyframeMarkerStyle,
    startDragKeyframe,
    stopDragKeyframe,
    cancelDragKeyframe,
    cancelAllInteractions
  };
}
