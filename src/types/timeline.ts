import type { AnyDanmu } from "./danmu";
import type { EffectInstance } from "./effects";

export type KeyframeInterpolation = "linear" | "step";

export interface TimelineKeyframeProperties {
  x?: number | string;
  y?: number | string;
  content?: string;
  text?: string;
  scale?: number;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  opacity?: number;
  color?: number | string;
  fontSize?: number | string;
}

export interface TimelineKeyframe {
  id: string;
  timeMs: number;
  properties: TimelineKeyframeProperties;
  interpolation?: KeyframeInterpolation;
  easing?: string;
}

/** 音频片段参数 */
export interface TimelineClipParams {
  volume?: number; // dB 值，默认 0
  muted?: boolean; // 元素级静音
}

export interface TimelineClipBase {
  id: string;
  name?: string;      // 显示名称，默认跟随资源
  startTime: number;  // 在时间轴上的开始时间 (ms)
  duration: number;   // 持续时间 (ms)，默认跟随资源的 durationMs
  trackId: string;    // 所属轨道 ID
}

export interface TimelineResourceClip extends TimelineClipBase {
  kind: "resource";
  resourceId: string;
  params?: TimelineClipParams; // 音频/视频参数（音量、静音等）
  overrides?: Partial<AnyDanmu>;
  parentClipId?: string;
  sourceInMs?: number;
  /** 基础关键帧相对片段起点的局部时间偏移（ms，默认 0）；左边缘裁剪时随关键帧一起无损平移。 */
  baseKeyframeTimeMs?: number;
  effects?: EffectInstance[];
  keyframes?: TimelineKeyframe[]; // AE/视频编辑器式关键帧
}

export interface TimelineGroupClip extends TimelineClipBase {
  kind: "group";
  effects?: never;
  tracks: TimelineTrack[];
  resourceId?: never;
  params?: never;
  keyframes?: never;
  overrides?: never;
  parentClipId?: never;
  sourceInMs?: never;
  baseKeyframeTimeMs?: never;
}

export type TimelineClip = TimelineResourceClip | TimelineGroupClip;

export type TimelineTrackType = "danmu" | "audio";

export interface TimelineTrack {
  id: string;
  name: string;
  type?: TimelineTrackType;
  clips: TimelineClip[];
  visible: boolean;
  muted?: boolean;
  locked: boolean;
  expanded?: boolean; // 是否展开显示动画详情
}

export type TimelineDisplayMode = "frames" | "milliseconds";

export type TimelineMarker = {
  id: string;
  timeMs: number;
  label?: string;
};

export type TimelineSettings = {
  fps?: number;
  timeDisplayMode?: TimelineDisplayMode;
  snapEnabled?: boolean;
  markers?: TimelineMarker[];
};

export type TimelineSnapKind =
  | "playhead"
  | "marker"
  | "clipStart"
  | "clipEnd"
  | "keyframe"
  | "frame";

export type TimelineSnapCandidate = {
  timeMs: number;
  kind: Exclude<TimelineSnapKind, "frame">;
};

export interface TimelineState {
  tracks: TimelineTrack[];
  currentTime: number; // 当前游标位置 (ms)
  isPlaying: boolean;
  duration: number; // 总时长 (ms)
}
