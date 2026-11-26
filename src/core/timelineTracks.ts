import type { AnyDanmu } from "@/types/danmu";
import type { AudioResource } from "@/types/resource";
import type { TimelineClip, TimelineTrack, TimelineTrackType } from "@/types/timeline";
import { sliceEffects } from "@/core/effects";
import { normalizeKeyframes, roundKeyframeTime } from "@/core/keyframes";
import { createTimelineId } from "@/core/timelineGroups";

export type TimelineClipLocation = { track: TimelineTrack; clip: TimelineClip; clipIndex: number };

export const getResourceTrackType = (resource: AnyDanmu | AudioResource): TimelineTrackType => {
  return resource.type === "audio-file" ? "audio" : "danmu";
};

export const applyTrackType = (track: TimelineTrack, type: TimelineTrackType) => {
  track.type = type;
  if (type === "audio") {
    track.visible = true;
  } else {
    track.muted = false;
  }
};

export const clearTrackTypeIfEmpty = (track: TimelineTrack) => {
  if (track.clips.length === 0) {
    track.type = undefined;
    track.visible = true;
    track.muted = false;
  }
};

export const findClipLocation = (tracks: TimelineTrack[], clipId: string): TimelineClipLocation | null => {
  for (const track of tracks) {
    const clipIndex = track.clips.findIndex((clip) => clip.id === clipId);
    if (clipIndex !== -1) {
      const clip = track.clips[clipIndex];
      if (!clip) continue;

      return {
        track,
        clip,
        clipIndex,
      };
    }
  }

  return null;
};

export const applyClipUpdates = (clip: TimelineClip, updates: Partial<TimelineClip>) => {
  if (clip.kind === "group") {
    if (updates.name !== undefined) clip.name = updates.name;
    if (updates.startTime !== undefined && Number.isFinite(updates.startTime)) {
      clip.startTime = Math.max(0, updates.startTime);
    }
    return;
  }
  if (updates.sourceInMs !== undefined && (!Number.isFinite(updates.sourceInMs) || updates.sourceInMs < 0)) {
    throw new Error("Invalid clip source offset");
  }
  const {
    trackId: _ignoredTrackId,
    startTime,
    duration: clipDuration,
    ...rest
  } = updates;

  Object.assign(clip, rest);

  if (startTime !== undefined) {
    clip.startTime = Math.max(0, startTime);
  }

  if (updates.baseKeyframeTimeMs !== undefined) {
    const normalizedBase = roundKeyframeTime(updates.baseKeyframeTimeMs);
    if (normalizedBase === 0) delete clip.baseKeyframeTimeMs;
    else clip.baseKeyframeTimeMs = normalizedBase;
  }

  if (clipDuration !== undefined) {
    clip.duration = Math.max(0, clipDuration);
    // 关键帧采用非破坏性裁剪：修改时长时保留窗口外的关键帧，不做 clamp。
    if (clip.keyframes) clip.keyframes = normalizeKeyframes(clip.keyframes);
    // 特效保持自身时长，只截掉超出新终点的部分；左侧裁剪由 trimClip 传入已平移的 effects。
    if (clip.effects && !("effects" in updates)) clip.effects = sliceEffects(clip.effects, 0, clip.duration);
  } else if (updates.keyframes !== undefined && clip.keyframes) {
    clip.keyframes = normalizeKeyframes(clip.keyframes);
  }
  if (clip.effects && !clip.effects.length) delete clip.effects;
};

export const cloneClip = (source: TimelineClip, trackId: string): TimelineClip => {
  const cloned: TimelineClip = JSON.parse(JSON.stringify(source));
  const clipIdMap = new Map<string, string>();
  const regenerate = (clip: TimelineClip, ownerTrackId: string) => {
    const originalId = clip.id;
    clip.id = createTimelineId("clip");
    clipIdMap.set(originalId, clip.id);
    clip.trackId = ownerTrackId;
    if (clip.kind === "group") {
      for (const track of clip.tracks) {
        track.id = createTimelineId("track");
        for (const child of track.clips) regenerate(child, track.id);
      }
    } else {
      for (const effect of clip.effects ?? []) effect.id = createTimelineId("fx");
      for (const keyframe of clip.keyframes ?? []) keyframe.id = createTimelineId("kf");
    }
  };
  regenerate(cloned, trackId);
  const remapParents = (clip: TimelineClip) => {
    if (clip.kind === "group") {
      for (const track of clip.tracks) for (const child of track.clips) remapParents(child);
    } else if (clip.parentClipId && clipIdMap.has(clip.parentClipId)) {
      clip.parentClipId = clipIdMap.get(clip.parentClipId);
    }
  };
  remapParents(cloned);
  return cloned;
};
