import type { EffectInstance, EffectPatch } from "./types";

export type EffectStyle = NonNullable<EffectPatch["style"]>;

/**
 * 按特效区间的边界把片段切成若干段，返回每段起点及覆盖该段的样式。
 * 同一属性按 effects[] 顺序后者生效；相邻且样式相同的段会合并，第一段总是从 0 开始。
 */
export function effectStyleSegments(effects: EffectInstance[], duration: number) {
  const styled = effects.filter(effect => effect.patch.style);
  const times = [...new Set([0, ...styled.flatMap(effect => effect.span)])]
    .filter(time => time < duration)
    .sort((a, b) => a - b);
  if (!times.length) times.push(0);
  const segments: { at: number; style: EffectStyle }[] = [];
  times.forEach((at, index) => {
    const end = times[index + 1] ?? duration;
    // 零时长片段没有可切换的时间，所有样式直接写入定义。
    const active = styled.filter(
      ({ span: [start, stop] }) => duration === 0 || (start <= at && end <= stop && stop > start)
    );
    const style: EffectStyle = Object.assign({}, ...active.map(effect => effect.patch.style));
    const previous = segments[segments.length - 1];
    if (!previous || JSON.stringify(previous.style) !== JSON.stringify(style)) segments.push({ at, style });
  });
  return segments;
}
