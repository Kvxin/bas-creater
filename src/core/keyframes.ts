import type { AnyDanmu } from "@/types/danmu";
import type {
  TimelineClip,
  TimelineKeyframe,
  TimelineKeyframeProperties
} from "@/types/timeline";
import { resolveDanmuDefaults } from "@/core/danmuDefaults";
import {
  applyOpacityLimits,
  opacityAt,
  resolveEffectColorAtTime,
  resolveEffectDefStyle
} from "@/core/effects";
import {
  ANIMATABLE_KEYS,
  ANIMATABLE_KEYS_BY_TYPE,
  NUMERIC_INTERPOLATION_KEYS
} from "@/core/danmuProperties";
import type { AnimatableKey } from "@/core/danmuProperties";

export { ANIMATABLE_KEYS, ANIMATABLE_KEYS_BY_TYPE };
export type { AnimatableKey };

export const BASE_KEYFRAME_ID = "__base_keyframe__";

export const KEYFRAME_TOLERANCE_MS = 15;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const roundTenths = (value: number) => Math.round(value * 10) / 10;

export const createKeyframeId = () =>
  `kf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const roundKeyframeTime = (timeMs: number) =>
  roundTenths(Number.isFinite(timeMs) ? timeMs : 0);

export const clampKeyframeTime = (timeMs: number, clipDuration: number) =>
  clamp(roundTenths(Number.isFinite(timeMs) ? timeMs : 0), 0, Math.max(0, roundTenths(clipDuration)));

export const getBaseKeyframeTimeMs = (clip: Pick<TimelineClip, "kind" | "baseKeyframeTimeMs">): number =>
  clip.kind === "resource" && typeof clip.baseKeyframeTimeMs === "number" && Number.isFinite(clip.baseKeyframeTimeMs)
    ? roundTenths(clip.baseKeyframeTimeMs)
    : 0;

/**
 * 规范化关键帧列表：仅做精度对齐、字段过滤与按时间排序，不做 `[0, clipDuration]` 裁切，
 * 以支持非破坏性左右边缘裁剪（允许关键帧临时落在片段可见窗口之外）。
 */
export const normalizeKeyframes = (
  keyframes: TimelineKeyframe[] | undefined,
  _clipDuration?: number
) =>
  [...(keyframes ?? [])]
    .map((keyframe) => ({
      ...keyframe,
      timeMs: roundKeyframeTime(keyframe.timeMs),
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

  if (NUMERIC_INTERPOLATION_KEYS.has(key)) {
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

export interface KeyframeTimelinePoint {
  id: string;
  timeMs: number;
  isBase: boolean;
  interpolation: "linear" | "step";
  easing?: string;
  properties: TimelineKeyframeProperties;
}

const getCumulativeKeyframes = (resource: AnyDanmu, clip: TimelineClip) => {
  const base = getBaseKeyframeProperties(
    clip.kind === "resource" ? ({ ...resource, ...clip.overrides } as AnyDanmu) : resource
  );
  const baseTimeMs = getBaseKeyframeTimeMs(clip);
  const normalized = normalizeKeyframes(clip.keyframes);
  const beforeBase = normalized.filter((keyframe) => keyframe.timeMs < baseTimeMs);
  const fromBase = normalized.filter((keyframe) => keyframe.timeMs >= baseTimeMs);

  let beforeAcc = { ...base };
  const beforeEntries = beforeBase.map((keyframe) => {
    beforeAcc = mergeProperties(beforeAcc, pickKeyframePropertiesForResource(resource, keyframe.properties));
    return { keyframe, properties: { ...beforeAcc } };
  });

  let afterAcc = { ...base };
  const afterEntries = fromBase.map((keyframe) => {
    afterAcc = mergeProperties(afterAcc, pickKeyframePropertiesForResource(resource, keyframe.properties));
    return { keyframe, properties: { ...afterAcc } };
  });

  return [...beforeEntries, ...afterEntries];
};

export const getKeyframeTimelinePoints = (
  resource: AnyDanmu,
  clip: TimelineClip
): KeyframeTimelinePoint[] => {
  const base = getBaseKeyframeProperties(
    clip.kind === "resource" ? ({ ...resource, ...clip.overrides } as AnyDanmu) : resource
  );
  const baseTimeMs = getBaseKeyframeTimeMs(clip);
  const cumulative = getCumulativeKeyframes(resource, clip);
  const before = cumulative.filter(({ keyframe }) => keyframe.timeMs < baseTimeMs);
  const fromBase = cumulative.filter(({ keyframe }) => keyframe.timeMs >= baseTimeMs);

  return [
    ...before.map(({ keyframe, properties }) => ({
      id: keyframe.id,
      timeMs: keyframe.timeMs,
      isBase: false,
      interpolation: keyframe.interpolation ?? "linear",
      easing: keyframe.easing,
      properties
    })),
    {
      id: BASE_KEYFRAME_ID,
      timeMs: baseTimeMs,
      isBase: true,
      interpolation: "linear",
      properties: base
    },
    ...fromBase.map(({ keyframe, properties }) => ({
      id: keyframe.id,
      timeMs: keyframe.timeMs,
      isBase: false,
      interpolation: keyframe.interpolation ?? "linear",
      easing: keyframe.easing,
      properties
    }))
  ];
};

export const resolveKeyframeProperties = (
  resource: AnyDanmu,
  clip: TimelineClip,
  keyframeId: string | null | undefined
): TimelineKeyframeProperties => {
  const base = getBaseKeyframeProperties(
    clip.kind === "resource" ? ({ ...resource, ...clip.overrides } as AnyDanmu) : resource
  );
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
  const points = getKeyframeTimelinePoints(resource, clip);
  const timeMs = roundKeyframeTime(localTimeMs);
  const first = points[0];
  if (!first) {
    return getBaseKeyframeProperties(
      clip.kind === "resource" ? ({ ...resource, ...clip.overrides } as AnyDanmu) : resource
    );
  }

  if (points.length === 1 || timeMs < first.timeMs) {
    return first.properties;
  }

  // 若同一时刻存在多个点（例如某帧正好落在 baseTimeMs 上），取该时刻最后一个点。
  let index = 0;
  while (index + 1 < points.length && points[index + 1]!.timeMs <= timeMs) {
    index += 1;
  }

  const previous = points[index]!;
  const next = points[index + 1];
  if (!next || timeMs <= previous.timeMs) {
    return previous.properties;
  }

  const span = next.timeMs - previous.timeMs;
  if (span <= 0) {
    return next.properties;
  }

  const progress =
    next.interpolation === "step"
      ? timeMs >= next.timeMs
        ? 1
        : 0
      : clamp((timeMs - previous.timeMs) / span, 0, 1);

  return interpolateProperties(previous.properties, next.properties, progress, reference);
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
  const baseResource =
    clip.kind === "resource"
      ? ({ ...resource, ...clip.overrides, ...resolveEffectDefStyle(clip.effects) } as AnyDanmu)
      : resource;
  const resolved = applyKeyframeProperties(baseResource, properties);
  if (clip.kind === "resource" && clip.effects?.length) {
    const effectColor = resolveEffectColorAtTime(clip.effects, localTimeMs, clip.duration);
    if (effectColor !== undefined && resolved.type === "text") {
      resolved.color = effectColor;
    }
    if (clip.effects.some(effect => effect.patch.opacityLimit)) {
      const baseOpacity = typeof resolved.opacity === "number" ? resolved.opacity : (baseResource.opacity ?? 1);
      const limited = applyOpacityLimits(
        [
          { at: 0, value: baseOpacity },
          ...(clip.duration > 0 ? [{ at: clip.duration, value: baseOpacity }] : [])
        ],
        clip.effects,
        clip.duration
      );
      resolved.opacity = opacityAt(limited, localTimeMs);
    }
  }
  return resolved;
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
