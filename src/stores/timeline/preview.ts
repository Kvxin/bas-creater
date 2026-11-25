import { ref } from "vue";
import type { TimelineClip, TimelineClipParams } from "@/types/timeline";
import type { TimelineStoreContext } from "./context";

export const createTimelinePreview = (ctx: TimelineStoreContext) => {
  const { findClipLocation } = ctx;

  // ============================================================
  // 预览系统（Preview System）
  // 用于非破坏性编辑：拖动音量线等操作时不写入历史，
  // 只在松手后统一提交。
  // ============================================================

  /** 预览覆盖层：clipId -> 临时参数覆盖 */
  const previewOverlay = ref<Map<string, TimelineClipParams>>(new Map());

  /** 应用预览覆盖（不写入历史） */
  const previewClipParams = (clipId: string, patch: TimelineClipParams) => {
    const existing = previewOverlay.value.get(clipId) ?? {};
    previewOverlay.value = new Map(previewOverlay.value).set(clipId, {
      ...existing,
      ...patch,
    });
  };

  /** 提交预览：将预览值写入真实的 clip 参数 */
  const commitPreview = () => {
    for (const [clipId, patch] of previewOverlay.value) {
      const location = findClipLocation(clipId);
      if (location?.clip.kind === "resource") {
        const params = location.clip.params ?? {};
        location.clip.params = { ...params, ...patch };
      }
    }
    previewOverlay.value = new Map();
  };

  /** 丢弃预览：清空所有预览覆盖 */
  const discardPreview = () => {
    previewOverlay.value = new Map();
  };

  /** 获取 clip 的有效参数（预览优先） */
  const getEffectiveParams = (clip: TimelineClip): TimelineClipParams => {
    const preview = previewOverlay.value.get(clip.id);
    const base = clip.params ?? {};
    if (!preview) return base;
    return { ...base, ...preview };
  };

  /** 获取 clip 的有效音量（dB），考虑预览和静音 */
  const getEffectiveVolume = (clip: TimelineClip): number => {
    const params = getEffectiveParams(clip);
    return params.volume ?? 0;
  };

  /** 获取 clip 是否被静音 */
  const isClipMuted = (clip: TimelineClip): boolean => {
    const params = getEffectiveParams(clip);
    return params.muted === true;
  };

  /** 更新 clip 的音量 */
  const updateClipVolume = (clipId: string, volume: number) => {
    const location = findClipLocation(clipId);
    if (location?.clip.kind === "resource") {
      const params = location.clip.params ?? {};
      location.clip.params = { ...params, volume };
    }
  };

  /** 切换 clip 的静音状态 */
  const toggleClipMuted = (clipId: string) => {
    const location = findClipLocation(clipId);
    if (location?.clip.kind === "resource") {
      const params = location.clip.params ?? {};
      location.clip.params = { ...params, muted: !params.muted };
    }
  };

  return { previewOverlay, previewClipParams, commitPreview, discardPreview, getEffectiveParams, getEffectiveVolume, isClipMuted, updateClipVolume, toggleClipMuted };
};
