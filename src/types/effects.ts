import type { DanmuType } from "@/types/danmu";

export type EffectText = string | { "zh-CN": string; en?: string; ja?: string };
export type EffectCategory = "animation" | "style";
export type EffectParam =
  | { type: "string" | "color"; label: EffectText; default: string }
  | { type: "number"; label: EffectText; default: number; min: number; max: number; step: number };
export type EffectSchema = Record<string, EffectParam>;
export type EffectParams = Record<string, string | number>;

export interface EffectPoint {
  at: number;
  value: number;
}

/**
 * 特效产出的中间表示（与 BAS 引擎能力严格对齐）：
 * - `defStyle`: BAS 仅在 `def` 初始化 DOM 时读取一次、不支持 `set` 动态变化的静态样式属性（全片段生效）；
 * - `color`: BAS 支持在 `set` 中通过 CSS `@keyframes` 动态切换/渐变的文字颜色；
 * - `opacityLimit`: 时间与透明度均归一化的上限曲线，分割后两个片段可以各自采样原曲线的一段。
 */
export interface EffectPatch {
  defStyle?: Partial<Record<"strokeWidth" | "strokeColor" | "fillColor" | "textColor" | "borderColor", number>>;
  color?: number;
  opacityLimit?: EffectPoint[];
}

export interface EffectPlugin<S extends EffectSchema = EffectSchema> {
  id: string;
  apiVersion: 2;
  version: string;
  category?: EffectCategory;
  title: EffectText;
  description?: EffectText;
  targets: DanmuType[];
  params: S;
  build(context: { targetType: DanmuType; params: { readonly [K in keyof S]: S[K]["default"] } }): EffectPatch;
}

export interface EffectInstance {
  id: string;
  pluginId: string;
  pluginVersion: string;
  apiVersion: number;
  params: EffectParams;
  patch: EffectPatch;
  range: [number, number];
  // 相对片段起点的毫秒区间，始终位于 [0, 片段时长] 内；range 描述该区间采样插件曲线的哪一段。
  span: [number, number];
}
