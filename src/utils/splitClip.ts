import type { AnyDanmu } from "@/types/danmu";
import type { AnimationSegment, TimelineResourceClip, TimelineKeyframeProperties } from "@/types/timeline";
import {
  createKeyframeId,
  getBaseKeyframeProperties,
  getEffectiveKeyframePropertiesAtTime,
  normalizeKeyframes,
  pickKeyframePropertiesForResource,
  resolveKeyframeProperties
} from "@/utils/keyframes";
import type { KeyframeReferenceSize } from "@/utils/keyframes";

/** Slice animation data without changing the resource shared by other clips. */
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
      leftAnimations: [],
      rightAnimations: [],
      rightProperties
    };
  }

  const leftAnimations: AnimationSegment[] = [];
  const rightAnimations: AnimationSegment[] = [];
  const baseResource = { ...resource, ...clip.overrides } as AnyDanmu;
  let rightProperties = getBaseKeyframeProperties(baseResource);
  let state = getBaseKeyframeProperties(baseResource);
  let cursorMs = 0;
  let rightChainStarted = false;

  for (const animation of clip.animations ?? []) {
    if (animation.type === "set") {
      cursorMs = 0;
      state = getBaseKeyframeProperties(baseResource);
      rightChainStarted = false;
    }
    const startMs = cursorMs + Math.max(0, animation.delay ?? 0);
    const endMs = startMs + Math.max(0, animation.duration);
    const target = pickKeyframePropertiesForResource(resource, animation.properties);
    const unsupported = Object.keys(animation.properties).filter(key => !(key in target));
    if (unsupported.length) throw new Error(`Cannot split unsupported animation properties: ${unsupported.join(", ")}`);
    const sample = (timeMs: number): TimelineKeyframeProperties => {
      const sampled = getEffectiveKeyframePropertiesAtTime(
        { ...resource, ...state } as AnyDanmu,
        {
          ...clip,
          overrides: undefined,
          duration: animation.duration,
          keyframes: [{ id: animation.id, timeMs: animation.duration, properties: target }]
        },
        timeMs - startMs,
        reference
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
