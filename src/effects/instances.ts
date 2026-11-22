import type { DanmuType } from "@/types/danmu";
import { createTimelineId } from "@/utils/timelineGroups";
import type { EffectInstance, EffectParams, EffectPlugin } from "./types";
import { validateEffectParams, validatePatch } from "./validation";

export function buildInstance(
  plugin: EffectPlugin,
  targetType: DanmuType,
  params: EffectParams,
  previous: Pick<EffectInstance, "span"> & Partial<Pick<EffectInstance, "id" | "range">>
): EffectInstance {
  validateEffectParams(plugin, params);
  const patch = plugin.build({ targetType, params: Object.freeze({ ...params }) });
  validatePatch(patch, targetType);
  return {
    id: previous.id ?? createTimelineId("fx"),
    pluginId: plugin.id,
    pluginVersion: plugin.version,
    apiVersion: plugin.apiVersion,
    params: { ...params },
    patch: JSON.parse(JSON.stringify(patch)),
    range: previous.range ?? [0, 1],
    span: [...previous.span]
  };
}

/**
 * 截取片段内 [offset, offset + duration] 的特效，结果以截取起点为新的零点。
 * 与该区间没有交集的特效被丢弃；被截断的特效同步收窄曲线采样区间，保留原有的播放进度。
 */
export function sliceEffects(effects: EffectInstance[], offset: number, duration: number, copy = false) {
  const end = offset + duration;
  return effects.flatMap(effect => {
    const [spanStart, spanEnd] = effect.span;
    const from = Math.max(spanStart, offset);
    const to = Math.min(spanEnd, end);
    const length = spanEnd - spanStart;
    if (to < from || (to === from && length > 0)) return [];
    const [rangeStart, rangeEnd] = effect.range;
    const sample = (time: number) =>
      length > 0
        ? Math.max(0, Math.min(1, rangeStart + (rangeEnd - rangeStart) * ((time - spanStart) / length)))
        : rangeStart;
    const sliced: EffectInstance = {
      ...effect,
      id: copy ? createTimelineId("fx") : effect.id,
      range: [sample(from), sample(to)],
      // 单独夹到 duration，避免浮点误差让区间越过片段终点。
      span: [Math.min(from - offset, duration), Math.min(to - offset, duration)]
    };
    return [sliced];
  });
}
