import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  TimelineTrack,
  TimelineClip,
  AnimationSegment,
  TimelineTrackType,
  TimelineKeyframe,
  TimelineKeyframeProperties,
  TimelineClipParams,
  TimelineGroupClip,
} from "@/types/timeline";
import type { AnyDanmu } from "@/types/danmu";
import type { AudioResource } from "@/types/resource";
import { useAudioStore } from "@/stores/audio";
import { i18n } from "@/i18n";
import { getItemName } from "@/utils/resourceUtils";
import { useDanmuStore } from "@/stores/danmu";
import { splitClipAnimation } from "@/utils/splitClip";
import { createTimelineId, getTimelineDuration, updateGroupDurations, visitTimelineClips } from "@/utils/timelineGroups";
import {
  BASE_KEYFRAME_ID,
  KEYFRAME_TOLERANCE_MS,
  clampKeyframeTime,
  createKeyframeId,
  normalizeKeyframes,
  pickKeyframeProperties,
} from "@/utils/keyframes";

export const useTimelineStore = defineStore("timeline", () => {
  // 默认轨道名是真实数据：创建时按当前语言生成快照，切换语言不会重写已有轨道名。
  const rootTracks = ref<TimelineTrack[]>([
    {
      id: "track_1",
      name: i18n.global.t("timeline.defaultTrackName", { n: 1 }),
      clips: [],
      visible: true,
      muted: false,
      locked: false,
    },
  ]);

  const activeGroupPath = ref<string[]>([]);
  const activeGroups = computed(() => {
    const groups: TimelineGroupClip[] = [];
    let scope = rootTracks.value;
    for (const groupId of activeGroupPath.value) {
      const clip = scope.flatMap((track) => track.clips).find((item) => item.id === groupId);
      if (!clip || clip.kind !== "group") break;
      groups.push(clip);
      scope = clip.tracks;
    }
    return groups;
  });
  const activeTracks = computed<TimelineTrack[]>(() => {
    const groups = activeGroups.value;
    return groups[groups.length - 1]?.tracks ?? rootTracks.value;
  });
  const tracks = activeTracks;
  const rootDuration = computed(() => getTimelineDuration(rootTracks.value));
  const duration = computed(() => getTimelineDuration(tracks.value));
  const currentTime = ref(0);
  const isPlaying = ref(false);
  const zoomScale = ref(50);
  const selectedClipIds = ref<string[]>([]);
  const primarySelectedClipId = ref<string | null>(null);
  const selectedClipId = computed({
    get: () => primarySelectedClipId.value,
    set: (id: string | null) => {
      primarySelectedClipId.value = id;
      if (!id) selectedClipIds.value = [];
      else if (!selectedClipIds.value.includes(id)) selectedClipIds.value = [id];
    }
  });
  const selectedAnimationId = ref<string | null>(null);
  const selectedKeyframeId = ref<string | null>(null);
  const autoKeyframe = ref(true);
  const navigationRevision = ref(0);
  const timelineScroll = ref({ left: 0, top: 0 });
  const viewStates = new Map<string, { zoom: number; left: number; top: number }>();

  // ============================================================
  // 剪贴板系统（Clipboard System）
  // 用于轨道的复制/粘贴功能
  // ============================================================

  interface ClipboardData {
    clipData: TimelineClip;
    resources: AnyDanmu[];
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
    const resources = clip.kind === "group"
      ? collectGroupResources(clip)
      : useDanmuStore().danmus.filter((resource) => resource.id === clip.resourceId);
    clipboardClip.value = {
      clipData: JSON.parse(JSON.stringify(clip)),
      resources: JSON.parse(JSON.stringify(resources)),
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
    const newClip = cloneClip(source, trackId, clipboardClip.value.resources);
    newClip.startTime = Math.max(0, startTime);

    // 确保轨道类型匹配
    if (!track.type && sourceTrackType) {
      applyTrackType(track, sourceTrackType);
    }

    track.clips.push(newClip);
    track.clips.sort((a, b) => a.startTime - b.startTime);
    recalculateDuration();
    setSelectedClip(newClip.id);
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
    if (clip.kind === "group") {
      if (updates.name !== undefined) clip.name = updates.name;
      if (updates.startTime !== undefined && Number.isFinite(updates.startTime)) {
        clip.startTime = Math.max(0, updates.startTime);
      }
      return;
    }
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
    updateGroupDurations(rootTracks.value);
    if (activeGroups.value.length !== activeGroupPath.value.length) {
      activeGroupPath.value = activeGroups.value.map((group) => group.id);
      clearEditingState();
      navigationRevision.value += 1;
    }
    const validIds = new Set(tracks.value.flatMap((track) => track.clips.map((clip) => clip.id)));
    setSelectedClips(selectedClipIds.value.filter((id) => validIds.has(id)), selectedClipId.value);
    currentTime.value = Math.max(0, Math.min(currentTime.value, duration.value));
  };

  // 添加新轨道
  const addTrack = (name?: string, type?: TimelineTrackType) => {
    if (activeGroupPath.value.length && type === "audio") return null;
    const id = `track_${Math.random().toString(36).slice(2, 9)}`;
    tracks.value.push({
      id,
      name: name || i18n.global.t("timeline.defaultTrackName", { n: tracks.value.length + 1 }),
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
    if (tracks.value.find((track) => track.id === trackId)?.locked) return;
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
    if (!track || track.locked) {
      console.warn(`[TimelineStore] Track not found: ${trackId}`);
      return;
    }

    const resourceType = getResourceTrackType(resource);
    if (activeGroupPath.value.length && resourceType === "audio") return;
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
      kind: "resource",
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
    setSelectedClip(newClip.id);
    selectedAnimationId.value = null;
    selectedKeyframeId.value = BASE_KEYFRAME_ID;
    return newClip;
  };

  // 移除片段
  const removeClip = (clipId: string) => {
    if (findClipLocation(clipId)?.track.locked) return;
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
    const removeFromTracks = (scope: TimelineTrack[]) => {
      for (const track of scope) {
        for (let index = track.clips.length - 1; index >= 0; index--) {
          const clip = track.clips[index];
          if (!clip) continue;
          if (clip.kind === "group") removeFromTracks(clip.tracks);
          else if (clip.resourceId === resourceId) track.clips.splice(index, 1);
        }
        clearTrackTypeIfEmpty(track);
      }
    };
    removeFromTracks(rootTracks.value);
    recalculateDuration();
  };

  // 更新片段
  const updateClip = (clipId: string, updates: Partial<TimelineClip>) => {
    for (const track of tracks.value) {
      if (track.locked) continue;
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
    if (sourceTrack.locked || targetTrack.locked) return false;
    const clipType = clip.kind === "group" ? "danmu" : sourceTrack.type ?? options.clipType;
    if (activeGroupPath.value.length && clipType === "audio") return false;

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
   * 判断当前编辑层中的片段是否可以放入目标分组。
   *
   * 仅允许未锁定的非音频片段操作，并拒绝把片段放入自身；调用方可据此
   * 同时控制拖拽高亮、投放结果和快捷操作的可用状态。
   *
   * @param clipId 待移动或复制的片段 ID
   * @param groupId 目标分组 ID
   * @returns 片段可以放入目标分组时返回 true，否则返回 false
   */
  const canMoveClipIntoGroup = (clipId: string | null, groupId: string | null) => {
    if (!clipId || !groupId || clipId === groupId) return false;
    const source = findClipLocation(clipId);
    const target = findClipLocation(groupId);
    if (!source || !target || target.clip.kind !== "group") return false;
    if (source.track.locked || target.track.locked || source.track.type === "audio") return false;
    if (source.clip.kind === "resource" && useAudioStore().audioResources.some((resource) => resource.id === source.clip.resourceId)) {
      return false;
    }
    return true;
  };

  /**
   * 将当前编辑层的片段移动到目标分组。
   *
   * 操作会在分组内部创建新的弹幕轨道，并把片段时间转换为相对分组起点的
   * 局部时间；如果片段早于分组起点，则前移分组及其已有内容以保持绝对时间。
   *
   * @param clipId 待移动的片段 ID
   * @param groupId 目标分组 ID
   * @returns 移动成功时返回 true，校验失败或目标不存在时返回 false
   */
  const moveClipIntoGroup = (clipId: string | null, groupId: string | null) => {
    if (!canMoveClipIntoGroup(clipId, groupId)) return false;
    const source = findClipLocation(clipId!);
    const target = findClipLocation(groupId!);
    if (!source || !target || target.clip.kind !== "group") return false;

    const sourceClip = source.clip;
    const group = target.clip;
    const absoluteStart = sourceClip.startTime;

    // 如果素材早于分组开始时间，整体前移分组内容，保证拖入后绝对时间不变。
    if (absoluteStart < group.startTime) {
      const shift = group.startTime - absoluteStart;
      for (const childTrack of group.tracks) {
        for (const childClip of childTrack.clips) childClip.startTime += shift;
      }
      group.startTime = absoluteStart;
    }

    source.track.clips.splice(source.clipIndex, 1);
    clearTrackTypeIfEmpty(source.track);

    const childTrackId = createTimelineId("track");
    sourceClip.trackId = childTrackId;
    sourceClip.startTime = Math.max(0, absoluteStart - group.startTime);
    group.tracks.push({
      id: childTrackId,
      name: i18n.global.t("timeline.defaultTrackName", { n: group.tracks.length + 1 }),
      type: "danmu",
      clips: [sourceClip],
      visible: target.track.visible,
      muted: false,
      locked: false,
      expanded: false,
    });

    recalculateDuration();
    setSelectedClip(group.id);
    return true;
  };

  /**
   * 将当前编辑层的片段复制到目标分组。
   *
   * 复制会递归克隆分组结构、片段 ID、动画、关键帧和弹幕资源，保证副本与
   * 原片段独立编辑；时间换算规则与移动到分组保持一致。
   *
   * @param clipId 待复制的片段 ID
   * @param groupId 目标分组 ID
   * @returns 复制成功时返回 true，校验失败或目标不存在时返回 false
   */
  const copyClipIntoGroup = (clipId: string | null, groupId: string | null) => {
    if (!canMoveClipIntoGroup(clipId, groupId)) return false;
    const source = findClipLocation(clipId!);
    const target = findClipLocation(groupId!);
    if (!source || !target || target.clip.kind !== "group") return false;

    const group = target.clip;
    const absoluteStart = source.clip.startTime;
    if (absoluteStart < group.startTime) {
      const shift = group.startTime - absoluteStart;
      for (const childTrack of group.tracks) {
        for (const childClip of childTrack.clips) childClip.startTime += shift;
      }
      group.startTime = absoluteStart;
    }

    const childTrackId = createTimelineId("track");
    const resources = source.clip.kind === "group"
      ? collectGroupResources(source.clip)
      : useDanmuStore().danmus.filter((resource) => resource.id === source.clip.resourceId);
    const copiedClip = cloneClip(source.clip, childTrackId, resources);
    copiedClip.startTime = Math.max(0, absoluteStart - group.startTime);
    group.tracks.push({
      id: childTrackId,
      name: i18n.global.t("timeline.defaultTrackName", { n: group.tracks.length + 1 }),
      type: "danmu",
      clips: [copiedClip],
      visible: target.track.visible,
      muted: false,
      locked: false,
      expanded: false,
    });
    recalculateDuration();
    setSelectedClip(group.id);
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
    if (sourceTrack.locked || targetTrack.locked) return null;
    const clipType = sourceClip.kind === "group" ? "danmu" : sourceTrack.type;
    if (activeGroupPath.value.length && clipType === "audio") return null;

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
    const resources = sourceClip.kind === "group"
      ? collectGroupResources(sourceClip)
      : useDanmuStore().danmus.filter((resource) => resource.id === sourceClip.resourceId);
    const newClip = cloneClip(sourceClip, targetTrackId, resources);
    applyClipUpdates(newClip, updates);

    // 确保目标轨道有类型
    if (!targetTrack.type && clipType) {
      applyTrackType(targetTrack, clipType);
    }

    targetTrack.clips.push(newClip);
    targetTrack.clips.sort((a, b) => a.startTime - b.startTime);
    recalculateDuration();

    setSelectedClip(newClip.id);
    selectedAnimationId.value = null;
    selectedKeyframeId.value = BASE_KEYFRAME_ID;

    console.log(
      `[TimelineStore] Copied clip "${sourceClip.name || sourceClip.id}" to track "${targetTrack.name}"`
    );
    return newClip;
  };

  const canSplitClip = (clipId: string | null, timeMs = currentTime.value) => {
    if (!clipId || !Number.isFinite(timeMs)) return false;
    const location = findClipLocation(clipId);
    if (!location || location.clip.kind !== "resource" || location.track.locked || location.track.type === "audio" || selectedClipIds.value.length > 1) return false;
    const { clip } = location;
    const offsetMs = Math.round(timeMs - clip.startTime);
    return Number.isFinite(clip.duration) && offsetMs > 0 && offsetMs < clip.duration &&
      useDanmuStore().danmus.some((resource) => resource.id === clip.resourceId);
  };

  const splitClip = (clipId: string | null, timeMs = currentTime.value): TimelineClip | null => {
    if (!canSplitClip(clipId, timeMs)) return null;
    const { track, clip } = findClipLocation(clipId!)!;
    const danmuStore = useDanmuStore();
    const resource = danmuStore.danmus.find((item) => item.id === clip.resourceId)!;
    if (clip.kind !== "resource") return null;
    const source: typeof clip = JSON.parse(JSON.stringify(clip));
    const offsetMs = Math.round(timeMs - clip.startTime);
    const split = splitClipAnimation(source, resource, offsetMs);
    const rightResource = danmuStore.duplicate(resource.id)!;
    danmuStore.updateDanmu(rightResource.id, split.rightProperties as Partial<AnyDanmu>);

    const rightClip: TimelineClip = {
      ...source,
      id: `clip_${crypto.randomUUID()}`,
      resourceId: rightResource.id,
      name: getItemName(rightResource),
      startTime: clip.startTime + offsetMs,
      duration: clip.duration - offsetMs,
      keyframes: split.rightKeyframes,
      animations: split.rightAnimations
    };
    clip.duration = offsetMs;
    clip.keyframes = split.leftKeyframes;
    clip.animations = split.leftAnimations;
    track.clips.push(rightClip);
    track.clips.sort((a, b) => a.startTime - b.startTime);
    recalculateDuration();
    selectedClipId.value = rightClip.id;
    selectedAnimationId.value = null;
    selectedKeyframeId.value = BASE_KEYFRAME_ID;
    return rightClip;
  };

  const splitClipLeft = (clipId: string | null, timeMs = currentTime.value): TimelineClip | null => {
    const leftClip = clipId ? findClipLocation(clipId)?.clip : undefined;
    const leftResourceId = leftClip?.kind === "resource" ? leftClip.resourceId : undefined;
    const rightClip = splitClip(clipId, timeMs);
    if (!rightClip || !clipId) return null;
    if (rightClip.kind !== "resource") return null;
    removeClip(clipId);
    // 共用资源仍被其他片段引用时，保留它以免影响其他元素。
    let isReferenced = false;
    visitTimelineClips(rootTracks.value, (clip) => {
      if (clip.kind === "resource" && clip.resourceId === leftResourceId) isReferenced = true;
    });
    if (leftResourceId && !isReferenced) {
      useDanmuStore().remove(leftResourceId);
    }
    return rightClip;
  };

  const splitClipRight = (clipId: string | null, timeMs = currentTime.value): TimelineClip | null => {
    const rightClip = splitClip(clipId, timeMs);
    if (!rightClip || !clipId) return null;
    removeClip(rightClip.id);
    if (rightClip.kind === "resource") useDanmuStore().remove(rightClip.resourceId);
    selectedClipId.value = clipId;
    selectedAnimationId.value = null;
    selectedKeyframeId.value = BASE_KEYFRAME_ID;
    const leftClip = findClipLocation(clipId)?.clip ?? null;
    if (leftClip?.kind === "resource") useDanmuStore().select(leftClip.resourceId);
    return leftClip;
  };

  // 更新当前时间
  const setCurrentTime = (time: number) => {
    currentTime.value = Math.max(0, Math.min(time, duration.value));
  };

  const setSelectedClip = (id: string | null) => {
      selectedClipIds.value = id ? [id] : [];
      if (selectedClipId.value !== id) {
          selectedAnimationId.value = null;
          selectedKeyframeId.value = null;
      }
      selectedClipId.value = id;
      const clip = id ? findClipLocation(id)?.clip : null;
      useDanmuStore().select(clip?.kind === "resource" ? clip.resourceId : null);
      if (id === null) {
          selectedAnimationId.value = null;
          selectedKeyframeId.value = null;
      }
  }

  /**
   * 更新当前编辑层的多选状态，并同步主选片段及弹幕资源选择。
   *
   * 当多选收缩为单选时也必须重新同步资源，否则属性面板会继续保留多选时的
   * 空资源状态，导致用户无法编辑最后留下的片段。
   *
   * @param ids 要选中的片段 ID 列表，重复或不存在的 ID 会被忽略
   * @param primaryId 可选的主选片段 ID；不在有效选区时使用第一个有效片段
   * @returns 无返回值
   */
  const setSelectedClips = (ids: string[], primaryId?: string | null) => {
    const validIds = [...new Set(ids)].filter((id) => findClipLocation(id));
    const primary = primaryId && validIds.includes(primaryId) ? primaryId : validIds[0] ?? null;
    const changed = primary !== primarySelectedClipId.value;
    const selectionCountChanged = validIds.length !== selectedClipIds.value.length;
    selectedClipIds.value = validIds;
    primarySelectedClipId.value = primary;
    if (changed || selectionCountChanged || validIds.length > 1) {
      selectedAnimationId.value = null;
      selectedKeyframeId.value = null;
      const clip = primary ? findClipLocation(primary)?.clip : null;
      useDanmuStore().select(validIds.length === 1 && clip?.kind === "resource" ? clip.resourceId : null);
    }
  };

  const toggleClipSelection = (id: string) => {
    const ids = selectedClipIds.value.includes(id)
      ? selectedClipIds.value.filter((selectedId) => selectedId !== id)
      : [...selectedClipIds.value, id];
    setSelectedClips(ids, ids.includes(id) ? id : null);
  };

  const removeSelectedClips = () => {
    const ids = [...selectedClipIds.value];
    for (const id of ids) removeClip(id);
  };

  const collectGroupResources = (group: TimelineGroupClip): AnyDanmu[] => {
    const resourceIds = new Set<string>();
    visitTimelineClips(group.tracks, (clip) => {
      if (clip.kind === "resource") resourceIds.add(clip.resourceId);
    });
    return JSON.parse(JSON.stringify(useDanmuStore().danmus.filter((resource) => resourceIds.has(resource.id))));
  };

  const cloneClip = (source: TimelineClip, trackId: string, resources?: AnyDanmu[]): TimelineClip => {
    const cloned: TimelineClip = JSON.parse(JSON.stringify(source));
    const resourceIdMap = new Map<string, string>();
    const resourcesToClone = resources ?? (source.kind === "group" ? collectGroupResources(source) : []);
    if (resourcesToClone.length > 0) {
      const copies = resourcesToClone.map((resource) => {
        const copy: AnyDanmu = JSON.parse(JSON.stringify(resource));
        copy.id = createTimelineId("danmu");
        resourceIdMap.set(resource.id, copy.id);
        return copy;
      });
      for (const resource of copies) {
        if (resource.parentId && resourceIdMap.has(resource.parentId)) {
          resource.parentId = resourceIdMap.get(resource.parentId);
        }
      }
      useDanmuStore().danmus.push(...copies);
    }
    const regenerate = (clip: TimelineClip, ownerTrackId: string) => {
      clip.id = createTimelineId("clip");
      clip.trackId = ownerTrackId;
      if (clip.kind === "group") {
        for (const track of clip.tracks) {
          track.id = createTimelineId("track");
          for (const child of track.clips) regenerate(child, track.id);
        }
      } else {
        clip.resourceId = resourceIdMap.get(clip.resourceId) ?? clip.resourceId;
        for (const animation of clip.animations ?? []) animation.id = createTimelineId("anim");
        for (const keyframe of clip.keyframes ?? []) keyframe.id = createTimelineId("kf");
      }
    };
    regenerate(cloned, trackId);
    return cloned;
  };

  const canCreateGroup = () => selectedClipIds.value.length > 0 && selectedClipIds.value.every((id) => {
    const location = findClipLocation(id);
    return location && !location.track.locked && location.track.type !== "audio" &&
      (location.clip.kind === "group" || useDanmuStore().danmus.some((resource) => resource.id === location.clip.resourceId));
  });

  const createGroup = (): TimelineGroupClip | null => {
    if (!canCreateGroup()) return null;
    const selectedIds = new Set(selectedClipIds.value);
    const scope = tracks.value;
    const sourceTracks = scope.filter((track) => track.clips.some((clip) => selectedIds.has(clip.id)));
    const sourceClips = sourceTracks.flatMap((track) => track.clips.filter((clip) => selectedIds.has(clip.id)));
    const startTime = Math.min(...sourceClips.map((clip) => clip.startTime));
    const insertIndex = scope.findIndex((track) => track.id === sourceTracks[0]?.id);
    const childTracks: TimelineTrack[] = sourceTracks.map((track) => {
      const childTrackId = createTimelineId("track");
      const clips = track.clips.filter((clip) => selectedIds.has(clip.id));
      for (const clip of clips) {
        clip.startTime -= startTime;
        clip.trackId = childTrackId;
      }
      track.clips = track.clips.filter((clip) => !selectedIds.has(clip.id));
      return { ...track, id: childTrackId, type: "danmu", clips };
    });
    let groupNumber = 1;
    const names = new Set<string>();
    visitTimelineClips(rootTracks.value, (clip) => {
      if (clip.kind === "group" && clip.name) names.add(clip.name);
    });
    while (names.has(i18n.global.t("groups.defaultName", { n: groupNumber }))) groupNumber += 1;
    const name = i18n.global.t("groups.defaultName", { n: groupNumber });
    const groupTrackId = createTimelineId("track");
    const group: TimelineGroupClip = {
      kind: "group", id: createTimelineId("clip"), trackId: groupTrackId,
      name, startTime, duration: getTimelineDuration(childTracks), tracks: childTracks
    };
    scope.splice(insertIndex, 0, {
      id: groupTrackId, name, type: "danmu", clips: [group], visible: true, muted: false, locked: false
    });
    for (const sourceTrack of sourceTracks) {
      if (!sourceTrack.clips.length) scope.splice(scope.indexOf(sourceTrack), 1);
    }
    recalculateDuration();
    setSelectedClip(group.id);
    return group;
  };

  const canUngroupClip = (id = selectedClipId.value) => {
    const location = id ? findClipLocation(id) : null;
    return selectedClipIds.value.length === 1 && location?.clip.kind === "group" && !location.track.locked;
  };

  const ungroupClip = (id = selectedClipId.value) => {
    if (!id || !canUngroupClip(id)) return false;
    const location = findClipLocation(id);
    if (!location || location.clip.kind !== "group") return false;
    const { clip: group, track, clipIndex } = location;
    const insertIndex = tracks.value.indexOf(track);
    track.clips.splice(clipIndex, 1);
    for (const childTrack of group.tracks) {
      childTrack.visible = track.visible && childTrack.visible;
      for (const child of childTrack.clips) child.startTime += group.startTime;
    }
    const childIds = group.tracks.flatMap((childTrack) => childTrack.clips.map((clip) => clip.id));
    tracks.value.splice(insertIndex, track.clips.length ? 0 : 1, ...group.tracks);
    recalculateDuration();
    setSelectedClips(childIds);
    return true;
  };

  const clearEditingState = () => {
    isPlaying.value = false;
    setSelectedClip(null);
    discardPreview();
  };

  const navigateToGroup = (depth: number) => {
    if (depth < 0 || depth >= activeGroupPath.value.length) return;
    viewStates.set(activeGroupPath.value.join("/"), { zoom: zoomScale.value, ...timelineScroll.value });
    let parentTime = currentTime.value;
    const leavingGroup = activeGroups.value[depth];
    for (const group of activeGroups.value.slice(depth)) parentTime += group.startTime;
    clearEditingState();
    activeGroupPath.value = activeGroupPath.value.slice(0, depth);
    currentTime.value = Math.min(parentTime, duration.value);
    const view = viewStates.get(activeGroupPath.value.join("/"));
    zoomScale.value = view?.zoom ?? 50;
    timelineScroll.value = { left: view?.left ?? 0, top: view?.top ?? 0 };
    if (leavingGroup) setSelectedClip(leavingGroup.id);
    navigationRevision.value += 1;
  };

  const enterGroup = (id: string) => {
    const location = findClipLocation(id);
    if (!location || location.clip.kind !== "group") return;
    viewStates.set(activeGroupPath.value.join("/"), { zoom: zoomScale.value, ...timelineScroll.value });
    const localTime = Math.max(0, currentTime.value - location.clip.startTime);
    clearEditingState();
    activeGroupPath.value = [...activeGroupPath.value, id];
    currentTime.value = Math.min(localTime, duration.value);
    const view = viewStates.get(activeGroupPath.value.join("/"));
    zoomScale.value = view?.zoom ?? 50;
    timelineScroll.value = { left: view?.left ?? 0, top: view?.top ?? 0 };
    navigationRevision.value += 1;
  };

  const leaveGroup = () => navigateToGroup(activeGroupPath.value.length - 1);

  const loadTimeline = (nextTracks: TimelineTrack[]) => {
    clearEditingState();
    activeGroupPath.value = [];
    rootTracks.value = nextTracks;
    currentTime.value = 0;
    zoomScale.value = 50;
    timelineScroll.value = { left: 0, top: 0 };
    viewStates.clear();
    clearClipboard();
    recalculateDuration();
    navigationRevision.value += 1;
  };

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
      if (clip?.kind === "resource" && !track.locked) {
        if (!clip.animations) clip.animations = [];
        clip.animations.push(animation);
        return;
      }
    }
  }

  const insertClipAnimation = (clipId: string, index: number, animation: AnimationSegment) => {
    for (const track of tracks.value) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip?.kind === "resource" && !track.locked) {
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
    if (!location || location.clip.kind !== "resource" || location.track.locked) return null;

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
    if (!location || location.clip.kind !== "resource" || location.track.locked) return null;

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
    rootTracks,
    rootDuration,
    activeTracks,
    activeGroupPath,
    activeGroups,
    navigationRevision,
    timelineScroll,
    selectedClipIds,
    setSelectedClips,
    toggleClipSelection,
    removeSelectedClips,
    canCreateGroup,
    createGroup,
    canUngroupClip,
    ungroupClip,
    canMoveClipIntoGroup,
    moveClipIntoGroup,
    copyClipIntoGroup,
    enterGroup,
    leaveGroup,
    navigateToGroup,
    loadTimeline,
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
    canSplitClip,
    splitClip,
    splitClipLeft,
    splitClipRight,
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
