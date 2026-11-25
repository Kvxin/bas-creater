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

/** 视频编辑器风格时间码：hh:mm:ss:ff（按 30fps 显示帧）。 */
export const toPreviewTimecode = (timeMs: number) => {
  const totalMs = Math.max(0, timeMs);
  const totalSeconds = Math.floor(totalMs / 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  const frames = Math.floor(((totalMs % 1000) / 1000) * 30);
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}:${pad(frames)}`;
};
