import type { AnyDanmu } from "@/types/danmu";
import type { AnimationSegment, TimelineClip, TimelineKeyframeProperties } from "@/types/timeline";
import {
  createKeyframeId,
  getBaseKeyframeProperties,
  getEffectiveKeyframePropertiesAtTime,
  normalizeKeyframes,
  pickKeyframePropertiesForResource,
  resolveKeyframeProperties
} from "@/utils/keyframes";

/** Slice animation data without changing the resource shared by other clips. */
export function splitClipAnimation(clip: TimelineClip, resource: AnyDanmu, offsetMs: number) {
  const keyframes = normalizeKeyframes(clip.keyframes, clip.duration);
  if (keyframes.length > 0) {
    const rightProperties = getEffectiveKeyframePropertiesAtTime(resource, clip, offsetMs);
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
      leftAnimations: [],
      rightAnimations: [],
      rightProperties
    };
  }

  const leftAnimations: AnimationSegment[] = [];
  const rightAnimations: AnimationSegment[] = [];
  let rightProperties = getBaseKeyframeProperties(resource);
  let state = getBaseKeyframeProperties(resource);
  let cursorMs = 0;
  let rightChainStarted = false;

  for (const animation of clip.animations ?? []) {
    if (animation.type === "set") {
      cursorMs = 0;
      state = getBaseKeyframeProperties(resource);
      rightChainStarted = false;
    }
    const startMs = cursorMs + Math.max(0, animation.delay ?? 0);
    const endMs = startMs + Math.max(0, animation.duration);
    const target = pickKeyframePropertiesForResource(resource, animation.properties);
    const sample = (timeMs: number): TimelineKeyframeProperties => {
      const sampled = getEffectiveKeyframePropertiesAtTime(
        { ...resource, ...state } as AnyDanmu,
        {
          ...clip,
          duration: animation.duration,
          keyframes: [{ id: animation.id, timeMs: animation.duration, properties: target }]
        },
        timeMs - startMs
      );
      return Object.fromEntries(
        Object.keys(target).map((key) => [key, sampled[key as keyof TimelineKeyframeProperties]])
      );
    };

    if (startMs <= offsetMs) {
      const sampled = endMs <= offsetMs ? { ...state, ...target } : sample(offsetMs);
      const changed = Object.fromEntries(
        Object.keys(target).map((key) => [key, sampled[key as keyof TimelineKeyframeProperties]])
      );
      rightProperties = { ...rightProperties, ...changed };
    }

    if (startMs < offsetMs) {
      leftAnimations.push({
        ...animation,
        duration: Math.min(endMs, offsetMs) - startMs,
        properties: endMs > offsetMs ? sample(offsetMs) as Partial<AnyDanmu> : animation.properties
      });
    }
    if (endMs > offsetMs || (animation.duration === 0 && startMs >= offsetMs)) {
      rightAnimations.push({
        ...animation,
        id: `anim_${crypto.randomUUID()}`,
        type: rightChainStarted ? "then" : "set",
        delay: rightChainStarted ? animation.delay : Math.max(0, startMs - offsetMs),
        duration: endMs - Math.max(startMs, offsetMs)
      });
      rightChainStarted = true;
    }

    state = { ...state, ...target };
    cursorMs = endMs;
  }

  return { leftKeyframes: [], rightKeyframes: [], leftAnimations, rightAnimations, rightProperties };
}
