import { i18n } from "@/i18n";
import type { AnyDanmu, DanmuType } from "@/types/danmu";

export const BAS_COMMON_DEFAULTS = {
  x: 0,
  y: 0,
  zIndex: 0,
  scale: 1,
  durationMs: undefined,
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
  parentId: undefined,
} as const;

export const BAS_BUTTON_DEFAULTS = {
  fontSize: 25,
  textColor: 0x000000,
  textAlpha: 1,
  fillColor: 0xffffff,
  fillAlpha: 1,
  target: undefined,
} as const;

export const BAS_PATH_DEFAULTS = {
  d: undefined,
  viewBox: undefined,
  borderColor: 0x000000,
  borderAlpha: 1,
  borderWidth: 0,
  fillColor: 0xffffff,
  fillAlpha: 1,
} as const;

export type BasDanmuDefaults = typeof BAS_COMMON_DEFAULTS &
  Partial<
    typeof BAS_TEXT_DEFAULTS &
      typeof BAS_BUTTON_DEFAULTS &
      typeof BAS_PATH_DEFAULTS
  > & {
    /**
     * Locale dependent placeholder content of a text danmaku. It is resolved on
     * every call instead of being baked into the constants above, so a resource
     * created in one language keeps the text it was created with and new
     * resources follow the active language.
     */
    content?: string;
    /** Locale dependent placeholder label of a button danmaku. */
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
  path: BAS_PATH_DEFAULTS,
};

/**
 * Textual BAS defaults, translated with the active locale.
 * The button default deliberately mirrors the text default (both used to be
 * "请输入内容"): BAS only emits a property when it differs from these values, so
 * changing it would alter the generated code for newly created buttons.
 */
const localizedTextDefaults = (
  type: DanmuType
): Partial<Pick<BasDanmuDefaults, "content" | "text">> => {
  if (type === "text") return { content: i18n.global.t("danmu.defaultText") };
  if (type === "button") return { text: i18n.global.t("danmu.defaultText") };
  return {};
};

export const getBasDanmuDefaults = (type: DanmuType): BasDanmuDefaults => ({
  ...BAS_COMMON_DEFAULTS,
  ...BAS_DEFAULTS_BY_TYPE[type],
  ...localizedTextDefaults(type),
});

export const resolveDanmuDefaults = <T extends AnyDanmu>(
  resource: T
): ResolvedDanmu<T> => {
  const definedResourceEntries = Object.entries(resource).filter(
    ([, value]) => value !== undefined
  );
  return {
    ...getBasDanmuDefaults(resource.type),
    ...Object.fromEntries(definedResourceEntries),
  } as ResolvedDanmu<T>;
};

const RAW_KEY_TO_DEFAULT_KEY: Readonly<Record<string, string>> = {
  alpha: "opacity",
  duration: "durationMs",
  parent: "parentId",
};

const COLOR_KEYS = new Set([
  "color",
  "strokeColor",
  "textColor",
  "fillColor",
  "borderColor",
]);

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
  if (COLOR_KEYS.has(key)) {
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
  const defaultKey = RAW_KEY_TO_DEFAULT_KEY[rawKey] ?? rawKey;
  const defaults = getBasDanmuDefaults(resource.type) as unknown as Record<string, unknown>;
  return areEquivalentValues(defaultKey, rawValue, defaults[defaultKey]);
};
