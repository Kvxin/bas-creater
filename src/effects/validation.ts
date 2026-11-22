import type { DanmuType } from "@/types/danmu";
import type { EffectInstance, EffectPatch, EffectParam, EffectParams, EffectPlugin, EffectText } from "./types";

export const MAX_CLIP_EFFECTS = 64;
const MAX_CURVE_POINTS = 64;
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const isEffectKey = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-zA-Z][\w.-]*$/.test(value) &&
  !Object.prototype.hasOwnProperty.call(Object.prototype, value);
const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
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

const isColor = (value: unknown) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const isUnit = (value: unknown): value is number => isFiniteNumber(value) && value >= 0 && value <= 1;
const styleKeys: Record<DanmuType, readonly string[]> = {
  text: ["color", "strokeWidth", "strokeColor"],
  button: ["textColor", "fillColor"],
  path: ["borderColor", "fillColor"]
};

export function validatePatch(patch: unknown, type: DanmuType): asserts patch is EffectPatch {
  if (!isRecord(patch) || Object.keys(patch).some(key => key !== "style" && key !== "opacityLimit"))
    throw new Error("Invalid host effect patch");
  if (patch.style !== undefined) {
    if (!isRecord(patch.style)) throw new Error("Invalid host style");
    for (const [key, value] of Object.entries(patch.style)) {
      const valid =
        isFiniteNumber(value) &&
        value >= 0 &&
        (key === "strokeWidth" ? value <= 64 : Number.isInteger(value) && value <= 0xffffff);
      if (!valid || !styleKeys[type].includes(key)) throw new Error(`Invalid ${type} effect style: ${key}`);
    }
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
  if (!points && !Object.keys(patch.style ?? {}).length) throw new Error("Empty host effect patch");
}

export function validateInstance(effect: unknown, type: DanmuType, clipDuration: number): asserts effect is EffectInstance {
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
  validatePatch(effect.patch, type);
}
