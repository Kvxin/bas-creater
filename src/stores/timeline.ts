import { defineStore } from "pinia";
import { ref } from "vue";
import type {
  TimelineTrack,
  TimelineClip,
  AnimationSegment,
  TimelineTrackType,
  TimelineKeyframe,
  TimelineKeyframeProperties,
  TimelineClipParams,
} from "@/types/timeline";
import type { AnyDanmu } from "@/types/danmu";
import type { AudioResource } from "@/types/resource";
import { getItemName } from "@/utils/resourceUtils";
import {
  BASE_KEYFRAME_ID,
  KEYFRAME_TOLERANCE_MS,
  clampKeyframeTime,
  createKeyframeId,
  normalizeKeyframes,
  pickKeyframeProperties,
} from "@/utils/keyframes";

export const useTimelineStore = defineStore("timeline", () => {
  const tracks = ref<TimelineTrack[]>([
    {
      id: "track_1",
      name: "轨道 1",
      clips: [],
      visible: true,
      muted: false,
      locked: false,
    },
  ]);

  const currentTime = ref(0);
  const isPlaying = ref(false);
  const duration = ref(0);
  const zoomScale = ref(50);
  const selectedClipId = ref<string | null>(null);
  const selectedAnimationId = ref<string | null>(null);
  const selectedKeyframeId = ref<string | null>(null);
  const autoKeyframe = ref(true);

  // ============================================================
  // 剪贴板系统（Clipboard System）
  // 用于轨道的复制/粘贴功能
  // ============================================================

  interface ClipboardData {
    clipData: Omit<TimelineClip, "id" | "trackId">;
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
    const { id: _id, trackId: _trackId, ...rest } = JSON.parse(JSON.stringify(clip));
    clipboardClip.value = { clipData: rest, trackType };
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
    if (!track) {
      console.warn(`[TimelineStore] 目标轨道不存在: ${trackId}`);
      return null;
    }

    const { clipData: source, trackType: sourceTrackType } = clipboardClip.value;

    // 检查轨道类型兼容性
    if (track.clips.length > 0 && track.type && sourceTrackType && track.type !== sourceTrackType) {
      console.warn(
        `[TimelineStore] 无法将 ${sourceTrackType} 片段粘贴到 ${track.type} 轨道`
      );
      return null;
    }

    // 深拷贝剪贴板数据
    const clipData: any = JSON.parse(JSON.stringify(source));

    // 为动画片段生成新 ID
    if (clipData.animations) {
      clipData.animations = clipData.animations.map((anim: AnimationSegment) => ({
        ...anim,
        id: `anim_${Math.random().toString(36).slice(2, 9)}`,
      }));
    }

    // 为关键帧生成新 ID
    if (clipData.keyframes) {
      clipData.keyframes = clipData.keyframes.map((kf: TimelineKeyframe) => ({
        ...kf,
        id: `kf_${Math.random().toString(36).slice(2, 9)}`,
      }));
    }

    const newClip: TimelineClip = {
      ...clipData,
      id: `clip_${Math.random().toString(36).slice(2, 9)}`,
      trackId,
      startTime: Math.max(0, startTime),
    };

    // 确保轨道类型匹配
    if (!track.type && sourceTrackType) {
      applyTrackType(track, sourceTrackType);
    }

    track.clips.push(newClip);
    track.clips.sort((a, b) => a.startTime - b.startTime);
    recalculateDuration();
    selectedClipId.value = newClip.id;
    selectedAnimationId.value = null;
    selectedKeyframeId.value = BASE_KEYFRAME_ID;

    console.log(`[TimelineStore] 已粘贴片段到轨道 ${track.name}:`, newClip);
    return newClip;
  };

  /** 清空剪贴板 */
  const clearClipboard = () => {
    clipboardClip.value = null;
  };

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
      if (location) {
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
    if (location) {
      const params = location.clip.params ?? {};
      location.clip.params = { ...params, volume };
    }
  };

  /** 切换 clip 的静音状态 */
  const toggleClipMuted = (clipId: string) => {
    const location = findClipLocation(clipId);
    if (location) {
      const params = location.clip.params ?? {};
      location.clip.params = { ...params, muted: !params.muted };
    }
  };

  const getResourceTrackType = (resource: AnyDanmu | AudioResource): TimelineTrackType => {
    return resource.type === "audio-file" ? "audio" : "danmu";
  };

  const applyTrackType = (track: TimelineTrack, type: TimelineTrackType) => {
    track.type = type;
    if (type === "audio") {
      track.visible = true;
    } else {
      track.muted = false;
    }
  };

  const clearTrackTypeIfEmpty = (track: TimelineTrack) => {
    if (track.clips.length === 0) {
      track.type = undefined;
      track.visible = true;
      track.muted = false;
    }
  };

  const findClipLocation = (clipId: string) => {
    for (const track of tracks.value) {
      const clipIndex = track.clips.findIndex((clip) => clip.id === clipId);
      if (clipIndex !== -1) {
        const clip = track.clips[clipIndex];
        if (!clip) continue;

        return {
          track,
          clip,
          clipIndex,
        };
      }
    }

    return null;
  };

  const applyClipUpdates = (clip: TimelineClip, updates: Partial<TimelineClip>) => {
    const {
      trackId: _ignoredTrackId,
      startTime,
      duration: clipDuration,
      ...rest
    } = updates;

    Object.assign(clip, rest);

    if (startTime !== undefined) {
      clip.startTime = Math.max(0, startTime);
    }

    if (clipDuration !== undefined) {
      clip.duration = Math.max(0, clipDuration);
      clip.keyframes = normalizeKeyframes(clip.keyframes, clip.duration);
    }
  };

  const getClipEndTime = (clip: TimelineClip) => {
    const startTime = Number.isFinite(clip.startTime) ? Math.max(0, clip.startTime) : 0;
    const clipDuration = Number.isFinite(clip.duration) ? Math.max(0, clip.duration) : 0;
    return startTime + clipDuration;
  };

  const recalculateDuration = () => {
    duration.value = tracks.value.reduce((maxEnd, track) => {
      return track.clips.reduce(
        (trackMaxEnd, clip) => Math.max(trackMaxEnd, getClipEndTime(clip)),
        maxEnd
      );
    }, 0);

    currentTime.value = Math.max(0, Math.min(currentTime.value, duration.value));
  };

  // 添加新轨道
  const addTrack = (name?: string, type?: TimelineTrackType) => {
    const id = `track_${Math.random().toString(36).slice(2, 9)}`;
    tracks.value.push({
      id,
      name: name || `轨道 ${tracks.value.length + 1}`,
      type,
      clips: [],
      visible: true,
      muted: false,
      locked: false,
      expanded: false,
    });
    return id;
  };

  // 移除轨道
  const removeTrack = (trackId: string) => {
    const index = tracks.value.findIndex((t) => t.id === trackId);
    if (index !== -1) {
      const removedTrack = tracks.value[index];
      if (removedTrack?.clips.some((clip) => clip.id === selectedClipId.value)) {
        selectedClipId.value = null;
        selectedAnimationId.value = null;
        selectedKeyframeId.value = null;
      }
      tracks.value.splice(index, 1);
      recalculateDuration();
    }
  };

  // 添加片段
  // resource: 拖入的资源
  // trackId: 目标轨道 ID
  // time: 插入的时间点 (ms)
  const addClip = (resource: AnyDanmu | AudioResource, trackId: string, time: number) => {
    const track = tracks.value.find((t) => t.id === trackId);
    if (!track) {
      console.warn(`[TimelineStore] Track not found: ${trackId}`);
      return;
    }

    const resourceType = getResourceTrackType(resource);
    if (track.clips.length > 0 && track.type && track.type !== resourceType) {
      console.warn(
        `[TimelineStore] Cannot add ${resourceType} clip to ${track.type} track: ${trackId}`
      );
      return;
    }
    if (!track.type || track.clips.length === 0) {
      applyTrackType(track, resourceType);
    }

    let clipDuration = 5000;
    if ("durationMs" in resource && resource.durationMs) {
      clipDuration = resource.durationMs;
    } else if ("duration" in resource && resource.duration) {
      clipDuration = resource.duration;
    }

    const newClip: TimelineClip = {
      id: `clip_${Math.random().toString(36).slice(2, 9)}`,
      resourceId: resource.id,
      name: getItemName(resource),
      startTime: time,
      duration: clipDuration,
      trackId: trackId,
      animations: [],
      keyframes: [],
      params: resourceType === "audio" ? { volume: 0, muted: false } : undefined,
    };

    track.clips.push(newClip);
    // 简单的排序，保证片段按时间顺序排列
    track.clips.sort((a, b) => a.startTime - b.startTime);
    recalculateDuration();

    console.log("[TimelineStore] Added clip:", newClip);
    selectedClipId.value = newClip.id;
    selectedAnimationId.value = null;
    selectedKeyframeId.value = BASE_KEYFRAME_ID;
    return newClip;
  };

  // 移除片段
  const removeClip = (clipId: string) => {
    for (const track of tracks.value) {
      const index = track.clips.findIndex((c) => c.id === clipId);
      if (index !== -1) {
        if (selectedClipId.value === clipId) {
          selectedClipId.value = null;
          selectedAnimationId.value = null;
          selectedKeyframeId.value = null;
        }
        track.clips.splice(index, 1);
        clearTrackTypeIfEmpty(track);
        recalculateDuration();
        return;
      }
    }
  };

  // 根据 resourceId 移除片段
  const removeClipsByResourceId = (resourceId: string) => {
    let changed = false;
    for (const track of tracks.value) {
      for (let i = track.clips.length - 1; i >= 0; i--) {
        const clip = track.clips[i];
        if (clip && clip.resourceId === resourceId) {
          if (selectedClipId.value === clip.id) {
            selectedClipId.value = null;
            selectedAnimationId.value = null;
            selectedKeyframeId.value = null;
          }
          track.clips.splice(i, 1);
          changed = true;
        }
      }
      clearTrackTypeIfEmpty(track);
    }
    if (changed) recalculateDuration();
  };

  // 更新片段
  const updateClip = (clipId: string, updates: Partial<TimelineClip>) => {
    for (const track of tracks.value) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) {
        applyClipUpdates(clip, updates);
        
        // 如果更新了时间，重新排序
        if (updates.startTime !== undefined || updates.duration !== undefined) {
             track.clips.sort((a, b) => a.startTime - b.startTime);
             recalculateDuration();
        }
        return;
      }
    }
  };

  const moveClipToTrack = (
    clipId: string,
    targetTrackId: string,
    updates: Partial<TimelineClip> = {},
    options: {
      clipType?: TimelineTrackType;
      targetTrackType?: TimelineTrackType | null;
    } = {}
  ) => {
    const location = findClipLocation(clipId);
    if (!location) {
      console.warn(`[TimelineStore] Clip not found: ${clipId}`);
      return false;
    }

    const targetTrack = tracks.value.find((track) => track.id === targetTrackId);
    if (!targetTrack) {
      console.warn(`[TimelineStore] Track not found: ${targetTrackId}`);
      return false;
    }

    const { track: sourceTrack, clip, clipIndex } = location;
    const clipType = sourceTrack.type ?? options.clipType;

    if (!clipType) {
      console.warn(`[TimelineStore] Cannot move clip without a resolved track type: ${clipId}`);
      return false;
    }

    if (sourceTrack.id === targetTrack.id) {
      applyClipUpdates(clip, updates);
      sourceTrack.clips.sort((a, b) => a.startTime - b.startTime);
      recalculateDuration();
      return true;
    }

    const targetType = targetTrack.type ?? options.targetTrackType ?? null;
    const targetHasClips = targetTrack.clips.length > 0;

    if (targetType && targetType !== clipType) {
      console.warn(
        `[TimelineStore] Cannot move ${clipType} clip to ${targetType} track: ${targetTrackId}`
      );
      return false;
    }

    if (targetHasClips && !targetType) {
      console.warn(`[TimelineStore] Cannot move clip to an ambiguous track: ${targetTrackId}`);
      return false;
    }

    sourceTrack.clips.splice(clipIndex, 1);
    applyClipUpdates(clip, updates);
    clip.trackId = targetTrackId;

    if (!targetTrack.type) {
      applyTrackType(targetTrack, clipType);
    }

    targetTrack.clips.push(clip);
    targetTrack.clips.sort((a, b) => a.startTime - b.startTime);
    clearTrackTypeIfEmpty(sourceTrack);
    recalculateDuration();

    return true;
  };

  /**
   * 复制片段到目标轨道（Alt+拖拽跨轨道复制）
   * 深拷贝源片段数据，生成新 ID，插入到目标轨道，保留原始片段不变
   */
  const copyClipToTrack = (
    sourceClipId: string,
    targetTrackId: string,
    updates: Partial<TimelineClip> = {}
  ): TimelineClip | null => {
    const location = findClipLocation(sourceClipId);
    if (!location) {
      console.warn(`[TimelineStore] Source clip not found for copy: ${sourceClipId}`);
      return null;
    }

    const targetTrack = tracks.value.find((t) => t.id === targetTrackId);
    if (!targetTrack) {
      console.warn(`[TimelineStore] Target track not found for copy: ${targetTrackId}`);
      return null;
    }

    const { track: sourceTrack, clip: sourceClip } = location;
    const clipType = sourceTrack.type;

    // 类型兼容性检查 (同轨道复制无需检查，跨轨道才需要)
    if (sourceTrack.id !== targetTrackId) {
      const targetType = targetTrack.type;
      if (targetType && clipType && targetType !== clipType) {
        console.warn(
          `[TimelineStore] Cannot copy ${clipType} clip to ${targetType} track: ${targetTrackId}`
        );
        return null;
      }
      if (targetTrack.clips.length > 0 && !targetType) {
        console.warn(`[TimelineStore] Cannot copy clip to ambiguous track: ${targetTrackId}`);
        return null;
      }
    }

    // 深拷贝源片段，剥离 id 和 trackId
    const sourceData = JSON.parse(JSON.stringify(sourceClip));
    const { id: _id, trackId: _trackId, ...rest } = sourceData;

    // 为嵌套结构生成新 ID
    if (rest.animations) {
      rest.animations = rest.animations.map((anim: AnimationSegment) => ({
        ...anim,
        id: `anim_${Math.random().toString(36).slice(2, 9)}`,
      }));
    }
    if (rest.keyframes) {
      rest.keyframes = rest.keyframes.map((kf: TimelineKeyframe) => ({
        ...kf,
        id: `kf_${Math.random().toString(36).slice(2, 9)}`,
      }));
    }

    const newClip: TimelineClip = {
      ...rest,
      id: `clip_${Math.random().toString(36).slice(2, 9)}`,
      trackId: targetTrackId,
      resourceId: updates.resourceId ?? sourceClip.resourceId,
      name: updates.name ?? sourceClip.name,
      startTime: Math.max(0, updates.startTime ?? sourceClip.startTime),
    };

    if (updates.duration !== undefined) {
      newClip.duration = Math.max(0, updates.duration);
    }

    // 确保目标轨道有类型
    if (!targetTrack.type && clipType) {
      applyTrackType(targetTrack, clipType);
    }

    targetTrack.clips.push(newClip);
    targetTrack.clips.sort((a, b) => a.startTime - b.startTime);
    recalculateDuration();

    selectedClipId.value = newClip.id;
    selectedAnimationId.value = null;
    selectedKeyframeId.value = BASE_KEYFRAME_ID;

    console.log(
      `[TimelineStore] Copied clip "${sourceClip.name || sourceClip.id}" to track "${targetTrack.name}"`
    );
    return newClip;
  };

  // 更新当前时间
  const setCurrentTime = (time: number) => {
    currentTime.value = Math.max(0, Math.min(time, duration.value));
  };

  const setSelectedClip = (id: string | null) => {
      if (selectedClipId.value !== id) {
          selectedAnimationId.value = null;
          selectedKeyframeId.value = null;
      }
      selectedClipId.value = id;
      if (id === null) {
          selectedAnimationId.value = null;
          selectedKeyframeId.value = null;
      }
  }

  const setSelectedAnimation = (id: string | null) => {
    selectedAnimationId.value = id;
    if (id) {
      selectedKeyframeId.value = null;
    }
  }

  const setSelectedKeyframe = (id: string | null) => {
    selectedKeyframeId.value = id;
    if (id) {
      selectedAnimationId.value = null;
    }
  }

  const setAutoKeyframe = (enabled: boolean) => {
    autoKeyframe.value = enabled;
  }

  const toggleTrackExpand = (trackId: string) => {
    const track = tracks.value.find((t) => t.id === trackId);
    if (track) {
      track.expanded = !track.expanded;
    }
  }

  const toggleTrackVisibility = (trackId: string) => {
    const track = tracks.value.find((t) => t.id === trackId);
    if (track && track.type !== "audio") {
      track.visible = !track.visible;
    }
  }

  const toggleTrackMute = (trackId: string) => {
    const track = tracks.value.find((t) => t.id === trackId);
    if (track && track.type === "audio") {
      track.muted = !track.muted;
    }
  }

  // 动画管理
  const addClipAnimation = (clipId: string, animation: AnimationSegment) => {
    for (const track of tracks.value) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip) {
        if (!clip.animations) clip.animations = [];
        clip.animations.push(animation);
        return;
      }
    }
  }

  const insertClipAnimation = (clipId: string, index: number, animation: AnimationSegment) => {
    for (const track of tracks.value) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip) {
        if (!clip.animations) clip.animations = [];
        // Ensure index is valid
        if (index < 0) index = 0;
        if (index > clip.animations.length) index = clip.animations.length;
        
        clip.animations.splice(index, 0, animation);
        return;
      }
    }
  }

  const removeClipAnimation = (clipId: string, animationId: string) => {
    for (const track of tracks.value) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip && clip.animations) {
        const idx = clip.animations.findIndex(a => a.id === animationId);
        if (idx !== -1) {
          clip.animations.splice(idx, 1);
          if (selectedAnimationId.value === animationId) {
            selectedAnimationId.value = null;
          }
        }
        return;
      }
    }
  }

  const updateClipAnimation = (clipId: string, animationId: string, updates: Partial<AnimationSegment>) => {
    for (const track of tracks.value) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip && clip.animations) {
        const animation = clip.animations.find(a => a.id === animationId);
        if (animation) {
          Object.assign(animation, updates);
        }
        return;
      }
    }
  }

  const addClipKeyframe = (
    clipId: string,
    keyframe: Omit<TimelineKeyframe, "id"> & { id?: string },
    options: { select?: boolean } = {}
  ) => {
    const location = findClipLocation(clipId);
    if (!location) return null;

    const nextKeyframe: TimelineKeyframe = {
      ...keyframe,
      id: keyframe.id ?? createKeyframeId(),
      timeMs: clampKeyframeTime(keyframe.timeMs, location.clip.duration),
      interpolation: keyframe.interpolation ?? "linear",
      properties: pickKeyframeProperties(keyframe.properties),
    };

    if (nextKeyframe.timeMs <= 0) {
      selectedClipId.value = clipId;
      selectedKeyframeId.value = BASE_KEYFRAME_ID;
      selectedAnimationId.value = null;
      return null;
    }

    if (!location.clip.keyframes) location.clip.keyframes = [];
    location.clip.keyframes.push(nextKeyframe);
    location.clip.keyframes = normalizeKeyframes(location.clip.keyframes, location.clip.duration);

    if (options.select !== false) {
      selectedClipId.value = clipId;
      selectedKeyframeId.value = nextKeyframe.id;
      selectedAnimationId.value = null;
    }

    return nextKeyframe;
  }

  const upsertClipKeyframeAtTime = (
    clipId: string,
    timeMs: number,
    properties: TimelineKeyframeProperties,
    options: { select?: boolean; toleranceMs?: number } = {}
  ) => {
    const location = findClipLocation(clipId);
    if (!location) return null;

    const clampedTime = clampKeyframeTime(timeMs, location.clip.duration);
    if (clampedTime <= 0) {
      selectedClipId.value = clipId;
      selectedKeyframeId.value = BASE_KEYFRAME_ID;
      selectedAnimationId.value = null;
      return null;
    }

    if (!location.clip.keyframes) location.clip.keyframes = [];

    const toleranceMs = options.toleranceMs ?? KEYFRAME_TOLERANCE_MS;
    const existing = location.clip.keyframes.find((keyframe) => {
      const existingTime = clampKeyframeTime(keyframe.timeMs, location.clip.duration);
      return Math.abs(existingTime - clampedTime) <= toleranceMs;
    });

    if (existing) {
      existing.timeMs = clampedTime;
      existing.properties = pickKeyframeProperties({
        ...existing.properties,
        ...properties,
      });
      location.clip.keyframes = normalizeKeyframes(location.clip.keyframes, location.clip.duration);

      if (options.select !== false) {
        selectedClipId.value = clipId;
        selectedKeyframeId.value = existing.id;
        selectedAnimationId.value = null;
      }

      return existing;
    }

    return addClipKeyframe(
      clipId,
      {
        timeMs: clampedTime,
        properties,
        interpolation: "linear",
      },
      options
    );
  }

  const updateClipKeyframe = (
    clipId: string,
    keyframeId: string,
    updates: Partial<TimelineKeyframe>
  ) => {
    const location = findClipLocation(clipId);
    if (!location?.clip.keyframes || keyframeId === BASE_KEYFRAME_ID) return;

    const keyframe = location.clip.keyframes.find((item) => item.id === keyframeId);
    if (!keyframe) return;

    if (updates.timeMs !== undefined) {
      const clampedTime = clampKeyframeTime(updates.timeMs, location.clip.duration);
      keyframe.timeMs = location.clip.duration > 0 ? Math.max(1, clampedTime) : 0;
    }
    if (updates.properties !== undefined) {
      keyframe.properties = pickKeyframeProperties(updates.properties);
    }
    if (updates.interpolation !== undefined) {
      keyframe.interpolation = updates.interpolation;
    }
    if (updates.easing !== undefined) {
      keyframe.easing = updates.easing;
    }

    location.clip.keyframes = normalizeKeyframes(location.clip.keyframes, location.clip.duration);
  }

  const removeClipKeyframe = (clipId: string, keyframeId: string) => {
    const location = findClipLocation(clipId);
    if (!location?.clip.keyframes || keyframeId === BASE_KEYFRAME_ID) return;

    const index = location.clip.keyframes.findIndex((item) => item.id === keyframeId);
    if (index === -1) return;

    location.clip.keyframes.splice(index, 1);
    if (selectedKeyframeId.value === keyframeId) {
      selectedKeyframeId.value = BASE_KEYFRAME_ID;
    }
  }

  return {
    tracks,
    currentTime,
    isPlaying,
    duration,
    zoomScale,
    selectedClipId,
    selectedAnimationId,
    selectedKeyframeId,
    autoKeyframe,
    addTrack,
    removeTrack,
    addClip,
    removeClip,
    removeClipsByResourceId,
    updateClip,
    moveClipToTrack,
    copyClipToTrack,
    setCurrentTime,
    setSelectedClip,
    setSelectedAnimation,
    setSelectedKeyframe,
    setAutoKeyframe,
    toggleTrackExpand,
    toggleTrackVisibility,
    toggleTrackMute,
    // 预览系统
    previewOverlay,
    previewClipParams,
    commitPreview,
    discardPreview,
    getEffectiveParams,
    getEffectiveVolume,
    isClipMuted,
    updateClipVolume,
    toggleClipMuted,
    addClipAnimation,
    insertClipAnimation,
    removeClipAnimation,
    updateClipAnimation,
    addClipKeyframe,
    upsertClipKeyframeAtTime,
    updateClipKeyframe,
    removeClipKeyframe,
    // 剪贴板
    clipboardClip,
    hasClipboardClip,
    copyClipToClipboard,
    pasteClipFromClipboard,
    clearClipboard,
  };
});
