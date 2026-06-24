<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from "vue";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Minus,
  Plus,
  RotateCcw,
} from "lucide-vue-next";
import basService from "@/utils/bas";
import { useTimelineStore } from "@/stores/timeline";
import { useDanmuStore } from "@/stores/danmu";
import { useAudioStore } from "@/stores/audio";
import { compileTimelineToBas } from "@/utils/compiler";
import TransformControls from "./controls/TransformControls.vue";
import type { AnyDanmu } from "@/types/danmu";
import type { TimelineClip } from "@/types/timeline";
import {
  BASE_KEYFRAME_ID,
  clampKeyframeTime,
  createKeyframeSnapshot,
  getEffectiveDanmuAtTime,
  pickKeyframeProperties,
  resolveKeyframeProperties,
} from "@/utils/keyframes";

const ZOOM_SENSITIVITY = 0.001;
const MIN_SCALE = 0.1;
const MAX_SCALE = 5.0;
const DANMAKU_WIDTH = 800;
const DANMAKU_HEIGHT = 450; // 16:9 aspect ratio
const PLAYBACK_END_EPSILON_MS = 1000 / 60;
const SKIP_FORWARD_MS = 5000;

// Stores
const timelineStore = useTimelineStore();
const danmuStore = useDanmuStore();
const audioStore = useAudioStore();

// State
const scale = ref(1);
const position = ref({ x: 0, y: 0 });
const isDragging = ref(false);
const lastMousePos = { x: 0, y: 0 };
const containerRef = ref<HTMLElement | null>(null);
const danmakuRef = ref<HTMLElement | null>(null);

const previewTransformItems = computed(() => {
  const items: Array<{ clipId: string; danmu: AnyDanmu }> = [];

  for (const track of timelineStore.tracks) {
    if (!track.visible) continue;

    for (const clip of track.clips) {
      const danmu = danmuStore.danmus.find((item) => item.id === clip.resourceId);
      if (!danmu) continue;

      const selectedKeyframeId =
        clip.id === timelineStore.selectedClipId ? timelineStore.selectedKeyframeId : null;

      items.push({
        clipId: clip.id,
        danmu: getEffectiveDanmuAtTime(
          danmu,
          clip,
          timelineStore.currentTime,
          selectedKeyframeId
        ),
      });
    }
  }

  return items;
});

const handleTransformSelection = (payload: {
  clipIds: string[];
  primaryClipId: string | null;
  primaryDanmuId: string | null;
}) => {
  timelineStore.setSelectedClip(payload.primaryClipId);

  if (!payload.primaryClipId) {
    timelineStore.setSelectedAnimation(null);
    timelineStore.setSelectedKeyframe(null);
  }

  danmuStore.select(payload.primaryDanmuId);
};

const findClipByResourceId = (resourceId: string): TimelineClip | null => {
  if (timelineStore.selectedClipId) {
    for (const track of timelineStore.tracks) {
      const selectedClip = track.clips.find(
        (clip) =>
          clip.id === timelineStore.selectedClipId && clip.resourceId === resourceId
      );
      if (selectedClip) return selectedClip;
    }
  }

  for (const track of timelineStore.tracks) {
    const clip = track.clips.find((item) => item.resourceId === resourceId);
    if (clip) return clip;
  }

  return null;
};

const handleTransformCommit = (
  updates: Array<{ id: string; changes: Partial<AnyDanmu> }>
) => {
  for (const update of updates) {
    const resource = danmuStore.danmus.find((item) => item.id === update.id);
    const clip = findClipByResourceId(update.id);
    const keyframeProperties = pickKeyframeProperties(update.changes);
    const hasAnimatableChanges = Object.keys(keyframeProperties).length > 0;

    if (!resource || !clip || !hasAnimatableChanges) {
      danmuStore.updateDanmu(update.id, update.changes);
      continue;
    }

    const selectedKeyframeId =
      clip.id === timelineStore.selectedClipId ? timelineStore.selectedKeyframeId : null;

    if (selectedKeyframeId && selectedKeyframeId !== BASE_KEYFRAME_ID) {
      timelineStore.updateClipKeyframe(clip.id, selectedKeyframeId, {
        properties: {
          ...resolveKeyframeProperties(resource, clip, selectedKeyframeId),
          ...keyframeProperties,
        },
      });
      continue;
    }

    if (selectedKeyframeId === BASE_KEYFRAME_ID) {
      danmuStore.updateDanmu(update.id, update.changes);
      continue;
    }

    const localTimeMs = clampKeyframeTime(
      timelineStore.currentTime - clip.startTime,
      clip.duration
    );

    if (timelineStore.autoKeyframe && localTimeMs > 0 && localTimeMs < clip.duration) {
      const snapshot = createKeyframeSnapshot(resource, clip, localTimeMs, update.changes);
      timelineStore.upsertClipKeyframeAtTime(clip.id, snapshot.timeMs, snapshot.properties);
      continue;
    }

    danmuStore.updateDanmu(update.id, update.changes);
  }
};

// Helper to find clip by BAS element class name
const findClipByElement = (element: Element): { clip: any; track: any } | null => {
  const classList = Array.from(element.classList);

  // BAS generates class like: bas-danmaku-item--obj_clipId
  for (const className of classList) {
    if (className.startsWith('bas-danmaku-item--obj_')) {
      const objName = className.replace('bas-danmaku-item--', '');

      // Match against all clips
      for (const track of timelineStore.tracks) {
        for (const clip of track.clips) {
          const expectedObjName = `obj_${clip.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
          if (objName === expectedObjName) {
            return { clip, track };
          }
        }
      }
    }
  }
  return null;
};

// Computed isPlaying synced with timelineStore
const isPlaying = computed(() => timelineStore.isPlaying);
const basInitialized = ref(false);
let animationFrameId: number | null = null;
const needsRecompile = ref(false);

type ScheduledAudio = {
  clipId: string;
  audio: HTMLAudioElement;
  startTimerId: number;
  stopTimerId: number;
};

let scheduledAudio: ScheduledAudio[] = [];
const audioTimers = new Set<number>();
let audioSession = 0;

const stopAudioPlayback = () => {
  audioSession += 1;
  for (const timerId of audioTimers) {
    window.clearTimeout(timerId);
  }
  audioTimers.clear();
  for (const entry of scheduledAudio) {
    try {
      entry.audio.pause();
      entry.audio.currentTime = 0;
    } catch (err) {
      // Ignore failed resets on unloaded audio elements.
    }
  }
  scheduledAudio = [];
};

const isAtTimelineEnd = (timeMs = timelineStore.currentTime) => {
  return (
    timelineStore.duration > 0 &&
    timeMs >= timelineStore.duration - PLAYBACK_END_EPSILON_MS
  );
};

const startAudioPlayback = (startTimeMs: number) => {
  stopAudioPlayback();
  const session = audioSession;
  const resourceById = new Map(
    audioStore.audioResources.map((resource) => [resource.id, resource])
  );

  for (const track of timelineStore.tracks) {
    if (track.muted || (track.type !== "audio" && !track.visible)) continue;
    for (const clip of track.clips) {
      const resource = resourceById.get(clip.resourceId);
      if (!resource) continue;

      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + clip.duration;
      if (clipEnd <= startTimeMs) continue;

      const startDelay = Math.max(0, clipStart - startTimeMs);
      const offsetMs = Math.max(0, startTimeMs - clipStart);
      const remainingMs = clipEnd - startTimeMs;

      const audio = new Audio(resource.url);
      audio.preload = "auto";

      const startPlayback = async () => {
        if (session !== audioSession) return;
        const offsetSec = offsetMs / 1000;

        if (audio.readyState < 1) {
          await new Promise<void>((resolve) => {
            const handleLoaded = () => {
              audio.removeEventListener("loadedmetadata", handleLoaded);
              resolve();
            };
            audio.addEventListener("loadedmetadata", handleLoaded);
          });
        }

        if (session !== audioSession) return;
        if (
          Number.isFinite(audio.duration) &&
          audio.duration > 0 &&
          offsetSec >= audio.duration
        ) {
          return;
        }

        try {
          audio.currentTime = offsetSec;
        } catch (err) {
          // Ignore invalid seeks on not-yet-ready audio elements.
        }
        audio.play().catch(() => {});
      };

      const startTimerId = window.setTimeout(() => {
        void startPlayback();
      }, startDelay);
      const stopTimerId = window.setTimeout(() => {
        audio.pause();
      }, remainingMs);

      audioTimers.add(startTimerId);
      audioTimers.add(stopTimerId);
      scheduledAudio.push({ clipId: clip.id, audio, startTimerId, stopTimerId });
    }
  }
};

// Sync loop
const startSyncLoop = () => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  const loop = () => {
    if (timelineStore.isPlaying) {
      const currentTime = basService.getCurrentTime();

      if (isAtTimelineEnd(currentTime)) {
        finishPlaybackAtEnd();
        return;
      }

      timelineStore.setCurrentTime(currentTime);
      animationFrameId = requestAnimationFrame(loop);
    }
  };
  animationFrameId = requestAnimationFrame(loop);
};

const stopSyncLoop = () => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
};

function stopPlayback(seekTimeMs?: number) {
  stopAudioPlayback();
  basService.pause();

  if (seekTimeMs !== undefined) {
    const clampedTime = Math.max(0, Math.min(seekTimeMs, timelineStore.duration));
    timelineStore.setCurrentTime(clampedTime);
    basService.seek(clampedTime / 1000, true);
  }

  timelineStore.isPlaying = false;
  stopSyncLoop();
}

function finishPlaybackAtEnd() {
  stopPlayback(timelineStore.duration);
}

// ... (handleWheel, startDrag, onDrag, stopDrag helpers remain same)



// Computed styles
const containerStyle = computed(() => ({
  backgroundPosition: `${position.value.x}px ${position.value.y}px`,
  backgroundSize: `${20 * scale.value}px ${20 * scale.value}px`,
  backgroundImage: `radial-gradient(circle, color-mix(in oklab, var(--border) 70%, transparent) 1px, transparent 1px)`,
}));

const contentStyle = computed(() => ({
  transform: `translate(${position.value.x}px, ${position.value.y}px) scale(${scale.value})`,
  transformOrigin: "0 0",
}));

const centerStageView = (nextScale = scale.value) => {
  if (!containerRef.value) return;

  const rect = containerRef.value.getBoundingClientRect();
  position.value.x = (rect.width - DANMAKU_WIDTH * nextScale) / 2;
  position.value.y = (rect.height - DANMAKU_HEIGHT * nextScale) / 2;
};

// Helpers
const handleWheel = (e: WheelEvent) => {
  if (!containerRef.value) return;
  e.preventDefault();

  // Zoom logic (Zoom towards cursor)
  const rect = containerRef.value.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // Calculate point in "world" space before zoom
  const worldX = (mouseX - position.value.x) / scale.value;
  const worldY = (mouseY - position.value.y) / scale.value;

  // New Scale
  const zoomDelta = -e.deltaY * ZOOM_SENSITIVITY;
  const newScale = Math.min(
    Math.max(MIN_SCALE, scale.value * (1 + zoomDelta)),
    MAX_SCALE
  );

  // Calculate new translation to keep the world point under the mouse
  position.value.x = mouseX - worldX * newScale;
  position.value.y = mouseY - worldY * newScale;
  scale.value = newScale;
};

const startDrag = (e: MouseEvent) => {
  // Middle mouse (button 1) or Alt+Left (button 0 + alt)
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    e.preventDefault();
    isDragging.value = true;
    lastMousePos.x = e.clientX;
    lastMousePos.y = e.clientY;
    document.body.style.cursor = "grabbing";
  }
};

const onDrag = (e: MouseEvent) => {
  if (!isDragging.value) return;
  e.preventDefault();

  const dx = e.clientX - lastMousePos.x;
  const dy = e.clientY - lastMousePos.y;

  position.value.x += dx;
  position.value.y += dy;

  lastMousePos.x = e.clientX;
  lastMousePos.y = e.clientY;
};

const stopDrag = () => {
  isDragging.value = false;
  document.body.style.cursor = "";
};

const compileAndLoad = (seekToCurrent = true) => {
  if (!basInitialized.value || !basService.isReady()) return false;
  const code = compileTimelineToBas(timelineStore.tracks, danmuStore.danmus);
  basService.reset();
  basService.addRaw(code);
  if (seekToCurrent) {
    basService.seek(timelineStore.currentTime / 1000, true);
  }
  needsRecompile.value = false;
  return true;
};

// 自动刷新预览（当资源或时间轴改变时）
watch(
  [() => danmuStore.danmus, () => timelineStore.tracks],
  () => {
    needsRecompile.value = true;
    // 只有在暂停状态下才自动刷新，避免播放时频繁重置
    if (!timelineStore.isPlaying && basInitialized.value && basService.isReady()) {
      compileAndLoad(true);
    }
  },
  { deep: true }
);

watch(
  () =>
    timelineStore.tracks
      .map((track) => `${track.id}:${track.type ?? "danmu"}:${track.visible ? 1 : 0}:${track.muted ? 1 : 0}`)
      .join("|"),
  () => {
    if (timelineStore.isPlaying) {
      startAudioPlayback(timelineStore.currentTime);
    }
  }
);

watch(
  () => timelineStore.isPlaying,
  (isPlayingNow) => {
    if (!isPlayingNow && needsRecompile.value) {
      compileAndLoad(true);
    }
  }
);

watch(
  () => basInitialized.value,
  (ready) => {
    if (ready && !timelineStore.isPlaying && needsRecompile.value) {
      compileAndLoad(true);
    }
  }
);

// Initial centering and BAS init
onMounted(() => {
  if (containerRef.value) {
    centerStageView(scale.value);
  }

  window.addEventListener("mousemove", onDrag);
  window.addEventListener("mouseup", stopDrag);

  // 初始化 BAS 弹幕服务
  nextTick(() => {
    const danmakuEl = document.getElementById("danmaku");
    if (danmakuEl && !basService.isReady()) {
      try {
        basService.init({ container: danmakuEl });
        // 初始化时不自动播放，或者根据需要
        basInitialized.value = true;
        console.log("[PreviewPanel] BAS initialized");
      } catch (err) {
        console.warn("[PreviewPanel] BAS init failed:", err);
      }
    }
  });
});

onUnmounted(() => {
  window.removeEventListener("mousemove", onDrag);
  window.removeEventListener("mouseup", stopDrag);
  stopPlayback();
});

const resetView = () => {
  if (!containerRef.value) return;
  scale.value = 0.8; // Slightly zoomed out default
  centerStageView(0.8);
};

// 播放控制
const togglePlay = () => {
  if (!basInitialized.value) return;

  if (timelineStore.isPlaying) {
    stopPlayback();
  } else {
    if (timelineStore.duration <= 0) {
      stopPlayback(0);
      return;
    }

    if (isAtTimelineEnd()) {
      timelineStore.setCurrentTime(0);
      basService.seek(0);
    }

    if (needsRecompile.value) {
      const compiled = compileAndLoad(true);
      if (!compiled) return;
    }

    basService.play();
    startAudioPlayback(timelineStore.currentTime);
    timelineStore.isPlaying = true;
    startSyncLoop();
  }
};

const playFromStart = () => {
  if (!basInitialized.value) return;
  if (timelineStore.duration <= 0) {
    stopPlayback(0);
    return;
  }

  timelineStore.setCurrentTime(0);

  if (needsRecompile.value) {
    const compiled = compileAndLoad(true);
    if (!compiled) return;
  } else {
    basService.seek(0);
  }

  startAudioPlayback(0);

  basService.play();
  timelineStore.isPlaying = true;
  startSyncLoop();
};

const seekToStart = () => {
  if (!basInitialized.value) return;
  timelineStore.setCurrentTime(0);
  basService.seek(0);

  if (timelineStore.isPlaying) {
    startAudioPlayback(0);
  }
};

const skipForward = () => {
  if (!basInitialized.value) return;
  const targetTime = Math.min(
    timelineStore.currentTime + SKIP_FORWARD_MS,
    timelineStore.duration
  );

  if (isAtTimelineEnd(targetTime)) {
    finishPlaybackAtEnd();
    return;
  }

  timelineStore.setCurrentTime(targetTime);
  basService.seek(targetTime / 1000);

  if (timelineStore.isPlaying) {
    startAudioPlayback(targetTime);
  }
};
</script>

<template>
  <div class="panel h-full w-full bg-background border border-border rounded-sm overflow-hidden flex flex-col" data-ui="preview-panel">
    <!-- Canvas Area -->
    <div
      ref="containerRef"
      class="flex-1 relative overflow-hidden bg-background cursor-grab active:cursor-grabbing"
      :style="containerStyle"
      @wheel="handleWheel"
      @mousedown="startDrag"
    >
      <!-- Controls Overlay -->
      <div
        class="absolute top-3 right-3 flex flex-col gap-0.5 bg-background/95 border border-border rounded-sm z-10 p-1 shadow-sm"
      >
        <button
          @click="scale = Math.min(MAX_SCALE, scale + 0.1)"
          class="size-7 inline-flex items-center justify-center hover:bg-accent hover:text-accent-foreground rounded-sm"
          title="Zoom In"
        >
          <Plus class="size-4" />
        </button>
        <button
          @click="scale = Math.max(MIN_SCALE, scale - 0.1)"
          class="size-7 inline-flex items-center justify-center hover:bg-accent hover:text-accent-foreground rounded-sm"
          title="Zoom Out"
        >
          <Minus class="size-4" />
        </button>
        <button
          @click="resetView"
          class="size-7 inline-flex items-center justify-center hover:bg-accent hover:text-accent-foreground rounded-sm"
          title="Reset View"
        >
          <RotateCcw class="size-3" />
        </button>
        <div
          class="text-[10px] text-center font-mono text-muted-foreground border-t border-border pt-1 mt-1"
        >
          {{ Math.round(scale * 100) }}%
        </div>
      </div>

      <!-- Transform Wrapper -->
      <div
        class="absolute top-0 left-0"
        :style="contentStyle"
      >
        <div
          ref="danmakuRef"
          id="danmaku"
          class="w-[800px] aspect-video bg-black rounded-sm border border-border flex items-center justify-center relative group select-none shadow-sm"
        >
          <!-- BAS renders danmaku items here -->

          <!-- Transform Controls Overlay -->
          <TransformControls
            v-if="previewTransformItems.length && !isPlaying"
            :items="previewTransformItems"
            :selected-clip-id="timelineStore.selectedClipId"
            :container-width="DANMAKU_WIDTH"
            :container-height="DANMAKU_HEIGHT"
            :canvas-scale="scale"
            @select="handleTransformSelection"
            @commit="handleTransformCommit"
          />
        </div>
      </div>
    </div>

    <!-- Playback Controls -->
    <div
      class="h-[3.25rem] border-t border-border grid grid-cols-[1fr_auto_1fr] items-center px-5 bg-background text-foreground shrink-0 z-20"
    >
      <div></div>
      <div class="flex items-center justify-center gap-2">
      <button
        @click="playFromStart"
        class="size-8 rounded-sm inline-flex items-center justify-center hover:bg-accent hover:text-accent-foreground transition-colors"
        title="从头播放"
      >
        <RotateCcw class="size-4" />
      </button>
      <button
        @click="seekToStart"
        class="size-8 rounded-sm inline-flex items-center justify-center hover:bg-accent hover:text-accent-foreground transition-colors"
        title="回到开头"
      >
        <SkipBack class="size-4" />
      </button>
      <button
        @click="togglePlay"
        class="size-8 rounded-sm inline-flex items-center justify-center hover:bg-accent hover:text-accent-foreground transition-colors text-primary"
        :title="isPlaying ? '暂停' : '播放'"
      >
        <Pause v-if="isPlaying" class="size-5 fill-current" />
        <Play v-else class="size-5 fill-current" />
      </button>
      <button
        @click="skipForward"
        class="size-8 rounded-sm inline-flex items-center justify-center hover:bg-accent hover:text-accent-foreground transition-colors"
        title="快进"
      >
        <SkipForward class="size-4" />
      </button>
      </div>
      <div class="justify-self-end text-xs text-muted-foreground tabular-nums">
        {{ Math.round(scale * 100) }}%
      </div>
    </div>
  </div>
</template>
