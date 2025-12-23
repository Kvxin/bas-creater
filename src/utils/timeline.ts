// 统一的缩放逻辑：pixelsPerSecond = scale * 2
export function getPixelsPerSecond(scale: number): number {
  return scale * 2;
}

/**
 * 根据 scale 获取网格对齐的基准时间单元（毫秒）
 * 用于吸附和计算基础网格
 */
export function getGridSize(scale: number): number {
  const pps = getPixelsPerSecond(scale);
  // 目标：让每个最小网格在视觉上保持在 10px - 50px 之间
  if (pps >= 200) return 50;   // 1s=200px -> 50ms=10px
  if (pps >= 100) return 100;  // 1s=100px -> 100ms=10px
  if (pps >= 40) return 250;   // 1s=40px  -> 250ms=10px
  if (pps >= 20) return 500;   // 1s=20px  -> 500ms=10px
  return 1000;                 // 1s=10px  -> 1s=10px (base)
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
  // 直接转为时间，再吸附到最近的 grid
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
    return `${timeMs}ms`;
  }
  return "";
}

/**
 * 格式化时间，支持毫秒显示
 * 返回格式：hh:mm:ss.xxx
 */
export function formatTime(timeMs: number) {
  const ms = Math.floor(timeMs % 1000);
  let totalSeconds = Math.floor(timeMs / 1000);

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
      `.${ms.toString().padStart(3, "0")}`,
  };
}

/**
 * 计算两个时间的差（毫秒）
 */
export function durationMs(startMs: number, endMs: number): number {
  return Math.max(0, endMs - startMs);
}
