import { ref } from "vue";
import type { TimelineClip, TimelineTrackType } from "@/types/timeline";
import { BASE_KEYFRAME_ID } from "@/core/keyframes";
import { applyTrackType, cloneClip } from "@/core/timelineTracks";
import type { TimelineStoreContext } from "./context";

export const createTimelineClipboard = (ctx: TimelineStoreContext) => {
  const { tracks, activeGroupPath, selectedKeyframeId, findClipLocation, recalculateDuration, setSelectedClip } = ctx;

  // ============================================================
  // 剪贴板系统（Clipboard System）
  // 用于轨道的复制/粘贴功能
  // ============================================================

  interface ClipboardData {
    clipData: TimelineClip;
    /** 原始轨道类型（复制时记录，粘贴时用于类型兼容性检查） */
    trackType: TimelineTrackType | undefined;
  }

  /** 剪贴板中存储的片段数据 */
  const clipboardClip = ref<ClipboardData | null>(null);

  /** 是否有可粘贴的片段 */
  const hasClipboardClip = () => clipboardClip.value !== null;

  /**
   * 将片段复制到剪贴板
   * 深拷贝片段数据，剥离 id 和 trackId，同时记录轨道类型
   */
  const copyClipToClipboard = (clip: TimelineClip) => {
    const location = findClipLocation(clip.id);
    const trackType = location?.track.type;
    clipboardClip.value = {
      clipData: JSON.parse(JSON.stringify(clip)),
      trackType: clip.kind === "group" ? "danmu" : trackType
    };
    console.log(`[TimelineStore] 已复制片段到剪贴板: ${clip.name || clip.id}`);
  };

  /**
   * 从剪贴板粘贴片段到指定轨道
   * 自动为所有嵌套结构生成新的 ID
   */
  const pasteClipFromClipboard = (trackId: string, startTime: number): TimelineClip | null => {
    if (!clipboardClip.value) {
      console.warn("[TimelineStore] 剪贴板为空，无法粘贴");
      return null;
    }

    const track = tracks.value.find((t) => t.id === trackId);
    if (!track || track.locked) {
      console.warn(`[TimelineStore] 目标轨道不存在: ${trackId}`);
      return null;
    }

    const { clipData: source, trackType: sourceTrackType } = clipboardClip.value;
    if (activeGroupPath.value.length && sourceTrackType === "audio") return null;

    // 检查轨道类型兼容性
    if (track.clips.length > 0 && track.type && sourceTrackType && track.type !== sourceTrackType) {
      console.warn(
        `[TimelineStore] 无法将 ${sourceTrackType} 片段粘贴到 ${track.type} 轨道`
      );
      return null;
    }

    // 深拷贝剪贴板数据
    const newClip = cloneClip(source, trackId);
    newClip.startTime = Math.max(0, startTime);

    // 确保轨道类型匹配
    if (!track.type && sourceTrackType) {
      applyTrackType(track, sourceTrackType);
    }

    track.clips.push(newClip);
    track.clips.sort((a, b) => a.startTime - b.startTime);
    recalculateDuration();
    setSelectedClip(newClip.id);
    selectedKeyframeId.value = BASE_KEYFRAME_ID;

    console.log(`[TimelineStore] 已粘贴片段到轨道 ${track.name}:`, newClip);
    return newClip;
  };

  /** 清空剪贴板 */
  const clearClipboard = () => {
    clipboardClip.value = null;
  };

  return { clipboardClip, hasClipboardClip, copyClipToClipboard, pasteClipFromClipboard, clearClipboard };
};
