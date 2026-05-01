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

const ZOOM_SENSITIVITY = 0.001;
const MIN_SCALE = 0.1;
const MAX_SCALE = 5.0;
const DANMAKU_WIDTH = 800;
const DANMAKU_HEIGHT = 450; // 16:9 aspect ratio

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

// Selected danmu for transform controls
const selectedDanmuForTransform = computed(() => {
  // Get selected from timeline clip first
  if (timelineStore.selectedClipId) {
    for (const track of timelineStore.tracks) {
      const clip = track.clips.find(c => c.id === timelineStore.selectedClipId);
      if (clip) {
        return danmuStore.danmus.find(d => d.id === clip.resourceId) ?? null;
      }
    }
  }
  // Fall back to danmu store selection
  return danmuStore.selected;
});

// Handle transform updates
const handleTransformUpdate = (changes: Partial<AnyDanmu>) => {
  if (selectedDanmuForTransform.value) {
    danmuStore.updateDanmu(selectedDanmuForTransform.value.id, changes);
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

// Handle clicking on danmaku preview area to select items
const handleDanmakuClick = (e: MouseEvent) => {
  // Don't handle if alt is pressed (panning) or middle mouse
  if (e.altKey || e.button !== 0) return;

  const target = e.target as HTMLElement;

  // Don't handle clicks on transform controls
  if (target.closest('.transform-controls')) return;

  // Look for bas-danmaku-item element (could be the target or an ancestor)
  const danmakuItem = target.closest('.bas-danmaku-item') ||
                      (target.classList.contains('bas-danmaku-item') ? target : null);

  if (danmakuItem) {
    const result = findClipByElement(danmakuItem);
    if (result) {
      timelineStore.setSelectedClip(result.clip.id);
      danmuStore.select(result.clip.resourceId);
      e.stopPropagation();
      return;
    }
  }

  // Click on empty area - deselect (only if clicking on the danmaku container itself)
  const isDanmakuContainer = target.id === 'danmaku' || target === danmakuRef.value;
  const isInsideDanmaku = danmakuRef.value?.contains(target);

  if (isDanmakuContainer || (isInsideDanmaku && !danmakuItem)) {
    timelineStore.setSelectedClip(null);
    timelineStore.setSelectedAnimation(null);
    danmuStore.select(null);
  }
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

const startAudioPlayback = (startTimeMs: number) => {
  stopAudioPlayback();
  const session = audioSession;
  const resourceById = new Map(
    audioStore.audioResources.map((resource) => [resource.id, resource])
  );

  for (const track of timelineStore.tracks) {
    if (!track.visible) continue;
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
      timelineStore.setCurrentTime(basService.getCurrentTime());
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

// ... (handleWheel, startDrag, onDrag, stopDrag helpers remain same)



// Computed styles
const containerStyle = computed(() => ({
  backgroundPosition: `${position.value.x}px ${position.value.y}px`,
  backgroundSize: `${20 * scale.value}px ${20 * scale.value}px`,
  backgroundImage: `radial-gradient(circle, var(--color-border) 1px, transparent 1px)`,
}));

const contentStyle = computed(() => ({
  transform: `translate(${position.value.x}px, ${position.value.y}px) scale(${scale.value})`,
  transformOrigin: "0 0",
}));

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
    const rect = containerRef.value.getBoundingClientRect();
    position.value.x = rect.width / 2;
    position.value.y = rect.height / 2;
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
  stopAudioPlayback();
});

const resetView = () => {
  if (!containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  scale.value = 0.8; // Slightly zoomed out default
  position.value.x = rect.width / 2;
  position.value.y = rect.height / 2;
};

// 播放控制
const togglePlay = () => {
  if (!basInitialized.value) return;

  if (timelineStore.isPlaying) {
    stopAudioPlayback();
    basService.pause();
    timelineStore.isPlaying = false;
    stopSyncLoop();
  } else {
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

  timelineStore.setCurrentTime(0);

  if (needsRecompile.value) {
    const compiled = compileAndLoad(true);
    if (!compiled) return;
  } else {
    basService.seek(0);
  }

  startAudioPlayback(0);

  if (!timelineStore.isPlaying) {
    basService.play();
    timelineStore.isPlaying = true;
    startSyncLoop();
  }
};

const seekToStart = () => {
  if (!basInitialized.value) return;
  basService.seek(0);
};

const skipForward = () => {
  if (!basInitialized.value) return;
  // 简单跳过 5 秒
  basService.seek(5);
};
</script>

<template>
  <div class="h-full w-full bg-background flex flex-col">
    <!-- Canvas Area -->
    <div
      ref="containerRef"
      class="flex-1 relative overflow-hidden bg-sidebar/5 cursor-grab active:cursor-grabbing"
      :style="containerStyle"
      @wheel="handleWheel"
      @mousedown="startDrag"
    >
      <!-- Controls Overlay -->
      <div
        class="absolute top-4 right-4 flex flex-col gap-2 bg-card border border-border rounded-md shadow-sm z-10 p-1"
      >
        <button
          @click="scale = Math.min(MAX_SCALE, scale + 0.1)"
          class="p-1.5 hover:bg-accent hover:text-accent-foreground rounded"
          title="Zoom In"
        >
          <Plus class="size-4" />
        </button>
        <button
          @click="scale = Math.max(MIN_SCALE, scale - 0.1)"
          class="p-1.5 hover:bg-accent hover:text-accent-foreground rounded"
          title="Zoom Out"
        >
          <Minus class="size-4" />
        </button>
        <button
          @click="resetView"
          class="p-1.5 hover:bg-accent hover:text-accent-foreground rounded"
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
        class="absolute top-0 left-0 w-full h-full flex items-center justify-center"
        :style="contentStyle"
      >
        <!-- Content (Centered on 0,0 of wrapper) -->
        <div
          ref="danmakuRef"
          id="danmaku"
          class="w-[800px] aspect-video bg-black rounded-lg shadow-2xl border border-border/10 flex items-center justify-center -translate-x-1/2 -translate-y-1/2 relative group select-none"
          @click="handleDanmakuClick"
        >
          <!-- BAS renders danmaku items here -->

          <!-- Transform Controls Overlay -->
          <TransformControls
            v-if="selectedDanmuForTransform && !isPlaying"
            :selected="selectedDanmuForTransform"
            :container-width="DANMAKU_WIDTH"
            :container-height="DANMAKU_HEIGHT"
            :canvas-scale="scale"
            @update="handleTransformUpdate"
          />
        </div>
      </div>
    </div>

    <!-- Playback Controls -->
    <div
      class="h-12 border-t border-border flex items-center justify-center gap-4 bg-card text-card-foreground shrink-0 z-20"
    >
      <button
        @click="playFromStart"
        class="p-2 rounded-full hover:bg-accent hover:text-accent-foreground transition-colors"
        title="从头播放"
      >
        <RotateCcw class="size-4" />
      </button>
      <button
        @click="seekToStart"
        class="p-2 rounded-full hover:bg-accent hover:text-accent-foreground transition-colors"
        title="回到开头"
      >
        <SkipBack class="size-4" />
      </button>
      <button
        @click="togglePlay"
        class="p-2 rounded-full hover:bg-accent hover:text-accent-foreground transition-colors text-primary"
        :title="isPlaying ? '暂停' : '播放'"
      >
        <Pause v-if="isPlaying" class="size-5 fill-current" />
        <Play v-else class="size-5 fill-current" />
      </button>
      <button
        @click="skipForward"
        class="p-2 rounded-full hover:bg-accent hover:text-accent-foreground transition-colors"
        title="快进"
      >
        <SkipForward class="size-4" />
      </button>
    </div>
  </div>
</template>
