// 每个小格的像素（可根据 UI 调整）
const PX_PER_GRID = 10;

/**
 * 根据 scale 获取一个小格对应的时间（毫秒）
 * 50ms / 1000ms / 10000ms
 */
export function getGridSize(scale: number): number {
  if (scale >= 80) {
    return 50; // 毫秒级：50ms
  }
  if (scale >= 40) {
    return 1000; // 秒级：1s
  }
  return 10000; // 分钟级：10s
}

/**
 * 将给定的时间（毫秒）转换为像素宽度
 * @param scale 缩放比例
 * @param timeMs 毫秒值
 */
export function getGridPixel(scale: number, timeMs: number): number {
  const gridMs = getGridSize(scale);
  return (timeMs / gridMs) * PX_PER_GRID;
}

/**
 * 从屏幕像素计算对应的时间（毫秒）
 * @param offsetX 像素偏移
 * @param scale 缩放比例
 */
export function getGridTime(offsetX: number, scale: number): number {
  const gridMs = getGridSize(scale);
  return Math.floor(offsetX / PX_PER_GRID) * gridMs;
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
  const ms = timeMs % 1000;
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
