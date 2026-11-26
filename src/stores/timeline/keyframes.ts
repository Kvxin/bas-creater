import type { TimelineKeyframe, TimelineKeyframeProperties } from "@/types/timeline";
import {
  BASE_KEYFRAME_ID,
  createKeyframeId,
  getBaseKeyframeTimeMs,
  normalizeKeyframes,
  pickKeyframeProperties,
  roundKeyframeTime
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

    const baseTimeMs = getBaseKeyframeTimeMs(location.clip);
    const nextTimeMs = roundKeyframeTime(keyframe.timeMs);

    if (nextTimeMs === baseTimeMs || (baseTimeMs === 0 && nextTimeMs <= 0)) {
      selectedClipId.value = clipId;
      selectedKeyframeId.value = BASE_KEYFRAME_ID;
      return null;
    }

    const nextKeyframe: TimelineKeyframe = {
      ...keyframe,
      id: keyframe.id ?? createKeyframeId(),
      timeMs: nextTimeMs,
      interpolation: keyframe.interpolation ?? "linear",
      properties: pickKeyframeProperties(keyframe.properties),
    };

    if (!location.clip.keyframes) location.clip.keyframes = [];
    location.clip.keyframes.push(nextKeyframe);
    location.clip.keyframes = normalizeKeyframes(location.clip.keyframes);

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

    const baseTimeMs = getBaseKeyframeTimeMs(location.clip);
    const targetTime = roundKeyframeTime(timeMs);
    if (targetTime === baseTimeMs || (baseTimeMs === 0 && targetTime <= 0)) {
      selectedClipId.value = clipId;
      selectedKeyframeId.value = BASE_KEYFRAME_ID;
      return null;
    }

    if (!location.clip.keyframes) location.clip.keyframes = [];

    const toleranceMs = options.toleranceMs ?? getKeyframeToleranceMs(fps.value);
    const existing = location.clip.keyframes.find((keyframe) => {
      const existingTime = roundKeyframeTime(keyframe.timeMs);
      return Math.abs(existingTime - targetTime) <= toleranceMs;
    });

    if (existing) {
      existing.timeMs = targetTime;
      existing.properties = pickKeyframeProperties({
        ...existing.properties,
        ...properties,
      });
      location.clip.keyframes = normalizeKeyframes(location.clip.keyframes);

      if (options.select !== false) {
        selectedClipId.value = clipId;
        selectedKeyframeId.value = existing.id;
      }

      return existing;
    }

    return addClipKeyframe(
      clipId,
      {
        timeMs: targetTime,
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
      const baseTimeMs = getBaseKeyframeTimeMs(location.clip);
      let nextTime = roundKeyframeTime(updates.timeMs);
      if (location.clip.startTime + nextTime < 0) {
        nextTime = roundKeyframeTime(-location.clip.startTime);
      }
      if (nextTime === baseTimeMs) {
        nextTime = location.clip.duration > 0 ? roundKeyframeTime(baseTimeMs + 1) : baseTimeMs;
      }
      keyframe.timeMs = nextTime;
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

    location.clip.keyframes = normalizeKeyframes(location.clip.keyframes);
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
