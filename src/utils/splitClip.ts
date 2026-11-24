import type { AnyDanmu } from "@/types/danmu";
import type { TimelineResourceClip } from "@/types/timeline";
import {
  createKeyframeId,
  getBaseKeyframeProperties,
  getEffectiveKeyframePropertiesAtTime,
  normalizeKeyframes,
  resolveKeyframeProperties
} from "@/utils/keyframes";
import type { KeyframeReferenceSize } from "@/utils/keyframes";

/** Slice keyframe data without changing the resource shared by other clips. */
export function splitClipAnimation(clip: TimelineResourceClip, resource: AnyDanmu, offsetMs: number, reference?: KeyframeReferenceSize) {
  const keyframes = normalizeKeyframes(clip.keyframes, clip.duration);
  if (keyframes.some(keyframe => keyframe.easing && keyframe.easing !== "linear")) {
    throw new Error("Cannot split a clip with unsupported keyframe easing");
  }
  if (keyframes.length > 0) {
    const rightProperties = getEffectiveKeyframePropertiesAtTime(resource, clip, offsetMs, reference);
    const leftKeyframes = keyframes.filter((keyframe) => keyframe.timeMs <= offsetMs);
    const next = keyframes.find((keyframe) => keyframe.timeMs > offsetMs);

    if (next && !leftKeyframes.some((keyframe) => keyframe.timeMs === offsetMs)) {
      leftKeyframes.push({
        id: createKeyframeId(),
        timeMs: offsetMs,
        properties: rightProperties,
        interpolation: next.interpolation,
        easing: next.easing
      });
    }

    return {
      leftKeyframes,
      rightKeyframes: keyframes.filter((keyframe) => keyframe.timeMs > offsetMs).map((keyframe) => ({
        ...keyframe,
        id: createKeyframeId(),
        timeMs: keyframe.timeMs - offsetMs,
        // Sparse targets can depend on properties in frames before the split.
        properties: resolveKeyframeProperties(resource, clip, keyframe.id)
      })),
      rightProperties
    };
  }

  return { leftKeyframes: [], rightKeyframes: [], rightProperties: getBaseKeyframeProperties({ ...resource, ...clip.overrides } as AnyDanmu) };
}
