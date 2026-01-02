import { defineStore } from "pinia";
import { ref } from "vue";
import type { TimelineTrack, TimelineClip, AnimationSegment } from "@/types/timeline";
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
      locked: false,
    },
  ]);

  const currentTime = ref(0);
  const isPlaying = ref(false);
  const duration = ref(300000); // 默认总时长 5分钟
  const zoomScale = ref(50);
  const selectedClipId = ref<string | null>(null);
  const selectedAnimationId = ref<string | null>(null);

  // 添加新轨道
  const addTrack = (name?: string) => {
    const id = `track_${Math.random().toString(36).slice(2, 9)}`;
    tracks.value.push({
      id,
      name: name || `轨道 ${tracks.value.length + 1}`,
      clips: [],
      visible: true,
      locked: false,
      expanded: false,
    });
    return id;
  };

  // 移除轨道
  const removeTrack = (trackId: string) => {
    const index = tracks.value.findIndex((t) => t.id === trackId);
    if (index !== -1) {
      tracks.value.splice(index, 1);
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

    // 动态扩展时间轴长度
    const clipEnd = time + clipDuration;
    if (clipEnd > duration.value) {
        // 扩展到片段结束时间 + 1分钟缓冲
        duration.value = clipEnd + 60000;
    }

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
        return;
      }
    }
  };

  // 根据 resourceId 移除片段
  const removeClipsByResourceId = (resourceId: string) => {
    for (const track of tracks.value) {
      for (let i = track.clips.length - 1; i >= 0; i--) {
        const clip = track.clips[i];
        if (clip && clip.resourceId === resourceId) {
          if (selectedClipId.value === clip.id) {
            selectedClipId.value = null;
          }
          track.clips.splice(i, 1);
        }
      }
    }
  };

  // 更新片段
  const updateClip = (clipId: string, updates: Partial<TimelineClip>) => {
    for (const track of tracks.value) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) {
        Object.assign(clip, updates);
        
        // 如果更新了时间，重新排序
        if (updates.startTime !== undefined) {
             track.clips.sort((a, b) => a.startTime - b.startTime);
             
             // 检查是否超出总时长
             const clipEnd = clip.startTime + clip.duration;
             if (clipEnd > duration.value) {
                 duration.value = clipEnd + 60000;
             }
        }
        return;
      }
    }
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
    setCurrentTime,
    setSelectedClip,
    setSelectedAnimation,
    toggleTrackExpand,
    addClipAnimation,
    insertClipAnimation,
    removeClipAnimation,
    updateClipAnimation
  };
});
