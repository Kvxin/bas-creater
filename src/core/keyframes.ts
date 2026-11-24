import type { AnyDanmu, DanmuType } from "@/types/danmu";
import type {
  TimelineClip,
  TimelineKeyframe,
  TimelineKeyframeProperties,
} from "@/types/timeline";
import { resolveDanmuDefaults } from "@/core/danmuDefaults";

export const BASE_KEYFRAME_ID = "__base_keyframe__";

export const KEYFRAME_TOLERANCE_MS = 24;

export const ANIMATABLE_KEYS = [
  "x",
  "y",
  "content",
  "text",
  "scale",
  "rotateX",
  "rotateY",
  "rotateZ",
  "opacity",
  "color",
  "fontSize",
] as const;

export type AnimatableKey = (typeof ANIMATABLE_KEYS)[number];

/** 各资源类型可被关键帧插值的属性；BAS 导入据此判断哪些 `set` 能无损落成关键帧。 */
export const ANIMATABLE_KEYS_BY_TYPE: Record<DanmuType, readonly AnimatableKey[]> = {
  text: ["x", "y", "content", "scale", "rotateX", "rotateY", "rotateZ", "opacity", "color", "fontSize"],
  button: ["x", "y", "text", "fontSize"],
  path: ["x", "y"],
};

type NumericInterpolationKey = Exclude<AnimatableKey, "color" | "content" | "text" | "fontSize">;

const NUMERIC_KEYS = new Set<NumericInterpolationKey>([
  "x",
  "y",
  "scale",
  "rotateX",
  "rotateY",
  "rotateZ",
  "opacity",
]);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const createKeyframeId = () =>
  `kf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const clampKeyframeTime = (timeMs: number, clipDuration: number) =>
  clamp(Math.round(Number.isFinite(timeMs) ? timeMs : 0), 0, Math.max(0, clipDuration));

export const normalizeKeyframes = (
  keyframes: TimelineKeyframe[] | undefined,
  clipDuration: number
) =>
  [...(keyframes ?? [])]
    .map((keyframe) => ({
      ...keyframe,
      timeMs: clampKeyframeTime(keyframe.timeMs, clipDuration),
      properties: pickKeyframeProperties(keyframe.properties),
      interpolation: keyframe.interpolation ?? "linear",
    }))
    .sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));

export const isBaseKeyframeId = (keyframeId: string | null | undefined) =>
  keyframeId === BASE_KEYFRAME_ID;

export const pickKeyframeProperties = (
  source: Partial<AnyDanmu> | TimelineKeyframeProperties
): TimelineKeyframeProperties => {
  const picked: TimelineKeyframeProperties = {};

  for (const key of ANIMATABLE_KEYS) {
    const value = (source as Record<string, unknown>)[key];
    const allowsEmptyString = key === "content" || key === "text";
    if (
      value !== undefined &&
      value !== null &&
      (value !== "" || allowsEmptyString)
    ) {
      (picked as Record<string, unknown>)[key] = value;
    }
  }

  return picked;
};

export const pickKeyframePropertiesForResource = (
  resource: AnyDanmu,
  source: Partial<AnyDanmu> | TimelineKeyframeProperties
): TimelineKeyframeProperties => {
  const picked = pickKeyframeProperties(source);
  const allowedKeys = new Set<AnimatableKey>(ANIMATABLE_KEYS_BY_TYPE[resource.type]);

  return Object.fromEntries(
    Object.entries(picked).filter(([key]) => allowedKeys.has(key as AnimatableKey))
  ) as TimelineKeyframeProperties;
};

export const getBaseKeyframeProperties = (resource: AnyDanmu): TimelineKeyframeProperties => {
  const resolved = resolveDanmuDefaults(resource);

  return pickKeyframePropertiesForResource(resource, {
    x: resolved.x,
    y: resolved.y,
    content:
      resolved.type === "text"
        ? resolved.content
        : undefined,
    text:
      resolved.type === "button" ? resolved.text : undefined,
    scale: resolved.scale,
    rotateX: resolved.rotateX,
    rotateY: resolved.rotateY,
    rotateZ: resolved.rotateZ,
    opacity: resolved.opacity,
    color:
      resolved.type === "text" ? resolved.color : undefined,
    fontSize:
      resolved.type === "text" || resolved.type === "button"
        ? resolved.fontSize
        : undefined,
  });
};

export const findKeyframeAtTime = (
  keyframes: TimelineKeyframe[] | undefined,
  timeMs: number,
  toleranceMs = KEYFRAME_TOLERANCE_MS
) =>
  normalizeKeyframes(keyframes, Number.POSITIVE_INFINITY).find(
    (keyframe) => Math.abs(keyframe.timeMs - timeMs) <= toleranceMs
  ) ?? null;
export interface KeyframeReferenceSize {
  width: number;
  height: number;
}


const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace("%", ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const parseColor = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const normalized = value.trim().replace(/^#/, "").replace(/^0x/i, "");
  if (!/^[\da-f]{6}$/i.test(normalized)) return null;

  return Number.parseInt(normalized, 16);
};

const interpolateColor = (from: unknown, to: unknown, progress: number) => {
  const start = parseColor(from);
  const end = parseColor(to);
  if (start === null || end === null) return progress >= 1 ? to : from;

  const sr = (start >> 16) & 0xff;
  const sg = (start >> 8) & 0xff;
  const sb = start & 0xff;
  const er = (end >> 16) & 0xff;
  const eg = (end >> 8) & 0xff;
  const eb = end & 0xff;

  const r = Math.round(sr + (er - sr) * progress);
  const g = Math.round(sg + (eg - sg) * progress);
  const b = Math.round(sb + (eb - sb) * progress);
  return (r << 16) + (g << 8) + b;
};

const interpolateValue = (
  key: AnimatableKey,
  from: unknown,
  to: unknown,
  progress: number,
  reference?: KeyframeReferenceSize
) => {
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  if (key === "color") {
    return interpolateColor(from, to, progress);
  }

  if (NUMERIC_KEYS.has(key as NumericInterpolationKey)) {
    const start = toNumber(from);
    const end = toNumber(to);
    if (start !== null && end !== null) {
      const fromPercent = typeof from === "string" && from.trim().endsWith("%");
      const toPercent = typeof to === "string" && to.trim().endsWith("%");
      if (fromPercent !== toPercent && (key === "x" || key === "y")) {
        const size = key === "x" ? reference?.width : reference?.height;
        if (!size || !Number.isFinite(size) || size <= 0) {
          throw new Error(`Cannot interpolate mixed units for ${key} without a reference size`);
        }
        const startPx = fromPercent ? start * size / 100 : start;
        const endPx = toPercent ? end * size / 100 : end;
        return startPx + (endPx - startPx) * progress;
      }
      const value = start + (end - start) * progress;
      return fromPercent ? `${value}%` : value;
    }
  }

  return progress >= 1 ? to : from;
};

const mergeProperties = (
  base: TimelineKeyframeProperties,
  override: TimelineKeyframeProperties | undefined
): TimelineKeyframeProperties => ({
  ...base,
  ...(override ?? {}),
});

const getCumulativeKeyframes = (resource: AnyDanmu, clip: TimelineClip) => {
  let accumulated = getBaseKeyframeProperties(clip.kind === "resource" ? { ...resource, ...clip.overrides } as AnyDanmu : resource);

  return normalizeKeyframes(clip.keyframes, clip.duration).map((keyframe) => {
    accumulated = mergeProperties(
      accumulated,
      pickKeyframePropertiesForResource(resource, keyframe.properties)
    );
    return {
      keyframe,
      properties: { ...accumulated },
    };
  });
};

export const resolveKeyframeProperties = (
  resource: AnyDanmu,
  clip: TimelineClip,
  keyframeId: string | null | undefined
): TimelineKeyframeProperties => {
  const base = getBaseKeyframeProperties(clip.kind === "resource" ? { ...resource, ...clip.overrides } as AnyDanmu : resource);
  if (!keyframeId || isBaseKeyframeId(keyframeId)) return base;

  return getCumulativeKeyframes(resource, clip).find(
    ({ keyframe }) => keyframe.id === keyframeId
  )?.properties ?? base;
};

export const getEffectiveKeyframePropertiesAtTime = (
  resource: AnyDanmu,
  clip: TimelineClip,
  localTimeMs: number,
  reference?: KeyframeReferenceSize
): TimelineKeyframeProperties => {
  const base = getBaseKeyframeProperties(clip.kind === "resource" ? { ...resource, ...clip.overrides } as AnyDanmu : resource);
  const keyframes = getCumulativeKeyframes(resource, clip);
  const timeMs = clampKeyframeTime(localTimeMs, clip.duration);

  if (keyframes.length === 0) return base;

  const firstState = keyframes[0];
  const first = firstState?.keyframe;
  if (!first) return base;

  if (timeMs <= first.timeMs) {
    if (first.timeMs <= 0) return firstState?.properties ?? base;

    const progress =
      first.interpolation === "step"
        ? timeMs >= first.timeMs
          ? 1
          : 0
        : clamp(timeMs / first.timeMs, 0, 1);
    const target = firstState?.properties ?? base;
    return interpolateProperties(base, target, progress, reference);
  }

  for (let index = 1; index < keyframes.length; index += 1) {
    const previousState = keyframes[index - 1];
    const nextState = keyframes[index];
    const previous = previousState?.keyframe;
    const next = nextState?.keyframe;
    if (!previous || !next || !previousState || !nextState || timeMs > next.timeMs) continue;

    const span = Math.max(1, next.timeMs - previous.timeMs);
    const progress =
      next.interpolation === "step"
        ? timeMs >= next.timeMs
          ? 1
          : 0
        : clamp((timeMs - previous.timeMs) / span, 0, 1);

    return interpolateProperties(previousState.properties, nextState.properties, progress, reference);
  }

  return keyframes[keyframes.length - 1]?.properties ?? base;
};

const interpolateProperties = (
  from: TimelineKeyframeProperties,
  to: TimelineKeyframeProperties,
  progress: number,
  reference?: KeyframeReferenceSize
): TimelineKeyframeProperties => {
  const result: TimelineKeyframeProperties = {};

  for (const key of ANIMATABLE_KEYS) {
    const start = (from as Record<string, unknown>)[key];
    const end = (to as Record<string, unknown>)[key];
    if (start === undefined && end === undefined) continue;

    (result as Record<string, unknown>)[key] = interpolateValue(
      key,
      start ?? end,
      end ?? start,
      progress,
      reference
    );
  }

  return result;
};

export const applyKeyframeProperties = (
  resource: AnyDanmu,
  properties: TimelineKeyframeProperties
): AnyDanmu => ({
  ...resource,
  ...properties,
} as AnyDanmu);

export const getEffectiveDanmuAtTime = (
  resource: AnyDanmu,
  clip: TimelineClip,
  timelineTimeMs: number,
  _selectedKeyframeId?: string | null,
  reference?: KeyframeReferenceSize
) => {
  const localTimeMs = clampKeyframeTime(timelineTimeMs - clip.startTime, clip.duration);
  const properties = getEffectiveKeyframePropertiesAtTime(resource, clip, localTimeMs, reference);

  return applyKeyframeProperties(clip.kind === "resource" ? { ...resource, ...clip.overrides } as AnyDanmu : resource, properties);
};

export const createKeyframeSnapshot = (
  resource: AnyDanmu,
  clip: TimelineClip,
  localTimeMs: number,
  overrides: Partial<AnyDanmu> = {}
): TimelineKeyframe => ({
  id: createKeyframeId(),
  timeMs: clampKeyframeTime(localTimeMs, clip.duration),
  interpolation: "linear",
  // A new keyframe intentionally starts empty. Properties are added only when
  // the user changes them, keeping the exported BAS `set` statement minimal.
  properties: pickKeyframePropertiesForResource(resource, overrides),
});
