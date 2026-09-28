import { i18n } from "@/i18n";
import type {
  AnyDanmu,
  ButtonDanmu,
  DanmuBase,
  DanmuType,
  PathDanmu,
  TextDanmu,
} from "@/types/danmu";
import { compileDanmuDefinition } from "@/utils/compiler";

function genId(len = 10) {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < len; i++)
    s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function ms(v: number | string | undefined, fallback: number): number {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const COMMON_OPTIONAL_KEYS = [
  "name",
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
  "parentId",
] as const;

const TEXT_OPTIONAL_KEYS = [
  "fontSize",
  "fontFamily",
  "bold",
  "textShadow",
  "color",
  "strokeWidth",
  "strokeColor",
  "textColor",
] as const;

const BUTTON_OPTIONAL_KEYS = [
  "fontSize",
  "textColor",
  "textAlpha",
  "fillColor",
  "fillAlpha",
  "target",
] as const;

const PATH_OPTIONAL_KEYS = [
  "viewBox",
  "borderWidth",
  "borderColor",
  "borderAlpha",
  "fillColor",
  "fillAlpha",
  "width",
  "height",
] as const;

const pickDefined = (
  source: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  keys.forEach((key) => {
    const value = source[key];
    if (value !== undefined) result[key] = value;
  });

  return result;
};

function baseDefaults(type: DanmuType, ov: Partial<DanmuBase> = {}): DanmuBase {
  return {
    id: ov.id ?? genId(10),
    type,
    durationMs: ms(ov.durationMs, 2000),
    ...pickDefined(
      ov as Record<string, unknown>,
      COMMON_OPTIONAL_KEYS
    ),
  } as DanmuBase;
}

export function createTextDanmu(ov: Partial<TextDanmu> = {}): TextDanmu {
  const base = baseDefaults("text", ov);
  return {
    ...base,
    type: "text",
    content: ov.content ?? i18n.global.t("danmu.defaultText"),
    ...pickDefined(
      ov as Record<string, unknown>,
      TEXT_OPTIONAL_KEYS
    ),
  } as TextDanmu;
}

export function createButtonDanmu(ov: Partial<ButtonDanmu> = {}): ButtonDanmu {
  const base = baseDefaults("button", ov);
  return {
    ...base,
    type: "button",
    text: ov.text ?? i18n.global.t("danmu.defaultButtonText"),
    ...pickDefined(
      ov as Record<string, unknown>,
      BUTTON_OPTIONAL_KEYS
    ),
  } as ButtonDanmu;
}

export function createPathDanmu(ov: Partial<PathDanmu> = {}): PathDanmu {
  const base = baseDefaults("path", ov);
  return {
    ...base,
    type: "path",
    d: ov.d ?? "M0 0 H100 V100 H0 Z",
    ...pickDefined(
      ov as Record<string, unknown>,
      PATH_OPTIONAL_KEYS
    ),
  } as PathDanmu;
}

export function createDanmuByKey(key: string, payload: Partial<AnyDanmu> = {}): AnyDanmu {
  switch (key) {
    case "text":
      return createTextDanmu({
        durationMs: 5000,
        ...(payload as Partial<TextDanmu>),
      });
    case "path":
      return createPathDanmu({
        durationMs: 2000,
        ...(payload as Partial<PathDanmu>),
      });
    case "button":
      return createButtonDanmu({
        durationMs: 2000,
        ...(payload as Partial<ButtonDanmu>),
      });
    default:
      return createTextDanmu({});
  }
}

/**
 * 将 AnyDanmu 对象转换为 BAS DSL 文本
 */
export function danmuToDSL(danmu: AnyDanmu): string {
  const name = danmu.id.replace(/[^a-zA-Z0-9_]/g, "_");
  const durationMs = danmu.durationMs ?? 2000;
  const definition = compileDanmuDefinition(danmu, name, durationMs).trimEnd();
  return durationMs <= 0 ? `${definition}\nset ${name} {} 0s` : definition;
}
