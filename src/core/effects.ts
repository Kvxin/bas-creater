import type { DanmuType } from "@/types/danmu";
import type {
  EffectCategory,
  EffectInstance,
  EffectParam,
  EffectParams,
  EffectPatch,
  EffectPlugin,
  EffectPoint,
  EffectSchema,
  EffectText
} from "@/types/effects";
import { createTimelineId } from "@/core/timelineGroups";

export type {
  EffectCategory,
  EffectInstance,
  EffectParam,
  EffectParams,
  EffectPatch,
  EffectPlugin,
  EffectPoint,
  EffectSchema,
  EffectText
};

export type EffectDefStyle = NonNullable<EffectPatch["defStyle"]>;

export const MAX_CLIP_EFFECTS = 64;
const MAX_CURVE_POINTS = 64;

export const EFFECT_CATEGORIES: readonly EffectCategory[] = ["animation", "style"];

export const defineEffect = <S extends EffectSchema>(plugin: EffectPlugin<S>) => plugin;

export const matchesEffect = (plugin: EffectPlugin, instance: EffectInstance) =>
  plugin.id === instance.pluginId &&
  plugin.version === instance.pluginVersion &&
  plugin.apiVersion === instance.apiVersion;

export const effectText = (text: EffectText, locale: string) =>
  typeof text === "string" ? text : ((locale === "en" || locale === "ja") && text[locale]) || text["zh-CN"];

export const defaultEffectParams = (plugin: EffectPlugin): EffectParams =>
  Object.fromEntries(Object.entries(plugin.params).map(([key, field]) => [key, field.default]));

/** 判断该特效是否包含 BAS `set` 支持按时间区间作用的动态属性（`opacityLimit` 或 `color`）。 */
export const isDynamicEffect = (effect: Pick<EffectInstance, "patch">): boolean =>
  effect.patch.opacityLimit !== undefined || effect.patch.color !== undefined;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isEffectKey = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-zA-Z][\w.-]*$/.test(value) &&
  !Object.prototype.hasOwnProperty.call(Object.prototype, value);

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isColor = (value: unknown) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const isHexInt = (value: unknown): value is number =>
  isFiniteNumber(value) && Number.isInteger(value) && value >= 0 && value <= 0xffffff;
const isUnit = (value: unknown): value is number => isFiniteNumber(value) && value >= 0 && value <= 1;

const isLabel = (value: unknown): value is EffectText =>
  (typeof value === "string" && !!value.trim()) ||
  (isRecord(value) &&
    typeof value["zh-CN"] === "string" &&
    !!value["zh-CN"].trim() &&
    Object.values(value).every(label => typeof label === "string"));

function isParam(field: unknown): field is EffectParam {
  if (!isRecord(field) || !isLabel(field.label)) return false;
  if (field.type === "color") return isColor(field.default);
  if (field.type === "string") return typeof field.default === "string";
  return (
    field.type === "number" &&
    isFiniteNumber(field.min) &&
    isFiniteNumber(field.max) &&
    field.min <= field.max &&
    isFiniteNumber(field.step) &&
    field.step > 0 &&
    isFiniteNumber(field.default)
  );
}

export function validateEffectParams(plugin: EffectPlugin, values: EffectParams) {
  for (const [key, field] of Object.entries(plugin.params)) {
    const value = values[key];
    if (field.type === "color" && isColor(value)) continue;
    if (field.type === "string" && typeof value === "string") continue;
    if (field.type === "number" && isFiniteNumber(value) && value >= field.min && value <= field.max) {
      const steps = (value - field.min) / field.step;
      if (Math.abs(steps - Math.round(steps)) < 1e-7) continue;
    }
    throw new Error(`${plugin.id} · ${key}: invalid parameter`);
  }
  for (const key of Object.keys(values)) {
    if (!Object.prototype.hasOwnProperty.call(plugin.params, key))
      throw new Error(`${plugin.id} · ${key}: unknown parameter`);
  }
}

export function assertPlugin(value: unknown): asserts value is EffectPlugin {
  if (!isRecord(value) || !isEffectKey(value.id)) throw new Error("Invalid plugin ID");
  if (value.apiVersion !== 2) throw new Error(`${value.id}: unsupported API ${value.apiVersion}`);
  if (
    typeof value.version !== "string" ||
    !value.version.trim() ||
    (value.category !== undefined && !EFFECT_CATEGORIES.includes(value.category as EffectCategory)) ||
    !isLabel(value.title) ||
    (value.description !== undefined && !isLabel(value.description)) ||
    !Array.isArray(value.targets) ||
    !value.targets.length ||
    !value.targets.every(type => ["text", "button", "path"].includes(type)) ||
    typeof value.build !== "function" ||
    !isRecord(value.params)
  )
    throw new Error(`${value.id}: invalid definition`);
  for (const [key, field] of Object.entries(value.params)) {
    if (!isEffectKey(key) || !isParam(field)) throw new Error(`${value.id} · ${key}: invalid parameter definition`);
  }
}

/**
 * BAS `def` 静态样式属性表（这些属性在 bas.js 中仅在 `def` 初始化 DOM 时读取，不支持 `set` 动画）。
 * `color` 在 BAS `text` 中支持通过 `set` 生成 `@keyframes` 颜色动画，单独作为 `EffectPatch.color` 处理。
 */
const defStyleKeys: Record<DanmuType, readonly string[]> = {
  text: ["strokeWidth", "strokeColor"],
  button: ["textColor", "fillColor"],
  path: ["borderColor", "fillColor"]
};

/** 兼容旧版工程快照与插件中的 `patch.style`：将静态属性迁入 `defStyle`，`color` 迁入动态 `patch.color`。 */
export function normalizeEffectPatch(rawPatch: unknown): unknown {
  if (!isRecord(rawPatch) || !("style" in rawPatch)) return rawPatch;
  const { style, ...rest } = rawPatch;
  if (!isRecord(style)) return rawPatch;
  const next: Record<string, unknown> = { ...rest };
  const defStyle: Record<string, unknown> = isRecord(next.defStyle) ? { ...next.defStyle } : {};
  for (const [key, value] of Object.entries(style)) {
    if (key === "color") {
      if (next.color === undefined) next.color = value;
    } else {
      defStyle[key] = value;
    }
  }
  if (Object.keys(defStyle).length) next.defStyle = defStyle;
  return next;
}

export function validatePatch(patch: unknown, type: DanmuType): asserts patch is EffectPatch {
  if (
    !isRecord(patch) ||
    Object.keys(patch).some(key => key !== "defStyle" && key !== "color" && key !== "opacityLimit")
  )
    throw new Error("Invalid host effect patch");
  if (patch.defStyle !== undefined) {
    if (!isRecord(patch.defStyle)) throw new Error("Invalid host style");
    for (const [key, value] of Object.entries(patch.defStyle)) {
      const valid =
        isFiniteNumber(value) && (key === "strokeWidth" ? value >= 0 && value <= 64 : isHexInt(value));
      if (!valid || !defStyleKeys[type].includes(key)) throw new Error(`Invalid ${type} effect style: ${key}`);
    }
  }
  if (patch.color !== undefined) {
    if (type !== "text" || !isHexInt(patch.color)) throw new Error(`Invalid ${type} effect style: color`);
  }
  const points = patch.opacityLimit;
  if (points !== undefined) {
    if (
      !Array.isArray(points) ||
      points.length < 2 ||
      points.length > MAX_CURVE_POINTS ||
      points[0]?.at !== 0 ||
      points[points.length - 1]?.at !== 1
    )
      throw new Error("Invalid opacity curve");
    let last = -1;
    for (const point of points) {
      if (!isRecord(point) || !isUnit(point.at) || point.at <= last || !isUnit(point.value))
        throw new Error("Invalid opacity point");
      last = point.at;
    }
  }
  const hasDefStyle = Object.keys(patch.defStyle ?? {}).length > 0;
  if (!points && !hasDefStyle && patch.color === undefined) throw new Error("Empty host effect patch");
}

export function validateInstance(
  effect: unknown,
  type: DanmuType,
  clipDuration: number
): asserts effect is EffectInstance {
  if (
    !isRecord(effect) ||
    typeof effect.id !== "string" ||
    !effect.id ||
    !isEffectKey(effect.pluginId) ||
    typeof effect.pluginVersion !== "string" ||
    !effect.pluginVersion.trim() ||
    !isPositiveInteger(effect.apiVersion) ||
    !isRecord(effect.params) ||
    !Object.entries(effect.params).every(
      ([key, value]) => isEffectKey(key) && (typeof value === "string" || isFiniteNumber(value))
    ) ||
    !Array.isArray(effect.range) ||
    effect.range.length !== 2 ||
    !isUnit(effect.range[0]) ||
    !isUnit(effect.range[1]) ||
    effect.range[0] > effect.range[1] ||
    !Array.isArray(effect.span) ||
    effect.span.length !== 2 ||
    !isFiniteNumber(effect.span[0]) ||
    !isFiniteNumber(effect.span[1]) ||
    effect.span[0] < 0 ||
    effect.span[0] > effect.span[1] ||
    effect.span[1] > clipDuration
  )
    throw new Error("Invalid attached effect");
  effect.patch = normalizeEffectPatch(effect.patch) as EffectPatch;
  validatePatch(effect.patch, type);
  // 纯 def 静态样式特效在 BAS 中不支持按时间区间切换，其 span 必须覆盖整个片段。
  if (!isDynamicEffect(effect as unknown as EffectInstance)) {
    if (effect.span[0] !== 0 || effect.span[1] !== clipDuration) {
      throw new Error("Static defStyle effect must cover the entire clip duration");
    }
  }
}

export function buildInstance(
  plugin: EffectPlugin,
  targetType: DanmuType,
  params: EffectParams,
  previous: Pick<EffectInstance, "span"> & Partial<Pick<EffectInstance, "id" | "range">>,
  clipDuration?: number
): EffectInstance {
  validateEffectParams(plugin, params);
  const rawPatch = normalizeEffectPatch(plugin.build({ targetType, params: Object.freeze({ ...params }) }));
  validatePatch(rawPatch, targetType);
  const span: [number, number] =
    !isDynamicEffect({ patch: rawPatch }) && clipDuration !== undefined ? [0, clipDuration] : [...previous.span];
  return {
    id: previous.id ?? createTimelineId("fx"),
    pluginId: plugin.id,
    pluginVersion: plugin.version,
    apiVersion: plugin.apiVersion,
    params: { ...params },
    patch: JSON.parse(JSON.stringify(rawPatch)),
    range: previous.range ?? [0, 1],
    span
  };
}

/**
 * 截取片段内 [offset, offset + duration] 的特效，结果以截取起点为新的零点。
 * - 动态特效（`opacityLimit` / `color`）：与该区间没有交集的被丢弃；被截断的同步收窄曲线采样区间，保留原有的播放进度。
 * - 静态 `defStyle` 特效：始终跟随所属片段覆盖 `[0, duration]`。
 */
export function sliceEffects(effects: EffectInstance[], offset: number, duration: number, copy = false) {
  const end = offset + duration;
  return effects.flatMap(effect => {
    if (!isDynamicEffect(effect)) {
      return [
        {
          ...effect,
          id: copy ? createTimelineId("fx") : effect.id,
          range: [0, 1] as [number, number],
          span: [0, duration] as [number, number]
        }
      ];
    }
    const [spanStart, spanEnd] = effect.span;
    const from = Math.max(spanStart, offset);
    const to = Math.min(spanEnd, end);
    const length = spanEnd - spanStart;
    if (to < from || (to === from && length > 0)) return [];
    const [rangeStart, rangeEnd] = effect.range;
    const sample = (time: number) =>
      length > 0
        ? Math.max(0, Math.min(1, rangeStart + (rangeEnd - rangeStart) * ((time - spanStart) / length)))
        : rangeStart;
    const sliced: EffectInstance = {
      ...effect,
      id: copy ? createTimelineId("fx") : effect.id,
      range: [sample(from), sample(to)],
      // 单独夹到 duration，避免浮点误差让区间越过片段终点。
      span: [Math.min(from - offset, duration), Math.min(to - offset, duration)]
    };
    return [sliced];
  });
}

// 相同时刻的两个点分别表示跳变前后，保留宿主的 step 关键帧。
export function opacityAt(points: EffectPoint[], at: number, before = false): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (points[mid]!.at < at || (!before && points[mid]!.at === at)) low = mid + 1;
    else high = mid;
  }
  const right = points[low];
  const left = points[low - 1];
  if (!left) return points[0]!.value;
  if (!right) return left.value;
  return left.value + (right.value - left.value) * ((at - left.at) / (right.at - left.at));
}

function limitCurve(host: EffectPoint[], limit: EffectPoint[]) {
  const times = [...new Set([...host, ...limit].map(point => point.at))].sort((a, b) => a - b);
  const result: EffectPoint[] = [];
  for (let i = 0; i < times.length; i++) {
    const at = times[i]!;
    const before = Math.min(opacityAt(host, at, true), opacityAt(limit, at, true));
    const alpha = opacityAt(host, at);
    const cap = opacityAt(limit, at);
    result.push({ at, value: before });
    if (Math.min(alpha, cap) !== before) result.push({ at, value: Math.min(alpha, cap) });
    const end = times[i + 1];
    if (end === undefined) break;
    const nextAlpha = opacityAt(host, end, true);
    const nextCap = opacityAt(limit, end, true);
    const gap = alpha - cap;
    const nextGap = nextAlpha - nextCap;
    // 两条直线中途相交时补上折点，避免修改宿主较低的透明度。
    if (gap * nextGap < 0) {
      const fraction = gap / (gap - nextGap);
      result.push({ at: at + fraction * (end - at), value: alpha + fraction * (nextAlpha - alpha) });
    }
  }
  return result;
}

export function applyOpacityLimits(host: EffectPoint[], effects: EffectInstance[], duration: number) {
  for (const {
    patch,
    range: [from, to],
    span: [start, end]
  } of effects) {
    if (!patch.opacityLimit) continue;
    const curve = patch.opacityLimit;
    if (duration === 0) {
      host = [{ at: 0, value: Math.min(opacityAt(host, 0), opacityAt(curve, from)) }];
      continue;
    }
    if (end <= start) continue;
    // 特效区间外不限制透明度；区间两端各用一对同时刻的点表示跳变。
    const limit = [
      ...(start > 0 ? [{ at: 0, value: 1 }, { at: start, value: 1 }] : []),
      { at: start, value: opacityAt(curve, from) },
      ...curve
        .filter(point => point.at > from && point.at < to)
        .map(point => ({
          at: start + ((point.at - from) / (to - from)) * (end - start),
          value: point.value
        })),
      { at: end, value: opacityAt(curve, to) },
      ...(end < duration ? [{ at: end, value: 1 }, { at: duration, value: 1 }] : [])
    ];
    host = limitCurve(host, limit);
  }
  return host;
}

/** 合并片段上所有特效的 `def` 静态样式，按 `effects[]` 栈顺序后者覆盖前者。 */
export function resolveEffectDefStyle(effects: EffectInstance[] | undefined): EffectDefStyle {
  if (!effects?.length) return {};
  return Object.assign({}, ...effects.map(effect => effect.patch.defStyle));
}

/**
 * 按动态颜色特效区间的边界把片段切成若干段，返回每段起点及覆盖该段的颜色。
 * 仅对 BAS 支持 `set { color = ... }` 动画的 `patch.color` 分段；同一时刻按 `effects[]` 顺序后者生效。
 */
export function effectColorSegments(effects: EffectInstance[], duration: number) {
  const colored = effects.filter(effect => effect.patch.color !== undefined);
  const times = [...new Set([0, ...colored.flatMap(effect => effect.span)])]
    .filter(time => time < duration)
    .sort((a, b) => a - b);
  if (!times.length) times.push(0);
  const segments: { at: number; color?: number }[] = [];
  times.forEach((at, index) => {
    const end = times[index + 1] ?? duration;
    const active = colored.filter(
      ({ span: [start, stop] }) => duration === 0 || (start <= at && end <= stop && stop > start)
    );
    const color = active.length ? active[active.length - 1]!.patch.color : undefined;
    const previous = segments[segments.length - 1];
    if (!previous || previous.color !== color) segments.push({ at, ...(color !== undefined ? { color } : {}) });
  });
  return segments;
}

/** 计算给定局部时刻（相对于片段起点 `0..clipDuration`）在特效叠加后的颜色覆盖。 */
export function resolveEffectColorAtTime(
  effects: EffectInstance[] | undefined,
  localTimeMs: number,
  clipDuration: number
): number | undefined {
  if (!effects?.length) return undefined;
  let result: number | undefined;
  for (const effect of effects) {
    if (effect.patch.color === undefined) continue;
    const [start, end] = effect.span;
    if (clipDuration === 0 || (localTimeMs >= start && localTimeMs <= end && end > start)) {
      result = effect.patch.color;
    }
  }
  return result;
}
