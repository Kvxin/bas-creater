import type { AnyDanmu } from "@/types/danmu";
import type {
  TimelineClip,
  TimelineKeyframe,
  TimelineKeyframeProperties,
} from "@/types/timeline";

export const BASE_KEYFRAME_ID = "__base_keyframe__";

export const KEYFRAME_TOLERANCE_MS = 24;

export const ANIMATABLE_KEYS = [
  "x",
  "y",
  "zIndex",
  "scale",
  "rotateX",
  "rotateY",
  "rotateZ",
  "opacity",
  "anchorX",
  "anchorY",
  "color",
  "textColor",
  "fontSize",
  "strokeWidth",
] as const;

type AnimatableKey = (typeof ANIMATABLE_KEYS)[number];

type NumericInterpolationKey = Exclude<AnimatableKey, "color" | "textColor">;

const NUMERIC_KEYS = new Set<NumericInterpolationKey>([
  "x",
  "y",
  "zIndex",
  "scale",
  "rotateX",
  "rotateY",
  "rotateZ",
  "opacity",
  "anchorX",
  "anchorY",
  "fontSize",
  "strokeWidth",
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
    if (value !== undefined && value !== null && value !== "") {
      (picked as Record<string, unknown>)[key] = value;
    }
  }

  return picked;
};

export const getBaseKeyframeProperties = (resource: AnyDanmu): TimelineKeyframeProperties =>
  pickKeyframeProperties({
    x: resource.x,
    y: resource.y,
    zIndex: resource.zIndex,
    scale: resource.scale,
    rotateX: resource.rotateX,
    rotateY: resource.rotateY,
    rotateZ: resource.rotateZ,
    opacity: resource.opacity,
    anchorX: resource.anchorX,
    anchorY: resource.anchorY,
    color: resource.type === "text" ? resource.color : undefined,
    textColor: resource.type === "text" ? resource.textColor : undefined,
    fontSize:
      resource.type === "text" || resource.type === "button"
        ? resource.fontSize
        : undefined,
    strokeWidth: resource.type === "text" ? resource.strokeWidth : undefined,
  });

export const findKeyframeAtTime = (
  keyframes: TimelineKeyframe[] | undefined,
  timeMs: number,
  toleranceMs = KEYFRAME_TOLERANCE_MS
) =>
  normalizeKeyframes(keyframes, Number.POSITIVE_INFINITY).find(
    (keyframe) => Math.abs(keyframe.timeMs - timeMs) <= toleranceMs
  ) ?? null;

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
  progress: number
) => {
  if (key === "color" || key === "textColor") {
    return interpolateColor(from, to, progress);
  }

  if (NUMERIC_KEYS.has(key as NumericInterpolationKey)) {
    const start = toNumber(from);
    const end = toNumber(to);
    if (start !== null && end !== null) {
      return start + (end - start) * progress;
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

export const resolveKeyframeProperties = (
  resource: AnyDanmu,
  clip: TimelineClip,
  keyframeId: string | null | undefined
): TimelineKeyframeProperties => {
  const base = getBaseKeyframeProperties(resource);
  if (!keyframeId || isBaseKeyframeId(keyframeId)) return base;

  const keyframe = normalizeKeyframes(clip.keyframes, clip.duration).find(
    (item) => item.id === keyframeId
  );

  return mergeProperties(base, keyframe?.properties);
};

export const getEffectiveKeyframePropertiesAtTime = (
  resource: AnyDanmu,
  clip: TimelineClip,
  localTimeMs: number
): TimelineKeyframeProperties => {
  const base = getBaseKeyframeProperties(resource);
  const keyframes = normalizeKeyframes(clip.keyframes, clip.duration);
  const timeMs = clampKeyframeTime(localTimeMs, clip.duration);

  if (timeMs <= 0 || keyframes.length === 0) return base;

  const first = keyframes[0];
  if (!first) return base;

  if (timeMs <= first.timeMs) {
    if (first.timeMs <= 0) return mergeProperties(base, first.properties);

    const progress =
      first.interpolation === "step"
        ? timeMs >= first.timeMs
          ? 1
          : 0
        : clamp(timeMs / first.timeMs, 0, 1);
    const target = mergeProperties(base, first.properties);
    return interpolateProperties(base, target, progress);
  }

  for (let index = 1; index < keyframes.length; index += 1) {
    const previous = keyframes[index - 1];
    const next = keyframes[index];
    if (!previous || !next || timeMs > next.timeMs) continue;

    const previousProps = mergeProperties(base, previous.properties);
    const nextProps = mergeProperties(base, next.properties);
    const span = Math.max(1, next.timeMs - previous.timeMs);
    const progress =
      next.interpolation === "step"
        ? timeMs >= next.timeMs
          ? 1
          : 0
        : clamp((timeMs - previous.timeMs) / span, 0, 1);

    return interpolateProperties(previousProps, nextProps, progress);
  }

  const last = keyframes[keyframes.length - 1];
  return mergeProperties(base, last?.properties);
};

const interpolateProperties = (
  from: TimelineKeyframeProperties,
  to: TimelineKeyframeProperties,
  progress: number
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
      progress
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
  selectedKeyframeId?: string | null
) => {
  const localTimeMs = clampKeyframeTime(timelineTimeMs - clip.startTime, clip.duration);
  const properties = selectedKeyframeId
    ? resolveKeyframeProperties(resource, clip, selectedKeyframeId)
    : getEffectiveKeyframePropertiesAtTime(resource, clip, localTimeMs);

  return applyKeyframeProperties(resource, properties);
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
  properties: pickKeyframeProperties({
    ...getEffectiveKeyframePropertiesAtTime(resource, clip, localTimeMs),
    ...overrides,
  }),
});
