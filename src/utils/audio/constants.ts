/** 音量范围（dB） */
export const VOLUME_DB_MIN = -60;
export const VOLUME_DB_MAX = 20;

/** 波形显示参数 */
export const BAR_WIDTH = 1;
export const BAR_GAP = 1;
export const BAR_STEP = BAR_WIDTH + BAR_GAP; // 2px
export const WAVEFORM_GAIN_SAMPLE_COUNT = 200;
export const WAVEFORM_BAR_EXPONENT = 1.5;
export const MIN_DISPLAY_DB = -40;
export const WAVEFORM_BURN_COLOR = "rgba(255, 110, 20, 0.9)";
export const WAVEFORM_COLOR = "rgba(255, 255, 255, 0.7)";

/** 音量线参数 */
export const VOLUME_STEP = 0.1; // dB 步进
export const SLIDER_CURVE_EXPONENT = 2;
export const HIT_AREA_HEIGHT_PX = 14;
export const TOOLTIP_OFFSET_PX = 10;

/** 波形缓存默认桶大小 */
export const DEFAULT_WAVEFORM_BUCKET_SIZE = 128;
