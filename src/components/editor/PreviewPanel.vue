<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from "vue";
import { onClickOutside } from "@vueuse/core";
import {
  Check,
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Minus,
  Plus,
  RotateCcw,
  Maximize,
  Minimize,
} from "lucide-vue-next";
import basService from "@/utils/bas";
import { useTimelineStore } from "@/stores/timeline";
import { useDanmuStore } from "@/stores/danmu";
import { useAudioStore } from "@/stores/audio";
import { compileTimelineToBas } from "@/utils/compiler";
import { getAudioEngine } from "@/utils/audio/audio-engine";
import TransformControls from "./controls/TransformControls.vue";
import type { AnyDanmu } from "@/types/danmu";
import type { TimelineClip } from "@/types/timeline";
import {
  BASE_KEYFRAME_ID,
  clampKeyframeTime,
  getEffectiveDanmuAtTime,
  normalizeKeyframes,
  pickKeyframePropertiesForResource,
} from "@/utils/keyframes";

const ZOOM_SENSITIVITY = 0.001;
const MIN_SCALE = 0.1;
const MAX_SCALE = 5.0;
const PLAYBACK_END_EPSILON_MS = 1000 / 60;
const SKIP_FORWARD_MS = 5000;
const CANVAS_MIN_SIZE = 1;
const CANVAS_MAX_SIZE = 9999;

// ---- 画布分辨率预设（快捷预设，用户可自定义任意宽高） ----
const CANVAS_PRESETS = [
  {
    label: "800×450",
    aspect: "16:9",
    previewClass: "h-3 w-5",
    width: 800,
    height: 450,
  },
  {
    label: "640×360",
    aspect: "16:9",
    previewClass: "h-3 w-5",
    width: 640,
    height: 360,
  },
  {
    label: "1080×1920",
    aspect: "9:16",
    previewClass: "h-5 w-3",
    width: 1080,
    height: 1920,
  },
  {
    label: "1920×1080",
    aspect: "16:9",
    previewClass: "h-3 w-5",
    width: 1920,
    height: 1080,
  },
] as const;
type CanvasPreset = (typeof CANVAS_PRESETS)[number];

// ---- 视图缩放预设 (Fit + 25% ~ 200%) ----
const ZOOM_PRESETS = [25, 50, 75, 100, 150, 200] as const;

// 当前画布分辨率（默认匹配原有 800×450）
const canvasWidth = ref(800);
const canvasHeight = ref(450);
const editWidth = ref<number | string>(800);
const editHeight = ref<number | string>(450);

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
const isFullscreen = ref(false);
const isZoomMenuOpen = ref(false);
const isResolutionMenuOpen = ref(false);
const zoomMenuRef = ref<HTMLElement | null>(null);
const resolutionMenuRef = ref<HTMLElement | null>(null);

// 点击菜单外部时关闭
onClickOutside(zoomMenuRef, () => { isZoomMenuOpen.value = false; });
onClickOutside(resolutionMenuRef, () => { isResolutionMenuOpen.value = false; });

type CoordinateField = "x" | "y";

const isUnsetCoordinate = (value: unknown) =>
  value === undefined || value === null || value === "";

const isPercentageCoordinate = (value: unknown) =>
  typeof value === "string" && value.trim().endsWith("%");

const getSelectedCoordinateSource = (
  danmu: AnyDanmu,
  clip: TimelineClip,
  selectedKeyframeId: string,
  field: CoordinateField
) => {
  let source = danmu[field];

  for (const keyframe of normalizeKeyframes(clip.keyframes, clip.duration)) {
    const value = keyframe.properties[field];
    if (!isUnsetCoordinate(value)) source = value;
    if (keyframe.id === selectedKeyframeId) break;
  }

  return source;
};

const usesPercentageCoordinate = (
  danmu: AnyDanmu,
  clip: TimelineClip,
  selectedKeyframeId: string | null,
  effectiveValue: unknown,
  field: CoordinateField
) => {
  if (typeof effectiveValue === "string" && effectiveValue.trim().endsWith("%")) {
    return true;
  }

  if (selectedKeyframeId && selectedKeyframeId !== BASE_KEYFRAME_ID) {
    const source = getSelectedCoordinateSource(danmu, clip, selectedKeyframeId, field);
    return isUnsetCoordinate(source) || isPercentageCoordinate(source);
  }

  const rawValue = danmu[field];
  const localTimeMs = timelineStore.currentTime - clip.startTime;
  if (selectedKeyframeId === BASE_KEYFRAME_ID || localTimeMs <= 0) {
    return isUnsetCoordinate(rawValue) || isPercentageCoordinate(rawValue);
  }

  const hasAnimatedValue = clip.keyframes?.some(
    keyframe => !isUnsetCoordinate(keyframe.properties[field])
  );
  if (hasAnimatedValue) return false;

  return isUnsetCoordinate(rawValue) || isPercentageCoordinate(rawValue);
};

const previewTransformItems = computed(() => {
  const items: Array<{
    clipId: string;
    danmu: AnyDanmu;
    coordinatePercentageMode: { x: boolean; y: boolean };
  }> = [];

  for (const track of timelineStore.tracks) {
    if (!track.visible) continue;

    for (const clip of track.clips) {
      const danmu = danmuStore.danmus.find((item) => item.id === clip.resourceId);
      if (!danmu) continue;

      const selectedKeyframeId =
        clip.id === timelineStore.selectedClipId ? timelineStore.selectedKeyframeId : null;
      const effectiveDanmu = getEffectiveDanmuAtTime(
        danmu,
        clip,
        timelineStore.currentTime,
        selectedKeyframeId
      );

      items.push({
        clipId: clip.id,
        danmu: effectiveDanmu,
        coordinatePercentageMode: {
          x: usesPercentageCoordinate(
            danmu,
            clip,
            selectedKeyframeId,
            effectiveDanmu.x,
            "x"
          ),
          y: usesPercentageCoordinate(
            danmu,
            clip,
            selectedKeyframeId,
            effectiveDanmu.y,
            "y"
          ),
        },
      });
    }
  }

  return items;
});

// ---- 视图缩放 / 全屏 ----

/** 自适应缩放：使画布完整适配视口 */
const fitScale = computed(() => {
  if (!containerRef.value) return 1;
  const rect = containerRef.value.getBoundingClientRect();
  const paddingW = rect.width > 0 ? Math.max(0, rect.width - 32) : 0;
  const paddingH = rect.height > 0 ? Math.max(0, rect.height - 32) : 0;
  const sx = paddingW / canvasWidth.value;
  const sy = paddingH / canvasHeight.value;
  return Math.min(sx, sy);
});

/** 显示用缩放百分比（四舍五入取整） */
const zoomPercent = computed(() => Math.round(scale.value * 100));

/** 当前是否处于 Fit 模式（误差 ≤ 1%） */
const isAtFit = computed(
  () =>
    Math.abs(scale.value - fitScale.value) / Math.max(0.01, fitScale.value) <
    0.01
);
const zoomDisplayLabel = computed(() =>
  isAtFit.value ? "Fit" : `${zoomPercent.value}%`
);

/** 自适应：将画布居中缩放至完整适配视口 */
const fitToScreen = () => {
  const s = fitScale.value;
  scale.value = s;
  centerStageView(s);
};

/** 按照百分比设置缩放（用于预设 25% / 50% / … / 200%） */
const setViewportPercent = (percent: number) => {
  scale.value = Math.max(MIN_SCALE, Math.min(MAX_SCALE, percent / 100));
  centerStageView(scale.value);
};

const nudgeViewportZoom = (direction: 1 | -1) => {
  scale.value = Math.max(
    MIN_SCALE,
    Math.min(MAX_SCALE, scale.value + direction * fitScale.value * 0.25)
  );
  centerStageView(scale.value);
};

/** 切换全屏 */
const toggleFullscreen = async () => {
  if (!containerRef.value) return;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await containerRef.value.requestFullscreen();
    }
  } catch {
    // 全屏 API 不可用时静默忽略
  }
};

/** 当前分辨率是否匹配某个预设 */
const currentPresetLabel = computed(() => {
  const match = CANVAS_PRESETS.find(
    (p) => p.width === canvasWidth.value && p.height === canvasHeight.value
  );
  return match?.label ?? null;
});
const canvasSizeLabel = computed(
  () => currentPresetLabel.value ?? `${canvasWidth.value}×${canvasHeight.value}`
);

const isCanvasPresetSelected = (preset: CanvasPreset) =>
  canvasWidth.value === preset.width && canvasHeight.value === preset.height;

const isZoomPresetSelected = (preset: number) =>
  !isAtFit.value && zoomPercent.value === preset;

const clampCanvasDimension = (value: number | string) => {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) return CANVAS_MIN_SIZE;
  return Math.min(
    CANVAS_MAX_SIZE,
    Math.max(CANVAS_MIN_SIZE, Math.round(numericValue))
  );
};

/** 设置画布分辨率 */
const setCanvasResolution = (w: number, h: number) => {
  const nextWidth = clampCanvasDimension(w);
  const nextHeight = clampCanvasDimension(h);
  canvasWidth.value = nextWidth;
  canvasHeight.value = nextHeight;
  editWidth.value = nextWidth;
  editHeight.value = nextHeight;
  nextTick(() => {
    fitToScreen();
    if (needsRecompile.value) compileAndLoad(true);
  });
};

/** 应用自定义宽高 */
const applyCustomResolution = () => {
  const w = clampCanvasDimension(editWidth.value);
  const h = clampCanvasDimension(editHeight.value);
  editWidth.value = w;
  editHeight.value = h;
  setCanvasResolution(w, h);
  isResolutionMenuOpen.value = false;
};

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
    const keyframeProperties = resource
      ? pickKeyframePropertiesForResource(resource, update.changes)
      : {};
    const hasAnimatableChanges = Object.keys(keyframeProperties).length > 0;

    const animatableKeys = new Set(Object.keys(keyframeProperties));
    const resourceChanges = Object.fromEntries(
      Object.entries(update.changes).filter(([key]) => !animatableKeys.has(key))
    ) as Partial<AnyDanmu>;
    if (Object.keys(resourceChanges).length > 0) {
      danmuStore.updateDanmu(update.id, resourceChanges);
    }

    if (!resource || !clip || !hasAnimatableChanges) {
      if (hasAnimatableChanges) {
        danmuStore.updateDanmu(update.id, keyframeProperties as Partial<AnyDanmu>);
      }
      continue;
    }

    const selectedKeyframeId =
      clip.id === timelineStore.selectedClipId ? timelineStore.selectedKeyframeId : null;

    const rawLocalTimeMs = timelineStore.currentTime - clip.startTime;
    const localTimeMs = clampKeyframeTime(rawLocalTimeMs, clip.duration);

    if (
      timelineStore.autoKeyframe &&
      rawLocalTimeMs > 0 &&
      rawLocalTimeMs <= clip.duration
    ) {
      timelineStore.upsertClipKeyframeAtTime(clip.id, localTimeMs, keyframeProperties);
      continue;
    }

    if (timelineStore.autoKeyframe) {
      danmuStore.updateDanmu(update.id, keyframeProperties as Partial<AnyDanmu>);
      continue;
    }

    if (selectedKeyframeId && selectedKeyframeId !== BASE_KEYFRAME_ID) {
      const storedProperties = clip.keyframes?.find(
        (keyframe) => keyframe.id === selectedKeyframeId
      )?.properties ?? {};
      timelineStore.updateClipKeyframe(clip.id, selectedKeyframeId, {
        properties: {
          ...storedProperties,
          ...keyframeProperties,
        },
      });
      continue;
    }

    if (selectedKeyframeId === BASE_KEYFRAME_ID) {
      danmuStore.updateDanmu(update.id, keyframeProperties as Partial<AnyDanmu>);
      continue;
    }

    danmuStore.updateDanmu(update.id, keyframeProperties as Partial<AnyDanmu>);
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

// ---- Audio Engine 播放 ----

const audioEngine = getAudioEngine();

const isAtTimelineEnd = (timeMs = timelineStore.currentTime) => {
  return (
    timelineStore.duration > 0 &&
    timeMs >= timelineStore.duration - PLAYBACK_END_EPSILON_MS
  );
};

async function startAudioPlayback(startTimeMs: number) {
  // 确保 AudioContext 处于运行状态
  await audioEngine.ensureResumed();

  const now = audioEngine.getCurrentTime();
  const resourceById = new Map(
    audioStore.audioResources.map((resource) => [resource.id, resource]),
  );

  for (const track of timelineStore.tracks) {
    if (track.muted || (track.type !== "audio" && !track.visible)) continue;

    for (const clip of track.clips) {
      const resource = resourceById.get(clip.resourceId);
      if (!resource) continue;

      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + clip.duration;
      if (clipEnd <= startTimeMs) continue;

      // 计算调度参数
      const delaySec = Math.max(0, (clipStart - startTimeMs) / 1000);
      const offsetSec = Math.max(0, (startTimeMs - clipStart) / 1000);
      const durationSec = (clipEnd - Math.max(startTimeMs, clipStart)) / 1000;

      // 获取当前音量
      const volumeDb = timelineStore.getEffectiveVolume(clip);
      const isMuted = timelineStore.isClipMuted(clip);
      const effectiveVolumeDb = isMuted ? -60 : volumeDb;

      try {
        const buffer = await audioEngine.loadAudioBuffer(resource.url);
        audioEngine.scheduleClip(
          clip.id,
          buffer,
          now + delaySec,
          offsetSec,
          durationSec,
          effectiveVolumeDb,
        );
      } catch (err) {
        console.warn(`[PreviewPanel] Failed to load audio for clip ${clip.id}:`, err);
      }
    }
  }
}

function stopAudioPlayback() {
  audioEngine.stopAll();
}

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
  position.value.x = (rect.width - canvasWidth.value * nextScale) / 2;
  position.value.y = (rect.height - canvasHeight.value * nextScale) / 2;
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
    // 播放时隐藏舞台溢出内容，暂停时恢复
    if (danmakuRef.value) {
      danmakuRef.value.style.overflow = isPlayingNow ? "hidden" : "";
    }

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

// Fullscreen change handler (needs stable reference for cleanup)
const onFullscreenChange = () => {
  isFullscreen.value = document.fullscreenElement !== null;
};

// Initial centering and BAS init
onMounted(() => {
  if (containerRef.value) {
    centerStageView(scale.value);
  }

  window.addEventListener("mousemove", onDrag);
  window.addEventListener("mouseup", stopDrag);

  // 监听全屏状态变化
  document.addEventListener("fullscreenchange", onFullscreenChange);

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
  document.removeEventListener("fullscreenchange", onFullscreenChange);
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
      <!-- Controls Overlay: Zoom + Fullscreen -->
      <div
        class="absolute top-3 right-3 z-10 flex flex-col gap-1 rounded-md border border-border/80 bg-background/95 p-1.5 shadow-lg backdrop-blur-sm"
      >
        <button
          @click="nudgeViewportZoom(1)"
          class="inline-flex size-9 items-center justify-center rounded-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          title="放大"
        >
          <Plus class="size-4" />
        </button>

        <button
          @click="fitToScreen()"
          class="inline-flex h-9 min-w-9 items-center justify-center rounded-sm px-1 font-mono text-xs tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          title="点击适配窗口"
        >
          {{ zoomDisplayLabel }}
        </button>

        <button
          @click="nudgeViewportZoom(-1)"
          class="inline-flex size-9 items-center justify-center rounded-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          title="缩小"
        >
          <Minus class="size-4" />
        </button>

        <div class="my-0.5 border-t border-border"></div>

        <button
          @click="toggleFullscreen"
          class="inline-flex size-9 items-center justify-center rounded-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          :title="isFullscreen ? '退出全屏' : '全屏'"
        >
          <Minimize v-if="isFullscreen" class="size-4" />
          <Maximize v-else class="size-4" />
        </button>
      </div>

      <!-- Transform Wrapper -->
      <div
        class="absolute top-0 left-0"
        :style="contentStyle"
      >
        <div
          ref="danmakuRef"
          id="danmaku"
          class="bg-black rounded-sm border border-border flex items-center justify-center relative group select-none shadow-sm"
          :style="{ width: canvasWidth + 'px', height: canvasHeight + 'px' }"
        >
          <!-- BAS renders danmaku items here -->

          <!-- Transform Controls Overlay -->
          <TransformControls
            v-if="previewTransformItems.length && !isPlaying"
            :items="previewTransformItems"
            :selected-clip-id="timelineStore.selectedClipId"
            :container-width="canvasWidth"
            :container-height="canvasHeight"
            :canvas-scale="scale"
            @select="handleTransformSelection"
            @commit="handleTransformCommit"
          />
        </div>
      </div>
    </div>

    <!-- Playback Controls -->
    <div
      class="grid h-[3.75rem] shrink-0 grid-cols-[minmax(8rem,1fr)_auto_minmax(14rem,1fr)] items-center border-t border-border bg-background px-5 text-foreground z-20"
    >
      <div class="min-w-0"></div>
      <div class="flex items-center justify-center gap-1.5">
        <button
          @click="playFromStart"
          class="inline-flex size-9 items-center justify-center rounded-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          title="从头播放"
        >
          <RotateCcw class="size-4" />
        </button>
        <button
          @click="seekToStart"
          class="inline-flex size-9 items-center justify-center rounded-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          title="回到开头"
        >
          <SkipBack class="size-4" />
        </button>
        <button
          @click="togglePlay"
          class="inline-flex size-10 items-center justify-center rounded-sm text-primary transition-colors hover:bg-accent hover:text-accent-foreground"
          :title="isPlaying ? '暂停' : '播放'"
        >
          <Pause v-if="isPlaying" class="size-5 fill-current" />
          <Play v-else class="size-5 fill-current" />
        </button>
        <button
          @click="skipForward"
          class="inline-flex size-9 items-center justify-center rounded-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          title="快进"
        >
          <SkipForward class="size-4" />
        </button>
      </div>

      <!-- Right: Zoom + Resolution -->
      <div class="justify-self-end flex items-center gap-2">
        <!-- Zoom Select -->
        <div class="relative" ref="zoomMenuRef">
          <button
            @click.stop="isZoomMenuOpen = !isZoomMenuOpen; isResolutionMenuOpen = false"
            class="inline-flex h-9 min-w-[5.25rem] items-center justify-between gap-2 rounded-sm border border-border/70 bg-accent/35 px-3 font-mono text-xs tabular-nums text-foreground transition-colors hover:bg-accent"
            title="视图缩放"
          >
            <span>{{ zoomDisplayLabel }}</span>
            <ChevronDown class="size-3.5 text-muted-foreground" />
          </button>
          <div
            v-if="isZoomMenuOpen"
            class="absolute right-0 bottom-full z-50 mb-2 w-44 overflow-hidden rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
          >
            <button
              @click.stop="fitToScreen(); isZoomMenuOpen = false"
              :class="[
                'flex h-8 w-full items-center justify-between rounded-sm px-2.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                isAtFit ? 'bg-accent text-accent-foreground' : ''
              ]"
            >
              <span>Fit</span>
              <Check v-if="isAtFit" class="size-4" />
            </button>
            <div class="my-1.5 h-px bg-border"></div>
            <button
              v-for="preset in ZOOM_PRESETS"
              :key="preset"
              @click.stop="setViewportPercent(preset); isZoomMenuOpen = false"
              :class="[
                'flex h-8 w-full items-center justify-between rounded-sm px-2.5 text-left font-mono text-sm tabular-nums transition-colors hover:bg-accent hover:text-accent-foreground',
                isZoomPresetSelected(preset) ? 'bg-accent text-accent-foreground' : ''
              ]"
            >
              <span>{{ preset }}%</span>
              <Check v-if="isZoomPresetSelected(preset)" class="size-4" />
            </button>
          </div>
        </div>

        <!-- Resolution -->
        <div class="relative" ref="resolutionMenuRef">
          <button
            @click.stop="isResolutionMenuOpen = !isResolutionMenuOpen; isZoomMenuOpen = false"
            class="inline-flex h-9 min-w-[7.5rem] items-center justify-between gap-2 rounded-sm border border-border/70 bg-accent/35 px-3 font-mono text-xs tabular-nums text-foreground transition-colors hover:bg-accent"
            title="画布分辨率"
          >
            <span>{{ canvasSizeLabel }}</span>
            <ChevronDown class="size-3.5 text-muted-foreground" />
          </button>
          <div
            v-if="isResolutionMenuOpen"
            class="absolute right-0 bottom-full z-50 mb-2 w-72 overflow-hidden rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-xl"
          >
            <!-- 快捷预设 -->
            <div class="flex flex-col gap-1">
              <button
                v-for="preset in CANVAS_PRESETS"
                :key="preset.label"
                @click.stop="setCanvasResolution(preset.width, preset.height); isResolutionMenuOpen = false"
                :class="[
                  'flex h-10 w-full items-center gap-3 rounded-sm px-2.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground',
                  isCanvasPresetSelected(preset) ? 'bg-accent text-accent-foreground' : ''
                ]"
              >
                <span
                  :class="[
                    'shrink-0 rounded-[2px] border border-current opacity-70',
                    preset.previewClass
                  ]"
                ></span>
                <span class="min-w-0 flex-1">
                  <span class="block font-mono text-sm tabular-nums">{{ preset.label }}</span>
                  <span class="block text-xs text-muted-foreground">{{ preset.aspect }}</span>
                </span>
                <Check v-if="isCanvasPresetSelected(preset)" class="size-4 shrink-0" />
              </button>
            </div>
            <div class="my-2 h-px bg-border"></div>
            <!-- 自定义宽高 -->
            <div class="grid grid-cols-[1fr_auto_1fr_2.25rem] items-end gap-2">
              <label class="min-w-0">
                <span class="mb-1 block text-xs text-muted-foreground">宽</span>
                <input
                  v-model.number="editWidth"
                  type="number"
                  :min="CANVAS_MIN_SIZE"
                  :max="CANVAS_MAX_SIZE"
                  inputmode="numeric"
                  aria-label="画布宽度"
                  class="h-9 w-full rounded-sm border border-border bg-input px-2 text-center font-mono text-xs tabular-nums text-foreground [appearance:textfield] focus:border-ring focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  @keydown.enter.stop="applyCustomResolution()"
                />
              </label>
              <span class="pb-2 text-xs text-muted-foreground">×</span>
              <label class="min-w-0">
                <span class="mb-1 block text-xs text-muted-foreground">高</span>
                <input
                  v-model.number="editHeight"
                  type="number"
                  :min="CANVAS_MIN_SIZE"
                  :max="CANVAS_MAX_SIZE"
                  inputmode="numeric"
                  aria-label="画布高度"
                  class="h-9 w-full rounded-sm border border-border bg-input px-2 text-center font-mono text-xs tabular-nums text-foreground [appearance:textfield] focus:border-ring focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  @keydown.enter.stop="applyCustomResolution()"
                />
              </label>
              <button
                @click.stop="applyCustomResolution()"
                class="inline-flex size-9 items-center justify-center rounded-sm bg-primary text-primary-foreground transition-colors hover:brightness-110"
                title="应用自定义尺寸"
              >
                <Check class="size-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
