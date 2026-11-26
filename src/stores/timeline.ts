import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  TimelineTrack,
  TimelineClip,
  TimelineResourceClip,
  TimelineTrackType,
  TimelineGroupClip,
  TimelineDisplayMode,
  TimelineMarker,
  TimelineSettings
} from "@/types/timeline";
import type { AnyDanmu } from "@/types/danmu";
import type { AudioResource } from "@/types/resource";
import {
  buildInstance,
  defaultEffectParams,
  isDynamicEffect,
  matchesEffect,
  MAX_CLIP_EFFECTS,
  sliceEffects,
  type EffectParams,
  type EffectPlugin
} from "@/core/effects";
import { useAudioStore } from "@/stores/audio";
import { i18n } from "@/i18n";
import { getItemName } from "@/utils/resourceUtils";
import { useDanmuStore } from "@/stores/danmu";
import { findEffectTimingConflict } from "@/core/compiler";
import { splitClipAnimation } from "@/core/splitClip";
import { getTimelineDuration, updateGroupDurations, visitTimelineClips } from "@/core/timelineGroups";
import { BASE_KEYFRAME_ID, getBaseKeyframeTimeMs, roundKeyframeTime } from "@/core/keyframes";
import {
  clampTimelineFps,
  DEFAULT_TIMELINE_FPS,
  getKeyframeToleranceMs,
  MAX_TIMELINE_ZOOM,
  MIN_TIMELINE_ZOOM,
  roundTimelineMs,
  stepFrameTimeMs
} from "@/core/timeline";
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
      locked: false
    }
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
  const activeGroupOffsetMs = computed(() =>
    activeGroups.value.reduce((sum, group) => sum + group.startTime, 0)
  );
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
  const fps = ref(DEFAULT_TIMELINE_FPS);
  const timeDisplayMode = ref<TimelineDisplayMode>("frames");
  const snapEnabled = ref(true);
  const rootMarkers = ref<TimelineMarker[]>([]);
  const markers = computed<TimelineMarker[]>(() => {
    if (!activeGroupPath.value.length) return rootMarkers.value;
    const offset = activeGroupOffsetMs.value;
    const maxDuration = duration.value;
    return rootMarkers.value
      .map((marker) => ({ ...marker, timeMs: roundTimelineMs(marker.timeMs - offset) }))
      .filter((marker) => marker.timeMs >= 0 && (maxDuration <= 0 || marker.timeMs <= maxDuration));
  });
  const selectedClipIds = ref<string[]>([]);
  const selectedTrackId = ref<string | null>(null);
  // 时间轴上正在调整区间的特效，只在它所属片段单选时有效。
  const editingEffectId = ref<string | null>(null);
  const primarySelectedClipId = ref<string | null>(null);
  const selectedClipId = computed({
    get: () => primarySelectedClipId.value,
    set: (id: string | null) => {
      if (primarySelectedClipId.value !== id) editingEffectId.value = null;
      primarySelectedClipId.value = id;
      selectedTrackId.value = id ? (findClipLocation(id)?.track.id ?? null) : null;
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
    fps,
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
    if (selectedClipIds.value.length) {
      setSelectedClips(selectedClipIds.value, selectedClipId.value);
    } else if (selectedTrackId.value && !tracks.value.some((track) => track.id === selectedTrackId.value)) {
      selectedTrackId.value = null;
    }
    currentTime.value = Math.max(0, Math.min(currentTime.value, duration.value));
  };

  const effectScopeLocked = computed(() => {
    let scope = rootTracks.value;
    for (const group of activeGroups.value) {
      if (scope.find((track) => track.id === group.trackId)?.locked) return true;
      scope = group.tracks;
    }
    return false;
  });

  function getEffectTarget(clipId: string | null) {
    const location = clipId ? findClipLocation(clipId) : null;
    if (
      !location ||
      location.clip.kind !== "resource" ||
      location.track.locked ||
      location.track.type === "audio" ||
      effectScopeLocked.value
    )
      return null;
    const clip = location.clip;
    const resource = useDanmuStore().danmus.find((item) => item.id === clip.resourceId);
    return resource ? { clip, resource } : null;
  }

  function attachEffect(clipId: string | null, plugin: EffectPlugin) {
    const target = getEffectTarget(clipId);
    if (!target || !plugin.targets.includes(target.resource.type)) throw new Error(i18n.global.t("effects.chooseClip"));
    const effects = target.clip.effects ?? [];
    if (effects.length >= MAX_CLIP_EFFECTS) throw new Error(i18n.global.t("effects.limit", { n: MAX_CLIP_EFFECTS }));
    const effect = buildInstance(
      plugin,
      target.resource.type,
      defaultEffectParams(plugin),
      { span: [0, target.clip.duration] },
      target.clip.duration
    );
    target.clip.effects = [...effects, effect];
    setSelectedClip(target.clip.id);
    return effect.id;
  }

  function updateEffect(clipId: string, effectId: string, plugin: EffectPlugin, params: EffectParams) {
    const target = getEffectTarget(clipId);
    const effect = target?.clip.effects?.find((item) => item.id === effectId);
    if (!target || !effect || !matchesEffect(plugin, effect) || !plugin.targets.includes(target.resource.type))
      throw new Error(i18n.global.t("effects.cannotEdit"));
    const updated = buildInstance(plugin, target.resource.type, params, effect, target.clip.duration);
    target.clip.effects = target.clip.effects!.map((item) => (item.id === effectId ? updated : item));
  }

  function removeEffect(clipId: string, effectId: string) {
    const target = getEffectTarget(clipId);
    if (!target?.clip.effects?.some((item) => item.id === effectId)) return;
    const remaining = target.clip.effects.filter((item) => item.id !== effectId);
    if (remaining.length) target.clip.effects = remaining;
    else delete target.clip.effects;
    if (editingEffectId.value === effectId) editingEffectId.value = null;
  }

  function updateEffectSpan(clipId: string, effectId: string, span: [number, number]) {
    const target = getEffectTarget(clipId);
    const effect = target?.clip.effects?.find((item) => item.id === effectId);
    if (!target || !effect) throw new Error(i18n.global.t("effects.cannotEdit"));
    if (!isDynamicEffect(effect)) throw new Error(i18n.global.t("effects.staticFullClip"));
    const [start, end] = span;
    const { duration: clipDuration } = target.clip;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end > clipDuration ||
      start > end ||
      (start === end && clipDuration > 0)
    )
      throw new Error(i18n.global.t("effects.invalidSpan"));
    const effects = target.clip.effects!.map((item) =>
      item.id === effectId ? { ...item, span: [start, end] as [number, number] } : item
    );
    const conflict = findEffectTimingConflict(
      { ...target.clip, effects },
      { ...target.resource, ...target.clip.overrides, id: target.resource.id, type: target.resource.type } as AnyDanmu
    );
    if (conflict) throw new Error(i18n.global.t("effects.timingConflict", { key: conflict }));
    target.clip.effects = effects;
  }

  const editingEffect = computed(() => {
    if (!editingEffectId.value || selectedClipIds.value.length !== 1) return null;
    const location = findClipLocation(selectedClipIds.value[0]!);
    if (location?.clip.kind !== "resource") return null;
    const effect = location.clip.effects?.find((item) => item.id === editingEffectId.value);
    return effect && isDynamicEffect(effect) ? { clip: location.clip, effect } : null;
  });

  function setEditingEffect(clipId: string, effectId: string | null) {
    if (!effectId) {
      editingEffectId.value = null;
      return;
    }
    const target = getEffectTarget(clipId);
    const effect = target?.clip.effects?.find((item) => item.id === effectId);
    if (!target || !effect || !isDynamicEffect(effect)) return;
    if (selectedClipIds.value.join() !== clipId) setSelectedClip(clipId);
    editingEffectId.value = effectId;
  }

  function moveEffect(clipId: string, effectId: string, offset: -1 | 1) {
    const target = getEffectTarget(clipId);
    if (!target?.clip.effects) return;
    const effects = [...target.clip.effects];
    const index = effects.findIndex((item) => item.id === effectId);
    const next = index + offset;
    if (index < 0 || next < 0 || next >= effects.length) return;
    [effects[index], effects[next]] = [effects[next]!, effects[index]!];
    target.clip.effects = effects;
  }

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
      expanded: false
    });
    return id;
  };

  // 移除轨道
  const removeTrack = (trackId: string) => {
    if (tracks.value.find((track) => track.id === trackId)?.locked) return;
    const index = tracks.value.findIndex((t) => t.id === trackId);
    if (index !== -1) {
      tracks.value.splice(index, 1);
      if (selectedTrackId.value === trackId) selectedTrackId.value = null;
      recalculateDuration();
    }
  };

  // 添加片段
  const addClip = (resource: AnyDanmu | AudioResource, trackId: string, time: number) => {
    const track = tracks.value.find((t) => t.id === trackId);
    if (!track || track.locked) {
      console.warn(`[TimelineStore] Track not found: ${trackId}`);
      return;
    }

    const resourceType = getResourceTrackType(resource);
    if (activeGroupPath.value.length && resourceType === "audio") return;
    if (track.clips.length > 0 && track.type && track.type !== resourceType) {
      console.warn(`[TimelineStore] Cannot add ${resourceType} clip to ${track.type} track: ${trackId}`);
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
      params: resourceType === "audio" ? { volume: 0, muted: false } : undefined
    };

    track.clips.push(newClip);
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
          if (clip.kind === "group") {
            removeFromTracks(clip.tracks);
          } else if (clip.resourceId === resourceId) {
            track.clips.splice(index, 1);
          }
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
          visitTimelineClips(rootTracks.value, (item) => byId.set(item.id, item));
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

        if (updates.startTime !== undefined || updates.duration !== undefined) {
          track.clips.sort((a, b) => a.startTime - b.startTime);
          recalculateDuration();
        }
        return;
      }
    }
  };

  const trimClip = (clipId: string, startTime: number, duration: number) => {
    const location = findClipLocation(clipId);
    if (
      !location ||
      location.track.locked ||
      effectScopeLocked.value ||
      !Number.isFinite(startTime) ||
      startTime < 0 ||
      !Number.isFinite(duration) ||
      duration <= 0
    )
      return;
    const { clip } = location;
    if (clip.kind === "resource") {
      const deltaStart = roundKeyframeTime(startTime - clip.startTime);
      const isAudio = useAudioStore().audioResources.some((resource) => resource.id === clip.resourceId);
      const patch: Partial<TimelineResourceClip> = { startTime, duration };
      if (clip.effects?.length) {
        patch.effects = sliceEffects(clip.effects, startTime - clip.startTime, duration);
      }
      // 方向 A：左边缘裁剪时反向平移基础帧与关键帧，使其保持锚定在绝对时间轴原位，右边缘裁剪完全不动关键帧。
      if (!isAudio && deltaStart !== 0 && (clip.keyframes?.length || clip.baseKeyframeTimeMs)) {
        patch.baseKeyframeTimeMs = roundKeyframeTime(getBaseKeyframeTimeMs(clip) - deltaStart);
        if (clip.keyframes?.length) {
          patch.keyframes = clip.keyframes.map((keyframe) => ({
            ...keyframe,
            timeMs: roundKeyframeTime(keyframe.timeMs - deltaStart)
          }));
        }
      }
      updateClip(clipId, patch);
    } else {
      updateClip(clipId, { startTime, duration });
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
    const clipType = clip.kind === "group" ? "danmu" : (sourceTrack.type ?? options.clipType);
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
      console.warn(`[TimelineStore] Cannot move ${clipType} clip to ${targetType} track: ${targetTrackId}`);
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

    if (sourceTrack.id !== targetTrackId) {
      const targetType = targetTrack.type;
      if (targetType && clipType && targetType !== clipType) {
        console.warn(`[TimelineStore] Cannot copy ${clipType} clip to ${targetType} track: ${targetTrackId}`);
        return null;
      }
      if (targetTrack.clips.length > 0 && !targetType) {
        console.warn(`[TimelineStore] Cannot copy clip to ambiguous track: ${targetTrackId}`);
        return null;
      }
    }

    const newClip = cloneClip(sourceClip, targetTrackId);
    applyClipUpdates(newClip, updates);

    if (!targetTrack.type && clipType) {
      applyTrackType(targetTrack, clipType);
    }

    targetTrack.clips.push(newClip);
    targetTrack.clips.sort((a, b) => a.startTime - b.startTime);
    recalculateDuration();

    setSelectedClip(newClip.id);
    selectedKeyframeId.value = BASE_KEYFRAME_ID;

    console.log(`[TimelineStore] Copied clip "${sourceClip.name || sourceClip.id}" to track "${targetTrack.name}"`);
    return newClip;
  };

  const canSplitClip = (clipId: string | null, timeMs = currentTime.value) => {
    if (!clipId || !Number.isFinite(timeMs)) return false;
    const location = findClipLocation(clipId);
    if (
      !location ||
      location.clip.kind !== "resource" ||
      location.track.locked ||
      selectedClipIds.value.length > 1
    )
      return false;
    const { clip } = location;
    const offsetMs = roundTimelineMs(timeMs - clip.startTime);
    return (
      Number.isFinite(clip.duration) &&
      timeMs > clip.startTime &&
      offsetMs > 0 &&
      offsetMs < clip.duration &&
      (useDanmuStore().danmus.some((resource) => resource.id === clip.resourceId) ||
        useAudioStore().audioResources.some((resource) => resource.id === clip.resourceId))
    );
  };

  const splitClip = (clipId: string | null, timeMs = currentTime.value): TimelineClip | null => {
    if (!canSplitClip(clipId, timeMs)) return null;
    const { track, clip } = findClipLocation(clipId!)!;
    if (clip.kind !== "resource") return null;
    const resource = useDanmuStore().danmus.find((item) => item.id === clip.resourceId);
    const source: typeof clip = JSON.parse(JSON.stringify(clip));
    const offsetMs = roundTimelineMs(timeMs - clip.startTime);
    const reference = canvasReferenceSize.value ?? undefined;
    const split = resource ? splitClipAnimation(source, resource, offsetMs, reference) : null;
    const remainingMs = roundTimelineMs(clip.duration - offsetMs);

    const rightClip: TimelineClip = {
      ...source,
      id: `clip_${crypto.randomUUID()}`,
      startTime: roundTimelineMs(clip.startTime + offsetMs),
      duration: remainingMs,
      sourceInMs: resource ? source.sourceInMs : roundTimelineMs((source.sourceInMs ?? 0) + offsetMs),
      overrides: split ? { ...source.overrides, ...split.rightProperties } : source.overrides,
      keyframes: split?.rightKeyframes ?? source.keyframes
    };
    if (split?.rightBaseKeyframeTimeMs) rightClip.baseKeyframeTimeMs = split.rightBaseKeyframeTimeMs;
    else delete rightClip.baseKeyframeTimeMs;
    if (source.effects?.length) {
      const left = sliceEffects(source.effects, 0, offsetMs);
      const right = sliceEffects(source.effects, offsetMs, remainingMs, true);
      if (left.length) clip.effects = left;
      else delete clip.effects;
      if (right.length) rightClip.effects = right;
      else delete rightClip.effects;
    }
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
      editingEffectId.value = null;
    }
    selectedClipId.value = id;
    const clip = id ? findClipLocation(id)?.clip : null;
    useDanmuStore().select(clip?.kind === "resource" ? clip.resourceId : null);
    if (id === null) {
      selectedKeyframeId.value = null;
    }
  };

  const setSelectedClips = (ids: string[], primaryId?: string | null) => {
    const validIds = [...new Set(ids)].filter((id) => findClipLocation(id));
    const primary = primaryId && validIds.includes(primaryId) ? primaryId : (validIds[0] ?? null);
    const changed = primary !== primarySelectedClipId.value;
    const selectionCountChanged = validIds.length !== selectedClipIds.value.length;
    selectedClipIds.value = validIds;
    primarySelectedClipId.value = primary;
    const clip = primary ? findClipLocation(primary)?.clip : null;
    selectedTrackId.value = clip?.trackId ?? null;
    if (changed || selectionCountChanged || validIds.length > 1) {
      selectedKeyframeId.value = null;
      editingEffectId.value = null;
      useDanmuStore().select(validIds.length === 1 && clip?.kind === "resource" ? clip.resourceId : null);
    }
  };

  function selectTrack(id: string) {
    setSelectedClip(null);
    selectedTrackId.value = tracks.value.some((track) => track.id === id) ? id : null;
  }

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

  const applyTimelineSettings = (settings?: TimelineSettings & { zoomScale?: number }) => {
    fps.value = clampTimelineFps(settings?.fps);
    timeDisplayMode.value =
      settings?.timeDisplayMode && ["frames", "milliseconds"].includes(settings.timeDisplayMode)
        ? settings.timeDisplayMode
        : "frames";
    snapEnabled.value = settings?.snapEnabled ?? true;
    rootMarkers.value = (settings?.markers ?? [])
      .filter((marker) => Number.isFinite(marker.timeMs) && marker.timeMs >= 0)
      .map((marker) => ({
        id: marker.id || `marker_${crypto.randomUUID()}`,
        timeMs: roundTimelineMs(marker.timeMs),
        ...(marker.label?.trim() ? { label: marker.label.trim() } : {})
      }))
      .sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));
    if (typeof settings?.zoomScale === "number" && Number.isFinite(settings.zoomScale) && settings.zoomScale > 0) {
      zoomScale.value = Math.min(MAX_TIMELINE_ZOOM, Math.max(MIN_TIMELINE_ZOOM, settings.zoomScale));
    } else {
      zoomScale.value = 50;
    }
  };

  const getTimelineSettings = (): TimelineSettings & { zoomScale: number } => ({
    zoomScale: zoomScale.value,
    fps: fps.value,
    timeDisplayMode: timeDisplayMode.value,
    snapEnabled: snapEnabled.value,
    markers: rootMarkers.value.map((marker) => ({ ...marker }))
  });

  const loadTimeline = (nextTracks: TimelineTrack[], settings?: TimelineSettings & { zoomScale?: number }) => {
    clearEditingState();
    activeGroupPath.value = [];
    rootTracks.value = nextTracks;
    currentTime.value = 0;
    applyTimelineSettings(settings);
    timelineScroll.value = { left: 0, top: 0 };
    viewStates.clear();
    clearClipboard();
    recalculateDuration();
    navigationRevision.value += 1;
  };

  const setFps = (nextFps: number) => {
    fps.value = clampTimelineFps(nextFps);
  };

  const setTimeDisplayMode = (mode: TimelineDisplayMode) => {
    if (["frames", "milliseconds"].includes(mode)) {
      timeDisplayMode.value = mode;
    }
  };

  const cycleTimeDisplayMode = () => {
    timeDisplayMode.value = timeDisplayMode.value === "frames" ? "milliseconds" : "frames";
  };

  const setSnapEnabled = (enabled: boolean) => {
    snapEnabled.value = Boolean(enabled);
  };

  const toggleSnap = () => {
    snapEnabled.value = !snapEnabled.value;
  };

  const stepFrames = (deltaFrames: number) => {
    setCurrentTime(stepFrameTimeMs(currentTime.value, deltaFrames, fps.value, duration.value));
  };

  const addMarker = (localTimeMs = currentTime.value, label?: string): TimelineMarker => {
    const rootTimeMs = roundTimelineMs(Math.max(0, localTimeMs) + activeGroupOffsetMs.value);
    const existing = rootMarkers.value.find((item) => Math.abs(item.timeMs - rootTimeMs) <= 0.5);
    if (existing) {
      if (label !== undefined) {
        const trimmed = label.trim();
        if (trimmed) existing.label = trimmed;
        else delete existing.label;
      }
      return existing;
    }
    const created: TimelineMarker = {
      id: `marker_${Math.random().toString(36).slice(2, 9)}`,
      timeMs: rootTimeMs,
      ...(label?.trim() ? { label: label.trim() } : {})
    };
    rootMarkers.value.push(created);
    rootMarkers.value.sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));
    return created;
  };

  const removeMarker = (markerId: string) => {
    const index = rootMarkers.value.findIndex((item) => item.id === markerId);
    if (index !== -1) {
      rootMarkers.value.splice(index, 1);
    }
  };

  const toggleMarkerAtCurrentTime = (toleranceMs = getKeyframeToleranceMs(fps.value)) => {
    const rootTimeMs = roundTimelineMs(Math.max(0, currentTime.value) + activeGroupOffsetMs.value);
    const existing = rootMarkers.value.find((item) => Math.abs(item.timeMs - rootTimeMs) <= toleranceMs);
    if (existing) {
      removeMarker(existing.id);
      return { action: "removed" as const, marker: existing };
    }
    return { action: "added" as const, marker: addMarker(currentTime.value) };
  };

  const clearMarkers = () => {
    rootMarkers.value = [];
  };

  const seekToAdjacentMarker = (direction: -1 | 1): boolean => {
    const visible = markers.value;
    if (!visible.length) return false;
    const epsilon = 0.5;
    if (direction > 0) {
      const next = visible.find((item) => item.timeMs > currentTime.value + epsilon);
      if (!next) return false;
      setCurrentTime(next.timeMs);
      return true;
    }
    for (let index = visible.length - 1; index >= 0; index -= 1) {
      const prev = visible[index]!;
      if (prev.timeMs < currentTime.value - epsilon) {
        setCurrentTime(prev.timeMs);
        return true;
      }
    }
    return false;
  };

  const setSelectedKeyframe = (id: string | null) => {
    selectedKeyframeId.value = id;
  };

  const setAutoKeyframe = (enabled: boolean) => {
    autoKeyframe.value = enabled;
  };

  const toggleTrackExpand = (trackId: string) => {
    const track = tracks.value.find((t) => t.id === trackId);
    if (track) {
      track.expanded = !track.expanded;
    }
  };

  const toggleTrackVisibility = (trackId: string) => {
    const track = tracks.value.find((t) => t.id === trackId);
    if (track && track.type !== "audio") {
      track.visible = !track.visible;
    }
  };

  const toggleTrackMute = (trackId: string) => {
    const track = tracks.value.find((t) => t.id === trackId);
    if (track && track.type === "audio") {
      track.muted = !track.muted;
    }
  };

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
    activeGroupOffsetMs,
    navigationRevision,
    timelineScroll,
    selectedClipIds,
    selectedTrackId,
    selectTrack,
    getEffectTarget,
    attachEffect,
    updateEffect,
    moveEffect,
    removeEffect,
    updateEffectSpan,
    editingEffect,
    setEditingEffect,
    setSelectedClips,
    toggleClipSelection,
    removeSelectedClips,
    enterGroup,
    leaveGroup,
    navigateToGroup,
    loadTimeline,
    applyTimelineSettings,
    getTimelineSettings,
    tracks,
    currentTime,
    canvasReferenceSize,
    parentReferenceSizes,
    isPlaying,
    duration,
    zoomScale,
    fps,
    timeDisplayMode,
    snapEnabled,
    rootMarkers,
    markers,
    setFps,
    setTimeDisplayMode,
    cycleTimeDisplayMode,
    setSnapEnabled,
    toggleSnap,
    stepFrames,
    addMarker,
    removeMarker,
    toggleMarkerAtCurrentTime,
    clearMarkers,
    seekToAdjacentMarker,
    selectedClipId,
    selectedKeyframeId,
    autoKeyframe,
    addTrack,
    removeTrack,
    addClip,
    removeClip,
    removeClipsByResourceId,
    updateClip,
    trimClip,
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
    toggleTrackMute
  };
});
