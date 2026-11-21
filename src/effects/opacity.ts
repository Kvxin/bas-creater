import type { EffectInstance, EffectPoint } from "./types";

// 相同时刻的两个点分别表示跳变前后，保留宿主的 step 关键帧。
export function opacityAt(points: EffectPoint[], at: number, before = false): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (points[mid]!.at < at || (!before && points[mid]!.at === at)) low = mid + 1;
    else high = mid;
  }
  const right = points[low];
  const left = points[low - 1];
  if (!left) return points[0]!.value;
  if (!right) return left.value;
  return left.value + (right.value - left.value) * ((at - left.at) / (right.at - left.at));
}

function limitCurve(host: EffectPoint[], limit: EffectPoint[]) {
  const times = [...new Set([...host, ...limit].map(point => point.at))].sort((a, b) => a - b);
  const result: EffectPoint[] = [];
  for (let i = 0; i < times.length; i++) {
    const at = times[i]!;
    const before = Math.min(opacityAt(host, at, true), opacityAt(limit, at, true));
    const alpha = opacityAt(host, at);
    const cap = opacityAt(limit, at);
    result.push({ at, value: before });
    if (Math.min(alpha, cap) !== before) result.push({ at, value: Math.min(alpha, cap) });
    const end = times[i + 1];
    if (end === undefined) break;
    const nextAlpha = opacityAt(host, end, true);
    const nextCap = opacityAt(limit, end, true);
    const gap = alpha - cap;
    const nextGap = nextAlpha - nextCap;
    // 两条直线中途相交时补上折点，避免修改宿主较低的透明度。
    if (gap * nextGap < 0) {
      const fraction = gap / (gap - nextGap);
      result.push({ at: at + fraction * (end - at), value: alpha + fraction * (nextAlpha - alpha) });
    }
  }
  return result;
}

export function applyOpacityLimits(host: EffectPoint[], effects: EffectInstance[], duration: number) {
  for (const {
    patch,
    range: [from, to]
  } of effects) {
    if (!patch.opacityLimit) continue;
    const curve = patch.opacityLimit;
    const limit = [
      { at: 0, value: opacityAt(curve, from) },
      ...curve
        .filter(point => point.at > from && point.at < to)
        .map(point => ({
          at: ((point.at - from) / (to - from)) * duration,
          value: point.value
        })),
      { at: duration, value: opacityAt(curve, to) }
    ];
    host = duration === 0 ? [{ at: 0, value: Math.min(opacityAt(host, 0), limit[0]!.value) }] : limitCurve(host, limit);
  }
  return host;
}
