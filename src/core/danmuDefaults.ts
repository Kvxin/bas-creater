import type { AnyDanmu, DanmuType } from "@/types/danmu";
import { COLOR_PROPERTY_KEYS, toEditorPropertyKey } from "@/core/danmuProperties";

export const BAS_COMMON_DEFAULTS = {
  x: "0%",
  y: "0%",
  zIndex: 0,
  scale: 1,
  durationMs: undefined
} as const;

export const BAS_TEXT_DEFAULTS = {
  opacity: 1,
  color: 0xffffff,
  anchorX: 0,
  anchorY: 0,
  fontSize: 25,
  fontFamily: "SimHei",
  bold: 1,
  textShadow: 1,
  strokeWidth: 0,
  strokeColor: 0xffffff,
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  parentId: undefined
} as const;

export const BAS_BUTTON_DEFAULTS = {
  fontSize: 25,
  textColor: 0x000000,
  textAlpha: 1,
  fillColor: 0xffffff,
  fillAlpha: 1,
  target: undefined
} as const;

export const BAS_PATH_DEFAULTS = {
  d: undefined,
  viewBox: undefined,
  borderColor: 0x000000,
  borderAlpha: 1,
  borderWidth: 0,
  fillColor: 0xffffff,
  fillAlpha: 1
} as const;

export type BasDanmuDefaults = typeof BAS_COMMON_DEFAULTS &
  Partial<
    typeof BAS_TEXT_DEFAULTS &
      typeof BAS_BUTTON_DEFAULTS &
      typeof BAS_PATH_DEFAULTS
  > & {
    /** BAS 内置文本默认内容（固定为 `BAS_DEFAULT_TEXT`，UI 本地化文案由 store 层传入）。 */
    content?: string;
    /** BAS 内置按钮默认文案（固定为 `BAS_DEFAULT_TEXT`，UI 本地化文案由 store 层传入）。 */
    text?: string;
  };

export type ResolvedDanmu<T extends AnyDanmu = AnyDanmu> = T & {
  x: number | string;
  y: number | string;
  zIndex: number;
  scale: number;
};

const BAS_DEFAULTS_BY_TYPE: Record<
  DanmuType,
  typeof BAS_TEXT_DEFAULTS | typeof BAS_BUTTON_DEFAULTS | typeof BAS_PATH_DEFAULTS
> = {
  text: BAS_TEXT_DEFAULTS,
  button: BAS_BUTTON_DEFAULTS,
  path: BAS_PATH_DEFAULTS
};

/** bas.js 运行时内置的文字默认值（文本与按钮相同）；编译器省略等于默认值的属性，所以这里不能随界面语言变化。 */
export const BAS_DEFAULT_TEXT = "请输入内容";

const textIdentityDefaults = (type: DanmuType): Partial<Pick<BasDanmuDefaults, "content" | "text">> => {
  if (type === "text") return { content: BAS_DEFAULT_TEXT };
  if (type === "button") return { text: BAS_DEFAULT_TEXT };
  return {};
};

export const getBasDanmuDefaults = (type: DanmuType): BasDanmuDefaults => ({
  ...BAS_COMMON_DEFAULTS,
  ...BAS_DEFAULTS_BY_TYPE[type],
  ...textIdentityDefaults(type)
});

export const resolveDanmuDefaults = <T extends AnyDanmu>(
  resource: T
): ResolvedDanmu<T> => {
  const definedResourceEntries = Object.entries(resource).filter(
    ([, value]) => value !== undefined
  );
  return {
    ...getBasDanmuDefaults(resource.type),
    ...Object.fromEntries(definedResourceEntries)
  } as ResolvedDanmu<T>;
};

const normalizeColor = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  const hex = trimmed.match(/^(?:#|0x)([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const expanded =
      hex.length === 3
        ? hex
            .split("")
            .map(character => character.repeat(2))
            .join("")
        : hex;
    return Number.parseInt(expanded, 16);
  }

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
};

interface NumericValue {
  unit: "number" | "percent";
  value: number;
}

const normalizeNumericValue = (value: unknown): NumericValue | null => {
  if (typeof value === "boolean") {
    return { unit: "number", value: value ? 1 : 0 };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { unit: "number", value };
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  const percent = trimmed.endsWith("%");
  const source = percent ? trimmed.slice(0, -1).trim() : trimmed;
  if (source === "") return null;

  const parsed = Number(source);
  if (!Number.isFinite(parsed)) return null;
  return { unit: percent ? "percent" : "number", value: parsed };
};

const areEquivalentValues = (
  key: string,
  rawValue: unknown,
  defaultValue: unknown
) => {
  if (COLOR_PROPERTY_KEYS.has(key)) {
    const rawColor = normalizeColor(rawValue);
    const defaultColor = normalizeColor(defaultValue);
    if (rawColor !== null && defaultColor !== null) return rawColor === defaultColor;
  }

  const rawNumeric = normalizeNumericValue(rawValue);
  const defaultNumeric = normalizeNumericValue(defaultValue);
  if (rawNumeric && defaultNumeric) {
    if (rawNumeric.unit === defaultNumeric.unit) {
      return Object.is(rawNumeric.value, defaultNumeric.value);
    }
    // Zero has the same rendered meaning with or without a percent unit.
    return rawNumeric.value === 0 && defaultNumeric.value === 0;
  }

  return Object.is(rawValue, defaultValue);
};

export const isDanmuFieldBasDefault = (
  resource: AnyDanmu,
  rawKey: string,
  rawValue: unknown = (resource as unknown as Record<string, unknown>)[rawKey]
) => {
  const defaultKey = toEditorPropertyKey(rawKey);
  const defaults = getBasDanmuDefaults(resource.type) as unknown as Record<string, unknown>;
  return areEquivalentValues(defaultKey, rawValue, defaults[defaultKey]);
};
