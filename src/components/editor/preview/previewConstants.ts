import {
  DEFAULT_TIMELINE_BPM,
  DEFAULT_TIMELINE_FPS,
  formatTimelineTime
} from "@/core/timeline";
import type { TimelineDisplayMode } from "@/types/timeline";

// ---- 画布分辨率预设（快捷预设，用户可自定义任意宽高） ----
export const CANVAS_PRESETS = [
  {
    label: "800×450",
    aspect: "16:9",
    previewClass: "h-3 w-5",
    width: 800,
    height: 450
  },
  {
    label: "640×360",
    aspect: "16:9",
    previewClass: "h-3 w-5",
    width: 640,
    height: 360
  },
  {
    label: "1080×1920",
    aspect: "9:16",
    previewClass: "h-5 w-3",
    width: 1080,
    height: 1920
  },
  {
    label: "1920×1080",
    aspect: "16:9",
    previewClass: "h-3 w-5",
    width: 1920,
    height: 1080
  }
] as const;

export type CanvasPreset = (typeof CANVAS_PRESETS)[number];

// ---- 视图缩放预设 (Fit + 25% ~ 200%) ----
export const ZOOM_PRESETS = [25, 50, 75, 100, 150, 200] as const;

export const CANVAS_MIN_SIZE = 1;
export const CANVAS_MAX_SIZE = 9999;

export const clampCanvasDimension = (value: number | string) => {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) return CANVAS_MIN_SIZE;
  return Math.min(CANVAS_MAX_SIZE, Math.max(CANVAS_MIN_SIZE, Math.round(numericValue)));
};

/** 视频/时间轴时间码显示：默认按参考帧率显示 HH:MM:SS:FF，并支持毫秒与 BPM 节拍模式。 */
export const toPreviewTimecode = (
  timeMs: number,
  fps = DEFAULT_TIMELINE_FPS,
  mode: TimelineDisplayMode = "frames",
  bpm = DEFAULT_TIMELINE_BPM,
  beatOffsetMs = 0
) =>
  formatTimelineTime(timeMs, {
    mode,
    fps,
    bpm,
    beatOffsetMs,
    alwaysShowHours: mode !== "beats"
  });
