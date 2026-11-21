import type { DanmuType } from "@/types/danmu";
import { createTimelineId } from "@/utils/timelineGroups";
import type { EffectInstance, EffectParams, EffectPlugin } from "./types";
import { validateEffectParams, validatePatch } from "./validation";

export function buildInstance(
  plugin: EffectPlugin,
  targetType: DanmuType,
  params: EffectParams,
  previous?: EffectInstance
): EffectInstance {
  validateEffectParams(plugin, params);
  const patch = plugin.build({ targetType, params: Object.freeze({ ...params }) });
  validatePatch(patch, targetType);
  return {
    id: previous?.id ?? createTimelineId("fx"),
    pluginId: plugin.id,
    pluginVersion: plugin.version,
    apiVersion: plugin.apiVersion,
    params: { ...params },
    patch: JSON.parse(JSON.stringify(patch)),
    range: previous?.range ?? [0, 1]
  };
}

export function sliceEffects(effects: EffectInstance[], start: number, end: number, copy = false): EffectInstance[] {
  return effects.map(effect => {
    const [from, to] = effect.range;
    const sample = (time: number) => Math.max(0, Math.min(1, from + (to - from) * time));
    return { ...effect, id: copy ? createTimelineId("fx") : effect.id, range: [sample(start), sample(end)] };
  });
}
