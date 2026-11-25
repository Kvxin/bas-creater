import type {
  EffectInstance,
  EffectParam,
  EffectParams,
  EffectPatch,
  EffectPlugin,
  EffectPoint,
  EffectSchema,
  EffectText
} from "@/types/effects";

export type {
  EffectInstance,
  EffectParam,
  EffectParams,
  EffectPatch,
  EffectPlugin,
  EffectPoint,
  EffectSchema,
  EffectText
};

export const defineEffect = <S extends EffectSchema>(plugin: EffectPlugin<S>) => plugin;

export const matchesEffect = (plugin: EffectPlugin, instance: EffectInstance) =>
  plugin.id === instance.pluginId &&
  plugin.version === instance.pluginVersion &&
  plugin.apiVersion === instance.apiVersion;

export const effectText = (text: EffectText, locale: string) =>
  typeof text === "string" ? text : ((locale === "en" || locale === "ja") && text[locale]) || text["zh-CN"];

export const defaultEffectParams = (plugin: EffectPlugin): EffectParams =>
  Object.fromEntries(Object.entries(plugin.params).map(([key, field]) => [key, field.default]));
