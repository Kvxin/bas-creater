import type { AnyDanmu } from "@/types/danmu";
import type { TimelineDisplayMode, TimelineMarker, TimelineTrack } from "@/types/timeline";

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
  sourcePath?: string;
  relativePath?: string;
}

/** File paths are relative to the project for owned files, absolute for desktop references. */
export type AssetLocation = { kind: "external" | "project"; path: string };

export type ProjectAsset =
  | { id: string; type: "text" | "button" | "path"; binId: string | null; danmu: AnyDanmu }
  | { id: string; type: "audio-file"; binId: string | null; audio: SerializedAudioMetadata; location?: AssetLocation };

export interface ProjectBin {
  id: string;
  name: string;
  parentId: string | null;
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
    fps?: number;
    bpm?: number;
    beatOffsetMs?: number;
    timeDisplayMode?: TimelineDisplayMode;
    snapEnabled?: boolean;
    markers?: TimelineMarker[];
  };
  danmus: AnyDanmu[];
  tracks: TimelineTrack[];
  assets: ProjectAsset[];
  bins: ProjectBin[];
  audioMeta: SerializedAudioMetadata[];
}

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";
