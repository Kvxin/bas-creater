import type { AnyDanmu } from "@/types/danmu";
import type { TimelineClip, TimelineResourceClip } from "@/types/timeline";
import type { CoordinateReferenceSize } from "@/core/coordinates";
import { resolveDanmuDefaults } from "@/core/danmuDefaults";
import { getEffectiveDanmuAtTime } from "@/core/keyframes";
import { flattenTimelineClips } from "@/core/timelineGroups";

/** 轨道高度达到或超过该阈值（px）时，弹幕/分组片段切换为“顶部标题栏 + 下方胶片条”展开态。 */
export const CLIP_FILMSTRIP_HEIGHT_THRESHOLD = 56;

/** 展开态片段顶部标题栏固定高度（px）。 */
export const CLIP_FILMSTRIP_HEADER_HEIGHT = 20;

const MIN_FRAME_WIDTH_PX = 16;
const MIN_ASPECT_RATIO = 0.25;
const MAX_ASPECT_RATIO = 4;

export interface FilmstripTile {
  index: number;
  /** 瓦片左边缘在片段内部的水平坐标（px）。 */
  x: number;
  /** 该帧对应的片段局部采样时间（ms，已合并左裁剪偏移）。 */
  localTimeMs: number;
}

export interface FilmstripLayout {
  clipWidthPx: number;
  visibleLeft: number;
  visibleWidth: number;
  frameWidth: number;
  frameHeight: number;
  tiles: FilmstripTile[];
}

export interface FilmstripLayoutParams {
  clipStartMs: number;
  clipDurationMs: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  viewportWidth: number;
  stripHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  minClipWidthPx?: number;
  /** 实时拖拽左边界裁剪时的局部时间偏移（ms）。 */
  timeOffsetMs?: number;
  /** 原始片段总时长（ms），用于限制带偏移时的采样上限。 */
  sourceDurationMs?: number;
}

export interface FilmstripDanmuItem {
  danmu: AnyDanmu;
  parentChain: AnyDanmu[];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const isClipFilmstripExpanded = (trackHeight: number): boolean =>
  Number.isFinite(trackHeight) && trackHeight >= CLIP_FILMSTRIP_HEIGHT_THRESHOLD;

/**
 * 计算片段胶片条在当前滚动视口中的可见切片与抽帧瓦片布局。
 * 瓦片按 `index * frameWidth` 锚定在片段左起点，水平滚动或右边缘缩放时不会产生抖动。
 */
export const computeFilmstripLayout = (params: FilmstripLayoutParams): FilmstripLayout => {
  const {
    clipStartMs,
    clipDurationMs,
    pixelsPerSecond,
    scrollLeft,
    viewportWidth,
    stripHeight,
    canvasWidth,
    canvasHeight,
    minClipWidthPx = 2,
    timeOffsetMs = 0,
    sourceDurationMs
  } = params;

  const safeDurationMs = Math.max(0, Number.isFinite(clipDurationMs) ? clipDurationMs : 0);
  const safePps = Math.max(0, Number.isFinite(pixelsPerSecond) ? pixelsPerSecond : 0);
  const safeStripHeight = Math.max(0, Number.isFinite(stripHeight) ? stripHeight : 0);
  const safeViewportWidth = Math.max(0, Number.isFinite(viewportWidth) ? viewportWidth : 0);
  const clipWidthPx = Math.max(minClipWidthPx, (safeDurationMs / 1000) * safePps);

  if (safeStripHeight <= 0 || safeViewportWidth <= 0 || clipWidthPx <= 0) {
    return {
      clipWidthPx,
      visibleLeft: 0,
      visibleWidth: 0,
      frameWidth: 0,
      frameHeight: 0,
      tiles: []
    };
  }

  const rawAspect = canvasWidth > 0 && canvasHeight > 0 ? canvasWidth / canvasHeight : 16 / 9;
  const aspectRatio = clamp(rawAspect, MIN_ASPECT_RATIO, MAX_ASPECT_RATIO);
  const frameHeight = safeStripHeight;
  const frameWidth = Math.max(MIN_FRAME_WIDTH_PX, Math.round(frameHeight * aspectRatio));

  const clipStartPx = (Math.max(0, Number.isFinite(clipStartMs) ? clipStartMs : 0) / 1000) * safePps;
  const visibleLeft = Math.max(0, Math.floor(scrollLeft - clipStartPx));
  const visibleRight = Math.min(clipWidthPx, Math.ceil(scrollLeft + safeViewportWidth - clipStartPx));
  const visibleWidth = Math.max(0, visibleRight - visibleLeft);

  if (visibleWidth <= 0) {
    return {
      clipWidthPx,
      visibleLeft,
      visibleWidth: 0,
      frameWidth,
      frameHeight,
      tiles: []
    };
  }

  const firstIndex = Math.floor(visibleLeft / frameWidth);
  const lastIndex = Math.max(firstIndex, Math.ceil(visibleRight / frameWidth) - 1);
  const maxSampleTimeMs = Math.max(
    safeDurationMs + timeOffsetMs,
    Number.isFinite(sourceDurationMs) ? (sourceDurationMs as number) : 0
  );
  const tiles: FilmstripTile[] = [];

  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const x = index * frameWidth;
    const tileSpan = Math.min(frameWidth, Math.max(0, clipWidthPx - x));
    const sampleX = x + tileSpan * 0.5;
    const rawLocalTimeMs = safePps > 0 ? (sampleX / safePps) * 1000 : safeDurationMs * 0.5;
    const localTimeMs = Math.min(rawLocalTimeMs + timeOffsetMs, maxSampleTimeMs);
    tiles.push({ index, x, localTimeMs });
  }

  return {
    clipWidthPx,
    visibleLeft,
    visibleWidth,
    frameWidth,
    frameHeight,
    tiles
  };
};

const evaluateResourceClipAtTime = (
  clip: TimelineResourceClip,
  timelineTimeMs: number,
  resource: AnyDanmu,
  reference: CoordinateReferenceSize
): AnyDanmu => {
  try {
    // 实时向右拉长片段时允许采样大于当前 clip.duration 的窗口外关键帧，向左拉长允许采样负局部时刻。
    const localTimeMs = timelineTimeMs - clip.startTime;
    const effectiveClip =
      localTimeMs > clip.duration ? { ...clip, duration: localTimeMs } : clip;
    return getEffectiveDanmuAtTime(resource, effectiveClip, timelineTimeMs, null, reference);
  } catch {
    return resolveDanmuDefaults({ ...resource, ...clip.overrides } as AnyDanmu);
  }
};

const resolveParentChain = (
  clip: TimelineResourceClip,
  timelineTimeMs: number,
  resourcesById: ReadonlyMap<string, AnyDanmu>,
  allClipsById: ReadonlyMap<string, TimelineResourceClip> | undefined,
  reference: CoordinateReferenceSize
): AnyDanmu[] => {
  if (!clip.parentClipId || !allClipsById) return [];
  const chain: AnyDanmu[] = [];
  const seen = new Set<string>([clip.id]);
  let parentId: string | undefined = clip.parentClipId;

  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parentClip = allClipsById.get(parentId);
    if (!parentClip) break;
    const parentResource = resourcesById.get(parentClip.resourceId);
    if (!parentResource) break;
    chain.push(evaluateResourceClipAtTime(parentClip, timelineTimeMs, parentResource, reference));
    parentId = parentClip.parentClipId;
  }

  chain.reverse();
  return chain;
};

/**
 * 采样指定片段（单个弹幕或嵌套分组）在局部时刻 `localTimeMs` 需要渲染的弹幕快照列表（按 zIndex 升序）。
 */
export const sampleClipDanmusAtTime = (params: {
  clip: TimelineClip;
  localTimeMs: number;
  resourcesById: ReadonlyMap<string, AnyDanmu>;
  allClipsById?: ReadonlyMap<string, TimelineResourceClip>;
  reference: CoordinateReferenceSize;
  audioResourceIds?: ReadonlySet<string>;
}): FilmstripDanmuItem[] => {
  const { clip, localTimeMs, resourcesById, allClipsById, reference, audioResourceIds } = params;

  if (clip.kind === "resource") {
    if (audioResourceIds?.has(clip.resourceId)) return [];
    const resource = resourcesById.get(clip.resourceId);
    if (!resource) return [];
    const timelineTimeMs = clip.startTime + localTimeMs;
    const danmu = evaluateResourceClipAtTime(clip, timelineTimeMs, resource, reference);
    const parentChain = resolveParentChain(clip, timelineTimeMs, resourcesById, allClipsById, reference);
    return [{ danmu, parentChain }];
  }

  const flattened = flattenTimelineClips(clip.tracks, 0).filter(
    child => !audioResourceIds?.has(child.resourceId)
  );
  if (!flattened.length) return [];

  const groupClipsById = new Map<string, TimelineResourceClip>(flattened.map(child => [child.id, child]));
  const items: Array<{ item: FilmstripDanmuItem; zIndex: number; order: number }> = [];

  for (let index = 0; index < flattened.length; index += 1) {
    const child = flattened[index]!;
    const endTime = child.startTime + child.duration;
    const isActive =
      child.duration > 0
        ? localTimeMs >= child.startTime && localTimeMs <= endTime
        : Math.abs(localTimeMs - child.startTime) <= 0.5;
    if (!isActive) continue;

    const resource = resourcesById.get(child.resourceId);
    if (!resource) continue;

    const danmu = evaluateResourceClipAtTime(child, localTimeMs, resource, reference);
    const parentChain = resolveParentChain(child, localTimeMs, resourcesById, groupClipsById, reference);
    items.push({
      item: { danmu, parentChain },
      zIndex: typeof danmu.zIndex === "number" && Number.isFinite(danmu.zIndex) ? danmu.zIndex : 0,
      order: index
    });
  }

  items.sort((a, b) => a.zIndex - b.zIndex || a.order - b.order);
  return items.map(entry => entry.item);
};
