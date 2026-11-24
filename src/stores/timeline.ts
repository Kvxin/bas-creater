import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { TimelineTrack, TimelineClip, TimelineTrackType, TimelineGroupClip } from "@/types/timeline";
import type { AnyDanmu } from "@/types/danmu";
import type { AudioResource } from "@/types/resource";
import { useAudioStore } from "@/stores/audio";
import { i18n } from "@/i18n";
import { getItemName } from "@/utils/resourceUtils";
import { useDanmuStore } from "@/stores/danmu";
import { splitClipAnimation } from "@/core/splitClip";
import { getTimelineDuration, updateGroupDurations, visitTimelineClips } from "@/core/timelineGroups";
import { BASE_KEYFRAME_ID } from "@/core/keyframes";
import {
  applyClipUpdates,
  applyTrackType,
  clearTrackTypeIfEmpty,
  cloneClip,
  findClipLocation as findClipLocationIn,
  getResourceTrackType
} from "@/core/timelineTracks";
import type { TimelineStoreContext } from "@/stores/timeline/context";
import { createTimelineClipboard } from "@/stores/timeline/clipboard";
import { createTimelinePreview } from "@/stores/timeline/preview";
import { createTimelineGroups } from "@/stores/timeline/groups";
import { createTimelineBasImport } from "@/stores/timeline/basImport";
import { createTimelineKeyframes } from "@/stores/timeline/keyframes";

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
  // 仅用于运行时采样，不写入工程；尺寸取自引擎实际内容盒。
  const canvasReferenceSize = ref<{ width: number; height: number } | null>(null);
  // BAS 在生成父子动画时按父文本定义基态计算局部尺寸，而非 DOM 的实时尺寸。
  const parentReferenceSizes = ref<Record<string, { width: number; height: number }>>({});
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
  const selectedKeyframeId = ref<string | null>(null);
  const autoKeyframe = ref(true);
  const navigationRevision = ref(0);
  const timelineScroll = ref({ left: 0, top: 0 });
  const viewStates = new Map<string, { zoom: number; left: number; top: number }>();

  const findClipLocation = (clipId: string) => findClipLocationIn(tracks.value, clipId);

  // 各模块在 setup 阶段创建，主 store 的函数此时尚未定义，所以通过包装函数延迟取用。
  const context: TimelineStoreContext = {
    rootTracks,
    tracks,
    activeGroupPath,
    selectedClipIds,
    selectedClipId,
    selectedKeyframeId,
    findClipLocation,
    recalculateDuration: () => recalculateDuration(),
    setSelectedClip: (id) => setSelectedClip(id),
    setSelectedClips: (ids, primaryId) => setSelectedClips(ids, primaryId),
    addTrack: (name, type) => addTrack(name, type) ?? null
  };
  const clipboard = createTimelineClipboard(context);
  const preview = createTimelinePreview(context);
  const groups = createTimelineGroups(context);
  const basImport = createTimelineBasImport(context);
  const keyframes = createTimelineKeyframes(context);
  const { clearClipboard } = clipboard;
  const { discardPreview } = preview;

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
      keyframes: [],
      params: resourceType === "audio" ? { volume: 0, muted: false } : undefined,
    };

    track.clips.push(newClip);
    // 简单的排序，保证片段按时间顺序排列
    track.clips.sort((a, b) => a.startTime - b.startTime);
    recalculateDuration();

    console.log("[TimelineStore] Added clip:", newClip);
    setSelectedClip(newClip.id);
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
        if (clip.kind === "resource" && updates.parentClipId !== undefined) {
          const byId = new Map<string, TimelineClip>();
          visitTimelineClips(rootTracks.value, item => byId.set(item.id, item));
          let parent: TimelineClip | undefined = byId.get(updates.parentClipId);
          const seen = new Set([clip.id]);
          if (!parent || parent.kind !== "resource") throw new Error("Invalid parent clip");
          while (parent) {
            if (seen.has(parent.id)) throw new Error("Cyclic parent clip relationship");
            seen.add(parent.id);
            parent = parent.kind === "resource" && parent.parentClipId ? byId.get(parent.parentClipId) : undefined;
          }
        }
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
    const newClip = cloneClip(sourceClip, targetTrackId);
    applyClipUpdates(newClip, updates);

    // 确保目标轨道有类型
    if (!targetTrack.type && clipType) {
      applyTrackType(targetTrack, clipType);
    }

    targetTrack.clips.push(newClip);
    targetTrack.clips.sort((a, b) => a.startTime - b.startTime);
    recalculateDuration();

    setSelectedClip(newClip.id);
    selectedKeyframeId.value = BASE_KEYFRAME_ID;

    console.log(
      `[TimelineStore] Copied clip "${sourceClip.name || sourceClip.id}" to track "${targetTrack.name}"`
    );
    return newClip;
  };

  const canSplitClip = (clipId: string | null, timeMs = currentTime.value) => {
    if (!clipId || !Number.isFinite(timeMs)) return false;
    const location = findClipLocation(clipId);
    if (!location || location.clip.kind !== "resource" || location.track.locked || selectedClipIds.value.length > 1) return false;
    const { clip } = location;
    const offsetMs = Math.round(timeMs - clip.startTime);
    return Number.isFinite(clip.duration) && offsetMs > 0 && offsetMs < clip.duration &&
      (useDanmuStore().danmus.some((resource) => resource.id === clip.resourceId) ||
        useAudioStore().audioResources.some((resource) => resource.id === clip.resourceId));
  };

  const splitClip = (clipId: string | null, timeMs = currentTime.value): TimelineClip | null => {
    if (!canSplitClip(clipId, timeMs)) return null;
    const { track, clip } = findClipLocation(clipId!)!;
    if (clip.kind !== "resource") return null;
    const resource = useDanmuStore().danmus.find((item) => item.id === clip.resourceId);
    const source: typeof clip = JSON.parse(JSON.stringify(clip));
    const offsetMs = Math.round(timeMs - clip.startTime);
    const reference = canvasReferenceSize.value ?? undefined;
    const split = resource ? splitClipAnimation(source, resource, offsetMs, reference) : null;

    const rightClip: TimelineClip = {
      ...source,
      id: `clip_${crypto.randomUUID()}`,
      startTime: clip.startTime + offsetMs,
      duration: clip.duration - offsetMs,
      sourceInMs: resource ? source.sourceInMs : (source.sourceInMs ?? 0) + offsetMs,
      overrides: split ? { ...source.overrides, ...split.rightProperties } : source.overrides,
      keyframes: split?.rightKeyframes ?? source.keyframes
    };
    clip.duration = offsetMs;
    if (split) {
      clip.keyframes = split.leftKeyframes;
    }
    track.clips.push(rightClip);
    track.clips.sort((a, b) => a.startTime - b.startTime);
    recalculateDuration();
    selectedClipId.value = rightClip.id;
    selectedKeyframeId.value = BASE_KEYFRAME_ID;
    return rightClip;
  };

  const splitClipLeft = (clipId: string | null, timeMs = currentTime.value): TimelineClip | null => {
    const rightClip = splitClip(clipId, timeMs);
    if (!rightClip || !clipId) return null;
    if (rightClip.kind !== "resource") return null;
    removeClip(clipId);
    return rightClip;
  };

  const splitClipRight = (clipId: string | null, timeMs = currentTime.value): TimelineClip | null => {
    const rightClip = splitClip(clipId, timeMs);
    if (!rightClip || !clipId) return null;
    removeClip(rightClip.id);
    selectedClipId.value = clipId;
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
          selectedKeyframeId.value = null;
      }
      selectedClipId.value = id;
      const clip = id ? findClipLocation(id)?.clip : null;
      useDanmuStore().select(clip?.kind === "resource" ? clip.resourceId : null);
      if (id === null) {
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

  const setSelectedKeyframe = (id: string | null) => {
    selectedKeyframeId.value = id;
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

  return {
    ...clipboard,
    ...preview,
    ...groups,
    ...basImport,
    ...keyframes,
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
    enterGroup,
    leaveGroup,
    navigateToGroup,
    loadTimeline,
    tracks,
    currentTime,
    canvasReferenceSize,
    parentReferenceSizes,
    isPlaying,
    duration,
    zoomScale,
    selectedClipId,
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
    setSelectedKeyframe,
    setAutoKeyframe,
    toggleTrackExpand,
    toggleTrackVisibility,
    toggleTrackMute,
  };
});
