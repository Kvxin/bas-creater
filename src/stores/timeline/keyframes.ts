import type { TimelineKeyframe, TimelineKeyframeProperties } from "@/types/timeline";
import {
  BASE_KEYFRAME_ID,
  clampKeyframeTime,
  createKeyframeId,
  normalizeKeyframes,
  pickKeyframeProperties
} from "@/core/keyframes";
import { getKeyframeToleranceMs } from "@/core/timeline";
import type { TimelineStoreContext } from "./context";

export const createTimelineKeyframes = (ctx: TimelineStoreContext) => {
  const { fps, selectedClipId, selectedKeyframeId, findClipLocation } = ctx;

  const addClipKeyframe = (
    clipId: string,
    keyframe: Omit<TimelineKeyframe, "id"> & { id?: string },
    options: { select?: boolean } = {}
  ) => {
    const location = findClipLocation(clipId);
    if (!location || location.clip.kind !== "resource" || location.track.locked) return null;

    const nextKeyframe: TimelineKeyframe = {
      ...keyframe,
      id: keyframe.id ?? createKeyframeId(),
      timeMs: clampKeyframeTime(keyframe.timeMs, location.clip.duration),
      interpolation: keyframe.interpolation ?? "linear",
      properties: pickKeyframeProperties(keyframe.properties),
    };

    if (nextKeyframe.timeMs <= 0) {
      selectedClipId.value = clipId;
      selectedKeyframeId.value = BASE_KEYFRAME_ID;
      return null;
    }

    if (!location.clip.keyframes) location.clip.keyframes = [];
    location.clip.keyframes.push(nextKeyframe);
    location.clip.keyframes = normalizeKeyframes(location.clip.keyframes, location.clip.duration);

    if (options.select !== false) {
      selectedClipId.value = clipId;
      selectedKeyframeId.value = nextKeyframe.id;
    }

    return nextKeyframe;
  }

  const upsertClipKeyframeAtTime = (
    clipId: string,
    timeMs: number,
    properties: TimelineKeyframeProperties,
    options: { select?: boolean; toleranceMs?: number } = {}
  ) => {
    const location = findClipLocation(clipId);
    if (!location || location.clip.kind !== "resource" || location.track.locked) return null;

    const clampedTime = clampKeyframeTime(timeMs, location.clip.duration);
    if (clampedTime <= 0) {
      selectedClipId.value = clipId;
      selectedKeyframeId.value = BASE_KEYFRAME_ID;
      return null;
    }

    if (!location.clip.keyframes) location.clip.keyframes = [];

    const toleranceMs = options.toleranceMs ?? getKeyframeToleranceMs(fps.value);
    const existing = location.clip.keyframes.find((keyframe) => {
      const existingTime = clampKeyframeTime(keyframe.timeMs, location.clip.duration);
      return Math.abs(existingTime - clampedTime) <= toleranceMs;
    });

    if (existing) {
      existing.timeMs = clampedTime;
      existing.properties = pickKeyframeProperties({
        ...existing.properties,
        ...properties,
      });
      location.clip.keyframes = normalizeKeyframes(location.clip.keyframes, location.clip.duration);

      if (options.select !== false) {
        selectedClipId.value = clipId;
        selectedKeyframeId.value = existing.id;
      }

      return existing;
    }

    return addClipKeyframe(
      clipId,
      {
        timeMs: clampedTime,
        properties,
        interpolation: "linear",
      },
      options
    );
  }

  const updateClipKeyframe = (
    clipId: string,
    keyframeId: string,
    updates: Partial<TimelineKeyframe>
  ) => {
    const location = findClipLocation(clipId);
    if (!location?.clip.keyframes || keyframeId === BASE_KEYFRAME_ID) return;

    const keyframe = location.clip.keyframes.find((item) => item.id === keyframeId);
    if (!keyframe) return;

    if (updates.timeMs !== undefined) {
      const clampedTime = clampKeyframeTime(updates.timeMs, location.clip.duration);
      keyframe.timeMs = location.clip.duration > 0 ? Math.max(1, clampedTime) : 0;
    }
    if (updates.properties !== undefined) {
      keyframe.properties = pickKeyframeProperties(updates.properties);
    }
    if (updates.interpolation !== undefined) {
      keyframe.interpolation = updates.interpolation;
    }
    if (updates.easing !== undefined) {
      keyframe.easing = updates.easing;
    }

    location.clip.keyframes = normalizeKeyframes(location.clip.keyframes, location.clip.duration);
  }

  const removeClipKeyframe = (clipId: string, keyframeId: string) => {
    const location = findClipLocation(clipId);
    if (!location?.clip.keyframes || keyframeId === BASE_KEYFRAME_ID) return;

    const index = location.clip.keyframes.findIndex((item) => item.id === keyframeId);
    if (index === -1) return;

    location.clip.keyframes.splice(index, 1);
    if (selectedKeyframeId.value === keyframeId) {
      selectedKeyframeId.value = BASE_KEYFRAME_ID;
    }
  }

  return { addClipKeyframe, upsertClipKeyframeAtTime, updateClipKeyframe, removeClipKeyframe };
};
