import type { AnyDanmu } from "@/types/danmu";
import type { TimelineKeyframe } from "@/types/timeline";
import { buildKeyframesFromSegments } from "@/utils/basImport";
import type { BasImportWarning, BasSegment } from "@/utils/basImport";
import { resolveDanmuDefaults } from "@/utils/danmuDefaults";
import { ANIMATABLE_KEYS_BY_TYPE } from "@/utils/keyframes";

/** v3 及更早工程中的 set/then 动画段，只在读取旧工程时出现，加载后会迁移为关键帧。 */
export type LegacyAnimationSegment = {
  id: string;
  type: "set" | "then";
  duration: number;
  delay?: number;
  properties: Record<string, unknown>;
};

/**
 * 把旧动画段转换成关键帧，时间语义与旧编译器输出的 BAS 一致：
 * `set` 从片段起点 + delay 开始一条新的并行链，`then` 接在上一段结束后 + delay。
 *
 * @param clipId 片段 ID，用于错误信息
 * @param resource 已合并片段 overrides 的资源
 * @param animations 旧动画段
 * @returns 关键帧，以及需要并入片段 overrides 的初值（不可动画属性只在 0 时刻设置一次时）
 * @throws 当动画修改了关键帧无法表达的属性时抛出错误
 */
export const convertLegacyAnimations = (
  clipId: string,
  resource: AnyDanmu,
  animations: LegacyAnimationSegment[]
): { keyframes: TimelineKeyframe[]; overrides: Partial<AnyDanmu> } => {
  const segments: BasSegment[] = [];
  let cursorMs = 0;
  for (const animation of animations) {
    const startMs = (animation.type === "set" ? 0 : cursorMs) + Math.max(0, animation.delay ?? 0);
    const endMs = startMs + Math.max(0, animation.duration);
    segments.push({ targetName: clipId, startMs, endMs, attrs: animation.properties });
    cursorMs = endMs;
  }

  const initial: Record<string, unknown> = { ...resolveDanmuDefaults(resource) };
  const working = { ...initial };
  const warnings: BasImportWarning[] = [];
  const { keyframes } = buildKeyframesFromSegments({
    name: clipId,
    resource: working,
    segments,
    allowedKeys: new Set<string>(ANIMATABLE_KEYS_BY_TYPE[resource.type]),
    warnings,
    readAttribute: (key, value) => ({ key, value: value ?? null }),
    unifyPercentUnits: false
  });
  const unsupported = warnings.find((warning) => warning.code === "unsupportedAnimation");
  if (unsupported) {
    throw new Error(
      `Clip ${clipId} animates "${String(unsupported.params?.property)}" in a legacy animation, which keyframes cannot represent`
    );
  }
  const overrides = Object.fromEntries(Object.entries(working).filter(([key, value]) => initial[key] !== value));
  return { keyframes, overrides: overrides as Partial<AnyDanmu> };
};
