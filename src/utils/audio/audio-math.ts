import {
  VOLUME_DB_MIN,
  VOLUME_DB_MAX,
  SLIDER_CURVE_EXPONENT,
  MIN_DISPLAY_DB,
  WAVEFORM_BAR_EXPONENT,
} from "./constants";

/** 钳制 dB 值到有效范围 */
export function clampDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(VOLUME_DB_MAX, Math.max(VOLUME_DB_MIN, value));
}

/** dB 转线性振幅 */
export function dBToLinear(db: number): number {
  return 10 ** (clampDb(db) / 20);
}

/** 线性振幅转 dB */
export function linearToDb(linear: number): number {
  if (linear <= 0) return VOLUME_DB_MIN;
  return clampDb(20 * Math.log10(linear));
}

// ---- 音量线位置映射（非线性曲线，让 0dB 附近拖动更精确） ----

const MIN_LINEAR_GAIN = 10 ** (VOLUME_DB_MIN / 20);
const MAX_LINEAR_GAIN = 10 ** (VOLUME_DB_MAX / 20);
const LINEAR_GAIN_RANGE = MAX_LINEAR_GAIN - MIN_LINEAR_GAIN;

function getNormalizedGainFromDb(db: number): number {
  const clampedDb = clampDb(db);
  const linearGain = 10 ** (clampedDb / 20);
  return (linearGain - MIN_LINEAR_GAIN) / LINEAR_GAIN_RANGE;
}

/**
 * 将 dB 值映射为音量线在元素内的 top 百分比位置。
 * 曲线定义在线性增益空间中，使得 0dB 附近拖动更精确，
 * 而静音区域被压缩到底部。
 *
 * @returns 0-100 的百分比（0=顶部=最大音量, 100=底部=静音）
 */
export function getLinePosFromDb(db: number): number {
  const normalizedGain = Math.max(0, Math.min(1, getNormalizedGainFromDb(db)));
  const progress = normalizedGain ** (1 / SLIDER_CURVE_EXPONENT);
  return (1 - progress) * 100;
}

/**
 * 将元素内的 top 百分比位置映射回 dB 值。
 * getLinePosFromDb 的逆函数。
 */
export function getDbFromLinePos(percent: number): number {
  const clampedPercent = Math.max(0, Math.min(100, percent));
  const progress = 1 - clampedPercent / 100;
  const normalizedGain = progress ** SLIDER_CURVE_EXPONENT;
  const linearGain = MIN_LINEAR_GAIN + normalizedGain * LINEAR_GAIN_RANGE;
  return clampDb(20 * Math.log10(linearGain));
}

// ---- 波形条形高度映射 ----

/**
 * 将输出振幅（原始振幅 × 增益）映射为波形条形的高度比例。
 * 使用 dB 对数曲线，使得安静内容仍然可见，
 * 同时为接近 0 dBFS 的振幅保留顶部空间。
 *
 * @returns 0-1 的高度比例
 */
export function getBarFractionFromOutputAmplitude(outputAmplitude: number): number {
  if (outputAmplitude <= 0) return 0;
  const db = 20 * Math.log10(outputAmplitude);
  if (db <= MIN_DISPLAY_DB) return 0;
  return Math.min(1, ((db - MIN_DISPLAY_DB) / -MIN_DISPLAY_DB) ** WAVEFORM_BAR_EXPONENT);
}

// ---- 辅助函数 ----

/** 将值钳制到 [min, max] 范围 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 将值吸附到最近的 step */
export function snapToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** 格式化数字显示（保留指定位数） */
export function formatNumberForDisplay(value: number, fractionDigits: number): string {
  return value.toFixed(fractionDigits);
}

/** 获取步进值的小数位数 */
export function getFractionDigitsForStep(step: number): number {
  const stepStr = step.toString();
  const dotIndex = stepStr.indexOf(".");
  return dotIndex === -1 ? 0 : stepStr.length - dotIndex - 1;
}

/** 判断两个值是否近似相等 */
export function isNearlyEqual(a: number, b: number, epsilon = 1e-9): boolean {
  return Math.abs(a - b) < epsilon;
}
