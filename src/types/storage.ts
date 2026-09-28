import type { AnyDanmu } from "@/types/danmu";
import type { TimelineTrack } from "@/types/timeline";

/**
 * 序列化后的音频元数据（剥离不可序列化的运行时 File 和临时 session Blob URL）
 */
export interface SerializedAudioMetadata {
  id: string;
  name: string;
  duration?: number;
  coverUrl?: string; // Data URL 格式的封面
  size?: number;
  type?: string;
}

/**
 * 弹幕工程本地持久化数据结构
 */
export interface BasProjectData {
  version: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  canvas: {
    width: number;
    height: number;
  };
  timeline: {
    duration: number;
    zoomScale?: number;
  };
  danmus: AnyDanmu[];
  tracks: TimelineTrack[];
  audioMeta: SerializedAudioMetadata[];
}

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";
