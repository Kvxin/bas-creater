import type { AnyDanmu } from "@/types/danmu";
import type { AudioResource } from "@/types/resource";
import type { TimelineClip, TimelineTrack, TimelineTrackType } from "@/types/timeline";
import { normalizeKeyframes } from "@/core/keyframes";
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

  if (clipDuration !== undefined) {
    clip.duration = Math.max(0, clipDuration);
    clip.keyframes = normalizeKeyframes(clip.keyframes, clip.duration);
  }
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
