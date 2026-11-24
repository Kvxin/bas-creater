import type { AnyDanmu, ButtonDanmu, DanmuType } from "@/types/danmu";
import type { BasParseResult } from "@/utils/bas";
import type { TimelineKeyframe, TimelineKeyframeProperties } from "@/types/timeline";
import { ANIMATABLE_KEYS_BY_TYPE, createKeyframeId } from "@/utils/keyframes";

/**
 * BAS 导入：把 `parseBasDSL` 的输出转换成时间轴可用的弹幕资源、片段时长与关键帧。
 *
 * 该模块只做纯数据转换，不依赖 Pinia store，也不读取播放头等运行时状态，
 * 因此可以直接用 `node --test` 覆盖；语法解析仍复用 public/bas.js 的解析器。
 *
 * 关键约定（与 docs/bas-import.md 一致）：
 * - 所有时间相对这条 BAS 弹幕的起点，单位毫秒；
 * - `def.duration` 缺省 4000ms（BAS 对 falsy duration 的默认行为）；
 * - 关键帧时间相对片段起点，导入时不需要按 `startTimeMs` 平移。
 */

/** BAS 未声明 duration 时使用的默认时长。 */
const BAS_DEFAULT_DURATION_MS = 4000;
/** 非 linear 缓动的关键帧采样间隔（ms）。 */
const EASING_SAMPLE_INTERVAL_MS = 100;

/** 在 BAS 中于段开始时突变的属性，编辑器侧只能用 step 关键帧表达。 */
const INSTANT_KEYS = new Set(["content", "text", "fontSize"]);

const PERCENT_VALUE_KEYS = new Set(["x", "y", "fontSize", "width", "height"]);
const COLOR_VALUE_KEYS = new Set(["color", "strokeColor", "textColor", "fillColor", "borderColor"]);
const STRING_VALUE_KEYS = new Set(["content", "text", "fontFamily", "d", "viewBox"]);

/** BAS 属性名到编辑器字段名的映射（与 compiler.ts 的 `toBasKey` 相反）。 */
const ATTRIBUTE_ALIASES: Record<string, string> = {
  alpha: "opacity",
  parent: "parentId"
};

/** 不参与关键帧合并、需要单独处理的 BAS 属性。 */
const RESERVED_ATTRIBUTES = new Set(["duration", "parent", "target"]);

const COMMON_FIELDS = [
  "x",
  "y",
  "zIndex",
  "scale",
  "rotateX",
  "rotateY",
  "rotateZ",
  "anchorX",
  "anchorY",
  "opacity"
] as const;

/** 已知的编辑器字段，用于忽略 BAS 中存在但编辑器未建模的属性。 */
const FIELDS_BY_TYPE: Record<DanmuType, readonly string[]> = {
  text: [...COMMON_FIELDS, "content", "fontSize", "fontFamily", "bold", "textShadow", "color", "strokeWidth", "strokeColor"],
  button: [...COMMON_FIELDS, "text", "fontSize", "textColor", "textAlpha", "fillColor", "fillAlpha", "target"],
  path: [
    ...COMMON_FIELDS,
    "d",
    "viewBox",
    "borderWidth",
    "borderColor",
    "borderAlpha",
    "fillColor",
    "fillAlpha",
    "width",
    "height"
  ]
};

/** 资源里缺少某属性时，用于插值起点的兜底值（与 BAS 默认值一致）。 */
const FALLBACK_INITIAL_VALUES: Record<string, number | string> = {
  x: 0,
  y: 0,
  zIndex: 0,
  scale: 1,
  opacity: 1,
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  anchorX: 0,
  anchorY: 0,
  fontSize: 25,
  content: "",
  text: ""
};

/** 弹幕资源载荷（去掉 id，交给 danmu store 生成）。 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export type BasImportResource = DistributiveOmit<AnyDanmu, "id">;

export type BasImportOptions = {
  /** 时间轴上的起点（ms）。关键帧相对片段起点，因此不参与时间平移。 */
  startTimeMs: number;
};

export type BasImportWarningCode =
  | "easingApproximated"
  | "unsupportedAnimation"
  | "unsupportedTarget"
  | "unknownObject"
  | "unknownNode"
  | "invalidParent"
  | "noObjects";

/** 结构化警告：由 UI 层按 `code` 翻译，避免把界面文案固化在纯函数里。 */
export type BasImportWarning = {
  code: BasImportWarningCode;
  params?: Record<string, string | number>;
};

export type BasImportObject = {
  /** BAS 对象名，用作资源名与子轨道名。 */
  name: string;
  resource: BasImportResource;
  durationMs: number;
  keyframes: TimelineKeyframe[];
  /** 父对象名，由 store 二次转换为 `parentClipId`。 */
  parentName?: string;
};

export type BasImportResult = {
  objects: BasImportObject[];
  durationMs: number;
  warnings: BasImportWarning[];
};

type BasNumericValue = {
  value: number;
  percent: boolean;
};

type RawBasDef = {
  type?: string;
  obj_type?: string;
  name?: string;
  attrs?: Record<string, unknown>;
};

type RawBasSet = {
  type?: string;
  targetName?: string;
  target_name?: string;
  duration?: unknown;
  defaultEasing?: unknown;
  default_easing?: unknown;
  attrs?: Record<string, unknown>;
  items?: RawBasSet[];
};

export type BasSegment = {
  targetName: string;
  startMs: number;
  endMs: number;
  easing?: string;
  attrs: Record<string, unknown>;
};

type ResolvedSegment = {
  key: string;
  /** BAS 属性名，仅用于警告文案。 */
  basKey: string;
  startMs: number;
  endMs: number;
  from: unknown;
  to: unknown;
  easing?: string;
  /** 段开始时突变（content / text / fontSize）。 */
  instant: boolean;
};

/** 读取 BAS 数值包装：`10`、`{numType,value}`、`{value:{numType,value},easing}`。 */
const readBasNumericValue = (raw: unknown): BasNumericValue | null => {
  let current: unknown = raw;

  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current === "number") {
      return Number.isFinite(current) ? { value: current, percent: false } : null;
    }

    if (typeof current === "string") {
      const trimmed = current.trim();
      const percent = trimmed.endsWith("%");
      const parsed = Number(percent ? trimmed.slice(0, -1) : trimmed);
      return Number.isFinite(parsed) ? { value: parsed, percent } : null;
    }

    if (!current || typeof current !== "object") return null;

    const record = current as Record<string, unknown>;
    if (record.numType === "number" || record.numType === "percent") {
      return typeof record.value === "number"
        ? { value: record.value, percent: record.numType === "percent" }
        : null;
    }

    if (!("value" in record)) return null;
    current = record.value;
  }

  return null;
};

/** 读取 BAS 字符串值，兼容数值包装。 */
const readBasStringValue = (raw: unknown): string | null => {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return String(raw);
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    if ("value" in record) return readBasStringValue(record.value);
  }
  return null;
};

/**
 * 还原 BAS 解析器做过 HTML 实体编码的字符串。
 *
 * 编码顺序是 `&`→`&amp;`、空格→`&nbsp;`、换行→`<br>`，因此解码时先还原
 * 换行与空格，最后才处理 `&amp;`，避免 `&amp;lt;` 被二次解码。
 */
export const decodeBasText = (value: string): string =>
  value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&#x2f;/gi, "/")
    .replace(/&amp;/gi, "&");

/** 把单个 BAS 属性值转换成编辑器字段值；不支持的形状返回 null。 */
const convertAttributeValue = (key: string, raw: unknown): unknown => {
  if (STRING_VALUE_KEYS.has(key)) {
    const text = readBasStringValue(raw);
    return text === null ? null : decodeBasText(text);
  }

  const numeric = readBasNumericValue(raw);
  if (!numeric) return null;

  // 颜色在解析后已是 0xRRGGBB 整数，原样保留。
  if (COLOR_VALUE_KEYS.has(key)) return numeric.value;

  return numeric.percent && PERCENT_VALUE_KEYS.has(key) ? `${numeric.value}%` : numeric.value;
};

const toObjectKey = (basKey: string) => ATTRIBUTE_ALIASES[basKey] ?? basKey;

/** BAS button 的 target 是平铺结构，编辑器需要 `{ av }` / `{ bangumi }` 包装。 */
const convertTargetValue = (
  raw: unknown,
  objectName: string,
  warnings: BasImportWarning[]
): ButtonDanmu["target"] | undefined => {
  if (!raw || typeof raw !== "object") return undefined;

  const target = raw as Record<string, unknown>;
  const readNumber = (value: unknown) => readBasNumericValue(value)?.value;
  const objType = typeof target.objType === "string" ? target.objType : null;
  const time = readNumber(target.time);

  if (objType === "av") {
    const av = readNumber(target.av);
    if (av === undefined) {
      warnings.push({ code: "unsupportedTarget", params: { object: objectName } });
      return undefined;
    }
    const page = readNumber(target.page);
    return {
      av: {
        av,
        ...(page !== undefined ? { page } : {}),
        ...(time !== undefined ? { timeMs: time } : {})
      }
    };
  }

  if (objType === "bangumi") {
    const seasonId = readNumber(target.seasonId);
    if (seasonId === undefined) {
      warnings.push({ code: "unsupportedTarget", params: { object: objectName } });
      return undefined;
    }
    const episodeId = readNumber(target.episodeId);
    return {
      bangumi: {
        seasonId,
        ...(episodeId !== undefined ? { episodeId } : {}),
        ...(time !== undefined ? { timeMs: time } : {})
      }
    };
  }

  warnings.push({ code: "unsupportedTarget", params: { object: objectName } });
  return undefined;
};

const readSegmentDuration = (raw: unknown): number => {
  const numeric = readBasNumericValue(raw);
  return numeric && numeric.value > 0 ? numeric.value : 0;
};

const readSegmentEasing = (node: RawBasSet): string | undefined => {
  const raw = node.defaultEasing ?? node.default_easing;
  const easing = readBasStringValue(raw)?.trim();
  return easing ? easing : undefined;
};

/**
 * 把动画树展开成绝对时间段的段列表。
 *
 * - 顶层数组与 `Parallel`：子项共享起点，整体结束时间取子项最大值；
 * - `Serial`：子项依次排列；
 * - `Unit`：产出一个动画段。
 */
const expandSetNode = (
  node: RawBasSet,
  startMs: number,
  segments: BasSegment[],
  warnings: BasImportWarning[]
): number => {
  if (!node || typeof node !== "object") {
    warnings.push({ code: "unknownNode" });
    return startMs;
  }

  if (node.type === "Parallel") {
    let endMs = startMs;
    for (const item of node.items ?? []) {
      endMs = Math.max(endMs, expandSetNode(item, startMs, segments, warnings));
    }
    return endMs;
  }

  if (node.type === "Serial") {
    let cursor = startMs;
    for (const item of node.items ?? []) {
      cursor = expandSetNode(item, cursor, segments, warnings);
    }
    return cursor;
  }

  if (node.type === "Unit") {
    const durationMs = readSegmentDuration(node.duration);
    const endMs = startMs + durationMs;
    const targetName = node.targetName ?? node.target_name;
    if (typeof targetName !== "string" || !targetName) {
      warnings.push({ code: "unknownNode" });
      return endMs;
    }
    segments.push({
      targetName,
      startMs,
      endMs,
      easing: readSegmentEasing(node),
      attrs: node.attrs ?? {}
    });
    return endMs;
  }

  warnings.push({ code: "unknownNode" });
  return startMs;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** CSS 标准缓动曲线（与 bas.js 传给 animation-timing-function 的取值一致）。 */
const CUBIC_BEZIERS: Record<string, readonly [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1]
};

/** 按贝塞尔曲线求某一时刻的进度（x 轴二分求解后取 y）。 */
const cubicBezierProgress = (
  points: readonly [number, number, number, number],
  progress: number
): number => {
  const [x1, y1, x2, y2] = points;
  const sample = (t: number) => {
    const inverse = 1 - t;
    return {
      x: 3 * inverse * inverse * t * x1 + 3 * inverse * t * t * x2 + t * t * t,
      y: 3 * inverse * inverse * t * y1 + 3 * inverse * t * t * y2 + t * t * t
    };
  };

  let low = 0;
  let high = 1;
  let t = progress;
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const x = sample(t).x;
    if (Math.abs(x - progress) < 1e-4) break;
    if (x < progress) low = t;
    else high = t;
    t = (low + high) / 2;
  }

  return sample(t).y;
};

const easeProgress = (easing: string | undefined, progress: number): number => {
  if (!easing || easing === "linear") return progress;
  const points = CUBIC_BEZIERS[easing];
  return points ? clamp01(cubicBezierProgress(points, progress)) : progress;
};

const roundNumber = (value: number) => Number(value.toFixed(3));

const isPercentValue = (value: unknown) =>
  typeof value === "string" && value.trim().endsWith("%");

/** 把数值统一成百分比表示（编辑器约定百分比用字符串）。 */
const toPercentValue = (value: unknown) => {
  const numeric = readBasNumericValue(value);
  return numeric ? `${roundNumber(numeric.value)}%` : value;
};

const interpolateColor = (from: number, to: number, progress: number) => {
  const channel = (shift: number) => {
    const start = (from >> shift) & 0xff;
    const end = (to >> shift) & 0xff;
    return Math.round(start + (end - start) * progress) & 0xff;
  };
  return (channel(16) << 16) + (channel(8) << 8) + channel(0);
};

const interpolatePropertyValue = (key: string, from: unknown, to: unknown, progress: number) => {
  if (progress <= 0) return from;
  if (progress >= 1) return to;

  const start = readBasNumericValue(from);
  const end = readBasNumericValue(to);
  if (!start || !end) return from;

  if (key === "color") return interpolateColor(start.value, end.value, progress);

  const value = start.value + (end.value - start.value) * progress;
  return end.percent ? `${roundNumber(value)}%` : roundNumber(value);
};

/** 单个属性在某个时刻的取值：段内插值、段结束后保持终值、初值取 def。 */
const resolvePropertyValue = (
  segments: ResolvedSegment[],
  key: string,
  timeMs: number,
  initialValue: unknown
): unknown => {
  let result: unknown = initialValue;

  for (const segment of segments) {
    if (segment.startMs > timeMs) continue;
    if (segment.instant || segment.endMs <= segment.startMs) {
      result = segment.to;
      continue;
    }
    if (timeMs >= segment.endMs) {
      result = segment.to;
      continue;
    }
    if (timeMs <= segment.startMs) {
      result = segment.from;
      continue;
    }
    const span = segment.endMs - segment.startMs;
    const progress = easeProgress(segment.easing, clamp01((timeMs - segment.startMs) / span));
    result = interpolatePropertyValue(key, segment.from, segment.to, progress);
  }

  return result;
};

/** 关键帧时间点：所有段的开始/结束，非 linear 缓动额外按固定间隔采样。 */
const collectKeyframeTimes = (segments: ResolvedSegment[]): number[] => {
  const times = new Set<number>();

  for (const segment of segments) {
    times.add(Math.round(segment.startMs));
    times.add(Math.round(segment.endMs));
    if (!segment.easing || segment.easing === "linear") continue;
    if (segment.endMs <= segment.startMs) continue;
    for (
      let time = segment.startMs + EASING_SAMPLE_INTERVAL_MS;
      time < segment.endMs;
      time += EASING_SAMPLE_INTERVAL_MS
    ) {
      times.add(Math.round(time));
    }
  }

  return [...times].sort((left, right) => left - right);
};

const isStepBoundary = (timeMs: number, segments: ResolvedSegment[]): boolean => {
  const instantChange = segments.some(
    segment => segment.startMs === timeMs && (segment.instant || segment.endMs <= segment.startMs)
  );
  if (!instantChange) return false;

  // 同一时刻还有连续动画收尾时保持 linear，否则该动画会在终点突然跳变。
  const continuousEnd = segments.some(
    segment => segment.endMs === timeMs && segment.endMs > segment.startMs && !segment.instant
  );
  return !continuousEnd;
};

/** 把段内属性转成编辑器字段；返回 null 表示该属性不参与关键帧合并，value 为 null 表示值无法识别。 */
export type SegmentAttributeReader = (attribute: string, raw: unknown) => { key: string; value: unknown } | null;

const readBasAttribute: SegmentAttributeReader = (basKey, raw) => {
  if (RESERVED_ATTRIBUTES.has(basKey)) return null;
  const key = toObjectKey(basKey);
  return { key, value: convertAttributeValue(key, raw) };
};

export type BuildKeyframesParams = {
  name: string;
  resource: Record<string, unknown>;
  segments: BasSegment[];
  allowedKeys: ReadonlySet<string>;
  warnings: BasImportWarning[];
  readAttribute?: SegmentAttributeReader;
  /** 同一属性混用数值和百分比时，是否把整条时间线（含资源初值）统一成百分比。 */
  unifyPercentUnits?: boolean;
};

/**
 * 把绝对时间段合并成关键帧：每个段的起止点各生成一帧，帧内存放所有被动画属性在该时刻的值。
 * 只出现一次且从 0 开始的不可动画属性会并入 `resource`（会修改传入对象）。
 */
export const buildKeyframesFromSegments = (params: BuildKeyframesParams) => {
  const { name, resource, segments, allowedKeys, warnings } = params;
  const readAttribute = params.readAttribute ?? readBasAttribute;
  const ordered = [...segments].sort((left, right) => left.startMs - right.startMs);
  const initialValue = (key: string) => resource[key] ?? FALLBACK_INITIAL_VALUES[key] ?? 0;

  // 每个属性出现次数与首次起点：仅出现一次且从 0 开始时，不可动画属性可并入初始值。
  const counts = new Map<string, number>();
  const firstStarts = new Map<string, number>();
  for (const segment of ordered) {
    for (const [basKey, rawValue] of Object.entries(segment.attrs)) {
      const attribute = readAttribute(basKey, rawValue);
      if (!attribute) continue;
      const { key } = attribute;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!firstStarts.has(key)) firstStarts.set(key, segment.startMs);
    }
  }

  const grouped = new Map<string, ResolvedSegment[]>();
  const flat: ResolvedSegment[] = [];
  const reportedUnsupported = new Set<string>();

  for (const segment of ordered) {
    for (const [basKey, rawValue] of Object.entries(segment.attrs)) {
      const attribute = readAttribute(basKey, rawValue);
      if (!attribute || attribute.value === null) continue;
      const { key, value } = attribute;

      if (!allowedKeys.has(key)) {
        if (counts.get(key) === 1 && firstStarts.get(key) === 0) {
          resource[key] = value;
        } else if (!reportedUnsupported.has(key)) {
          reportedUnsupported.add(key);
          warnings.push({ code: "unsupportedAnimation", params: { object: name, property: basKey } });
        }
        continue;
      }

      const list = grouped.get(key) ?? [];
      const resolved: ResolvedSegment = {
        key,
        basKey,
        startMs: segment.startMs,
        endMs: Math.max(segment.endMs, segment.startMs),
        from: resolvePropertyValue(list, key, segment.startMs, initialValue(key)),
        to: value,
        easing: segment.easing,
        instant: INSTANT_KEYS.has(key)
      };
      list.push(resolved);
      grouped.set(key, list);
      flat.push(resolved);
    }
  }

  // 单位归一：同一属性在关键帧间混用 number / percent 时，预览插值需要参考
  // 尺寸才能换算；只要出现过百分比，就把整条时间线（含资源初值）统一成百分比。
  const percentKeys = new Set<string>();
  for (const [key, list] of params.unifyPercentUnits === false ? new Map<string, ResolvedSegment[]>() : grouped) {
    if (
      isPercentValue(initialValue(key)) ||
      list.some(segment => isPercentValue(segment.from) || isPercentValue(segment.to))
    ) {
      percentKeys.add(key);
    }
  }
  for (const key of percentKeys) {
    const initial = readBasNumericValue(resource[key]);
    if (initial && !initial.percent) resource[key] = `${roundNumber(initial.value)}%`;
  }

  const reportedEasing = new Set<string>();
  for (const segment of flat) {
    if (!segment.easing || segment.easing === "linear") continue;
    if (reportedEasing.has(segment.basKey)) continue;
    reportedEasing.add(segment.basKey);
    warnings.push({
      code: "easingApproximated",
      params: { object: name, property: segment.basKey, easing: segment.easing }
    });
  }

  const keyframes: TimelineKeyframe[] = collectKeyframeTimes(flat).map(timeMs => {
    const properties: TimelineKeyframeProperties = {};
    for (const [key, list] of grouped) {
      const value = resolvePropertyValue(list, key, timeMs, initialValue(key));
      (properties as Record<string, unknown>)[key] = percentKeys.has(key) ? toPercentValue(value) : value;
    }

    return {
      id: createKeyframeId(),
      timeMs,
      properties,
      interpolation: isStepBoundary(timeMs, flat) ? "step" : "linear"
    };
  });

  const animatedEndMs = flat.reduce((end, segment) => Math.max(end, segment.endMs), 0);
  return { keyframes, animatedEndMs };
};

/**
 * 把解析结果转换成时间轴对象。
 *
 * 每个 `def` 生成一个资源 + 一组关键帧；`sets` 先展开成绝对时间段，再按对象
 * 合并为「每个时间点存放全部被动画属性」的关键帧。
 *
 * `options.startTimeMs` 不参与转换：关键帧时间相对片段起点，真正的平移由
 * `useTimelineStore().importBasObjects` 写入 `clip.startTime` / 分组起点完成。
 */
export const convertParsedBas = (
  parsed: BasParseResult,
  _options: BasImportOptions = { startTimeMs: 0 }
): BasImportResult => {
  const warnings: BasImportWarning[] = [];
  const objects: BasImportObject[] = [];
  const segments: BasSegment[] = [];

  for (const node of parsed.sets ?? []) expandSetNode(node as RawBasSet, 0, segments, warnings);

  for (const rawDef of parsed.defs ?? []) {
    const def = rawDef as RawBasDef;
    const type = def.obj_type;
    if (type !== "text" && type !== "button" && type !== "path") {
      warnings.push({ code: "unknownObject", params: { object: String(def.name ?? "") } });
      continue;
    }

    const name = typeof def.name === "string" && def.name ? def.name : `${type}_${objects.length + 1}`;
    const attrs = def.attrs ?? {};
    const fields = FIELDS_BY_TYPE[type];
    const resource: Record<string, unknown> = { type };

    for (const [basKey, rawValue] of Object.entries(attrs)) {
      if (RESERVED_ATTRIBUTES.has(basKey)) continue;
      const key = toObjectKey(basKey);
      if (!fields.includes(key)) continue;
      const value = convertAttributeValue(key, rawValue);
      if (value !== null) resource[key] = value;
    }

    if (type === "button") {
      const target = convertTargetValue(attrs.target, name, warnings);
      if (target) resource.target = target;
    }

    const declaredDuration = readSegmentDuration(attrs.duration);
    const allowedKeys = new Set<string>(ANIMATABLE_KEYS_BY_TYPE[type]);
    const { keyframes, animatedEndMs } = buildKeyframesFromSegments({
      name,
      resource,
      segments: segments.filter(segment => segment.targetName === name),
      allowedKeys,
      warnings
    });

    const parentName = readBasStringValue(attrs.parent);

    objects.push({
      name,
      resource: resource as BasImportResource,
      durationMs: Math.max(
        declaredDuration > 0 ? declaredDuration : BAS_DEFAULT_DURATION_MS,
        Math.round(animatedEndMs)
      ),
      keyframes,
      ...(parentName ? { parentName: decodeBasText(parentName) } : {})
    });
  }

  // 父对象必须是文本（编译器在导出时有同样的限制）。
  const byName = new Map(objects.map(object => [object.name, object]));
  for (const object of objects) {
    if (!object.parentName) continue;
    const parent = byName.get(object.parentName);
    if (!parent || parent.resource.type !== "text") {
      warnings.push({
        code: "invalidParent",
        params: { object: object.name, parent: object.parentName }
      });
      delete object.parentName;
    }
  }

  if (objects.length === 0) warnings.push({ code: "noObjects" });

  return {
    objects,
    durationMs: objects.reduce((end, object) => Math.max(end, object.durationMs), 0),
    warnings
  };
};

/**
 * 解析开始时间输入：`5`（秒）、`5.5s`、`500ms`、`00:05.500`、`01:00:05.000`。
 *
 * @returns 毫秒；空串或无法解析时返回 null
 */
export const parseStartTimeInput = (input: string): number | null => {
  const text = input.trim();
  if (!text) return null;

  const clock = text.match(/^(?:(\d+):)?(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (clock) {
    const [, hours, minutes, seconds, fraction] = clock;
    const hoursMs = Number(hours ?? 0) * 3600000;
    const minutesMs = Number(minutes) * 60000;
    const secondsMs = Number(seconds) * 1000;
    const fractionMs = fraction ? Number(fraction.padEnd(3, "0")) : 0;
    return hoursMs + minutesMs + secondsMs + fractionMs;
  }

  const withUnit = text.match(/^(\d+(?:\.\d+)?)(?:\s*(ms|s))?$/i);
  if (!withUnit) return null;

  const value = Number(withUnit[1]);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(withUnit[2]?.toLowerCase() === "ms" ? value : value * 1000);
};

/** 把毫秒格式化成可回填到开始时间输入框的文本（`mm:ss.mmm` / `hh:mm:ss.mmm`）。 */
export const formatStartTimeInput = (timeMs: number): string => {
  const total = Math.max(0, Math.round(timeMs));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const milliseconds = total % 1000;
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return `${hours > 0 ? `${pad(hours)}:` : ""}${pad(minutes)}:${pad(seconds)}.${pad(milliseconds, 3)}`;
};
