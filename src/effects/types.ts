import type { DanmuType } from "@/types/danmu";

export type EffectText = string | { "zh-CN": string; en?: string; ja?: string };
export type EffectParam =
  | { type: "string" | "color"; label: EffectText; default: string }
  | { type: "number"; label: EffectText; default: number; min: number; max: number; step: number };
export type EffectSchema = Record<string, EffectParam>;
export type EffectParams = Record<string, string | number>;

export interface EffectPoint {
  at: number;
  value: number;
}

// 时间和透明度均归一化，分割后两个片段可以各自采样原曲线的一段。
export interface EffectPatch {
  style?: Partial<Record<"color" | "strokeWidth" | "strokeColor" | "fillColor" | "textColor" | "borderColor", number>>;
  opacityLimit?: EffectPoint[];
}

export interface EffectPlugin<S extends EffectSchema = EffectSchema> {
  id: string;
  apiVersion: 2;
  version: string;
  title: EffectText;
  description?: EffectText;
  targets: DanmuType[];
  params: S;
  build(context: { targetType: DanmuType; params: { readonly [K in keyof S]: S[K]["default"] } }): EffectPatch;
}

export const defineEffect = <S extends EffectSchema>(plugin: EffectPlugin<S>) => plugin;

export interface EffectInstance {
  id: string;
  pluginId: string;
  pluginVersion: string;
  apiVersion: number;
  params: EffectParams;
  patch: EffectPatch;
  range: [number, number];
}

export const matchesEffect = (plugin: EffectPlugin, instance: EffectInstance) =>
  plugin.id === instance.pluginId &&
  plugin.version === instance.pluginVersion &&
  plugin.apiVersion === instance.apiVersion;

export const effectText = (text: EffectText, locale: string) =>
  typeof text === "string" ? text : ((locale === "en" || locale === "ja") && text[locale]) || text["zh-CN"];

export const defaultEffectParams = (plugin: EffectPlugin): EffectParams =>
  Object.fromEntries(Object.entries(plugin.params).map(([key, field]) => [key, field.default]));
