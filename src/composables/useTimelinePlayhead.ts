import { computed, getCurrentScope, onScopeDispose, ref, type Ref } from "vue";
import { collectTimelineSnapCandidates, resolveTimelineSnap } from "@/core/timeline";
import type { TimelineDisplayMode, TimelineMarker, TimelineTrack } from "@/types/timeline";

/** 吸附候选的语义种类；显示文本在渲染时通过 t() 解析。 */
export type PlayheadSemanticSnapKind = "marker" | "clipStart" | "clipEnd" | "keyframe";

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
  markers?: Ref<TimelineMarker[]>;
  mode?: Ref<TimelineDisplayMode>;
  fps?: Ref<number>;
  bpm?: Ref<number>;
  beatOffsetMs?: Ref<number>;
  snapEnabled?: Ref<boolean>;
};

const isSemanticKind = (kind: string | null): kind is PlayheadSemanticSnapKind =>
  kind === "marker" || kind === "clipStart" || kind === "clipEnd" || kind === "keyframe";

/** 管理时间轴游标的语义吸附、帧/节拍网格对齐、拖拽交互与标尺位置计算。 */
export function useTimelinePlayhead(params: UseTimelinePlayheadParams) {
  const {
    tracks,
    duration,
    currentTime,
    pixelsPerSecond,
    scrollLeft,
    timelineContentRef,
    setCurrentTime,
    translate,
    markers,
    mode,
    fps,
    bpm,
    beatOffsetMs,
    snapEnabled
  } = params;

  const isDraggingPlayhead = ref(false);
  const playheadSnapKind = ref<PlayheadSemanticSnapKind | null>(null);
  const playheadTooltipClientX = ref(0);
  const playheadTooltipTop = ref(0);

  const getPlayheadSnapText = (kind: PlayheadSemanticSnapKind) => {
    if (kind === "marker") return translate("timeline.snap.marker");
    if (kind === "clipStart") return translate("timeline.snap.clipStart");
    if (kind === "clipEnd") return translate("timeline.snap.clipEnd");
    return translate("timeline.snap.keyframe");
  };

  const playheadSnapText = computed(() =>
    playheadSnapKind.value ? getPlayheadSnapText(playheadSnapKind.value) : ""
  );

  const playheadSemanticSnapCandidates = computed(() =>
    collectTimelineSnapCandidates({
      tracks: tracks.value,
      markers: markers?.value,
      maxTimeMs: duration.value
    })
  );

  const resolvePlayheadPosition = (rawTimeMs: number, disableSnap = false) => {
    const resolved = resolveTimelineSnap(rawTimeMs, {
      candidates: playheadSemanticSnapCandidates.value,
      pixelsPerSecond: pixelsPerSecond.value,
      mode: mode?.value ?? "frames",
      fps: fps?.value,
      bpm: bpm?.value,
      beatOffsetMs: beatOffsetMs?.value,
      snapEnabled: snapEnabled?.value ?? true,
      disableSnap,
      maxTimeMs: duration.value,
      screenThresholdPx: PLAYHEAD_SEMANTIC_SNAP_SCREEN_PX
    });
    return {
      timeMs: resolved.timeMs,
      kind: isSemanticKind(resolved.kind) ? resolved.kind : null
    };
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
    const resolved = resolvePlayheadPosition(time, disableSnap);
    playheadSnapKind.value = resolved.kind;
    setCurrentTime(resolved.timeMs);
  };

  const onDragPlayhead = (e: MouseEvent) => {
    if (!isDraggingPlayhead.value || !timelineContentRef.value) return;

    const rect = timelineContentRef.value.getBoundingClientRect();
    const moveX = e.clientX - rect.left + scrollLeft.value;
    const rawTime = (moveX / pixelsPerSecond.value) * 1000;
    const resolved = resolvePlayheadPosition(rawTime, e.shiftKey);

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
