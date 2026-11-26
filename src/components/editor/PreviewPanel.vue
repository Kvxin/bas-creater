<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Minus, Plus, Maximize, Minimize } from "lucide-vue-next";
import basService, { parseBasDSL } from "@/utils/bas";
import { useTimelineStore } from "@/stores/timeline";
import { useDanmuStore } from "@/stores/danmu";
import { useAudioStore } from "@/stores/audio";
import { usePreviewViewport } from "@/composables/usePreviewViewport";
import { basNameForClip, compileTimelineToBas, formatBasParseError } from "@/core/compiler";
import { getAudioEngine } from "@/utils/audio/audio-engine";
import { measurePreviewPaint, startPreviewMeasurement } from "@/utils/previewPerformance";
import TransformControls from "./controls/TransformControls.vue";
import PreviewPlaybackBar from "./preview/PreviewPlaybackBar.vue";
import { clampCanvasDimension, toPreviewTimecode } from "./preview/previewConstants";
import { getFrameDurationMs } from "@/core/timeline";
import type { AnyDanmu } from "@/types/danmu";
import type { TimelineClip } from "@/types/timeline";
import {
  BASE_KEYFRAME_ID,
  clampKeyframeTime,
  getEffectiveDanmuAtTime,
  pickKeyframePropertiesForResource
} from "@/core/keyframes";

const { t } = useI18n();

const SKIP_FORWARD_MS = 5000;

// 当前画布分辨率（默认匹配原有 800×450）
const canvasWidth = ref(800);
const canvasHeight = ref(450);

// Stores
const timelineStore = useTimelineStore();
const danmuStore = useDanmuStore();
const audioStore = useAudioStore();

const containerRef = ref<HTMLElement | null>(null);
const danmakuRef = ref<HTMLElement | null>(null);
let canvasObserver: ResizeObserver | null = null;
let measuredDefinitions: Array<{ name: string; type: string; attrs: Record<string, unknown> }> = [];

const {
  scale,
  isFullscreen,
  zoomPercent,
  isAtFit,
  zoomDisplayLabel,
  contentStyle,
  fitToScreen,
  setViewportPercent,
  nudgeViewportZoom,
  handleWheel,
  startDrag,
  toggleFullscreen,
  mountViewportListeners,
  unmountViewportListeners
} = usePreviewViewport({
  containerRef,
  canvasWidth,
  canvasHeight,
  translate: key => t(key)
});

const refreshParentReferenceSizes = () => {
  const canvas = danmakuRef.value;
  const context = document.createElement("canvas").getContext("2d");
  const sizes: Record<string, { width: number; height: number }> = {};
  if (canvas && context && canvas.offsetWidth > 0) {
    const names = new Map(
      timelineStore.tracks
        .flatMap(track => track.clips)
        .filter(clip => clip.kind === "resource")
        .map(clip => [basNameForClip(clip.id), clip.id])
    );
    const numeric = (value: unknown, proportion: number) => {
      if (typeof value === "number") return value;
      if (!value || typeof value !== "object" || !("value" in value)) return NaN;
      const item = value as { value: number; numType?: string };
      return item.numType === "percent" ? (item.value * proportion) / 100 : item.value;
    };
    for (const definition of measuredDefinitions) {
      const id = names.get(definition.name);
      if (!id || definition.type !== "DefText") continue;
      const attrs = definition.attrs;
      const fontSize = numeric(attrs.fontSize, canvas.offsetWidth);
      let width = numeric(attrs.width, canvas.offsetWidth);
      let height = numeric(attrs.height, canvas.offsetHeight);
      if (!width || !height) {
        context.font = `${numeric(attrs.bold, canvas.offsetWidth) ? "bold " : ""} ${fontSize}px ${attrs.fontFamily}`;
        width = context.measureText(String(attrs.content)).width;
        height = fontSize;
      }
      if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) sizes[id] = { width, height };
    }
  }
  timelineStore.parentReferenceSizes = sizes;
};

const previewTransformItems = computed(() => {
  const items: Array<{
    clipId: string;
    parentClipId?: string;
    danmu: AnyDanmu;
  }> = [];

  const previewClips = timelineStore.tracks.flatMap(track =>
    track.visible
      ? track.clips.filter((clip): clip is Extract<TimelineClip, { kind: "resource" }> => clip.kind === "resource")
      : []
  );

  for (const clip of previewClips) {
    const resource = danmuStore.danmus.find(item => item.id === clip.resourceId);
    if (!resource) continue;
    const danmu = { ...resource, ...clip.overrides } as AnyDanmu;

    // BAS 先以根画布归一化数值坐标，再在渲染时乘父定义尺寸。
    const reference = timelineStore.canvasReferenceSize ?? undefined;
    let effectiveDanmu = danmu;
    try {
      effectiveDanmu = getEffectiveDanmuAtTime(danmu, clip, timelineStore.currentTime, null, reference);
    } catch {
      continue;
    }

    items.push({
      clipId: clip.id,
      parentClipId: clip.parentClipId,
      danmu: effectiveDanmu
    });
  }

  return items;
});

/** 设置画布分辨率 */
const setCanvasResolution = (w: number, h: number) => {
  canvasWidth.value = clampCanvasDimension(w);
  canvasHeight.value = clampCanvasDimension(h);
  nextTick(() => {
    fitToScreen();
    if (needsRecompile.value) void compileAndLoad(true);
  });
};

const handleTransformSelection = (payload: {
  clipIds: string[];
  primaryClipId: string | null;
  primaryDanmuId: string | null;
}) => {
  timelineStore.setSelectedClips(payload.clipIds, payload.primaryClipId);

  if (!payload.primaryClipId) {
    timelineStore.setSelectedKeyframe(null);
  }

  danmuStore.select(payload.primaryDanmuId);
};

const handleTransformCommit = (updates: Array<{ clipId: string; changes: Partial<AnyDanmu> }>) => {
  for (const update of updates) {
    const clip = timelineStore.tracks.flatMap(track => track.clips).find(item => item.id === update.clipId);
    if (!clip || clip.kind !== "resource") continue;
    const resource = danmuStore.danmus.find(item => item.id === clip.resourceId);
    if (!resource) continue;
    const keyframeProperties = pickKeyframePropertiesForResource(resource, update.changes);
    const hasAnimatableChanges = Object.keys(keyframeProperties).length > 0;

    const animatableKeys = new Set(Object.keys(keyframeProperties));
    const resourceChanges = Object.fromEntries(
      Object.entries(update.changes).filter(([key]) => !animatableKeys.has(key))
    ) as Partial<AnyDanmu>;
    if (Object.keys(resourceChanges).length > 0) {
      timelineStore.updateClip(clip.id, { overrides: { ...clip.overrides, ...resourceChanges } });
    }
    if (!hasAnimatableChanges) continue;

    const selectedKeyframeId = clip.id === timelineStore.selectedClipId ? timelineStore.selectedKeyframeId : null;

    const rawLocalTimeMs = timelineStore.currentTime - clip.startTime;
    const localTimeMs = clampKeyframeTime(rawLocalTimeMs, clip.duration);

    if (timelineStore.autoKeyframe && rawLocalTimeMs > 0 && rawLocalTimeMs <= clip.duration) {
      timelineStore.upsertClipKeyframeAtTime(clip.id, localTimeMs, keyframeProperties);
      continue;
    }

    if (timelineStore.autoKeyframe) {
      timelineStore.updateClip(clip.id, { overrides: { ...clip.overrides, ...keyframeProperties } });
      continue;
    }

    if (selectedKeyframeId && selectedKeyframeId !== BASE_KEYFRAME_ID) {
      const storedProperties = clip.keyframes?.find(keyframe => keyframe.id === selectedKeyframeId)?.properties ?? {};
      timelineStore.updateClipKeyframe(clip.id, selectedKeyframeId, {
        properties: {
          ...storedProperties,
          ...keyframeProperties
        }
      });
      continue;
    }

    timelineStore.updateClip(clip.id, { overrides: { ...clip.overrides, ...keyframeProperties } });
  }
};

const isPlaying = computed(() => timelineStore.isPlaying);
const currentTimecode = computed(() =>
  toPreviewTimecode(timelineStore.currentTime, timelineStore.fps, timelineStore.timeDisplayMode)
);
const durationTimecode = computed(() =>
  toPreviewTimecode(timelineStore.duration, timelineStore.fps, timelineStore.timeDisplayMode)
);

const basInitialized = ref(false);
let animationFrameId: number | null = null;
let publishingClock = false;
let playbackRequestId = 0;
const needsRecompile = ref(true);
const previewErrors = ref<string[]>([]);
let previewRevision = 0;
let previewFrame: number | null = null;
let previewUnmounted = false;
let previewRequestedAt: number | undefined;
let loadedCode: string | undefined;

const schedulePreview = () => {
  if (previewFrame !== null || previewUnmounted) return;
  if (import.meta.env.DEV && previewRequestedAt === undefined) previewRequestedAt = performance.now();
  previewFrame = requestAnimationFrame(() => {
    previewFrame = null;
    if (!timelineStore.isPlaying) void compileAndLoad(true);
  });
};

// ---- Audio Engine 播放 ----

const audioEngine = getAudioEngine();
let audioPlaybackRequestId = 0;

const isAtTimelineEnd = (timeMs = timelineStore.currentTime) => {
  const epsilonMs = Math.min(1000 / 60, getFrameDurationMs(timelineStore.fps) * 0.5);
  return timelineStore.duration > 0 && timeMs >= timelineStore.duration - epsilonMs;
};

async function startAudioPlayback(startTimeMs: number) {
  const requestId = ++audioPlaybackRequestId;
  audioEngine.stopAll();

  await audioEngine.ensureResumed();

  if (requestId !== audioPlaybackRequestId) return;

  const resourceById = new Map(audioStore.audioResources.map(resource => [resource.id, resource]));
  const scheduleTracks = (tracks: typeof timelineStore.tracks, offsetMs = 0) => {
    for (const track of tracks) {
      if (track.muted || (track.type !== "audio" && !track.visible)) continue;
      for (const clip of track.clips) {
        const clipStart = offsetMs + clip.startTime;
        if (clip.kind === "group") {
          scheduleTracks(clip.tracks, clipStart);
          continue;
        }
        const resource = resourceById.get(clip.resourceId);
        if (!resource?.url || clipStart + clip.duration <= startTimeMs) continue;
        if (timelineStore.isClipMuted(clip)) continue;
        const volumeDb = timelineStore.getEffectiveVolume(clip);
        void audioEngine
          .loadAudioBuffer(resource.url)
          .then(buffer => {
            if (requestId !== audioPlaybackRequestId || !timelineStore.isPlaying) return;
            const currentMs = basService.getCurrentTime();
            const elapsedMs = Math.max(0, currentMs - clipStart);
            const remainingMs = clip.duration - elapsedMs;
            const offsetSec = ((clip.sourceInMs ?? 0) + elapsedMs) / 1000;
            const durationSec = Math.min(remainingMs / 1000, buffer.duration - offsetSec);
            if (durationSec <= 0) return;
            const when = audioEngine.getCurrentTime() + Math.max(0, clipStart - currentMs) / 1000;
            audioEngine.scheduleClip(clip.id, buffer, when, offsetSec, durationSec, volumeDb);
          })
          .catch(err => {
            console.warn(`[PreviewPanel] Failed to load audio for clip ${clip.id}:`, err);
          });
      }
    }
  };
  scheduleTracks(timelineStore.tracks);
}

function stopAudioPlayback() {
  audioPlaybackRequestId++;
  audioEngine.stopAll();
}

const startSyncLoop = () => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  const loop = () => {
    if (timelineStore.isPlaying) {
      const currentTime = basService.getCurrentTime();

      if (isAtTimelineEnd(currentTime)) {
        finishPlaybackAtEnd();
        return;
      }

      publishingClock = true;
      timelineStore.setCurrentTime(currentTime);
      publishingClock = false;
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
  playbackRequestId++;
  stopAudioPlayback();
  basService.pause();
  timelineStore.isPlaying = false;
  stopSyncLoop();

  const targetTime = Math.max(0, Math.min(seekTimeMs ?? basService.getCurrentTime(), timelineStore.duration));
  seekTimeline(targetTime);
}

function finishPlaybackAtEnd() {
  stopPlayback(timelineStore.duration);
}

function seekTimeline(timeMs: number) {
  const previousTime = timelineStore.currentTime;
  timelineStore.setCurrentTime(timeMs);
  if (timelineStore.currentTime === previousTime && basInitialized.value) {
    basService.seek(timelineStore.currentTime / 1000, true);
    if (timelineStore.isPlaying) void startAudioPlayback(timelineStore.currentTime);
  }
}

const compileAndLoad = async (seekToCurrent = true): Promise<boolean> => {
  if (previewFrame !== null) {
    cancelAnimationFrame(previewFrame);
    previewFrame = null;
  }
  const revision = ++previewRevision;
  const measurement = startPreviewMeasurement(previewRequestedAt ?? performance.now());
  previewRequestedAt = undefined;
  if (!basInitialized.value || !basService.isReady() || previewUnmounted) {
    previewErrors.value = ["BAS preview is not initialized"];
    return false;
  }
  const errors: string[] = [];
  const ranges: Array<{ clipId: string; startLine: number; endLine: number }> = [];
  try {
    const compileStart = measurement ? performance.now() : 0;
    const code = compileTimelineToBas(timelineStore.tracks, danmuStore.danmus, {
      audioResourceIds: audioStore.audioResources.map(resource => resource.id),
      onError: message => errors.push(message),
      onRange: (clipId, startLine, endLine) => ranges.push({ clipId, startLine, endLine })
    });
    if (measurement) measurement.compileMs = performance.now() - compileStart;
    if (errors.length) throw new Error(errors.join("; "));
    if (code === loadedCode) {
      refreshParentReferenceSizes();
      if (seekToCurrent) basService.seek(timelineStore.currentTime / 1000, true);
      previewErrors.value = [];
      needsRecompile.value = false;
      if (measurement) measurement.outcome = "unchanged";
      measurePreviewPaint(measurement);
      return true;
    }
    const parseStart = measurement ? performance.now() : 0;
    let parsed;
    try {
      parsed = code.trim() ? await parseBasDSL(code) : { defs: [], sets: [] };
    } catch (error) {
      throw new Error(formatBasParseError(error, code, ranges, timelineStore.tracks));
    } finally {
      if (measurement) measurement.parseMs = performance.now() - parseStart;
    }
    if (revision !== previewRevision || previewUnmounted) {
      if (measurement) measurement.outcome = "superseded";
      return false;
    }
    const definitions = parsed.defs
      .filter(definition => definition.type === "DefText")
      .map(definition => ({
        name: definition.name as string,
        type: definition.type as string,
        attrs: { ...definition.attrs }
      }));
    const loadStart = measurement ? performance.now() : 0;
    loadedCode = undefined;
    try {
      basService.reset();
      if (code.trim()) await basService.addParsedAsync({ ...parsed, stime: 0 });
    } finally {
      if (measurement) measurement.loadMs = performance.now() - loadStart;
    }
    if (revision !== previewRevision || previewUnmounted) {
      if (measurement) measurement.outcome = "superseded";
      return false;
    }
    measuredDefinitions = definitions;
    refreshParentReferenceSizes();
    if (seekToCurrent) basService.seek(timelineStore.currentTime / 1000, true);
    loadedCode = code;
    previewErrors.value = [];
    needsRecompile.value = false;
    if (measurement) measurement.outcome = "loaded";
    measurePreviewPaint(measurement);
    return true;
  } catch (error) {
    if (revision !== previewRevision || previewUnmounted) {
      if (measurement) measurement.outcome = "superseded";
      return false;
    }
    if (measurement) measurement.outcome = "error";
    measurePreviewPaint(measurement);
    previewErrors.value = [error instanceof Error ? error.message : String(error)];
    needsRecompile.value = true;
    return false;
  }
};

watch(
  () => timelineStore.activeGroupPath.join("/"),
  () => {
    stopPlayback(timelineStore.currentTime);
    ++previewRevision;
    needsRecompile.value = true;
    if (basInitialized.value && basService.isReady()) schedulePreview();
  }
);

watch(
  [() => danmuStore.danmus, () => timelineStore.tracks, () => audioStore.audioResources],
  () => {
    ++previewRevision;
    timelineStore.parentReferenceSizes = {};
    needsRecompile.value = true;
    if (!timelineStore.isPlaying && basInitialized.value && basService.isReady()) schedulePreview();
  },
  { deep: true }
);

watch(
  [() => timelineStore.tracks, () => audioStore.audioResources],
  () => {
    if (timelineStore.isPlaying) void startAudioPlayback(timelineStore.currentTime);
  },
  { deep: true }
);

watch(
  () => timelineStore.currentTime,
  time => {
    if (publishingClock || !basInitialized.value) return;
    basService.seek(time / 1000, true);
    if (timelineStore.isPlaying) void startAudioPlayback(time);
  },
  { flush: "sync" }
);

watch(
  () => timelineStore.isPlaying,
  isPlayingNow => {
    if (danmakuRef.value) {
      danmakuRef.value.style.overflow = isPlayingNow ? "hidden" : "";
    }

    if (!isPlayingNow) {
      if (animationFrameId !== null) {
        stopAudioPlayback();
        basService.pause();
        stopSyncLoop();
      }
      if (needsRecompile.value) schedulePreview();
    }
  }
);

watch(
  () => basInitialized.value,
  ready => {
    if (ready && !timelineStore.isPlaying && needsRecompile.value) schedulePreview();
  }
);

const onVisibilityChange = () => {
  if (document.hidden) stopPlayback();
};

const handleGlobalPlaybackKeyDown = (event: KeyboardEvent) => {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (
    target?.isContentEditable ||
    target?.closest("input, textarea, select, [role='slider'], [role='dialog']") ||
    document.querySelector("[role='dialog']")
  ) {
    return;
  }
  if (event.code === "ArrowLeft") {
    event.preventDefault();
    stepByFrames(event.shiftKey ? -10 : -1);
    return;
  }
  if (event.code === "ArrowRight") {
    event.preventDefault();
    stepByFrames(event.shiftKey ? 10 : 1);
    return;
  }
  if (event.code === "Space" && !event.repeat && !target?.closest("button, [role='button']")) {
    event.preventDefault();
    void togglePlay();
  }
};

onMounted(() => {
  if (danmakuRef.value) {
    const canvas = danmakuRef.value;
    const updateCanvasSize = () => {
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      timelineStore.canvasReferenceSize = width > 0 && height > 0 ? { width, height } : null;
      refreshParentReferenceSizes();
    };
    updateCanvasSize();
    canvasObserver = new ResizeObserver(updateCanvasSize);
    canvasObserver.observe(canvas);
  }

  mountViewportListeners();
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("keydown", handleGlobalPlaybackKeyDown);

  nextTick(() => {
    const danmakuEl = document.getElementById("danmaku");
    if (danmakuEl) {
      try {
        basService.pause();
        basService.clear();
        basService.init({ container: danmakuEl });
        basInitialized.value = true;
        console.log("[PreviewPanel] BAS initialized");
      } catch (err) {
        console.warn("[PreviewPanel] BAS init failed:", err);
      }
    }
  });
});

onUnmounted(() => {
  previewUnmounted = true;
  ++previewRevision;
  if (previewFrame !== null) cancelAnimationFrame(previewFrame);
  unmountViewportListeners();
  canvasObserver?.disconnect();
  timelineStore.canvasReferenceSize = null;
  timelineStore.parentReferenceSizes = {};
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("keydown", handleGlobalPlaybackKeyDown);
  stopPlayback();
});

const togglePlay = async () => {
  if (!basInitialized.value) return;

  if (timelineStore.isPlaying) {
    stopPlayback();
  } else {
    if (timelineStore.duration <= 0) {
      stopPlayback(0);
      return;
    }

    if (isAtTimelineEnd()) {
      seekTimeline(0);
    }
    const requestId = ++playbackRequestId;

    if (needsRecompile.value) {
      const compiled = await compileAndLoad(true);
      if (!compiled || requestId !== playbackRequestId) return;
    }

    basService.play();
    timelineStore.isPlaying = true;
    void startAudioPlayback(timelineStore.currentTime);
    startSyncLoop();
  }
};

const playFromStart = async () => {
  if (!basInitialized.value) return;
  if (timelineStore.duration <= 0) {
    stopPlayback(0);
    return;
  }
  stopPlayback();
  const requestId = ++playbackRequestId;

  seekTimeline(0);

  if (needsRecompile.value) {
    const compiled = await compileAndLoad(true);
    if (!compiled || requestId !== playbackRequestId) return;
  }

  basService.play();
  timelineStore.isPlaying = true;
  void startAudioPlayback(timelineStore.currentTime);
  startSyncLoop();
};

const seekToStart = () => {
  if (!basInitialized.value) return;
  seekTimeline(0);
};

const stepByFrames = (deltaFrames: number) => {
  if (!basInitialized.value) return;
  if (timelineStore.isPlaying) {
    stopPlayback(timelineStore.currentTime);
  }
  timelineStore.stepFrames(deltaFrames);
};

const skipForward = () => {
  if (!basInitialized.value) return;
  const targetTime = Math.min(timelineStore.currentTime + SKIP_FORWARD_MS, timelineStore.duration);

  if (isAtTimelineEnd(targetTime)) {
    finishPlaybackAtEnd();
    return;
  }

  seekTimeline(targetTime);
};
</script>

<template>
  <div class="preview-panel panel workbench-panel flex h-full w-full flex-col overflow-hidden" data-ui="preview-panel">
    <!-- Canvas Area -->
    <div
      ref="containerRef"
      data-ui="preview-viewport"
      class="preview-viewport relative flex-1 cursor-grab overflow-hidden bg-preview active:cursor-grabbing"
      @wheel="handleWheel"
      @mousedown="startDrag"
    >
      <div
        v-if="previewErrors.length"
        role="alert"
        class="absolute top-2 left-2 z-20 max-w-96 rounded-sm bg-destructive p-2 text-xs text-white"
      >
        {{ `Preview may be out of date: ${previewErrors.join("; ")}` }}
      </div>

      <!-- Controls Overlay: Zoom + Fullscreen -->
      <div class="preview-view-tools absolute top-2.5 right-2.5 z-10 flex items-center gap-0.5 rounded-lg border p-0.5">
        <button @click="nudgeViewportZoom(1)" class="ui-icon-button" :title="t('preview.zoom.in')">
          <Plus class="size-4" />
        </button>

        <button
          @click="fitToScreen()"
          class="inline-flex h-7 min-w-12 items-center justify-center rounded-sm bg-surface px-1.5 font-mono text-xs text-foreground tabular-nums transition-colors hover:bg-accent"
          :title="t('preview.zoom.fitToWindow')"
        >
          {{ zoomDisplayLabel }}
        </button>

        <button @click="nudgeViewportZoom(-1)" class="ui-icon-button" :title="t('preview.zoom.out')">
          <Minus class="size-4" />
        </button>

        <div class="mx-0.5 h-4 border-l border-border"></div>

        <button
          @click="toggleFullscreen"
          class="ui-icon-button"
          :title="isFullscreen ? t('preview.fullscreen.exit') : t('preview.fullscreen.enter')"
        >
          <Minimize v-if="isFullscreen" class="size-4" />
          <Maximize v-else class="size-4" />
        </button>
      </div>

      <!-- Transform Wrapper -->
      <div class="absolute top-0 left-0" :style="contentStyle">
        <div
          ref="danmakuRef"
          id="danmaku"
          class="preview-canvas group relative flex items-center justify-center border bg-black select-none"
          :style="{ width: canvasWidth + 'px', height: canvasHeight + 'px' }"
        >
          <!-- BAS renders danmaku items here -->

          <!-- Transform Controls Overlay -->
          <TransformControls
            v-if="previewTransformItems.length && !isPlaying"
            :items="previewTransformItems"
            :selected-clip-id="timelineStore.selectedClipId"
            :selected-clip-ids="timelineStore.selectedClipIds"
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
    <PreviewPlaybackBar
      :current-timecode="currentTimecode"
      :duration-timecode="durationTimecode"
      :is-playing="isPlaying"
      :zoom-display-label="zoomDisplayLabel"
      :is-at-fit="isAtFit"
      :zoom-percent="zoomPercent"
      :canvas-width="canvasWidth"
      :canvas-height="canvasHeight"
      @play-from-start="playFromStart"
      @seek-to-start="seekToStart"
      @step-prev-frame="stepByFrames(-1)"
      @toggle-play="togglePlay"
      @step-next-frame="stepByFrames(1)"
      @skip-forward="skipForward"
      @cycle-time-mode="timelineStore.cycleTimeDisplayMode()"
      @fit-to-screen="fitToScreen"
      @set-viewport-percent="setViewportPercent"
      @set-canvas-resolution="setCanvasResolution"
    />
  </div>
</template>

<style scoped>
.preview-panel {
  container: preview-panel / inline-size;
}

.preview-viewport {
  background-image: radial-gradient(
    circle,
    color-mix(in oklab, var(--muted-foreground) 25%, transparent) 0.75px,
    transparent 1px
  );
  background-position: center;
  background-size: 16px 16px;
}

.preview-canvas {
  border-color: color-mix(in oklab, var(--muted-foreground) 40%, var(--preview));
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.16), 0 8px 24px rgb(0 0 0 / 0.24);
}

.preview-view-tools {
  border-color: var(--border);
  background: var(--panel);
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.12);
}

.preview-view-tools button:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}
</style>
