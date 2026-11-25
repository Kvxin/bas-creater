import { computed, reactive, ref, type Ref } from "vue";
import { clampKeyframeTime } from "@/core/keyframes";
import type { TimelineClip, TimelineTrack, TimelineTrackType } from "@/types/timeline";
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

/** 管理时间轴片段的拖拽跨轨/复制、边缘拉伸与关键帧拖拽交互。 */
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
      width: `${Math.max(clip.kind === "group" ? 28 : 1, width)}px`,
      zIndex
    };
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

  const onDragClip = (e: MouseEvent) => {
    if (!isDraggingClip.value || !draggedClipId.value) return;

    const deltaX = e.clientX - dragStartX.value;
    const deltaMs = (deltaX / pixelsPerSecond.value) * 1000;

    let newStartTime = initialClipStartTime.value + deltaMs;
    newStartTime = Math.max(0, newStartTime);

    tempState.startTime = newStartTime;
    const groupId = getGroupIdAtPoint(e);
    dragTargetGroupId.value = groupId;
    dragTargetTrackId.value = groupId ? null : (getTrackIdAtPoint(e) ?? dragTargetTrackId.value);

    isAltDragCopy.value = e.altKey;
    const crossingTracks = Boolean(groupId) || dragTargetTrackId.value !== originalClipTrackId.value;
    document.body.style.cursor = e.altKey && crossingTracks ? "copy" : "move";

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

  const startDragClip = (e: MouseEvent, clip: TimelineClip) => {
    if (e.button !== 0) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || editingGroupId.value === clip.id) return;
    if (timelineStore.tracks.find(track => track.id === clip.trackId)?.locked) return;

    if ((e.target as HTMLElement).dataset.handle) return;

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

    if (resizingHandle.value === "right") {
      let newDuration = initialResizeDuration.value + deltaMs;
      newDuration = Math.max(100, newDuration);
      if (resizeAudioDurationMs.value !== null) {
        newDuration = Math.min(newDuration, Math.max(0, resizeAudioDurationMs.value - initialResizeSourceInMs.value));
      }

      tempState.duration = newDuration;
    } else {
      let newStartTime = initialResizeStartTime.value + deltaMs;
      let newDuration = initialResizeDuration.value - deltaMs;

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

      tempState.startTime = newStartTime;
      tempState.duration = newDuration;
    }

    tooltipPosition.x = e.clientX + 15;
    tooltipPosition.y = e.clientY + 15;
  };

  const stopResizeClip = () => {
    if (isResizingClip.value && resizingClipId.value) {
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

  return {
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
    stopDragClip,
    startResizeClip,
    stopResizeClip,
    selectKeyframeMarker,
    getKeyframeMarkerStyle,
    startDragKeyframe,
    stopDragKeyframe
  };
}
