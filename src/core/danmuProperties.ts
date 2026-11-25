import type { DanmuType } from "@/types/danmu";

/** 属性值在 BAS 序列化与解析中的分类。 */
export type DanmuPropertyValueType = "numeric" | "color" | "string" | "target";

export type DanmuPropertySpec = {
  /** 编辑器内部字段名。 */
  readonly key: string;
  /** 对应的 BAS DSL 属性名；与编辑器字段名一致时省略。 */
  readonly basKey?: string;
  readonly valueType: DanmuPropertyValueType;
  /** 是否允许使用百分比字符串（如 `"50%"`）。 */
  readonly supportsPercent?: boolean;
  /** 是否为 BAS 段开始时即刻切换的离散属性。 */
  readonly instant?: boolean;
  /** 关键帧插值时是否按数值线性插值。 */
  readonly interpolatesNumerically?: boolean;
  /** 支持关键帧动画的弹幕类型列表。 */
  readonly animatableOn?: readonly DanmuType[];
};

const ALL_DANMU_TYPES = ["text", "button", "path"] as const satisfies readonly DanmuType[];
const TEXT_ONLY = ["text"] as const satisfies readonly DanmuType[];
const BUTTON_ONLY = ["button"] as const satisfies readonly DanmuType[];
const TEXT_AND_BUTTON = ["text", "button"] as const satisfies readonly DanmuType[];

/**
 * 弹幕属性注册表：作为编译器、BAS 导入、默认值校验、工厂函数与关键帧插值的单一数据源。
 *
 * 列表顺序同时保留关键帧可动画属性的稳定遍历顺序，便于 golden 与快照保持确定性。
 */
export const DANMU_PROPERTY_LIST = [
  {
    key: "x",
    valueType: "numeric",
    supportsPercent: true,
    interpolatesNumerically: true,
    animatableOn: ALL_DANMU_TYPES
  },
  {
    key: "y",
    valueType: "numeric",
    supportsPercent: true,
    interpolatesNumerically: true,
    animatableOn: ALL_DANMU_TYPES
  },
  {
    key: "content",
    valueType: "string",
    instant: true,
    animatableOn: TEXT_ONLY
  },
  {
    key: "text",
    valueType: "string",
    instant: true,
    animatableOn: BUTTON_ONLY
  },
  {
    key: "scale",
    valueType: "numeric",
    interpolatesNumerically: true,
    animatableOn: TEXT_ONLY
  },
  {
    key: "rotateX",
    valueType: "numeric",
    interpolatesNumerically: true,
    animatableOn: TEXT_ONLY
  },
  {
    key: "rotateY",
    valueType: "numeric",
    interpolatesNumerically: true,
    animatableOn: TEXT_ONLY
  },
  {
    key: "rotateZ",
    valueType: "numeric",
    interpolatesNumerically: true,
    animatableOn: TEXT_ONLY
  },
  {
    key: "opacity",
    basKey: "alpha",
    valueType: "numeric",
    interpolatesNumerically: true,
    animatableOn: TEXT_ONLY
  },
  {
    key: "color",
    valueType: "color",
    animatableOn: TEXT_ONLY
  },
  {
    key: "fontSize",
    valueType: "numeric",
    supportsPercent: true,
    instant: true,
    animatableOn: TEXT_AND_BUTTON
  },
  { key: "zIndex", valueType: "numeric" },
  { key: "durationMs", basKey: "duration", valueType: "numeric" },
  { key: "anchorX", valueType: "numeric" },
  { key: "anchorY", valueType: "numeric" },
  { key: "parentId", basKey: "parent", valueType: "string" },
  { key: "fontFamily", valueType: "string" },
  { key: "bold", valueType: "numeric" },
  { key: "textShadow", valueType: "numeric" },
  { key: "strokeWidth", valueType: "numeric" },
  { key: "strokeColor", valueType: "color" },
  { key: "textColor", valueType: "color" },
  { key: "textAlpha", valueType: "numeric" },
  { key: "fillColor", valueType: "color" },
  { key: "fillAlpha", valueType: "numeric" },
  { key: "target", valueType: "target" },
  { key: "d", valueType: "string" },
  { key: "viewBox", valueType: "string" },
  { key: "borderWidth", valueType: "numeric" },
  { key: "borderColor", valueType: "color" },
  { key: "borderAlpha", valueType: "numeric" },
  { key: "width", valueType: "numeric", supportsPercent: true },
  { key: "height", valueType: "numeric", supportsPercent: true }
] as const satisfies readonly DanmuPropertySpec[];

export type RegisteredPropertyKey = (typeof DANMU_PROPERTY_LIST)[number]["key"];

const REGISTERED_SPECS: readonly DanmuPropertySpec[] = DANMU_PROPERTY_LIST;

export const DANMU_PROPERTY_BY_KEY: ReadonlyMap<string, DanmuPropertySpec> = new Map(
  REGISTERED_SPECS.map((spec) => [spec.key, spec])
);

const hasBasAlias = (spec: DanmuPropertySpec): spec is DanmuPropertySpec & { readonly basKey: string } =>
  Boolean(spec.basKey);

const ALIASED_SPECS = REGISTERED_SPECS.filter(hasBasAlias);

const EDITOR_TO_BAS_KEY: Readonly<Record<string, string>> = Object.fromEntries(
  ALIASED_SPECS.map((spec) => [spec.key, spec.basKey])
);

const BAS_TO_EDITOR_KEY: Readonly<Record<string, string>> = Object.fromEntries(
  ALIASED_SPECS.map((spec) => [spec.basKey, spec.key])
);

/** 编辑器字段名转换为 BAS 属性名（如 `opacity` → `alpha`）。 */
export const toBasPropertyKey = (editorKey: string): string => EDITOR_TO_BAS_KEY[editorKey] ?? editorKey;

/** BAS 属性名转换为编辑器字段名（如 `alpha` → `opacity`）。 */
export const toEditorPropertyKey = (basKey: string): string => BAS_TO_EDITOR_KEY[basKey] ?? basKey;

/** 各类型弹幕的主内容标识字段（在 `def` 块最前面输出）。 */
export const IDENTITY_FIELD_BY_TYPE: Record<DanmuType, RegisteredPropertyKey> = {
  text: "content",
  button: "text",
  path: "d"
};

/**
 * 各类型在 BAS `def` 块中输出的属性顺序。
 *
 * 顺序与现有 BAS 编译器输出一致，避免无意义的快照抖动。
 */
export const DEFINITION_FIELDS_BY_TYPE: Record<DanmuType, readonly RegisteredPropertyKey[]> = {
  text: [
    "x",
    "y",
    "zIndex",
    "scale",
    "opacity",
    "color",
    "anchorX",
    "anchorY",
    "fontSize",
    "fontFamily",
    "bold",
    "textShadow",
    "strokeWidth",
    "strokeColor",
    "rotateX",
    "rotateY",
    "rotateZ",
    "parentId"
  ],
  button: [
    "x",
    "y",
    "zIndex",
    "scale",
    "fontSize",
    "textColor",
    "textAlpha",
    "fillColor",
    "fillAlpha",
    "target",
    "opacity",
    "anchorX",
    "anchorY",
    "rotateX",
    "rotateY",
    "rotateZ",
    "parentId"
  ],
  path: [
    "x",
    "y",
    "zIndex",
    "scale",
    "viewBox",
    "borderWidth",
    "borderColor",
    "borderAlpha",
    "fillColor",
    "fillAlpha",
    "width",
    "height",
    "opacity",
    "anchorX",
    "anchorY",
    "rotateX",
    "rotateY",
    "rotateZ",
    "parentId"
  ]
};

/** BAS 导入时各类型可写入资源的字段集合（`parent` 单独解析为 `parentName`）。 */
export const IMPORTABLE_FIELDS_BY_TYPE: Record<DanmuType, readonly RegisteredPropertyKey[]> = {
  text: [IDENTITY_FIELD_BY_TYPE.text, ...DEFINITION_FIELDS_BY_TYPE.text.filter((key) => key !== "parentId")],
  button: [IDENTITY_FIELD_BY_TYPE.button, ...DEFINITION_FIELDS_BY_TYPE.button.filter((key) => key !== "parentId")],
  path: [IDENTITY_FIELD_BY_TYPE.path, ...DEFINITION_FIELDS_BY_TYPE.path.filter((key) => key !== "parentId")]
};

export const PERCENTAGE_PROPERTY_KEYS: ReadonlySet<string> = new Set(
  DANMU_PROPERTY_LIST.filter((spec) => "supportsPercent" in spec && spec.supportsPercent).map((spec) => spec.key)
);

export const COLOR_PROPERTY_KEYS: ReadonlySet<string> = new Set(
  DANMU_PROPERTY_LIST.filter((spec) => spec.valueType === "color").map((spec) => spec.key)
);

export const STRING_PROPERTY_KEYS: ReadonlySet<string> = new Set(
  DANMU_PROPERTY_LIST.filter((spec) => spec.valueType === "string").map((spec) => spec.key)
);

export const NUMERIC_PROPERTY_KEYS: ReadonlySet<string> = new Set(
  DANMU_PROPERTY_LIST.filter((spec) => spec.valueType === "numeric").map((spec) => spec.key)
);

/** 在 BAS 中于段开始时突变的属性（不可与前一段渐变共用时长）。 */
export const INSTANT_PROPERTY_KEYS: ReadonlySet<string> = new Set(
  DANMU_PROPERTY_LIST.filter((spec) => "instant" in spec && spec.instant).map((spec) => spec.key)
);

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
  "fontSize"
] as const;

export type AnimatableKey = (typeof ANIMATABLE_KEYS)[number];

/** 各资源类型可被关键帧插值的属性；BAS 导入与编译器共用该约束。 */
export const ANIMATABLE_KEYS_BY_TYPE: Record<DanmuType, readonly AnimatableKey[]> = {
  text: ANIMATABLE_KEYS.filter((key) => {
    const spec = DANMU_PROPERTY_BY_KEY.get(key);
    return Boolean(spec?.animatableOn?.includes("text"));
  }),
  button: ANIMATABLE_KEYS.filter((key) => {
    const spec = DANMU_PROPERTY_BY_KEY.get(key);
    return Boolean(spec?.animatableOn?.includes("button"));
  }),
  path: ANIMATABLE_KEYS.filter((key) => {
    const spec = DANMU_PROPERTY_BY_KEY.get(key);
    return Boolean(spec?.animatableOn?.includes("path"));
  })
};

/** 关键帧中支持数值线性插值的属性集合。 */
export const NUMERIC_INTERPOLATION_KEYS: ReadonlySet<AnimatableKey> = new Set(
  ANIMATABLE_KEYS.filter((key) => Boolean(DANMU_PROPERTY_BY_KEY.get(key)?.interpolatesNumerically))
);
