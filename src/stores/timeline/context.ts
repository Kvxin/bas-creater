import type { ComputedRef, Ref, WritableComputedRef } from "vue";
import type { TimelineTrack, TimelineTrackType } from "@/types/timeline";
import type { TimelineClipLocation } from "@/core/timelineTracks";

/** timeline store 拆分出的各功能模块共享的状态与操作。 */
export interface TimelineStoreContext {
  rootTracks: Ref<TimelineTrack[]>;
  /** 当前编辑层（根时间轴或进入的分组）的轨道。 */
  tracks: ComputedRef<TimelineTrack[]>;
  activeGroupPath: Ref<string[]>;
  fps: Ref<number>;
  selectedClipIds: Ref<string[]>;
  selectedClipId: WritableComputedRef<string | null>;
  selectedKeyframeId: Ref<string | null>;
  findClipLocation: (clipId: string) => TimelineClipLocation | null;
  recalculateDuration: () => void;
  setSelectedClip: (id: string | null) => void;
  setSelectedClips: (ids: string[], primaryId?: string | null) => void;
  addTrack: (name?: string, type?: TimelineTrackType) => string | null;
}
