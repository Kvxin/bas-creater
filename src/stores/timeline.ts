import { defineStore } from "pinia";
import { ref } from "vue";
import type { TimelineTrack, TimelineClip, AnimationSegment, TimelineTrackType } from "@/types/timeline";
import type { AnyDanmu } from "@/types/danmu";
import type { AudioResource } from "@/types/resource";
import { getItemName } from "@/utils/resourceUtils";

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
    };

    track.clips.push(newClip);
    // 简单的排序，保证片段按时间顺序排列
    track.clips.sort((a, b) => a.startTime - b.startTime);
    recalculateDuration();

    console.log("[TimelineStore] Added clip:", newClip);
  };

  // 移除片段
  const removeClip = (clipId: string) => {
    for (const track of tracks.value) {
      const index = track.clips.findIndex((c) => c.id === clipId);
      if (index !== -1) {
        if (selectedClipId.value === clipId) {
          selectedClipId.value = null;
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
        Object.assign(clip, updates);
        
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

  // 更新当前时间
  const setCurrentTime = (time: number) => {
    currentTime.value = Math.max(0, Math.min(time, duration.value));
  };

  const setSelectedClip = (id: string | null) => {
      selectedClipId.value = id;
      if (id === null) {
          selectedAnimationId.value = null;
      }
  }

  const setSelectedAnimation = (id: string | null) => {
    selectedAnimationId.value = id;
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

  return {
    tracks,
    currentTime,
    isPlaying,
    duration,
    zoomScale,
    selectedClipId,
    selectedAnimationId,
    addTrack,
    removeTrack,
    addClip,
    removeClip,
    removeClipsByResourceId,
    updateClip,
    moveClipToTrack,
    setCurrentTime,
    setSelectedClip,
    setSelectedAnimation,
    toggleTrackExpand,
    toggleTrackVisibility,
    toggleTrackMute,
    addClipAnimation,
    insertClipAnimation,
    removeClipAnimation,
    updateClipAnimation
  };
});
