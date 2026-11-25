import { computed, getCurrentScope, onScopeDispose, ref, type Ref } from "vue";
import { normalizeKeyframes } from "@/core/keyframes";
import type { TimelineTrack } from "@/types/timeline";

/** 吸附候选的语义种类；显示文本在渲染时通过 t() 解析。 */
export type PlayheadSemanticSnapKind = "clipStart" | "clipEnd" | "keyframe";

export type PlayheadSemanticSnapCandidate = {
  timeMs: number;
  kind: PlayheadSemanticSnapKind;
};

const PLAYHEAD_SEMANTIC_SNAP_SCREEN_PX = 5;

export type UseTimelinePlayheadParams = {
  tracks: Ref<TimelineTrack[]>;
  duration: Ref<number>;
  currentTime: Ref<number>;
  pixelsPerSecond: Ref<number>;
  scrollLeft: Ref<number>;
  timelineContentRef: Ref<HTMLElement | null>;
  setCurrentTime: (timeMs: number) => void;
  translate: (key: string) => string;
};

/** 管理时间轴游标的语义吸附、拖拽交互与标尺位置计算。 */
export function useTimelinePlayhead(params: UseTimelinePlayheadParams) {
  const {
    tracks,
    duration,
    currentTime,
    pixelsPerSecond,
    scrollLeft,
    timelineContentRef,
    setCurrentTime,
    translate
  } = params;

  const isDraggingPlayhead = ref(false);
  const playheadSnapKind = ref<PlayheadSemanticSnapKind | null>(null);
  const playheadTooltipClientX = ref(0);
  const playheadTooltipTop = ref(0);

  const getPlayheadSnapText = (kind: PlayheadSemanticSnapKind) => {
    if (kind === "clipStart") return translate("timeline.snap.clipStart");
    if (kind === "clipEnd") return translate("timeline.snap.clipEnd");
    return translate("timeline.snap.keyframe");
  };

  const playheadSnapText = computed(() =>
    playheadSnapKind.value ? getPlayheadSnapText(playheadSnapKind.value) : ""
  );

  const playheadSemanticSnapCandidates = computed<PlayheadSemanticSnapCandidate[]>(() => {
    const candidates = new Map<string, PlayheadSemanticSnapCandidate>();
    const addCandidate = (timeMs: number, kind: PlayheadSemanticSnapKind) => {
      const clampedTime = Math.min(Math.max(0, timeMs), duration.value);
      if (!Number.isFinite(clampedTime)) return;
      const key = clampedTime.toFixed(3);
      if (!candidates.has(key)) candidates.set(key, { timeMs: clampedTime, kind });
    };

    for (const track of tracks.value) {
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
    const clampedTime = Math.min(Math.max(0, rawTimeMs), duration.value);
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
    const left = (currentTime.value / 1000) * pixelsPerSecond.value;
    return {
      left: `${left}px`
    };
  });

  const rulerPlayheadStyle = computed(() => {
    const rawLeft = (currentTime.value / 1000) * pixelsPerSecond.value;
    return {
      left: `${rawLeft - scrollLeft.value}px`,
      display: rawLeft - scrollLeft.value >= 0 ? "block" : "none"
    };
  });

  const updateTime = (time: number, disableSnap = false) => {
    const resolved = resolvePlayheadSemanticSnap(time, disableSnap);
    playheadSnapKind.value = resolved.kind;
    setCurrentTime(resolved.timeMs);
  };

  const onDragPlayhead = (e: MouseEvent) => {
    if (!isDraggingPlayhead.value || !timelineContentRef.value) return;

    const rect = timelineContentRef.value.getBoundingClientRect();
    const moveX = e.clientX - rect.left + scrollLeft.value;
    const rawTime = (moveX / pixelsPerSecond.value) * 1000;
    const resolved = resolvePlayheadSemanticSnap(rawTime, e.shiftKey);

    playheadSnapKind.value = resolved.kind;
    playheadTooltipClientX.value = e.clientX;
    setCurrentTime(resolved.timeMs);
  };

  const stopDragPlayhead = () => {
    const wasActive = isDraggingPlayhead.value;
    isDraggingPlayhead.value = false;
    playheadSnapKind.value = null;
    if (typeof window !== "undefined") {
      window.removeEventListener("mousemove", onDragPlayhead);
      window.removeEventListener("mouseup", stopDragPlayhead);
    }
    if (wasActive && typeof document !== "undefined") {
      document.body.style.cursor = "";
    }
  };

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

  if (getCurrentScope()) {
    onScopeDispose(stopDragPlayhead);
  }

  return {
    isDraggingPlayhead,
    playheadSnapKind,
    playheadSnapText,
    playheadTooltipStyle,
    playheadStyle,
    rulerPlayheadStyle,
    updateTime,
    startDragPlayhead,
    stopDragPlayhead
  };
}
