import { normalizeKeyframes } from "@/core/keyframes";
import type {
  TimelineDisplayMode,
  TimelineMarker,
  TimelineSnapCandidate,
  TimelineSnapKind,
  TimelineTrack
} from "@/types/timeline";

export const DEFAULT_TIMELINE_FPS = 30;
export const TIMELINE_FPS_PRESETS = [24, 25, 30, 60] as const;
export const MIN_TIMELINE_FPS = 1;
export const MAX_TIMELINE_FPS = 240;

export const DEFAULT_TIMELINE_BPM = 120;
export const MIN_TIMELINE_BPM = 20;
export const MAX_TIMELINE_BPM = 400;

export const MIN_TIMELINE_ZOOM = 10;
export const MAX_TIMELINE_ZOOM = 1200;
export const DEFAULT_SNAP_SCREEN_PX = 6;

/**
 * 将时间量化到 0.1ms（与 BAS 编译器 `toFixed(4)` 秒的最小精度对齐），消除浮点累积尾差。
 */
export function roundTimelineMs(timeMs: number): number {
  if (!Number.isFinite(timeMs)) return 0;
  return Math.round(Math.max(0, timeMs) * 10) / 10;
}

export function clampTimelineFps(fps: number | undefined): number {
  if (typeof fps !== "number" || !Number.isFinite(fps)) return DEFAULT_TIMELINE_FPS;
  return Math.min(MAX_TIMELINE_FPS, Math.max(MIN_TIMELINE_FPS, fps));
}

export function clampTimelineBpm(bpm: number | undefined): number {
  if (typeof bpm !== "number" || !Number.isFinite(bpm)) return DEFAULT_TIMELINE_BPM;
  return Math.min(MAX_TIMELINE_BPM, Math.max(MIN_TIMELINE_BPM, bpm));
}

export function getFrameDurationMs(fps = DEFAULT_TIMELINE_FPS): number {
  return 1000 / clampTimelineFps(fps);
}

export function getBeatDurationMs(bpm = DEFAULT_TIMELINE_BPM): number {
  return 60000 / clampTimelineBpm(bpm);
}

export function getMinClipDurationMs(fps = DEFAULT_TIMELINE_FPS): number {
  return Math.max(1, roundTimelineMs(getFrameDurationMs(fps)));
}

export function getKeyframeToleranceMs(fps = DEFAULT_TIMELINE_FPS): number {
  return Math.min(15, Math.max(1, Math.floor(450 / clampTimelineFps(fps))));
}

// 统一的缩放逻辑：pixelsPerSecond = scale * 2
export function getPixelsPerSecond(scale: number): number {
  return scale * 2;
}

/**
 * 根据 scale 获取网格对齐的基准时间单元（毫秒）
 * 用于毫秒模式吸附和计算基础网格
 */
export function getGridSize(scale: number): number {
  const pps = getPixelsPerSecond(scale);
  if (pps >= 800) return 10;
  if (pps >= 400) return 20;
  if (pps >= 200) return 50;
  if (pps >= 100) return 100;
  if (pps >= 40) return 250;
  if (pps >= 20) return 500;
  return 1000;
}

/**
 * 将给定的时间（毫秒）转换为像素宽度
 * @param scale 缩放比例
 * @param timeMs 毫秒值
 */
export function getGridPixel(scale: number, timeMs: number): number {
  const pps = getPixelsPerSecond(scale);
  return (timeMs / 1000) * pps;
}

/**
 * 从屏幕像素计算对应的时间（毫秒）
 * @param offsetX 像素偏移
 * @param scale 缩放比例
 */
export function getGridTime(offsetX: number, scale: number): number {
  const pps = getPixelsPerSecond(scale);
  if (pps === 0) return 0;
  const rawMs = (offsetX / pps) * 1000;
  const gridSize = getGridSize(scale);
  return Math.round(rawMs / gridSize) * gridSize;
}

/**
 * 获取长文本（例如：00:00.250 或 01:23）
 * @param timeMs 时间毫秒
 */
export function getLongText(timeMs: number): string {
  return formatTime(timeMs).str;
}

/**
 * 获取短文本（毫秒显示，仅在毫秒级显示）
 * @param timeMs 毫秒
 * @param scale 缩放比例
 */
export function getShortText(timeMs: number, scale: number): string {
  if (scale >= 80) {
    return `${roundTimelineMs(timeMs)}ms`;
  }
  return "";
}

/**
 * 格式化时间，支持毫秒显示
 * 返回格式：hh:mm:ss.xxx
 */
export function formatTime(timeMs: number) {
  const safeMs = Math.max(0, Number.isFinite(timeMs) ? timeMs : 0);
  const roundedIntMs = Math.round(safeMs);
  const ms = roundedIntMs % 1000;
  let totalSeconds = Math.floor(roundedIntMs / 1000);

  const s = totalSeconds % 60;
  totalSeconds = Math.floor(totalSeconds / 60);

  const m = totalSeconds % 60;
  const h = Math.floor(totalSeconds / 60);

  return {
    h,
    m,
    s,
    ms,
    str:
      (h > 0 ? `${h < 10 ? "0" : ""}${h}:` : "") +
      `${m < 10 ? "0" : ""}${m}:` +
      `${s < 10 ? "0" : ""}${s}` +
      `.${ms.toString().padStart(3, "0")}`
  };
}

/**
 * 格式化帧时间码：HH:MM:SS:FF（或 MM:SS:FF）。
 * 加 0.01 帧容差以补偿 0.1ms 量化后的浮点截断（例如 30fps 第 1 帧 33.3ms * 30 / 1000 = 0.999）。
 */
export function formatFrameTimecode(
  timeMs: number,
  fps = DEFAULT_TIMELINE_FPS,
  options: { alwaysShowHours?: boolean } = {}
): string {
  const safeMs = Math.max(0, Number.isFinite(timeMs) ? timeMs : 0);
  const safeFps = clampTimelineFps(fps);
  const nominalFps = Math.max(1, Math.round(safeFps));
  const totalFrames = Math.floor((safeMs * safeFps) / 1000 + 1e-2);
  const frames = totalFrames % nominalFps;
  const totalSeconds = Math.floor(totalFrames / nominalFps);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const frameDigits = nominalFps >= 100 ? 3 : 2;
  const pad2 = (value: number) => String(value).padStart(2, "0");
  const prefix = options.alwaysShowHours || h > 0 ? `${pad2(h)}:` : "";
  return `${prefix}${pad2(m)}:${pad2(s)}:${String(frames).padStart(frameDigits, "0")}`;
}

/**
 * 格式化音乐节拍时间码：BB:bb.ss（小节:拍.百分拍，默认 4/4 拍）。
 */
export function formatBeatTimecode(
  timeMs: number,
  bpm = DEFAULT_TIMELINE_BPM,
  beatOffsetMs = 0
): string {
  const safeMs = Math.max(0, Number.isFinite(timeMs) ? timeMs : 0);
  const offset = Number.isFinite(beatOffsetMs) ? beatOffsetMs : 0;
  const beatMs = getBeatDurationMs(bpm);
  const deltaMs = safeMs - offset;
  if (deltaMs < -1e-2) {
    const preBeats = Math.abs(deltaMs) / beatMs;
    const bar = Math.floor(preBeats / 4) + 1;
    const beat = (Math.floor(preBeats) % 4) + 1;
    const sub = Math.min(99, Math.floor((preBeats - Math.floor(preBeats)) * 100));
    return `-${String(bar).padStart(2, "0")}:${String(beat).padStart(2, "0")}.${String(sub).padStart(2, "0")}`;
  }
  const totalBeats = Math.max(0, deltaMs) / beatMs + 1e-4;
  const bar = Math.floor(totalBeats / 4) + 1;
  const beat = (Math.floor(totalBeats) % 4) + 1;
  const sub = Math.min(99, Math.floor((totalBeats - Math.floor(totalBeats)) * 100));
  return `${String(bar).padStart(2, "0")}:${String(beat).padStart(2, "0")}.${String(sub).padStart(2, "0")}`;
}

export function formatTimelineTime(
  timeMs: number,
  options: {
    mode?: TimelineDisplayMode;
    fps?: number;
    bpm?: number;
    beatOffsetMs?: number;
    alwaysShowHours?: boolean;
  } = {}
): string {
  const mode = options.mode ?? "frames";
  if (mode === "beats") {
    return formatBeatTimecode(timeMs, options.bpm, options.beatOffsetMs);
  }
  if (mode === "milliseconds") {
    const formatted = formatTime(timeMs);
    if (!options.alwaysShowHours || formatted.h > 0) return formatted.str;
    return `00:${formatted.str}`;
  }
  return formatFrameTimecode(timeMs, options.fps, { alwaysShowHours: options.alwaysShowHours });
}

/**
 * 按参考帧率逐帧步进：若当前游标位于两帧之间，首次步进先对齐到紧邻帧边界，避免累积漂移。
 */
export function stepFrameTimeMs(
  currentTimeMs: number,
  deltaFrames: number,
  fps = DEFAULT_TIMELINE_FPS,
  maxDurationMs = Number.POSITIVE_INFINITY
): number {
  const safeMax = Math.max(0, Number.isFinite(maxDurationMs) ? maxDurationMs : Number.POSITIVE_INFINITY);
  if (!Number.isFinite(deltaFrames) || deltaFrames === 0) {
    return Math.min(Math.max(0, roundTimelineMs(currentTimeMs)), safeMax);
  }
  const safeFps = clampTimelineFps(fps);
  const exactFrame = (Math.max(0, currentTimeMs) * safeFps) / 1000;
  const nearestFrame = Math.round(exactFrame);
  const isAligned = Math.abs(exactFrame - nearestFrame) <= 0.02;
  const targetFrame = isAligned
    ? nearestFrame + deltaFrames
    : deltaFrames > 0
      ? Math.ceil(exactFrame) + (deltaFrames - 1)
      : Math.floor(exactFrame) + (deltaFrames + 1);
  const nextMs = roundTimelineMs((Math.max(0, targetFrame) * 1000) / safeFps);
  return Math.min(Math.max(0, nextMs), safeMax);
}

export type RulerTick = {
  timeMs: number;
  kind: "major" | "medium" | "minor";
  label?: string;
};

/**
 * 使用整数步进索引生成可视区标尺刻度，避免非整除帧长（33.33ms）或 BPM 拍长（468.75ms）的浮点取模误差。
 */
export function getRulerTicks(options: {
  startTimeMs: number;
  endTimeMs: number;
  scale: number;
  mode?: TimelineDisplayMode;
  fps?: number;
  bpm?: number;
  beatOffsetMs?: number;
}): RulerTick[] {
  const pps = getPixelsPerSecond(options.scale);
  if (pps <= 0 || options.endTimeMs < 0) return [];
  const mode = options.mode ?? "frames";
  const safeFps = clampTimelineFps(options.fps);
  const safeBpm = clampTimelineBpm(options.bpm);
  const originMs = mode === "beats" && Number.isFinite(options.beatOffsetMs) ? options.beatOffsetMs! : 0;

  let minorMs = 1000;
  let mediumEvery = 5;
  let majorEvery = 10;
  let showMediumFrameLabel = false;
  let showMediumBeatLabel = false;

  if (mode === "frames") {
    const nominalFps = Math.max(1, Math.round(safeFps));
    const frameMs = 1000 / safeFps;
    const pxPerFrame = (frameMs / 1000) * pps;
    if (pxPerFrame >= 6) {
      minorMs = frameMs;
      mediumEvery = nominalFps % 10 === 0 ? 5 : nominalFps % 12 === 0 ? 6 : 5;
      majorEvery = nominalFps;
      showMediumFrameLabel = pxPerFrame * mediumEvery >= 56;
    } else if (pxPerFrame * 5 >= 8) {
      const stepFrames =
        nominalFps % 5 === 0 ? 5 : nominalFps % 6 === 0 ? 6 : Math.max(1, Math.round(nominalFps / 5));
      minorMs = frameMs * stepFrames;
      const stepsPerSec = Math.max(2, Math.round(nominalFps / stepFrames));
      mediumEvery = stepsPerSec % 2 === 0 ? stepsPerSec / 2 : stepsPerSec;
      majorEvery = stepsPerSec;
    } else if (pps >= 40) {
      minorMs = 500;
      mediumEvery = 2;
      majorEvery = 10;
    }
  } else if (mode === "beats") {
    const beatMs = getBeatDurationMs(safeBpm);
    const pxPerBeat = (beatMs / 1000) * pps;
    if (pxPerBeat / 4 >= 7) {
      minorMs = beatMs / 4;
      mediumEvery = 4;
      majorEvery = 16;
      showMediumBeatLabel = pxPerBeat >= 64;
    } else if (pxPerBeat / 2 >= 7) {
      minorMs = beatMs / 2;
      mediumEvery = 2;
      majorEvery = 8;
      showMediumBeatLabel = pxPerBeat >= 64;
    } else if (pxPerBeat >= 8) {
      minorMs = beatMs;
      mediumEvery = 2;
      majorEvery = 4;
    } else if (pxPerBeat * 4 >= 12) {
      minorMs = beatMs * 4;
      mediumEvery = 2;
      majorEvery = 4;
    } else {
      minorMs = beatMs * 16;
      mediumEvery = 2;
      majorEvery = 4;
    }
  } else {
    if (pps >= 800) {
      minorMs = 10;
      mediumEvery = 5;
      majorEvery = 10;
    } else if (pps >= 400) {
      minorMs = 20;
      mediumEvery = 5;
      majorEvery = 25;
    } else if (pps >= 200) {
      minorMs = 50;
      mediumEvery = 5;
      majorEvery = 20;
    } else if (pps >= 100) {
      minorMs = 100;
      mediumEvery = 5;
      majorEvery = 10;
    } else if (pps >= 40) {
      minorMs = 500;
      mediumEvery = 2;
      majorEvery = 10;
    }
  }

  const clampedStart = Math.max(0, options.startTimeMs);
  const minStep = Math.floor((clampedStart - originMs) / minorMs);
  const maxStep = Math.ceil((options.endTimeMs - originMs) / minorMs);
  const ticks: RulerTick[] = [];

  for (let step = minStep; step <= maxStep; step += 1) {
    const rawTime = originMs + step * minorMs;
    if (rawTime < -1e-4) continue;
    const timeMs = Math.max(0, rawTime);
    const modMajor = ((step % majorEvery) + majorEvery) % majorEvery;
    const modMedium = ((step % mediumEvery) + mediumEvery) % mediumEvery;

    if (modMajor === 0) {
      ticks.push({
        timeMs,
        kind: "major",
        label: formatTimelineTime(timeMs, {
          mode,
          fps: safeFps,
          bpm: safeBpm,
          beatOffsetMs: originMs
        })
      });
    } else if (modMedium === 0) {
      let label: string | undefined;
      if (showMediumFrameLabel) {
        const nominalFps = Math.max(1, Math.round(safeFps));
        const frame = Math.round(step) % nominalFps;
        label = `:${String(frame).padStart(2, "0")}`;
      } else if (showMediumBeatLabel) {
        label = formatBeatTimecode(timeMs, safeBpm, originMs).slice(0, 5);
      }
      ticks.push({ timeMs, kind: "medium", ...(label ? { label } : {}) });
    } else {
      ticks.push({ timeMs, kind: "minor" });
    }
  }

  return ticks;
}

export function collectTimelineSnapCandidates(options: {
  tracks: TimelineTrack[];
  markers?: TimelineMarker[];
  playheadTimeMs?: number;
  excludeClipId?: string | null;
  excludeKeyframeId?: string | null;
  maxTimeMs?: number;
}): TimelineSnapCandidate[] {
  const maxTime = options.maxTimeMs ?? Number.POSITIVE_INFINITY;
  const candidates = new Map<string, TimelineSnapCandidate>();
  const addCandidate = (timeMs: number, kind: TimelineSnapCandidate["kind"]) => {
    const clamped = Math.min(Math.max(0, roundTimelineMs(timeMs)), maxTime);
    if (!Number.isFinite(clamped)) return;
    const key = clamped.toFixed(1);
    if (!candidates.has(key)) candidates.set(key, { timeMs: clamped, kind });
  };

  for (const marker of options.markers ?? []) {
    addCandidate(marker.timeMs, "marker");
  }
  if (options.playheadTimeMs !== undefined && Number.isFinite(options.playheadTimeMs)) {
    addCandidate(options.playheadTimeMs, "playhead");
  }
  for (const track of options.tracks) {
    for (const clip of track.clips) {
      if (clip.id !== options.excludeClipId) {
        addCandidate(clip.startTime, "clipStart");
        addCandidate(clip.startTime + clip.duration, "clipEnd");
      }
      if (clip.id !== options.excludeClipId || options.excludeKeyframeId) {
        for (const keyframe of normalizeKeyframes(clip.keyframes, clip.duration)) {
          if (keyframe.id === options.excludeKeyframeId) continue;
          addCandidate(clip.startTime + keyframe.timeMs, "keyframe");
        }
      }
    }
  }

  return [...candidates.values()].sort((left, right) => left.timeMs - right.timeMs);
}

function findNearestSemanticCandidate(
  targetTimeMs: number,
  candidates: TimelineSnapCandidate[],
  thresholdMs: number
): TimelineSnapCandidate | null {
  if (!candidates.length || thresholdMs <= 0) return null;
  let low = 0;
  let high = candidates.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((candidates[middle]?.timeMs ?? 0) < targetTimeMs) low = middle + 1;
    else high = middle;
  }

  let nearest: TimelineSnapCandidate | null = null;
  for (const candidate of [candidates[low - 1], candidates[low]]) {
    if (!candidate) continue;
    if (!nearest || Math.abs(candidate.timeMs - targetTimeMs) < Math.abs(nearest.timeMs - targetTimeMs)) {
      nearest = candidate;
    }
  }
  if (nearest && Math.abs(nearest.timeMs - targetTimeMs) <= thresholdMs) {
    return nearest;
  }
  return null;
}

export function quantizeTimeToGrid(
  rawTimeMs: number,
  options: {
    mode?: TimelineDisplayMode;
    fps?: number;
    bpm?: number;
    beatOffsetMs?: number;
    pixelsPerSecond?: number;
    maxTimeMs?: number;
  } = {}
): { timeMs: number; kind: "frame" | "beat" | null } {
  const maxTime = options.maxTimeMs ?? Number.POSITIVE_INFINITY;
  const clamped = Math.min(Math.max(0, rawTimeMs), maxTime);
  const mode = options.mode ?? "frames";

  if (mode === "frames") {
    const frameMs = getFrameDurationMs(options.fps);
    const snapped = roundTimelineMs(Math.round(clamped / frameMs) * frameMs);
    return { timeMs: Math.min(maxTime, snapped), kind: "frame" };
  }

  if (mode === "beats") {
    const beatMs = getBeatDurationMs(options.bpm);
    const pps = options.pixelsPerSecond ?? 100;
    const stepMs =
      ((beatMs / 4) / 1000) * pps >= 6
        ? beatMs / 4
        : ((beatMs / 2) / 1000) * pps >= 6
          ? beatMs / 2
          : beatMs;
    const offset = Number.isFinite(options.beatOffsetMs) ? options.beatOffsetMs! : 0;
    const steps = Math.round((clamped - offset) / stepMs);
    const snapped = roundTimelineMs(Math.max(0, offset + steps * stepMs));
    return { timeMs: Math.min(maxTime, snapped), kind: "beat" };
  }

  return { timeMs: roundTimelineMs(clamped), kind: null };
}

/**
 * 统一解析时间轴吸附：语义吸附（标记点、播放头、片段首尾、关键帧）优先于当前网格（帧 / BPM 节拍）。
 */
export function resolveTimelineSnap(
  rawTimeMs: number,
  options: {
    candidates?: TimelineSnapCandidate[];
    pixelsPerSecond: number;
    mode?: TimelineDisplayMode;
    fps?: number;
    bpm?: number;
    beatOffsetMs?: number;
    snapEnabled?: boolean;
    disableSnap?: boolean;
    maxTimeMs?: number;
    screenThresholdPx?: number;
    clipDurationMs?: number;
  }
): { timeMs: number; kind: TimelineSnapKind | null } {
  const maxTime = options.maxTimeMs ?? Number.POSITIVE_INFINITY;
  const clamped = Math.min(Math.max(0, Number.isFinite(rawTimeMs) ? rawTimeMs : 0), maxTime);
  if (options.disableSnap || options.snapEnabled === false || options.pixelsPerSecond <= 0) {
    return { timeMs: roundTimelineMs(clamped), kind: null };
  }

  const thresholdMs = ((options.screenThresholdPx ?? DEFAULT_SNAP_SCREEN_PX) / options.pixelsPerSecond) * 1000;
  const candidates = options.candidates ?? [];
  const startMatch = findNearestSemanticCandidate(clamped, candidates, thresholdMs);
  const endMatch =
    options.clipDurationMs && options.clipDurationMs > 0
      ? findNearestSemanticCandidate(clamped + options.clipDurationMs, candidates, thresholdMs)
      : null;

  if (startMatch && endMatch) {
    const startDiff = Math.abs(startMatch.timeMs - clamped);
    const endDiff = Math.abs(endMatch.timeMs - (clamped + options.clipDurationMs!));
    if (endDiff < startDiff && endMatch.timeMs - options.clipDurationMs! >= 0) {
      return { timeMs: roundTimelineMs(endMatch.timeMs - options.clipDurationMs!), kind: endMatch.kind };
    }
    return { timeMs: roundTimelineMs(startMatch.timeMs), kind: startMatch.kind };
  }
  if (startMatch) {
    return { timeMs: roundTimelineMs(startMatch.timeMs), kind: startMatch.kind };
  }
  if (endMatch && endMatch.timeMs - options.clipDurationMs! >= 0) {
    return { timeMs: roundTimelineMs(endMatch.timeMs - options.clipDurationMs!), kind: endMatch.kind };
  }

  return quantizeTimeToGrid(clamped, {
    mode: options.mode,
    fps: options.fps,
    bpm: options.bpm,
    beatOffsetMs: options.beatOffsetMs,
    pixelsPerSecond: options.pixelsPerSecond,
    maxTimeMs: maxTime
  });
}

/**
 * 计算两个时间的差（毫秒）
 */
export function durationMs(startMs: number, endMs: number): number {
  return Math.max(0, roundTimelineMs(endMs - startMs));
}
