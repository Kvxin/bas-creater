<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from "vue";
import { onClickOutside } from "@vueuse/core";
import { useI18n } from "vue-i18n";
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
  Minimize
} from "lucide-vue-next";
import basService, { parseBasDSL } from "@/utils/bas";
import { useTimelineStore } from "@/stores/timeline";
import { useDanmuStore } from "@/stores/danmu";
import { useAudioStore } from "@/stores/audio";
import { basNameForClip, compileTimelineToBas, formatBasParseError } from "@/utils/compiler";
import { getAudioEngine } from "@/utils/audio/audio-engine";
import { measurePreviewPaint, startPreviewMeasurement } from "@/utils/previewPerformance";
import TransformControls from "./controls/TransformControls.vue";
import type { AnyDanmu } from "@/types/danmu";
import type { TimelineClip } from "@/types/timeline";
import {
  BASE_KEYFRAME_ID,
  clampKeyframeTime,
  getEffectiveDanmuAtTime,
  pickKeyframePropertiesForResource
} from "@/utils/keyframes";

const { t } = useI18n();

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
    height: 450
  },
  {
    label: "640×360",
    aspect: "16:9",
    previewClass: "h-3 w-5",
    width: 640,
    height: 360
  },
  {
    label: "1080×1920",
    aspect: "9:16",
    previewClass: "h-5 w-3",
    width: 1080,
    height: 1920
  },
  {
    label: "1920×1080",
    aspect: "16:9",
    previewClass: "h-3 w-5",
    width: 1920,
    height: 1080
  }
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
const viewportSize = ref({ width: 0, height: 0 });
let viewportObserver: ResizeObserver | null = null;
let canvasObserver: ResizeObserver | null = null;
const danmakuRef = ref<HTMLElement | null>(null);
const isFullscreen = ref(false);
const isZoomMenuOpen = ref(false);
const isResolutionMenuOpen = ref(false);
const zoomMenuRef = ref<HTMLElement | null>(null);
let measuredDefinitions: Array<{ name: string; type: string; attrs: Record<string, unknown> }> = [];

const refreshParentReferenceSizes = () => {
  const canvas = danmakuRef.value;
  const context = document.createElement("canvas").getContext("2d");
  const sizes: Record<string, { width: number; height: number }> = {};
  if (canvas && context && canvas.offsetWidth > 0) {
    const names = new Map(timelineStore.tracks.flatMap(track => track.clips)
      .filter(clip => clip.kind === "resource").map(clip => [basNameForClip(clip.id), clip.id]));
    const numeric = (value: unknown, proportion: number) => {
      if (typeof value === "number") return value;
      if (!value || typeof value !== "object" || !("value" in value)) return NaN;
      const item = value as { value: number; numType?: string };
      return item.numType === "percent" ? item.value * proportion / 100 : item.value;
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
const resolutionMenuRef = ref<HTMLElement | null>(null);

// 点击菜单外部时关闭
onClickOutside(zoomMenuRef, () => {
  isZoomMenuOpen.value = false;
});
onClickOutside(resolutionMenuRef, () => {
  isResolutionMenuOpen.value = false;
});

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

// ---- 视图缩放 / 全屏 ----

/** 自适应缩放：使画布完整适配视口 */
const fitScale = computed(() => {
  if (!viewportSize.value.width || !viewportSize.value.height) return 1;
  const paddingW = Math.max(0, viewportSize.value.width - 32);
  const paddingH = Math.max(0, viewportSize.value.height - 32);
  const sx = paddingW / canvasWidth.value;
  const sy = paddingH / canvasHeight.value;
  return Math.min(sx, sy);
});

/** 显示用缩放百分比（四舍五入取整） */
const zoomPercent = computed(() => Math.round(scale.value * 100));

/** 当前是否处于 Fit 模式（误差 ≤ 1%） */
const isAtFit = computed(() => Math.abs(scale.value - fitScale.value) / Math.max(0.01, fitScale.value) < 0.01);
const zoomDisplayLabel = computed(() => (isAtFit.value ? t("preview.zoom.fit") : `${zoomPercent.value}%`));

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
  scale.value = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale.value + direction * fitScale.value * 0.25));
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
  const match = CANVAS_PRESETS.find(p => p.width === canvasWidth.value && p.height === canvasHeight.value);
  return match?.label ?? null;
});
const canvasSizeLabel = computed(() => currentPresetLabel.value ?? `${canvasWidth.value}×${canvasHeight.value}`);

const isCanvasPresetSelected = (preset: CanvasPreset) =>
  canvasWidth.value === preset.width && canvasHeight.value === preset.height;

const isZoomPresetSelected = (preset: number) => !isAtFit.value && zoomPercent.value === preset;

const clampCanvasDimension = (value: number | string) => {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) return CANVAS_MIN_SIZE;
  return Math.min(CANVAS_MAX_SIZE, Math.max(CANVAS_MIN_SIZE, Math.round(numericValue)));
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

    if (selectedKeyframeId === BASE_KEYFRAME_ID) {
      timelineStore.updateClip(clip.id, { overrides: { ...clip.overrides, ...keyframeProperties } });
      continue;
    }

    timelineStore.updateClip(clip.id, { overrides: { ...clip.overrides, ...keyframeProperties } });
  }
};


// Computed isPlaying synced with timelineStore
const isPlaying = computed(() => timelineStore.isPlaying);

// 视频编辑器风格时间码：hh:mm:ss:ff（按 30fps 显示帧）
const toTimecode = (timeMs: number) => {
  const totalMs = Math.max(0, timeMs);
  const totalSeconds = Math.floor(totalMs / 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  const frames = Math.floor(((totalMs % 1000) / 1000) * 30);
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}:${pad(frames)}`;
};
const currentTimecode = computed(() => toTimecode(timelineStore.currentTime));
const durationTimecode = computed(() => toTimecode(timelineStore.duration));
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
// Invalidates stale async buffer-loading work whenever audio is rescheduled.
let audioPlaybackRequestId = 0;

const isAtTimelineEnd = (timeMs = timelineStore.currentTime) => {
  return timelineStore.duration > 0 && timeMs >= timelineStore.duration - PLAYBACK_END_EPSILON_MS;
};

async function startAudioPlayback(startTimeMs: number) {
  const requestId = ++audioPlaybackRequestId;
  audioEngine.stopAll();

  // 确保 AudioContext 处于运行状态
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
        void audioEngine.loadAudioBuffer(resource.url).then(buffer => {
          if (requestId !== audioPlaybackRequestId || !timelineStore.isPlaying) return;
          // Decoding may complete long after playback started. Align to the
          // current BAS clock, not the stale time captured before loading.
          const currentMs = basService.getCurrentTime();
          const elapsedMs = Math.max(0, currentMs - clipStart);
          const remainingMs = clip.duration - elapsedMs;
          const offsetSec = ((clip.sourceInMs ?? 0) + elapsedMs) / 1000;
          const durationSec = Math.min(remainingMs / 1000, buffer.duration - offsetSec);
          if (durationSec <= 0) return;
          const when = audioEngine.getCurrentTime() + Math.max(0, clipStart - currentMs) / 1000;
          audioEngine.scheduleClip(clip.id, buffer, when, offsetSec, durationSec, volumeDb);
        }).catch(err => {
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

// ... (handleWheel, startDrag, onDrag, stopDrag helpers remain same)

// Computed styles

const contentStyle = computed(() => ({
  transform: `translate(${position.value.x}px, ${position.value.y}px) scale(${scale.value})`,
  transformOrigin: "0 0"
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
  const newScale = Math.min(Math.max(MIN_SCALE, scale.value * (1 + zoomDelta)), MAX_SCALE);

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
      throw new Error(formatBasParseError(error, code, ranges));
    } finally {
      if (measurement) measurement.parseMs = performance.now() - parseStart;
    }
    if (revision !== previewRevision || previewUnmounted) {
      if (measurement) measurement.outcome = "superseded";
      return false;
    }
    const definitions = parsed.defs.filter(definition => definition.type === "DefText").map(definition => ({
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

// 自动刷新预览（当资源或时间轴改变时）
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
    // 播放时隐藏舞台溢出内容，暂停时恢复
    if (danmakuRef.value) {
      danmakuRef.value.style.overflow = isPlayingNow ? "hidden" : "";
    }

    if (!isPlayingNow && needsRecompile.value) schedulePreview();
  }
);

watch(
  () => basInitialized.value,
  ready => {
    if (ready && !timelineStore.isPlaying && needsRecompile.value) schedulePreview();
  }
);

// Fullscreen change handler (needs stable reference for cleanup)
const onFullscreenChange = () => {
  isFullscreen.value = document.fullscreenElement !== null;
};

const onVisibilityChange = () => {
  if (document.hidden) stopPlayback();
};

// Initial centering and BAS init
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
  if (containerRef.value) {
    // 编辑器恢复项目时暂时隐藏；等到容器有实际尺寸后再居中。
    viewportObserver = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width <= 0 || entry.contentRect.height <= 0) return;
      const previous = viewportSize.value;
      const shouldFit = previous.width === 0 || isAtFit.value;
      viewportSize.value = { width: entry.contentRect.width, height: entry.contentRect.height };
      if (shouldFit) fitToScreen();
      else {
        position.value.x += (viewportSize.value.width - previous.width) / 2;
        position.value.y += (viewportSize.value.height - previous.height) / 2;
      }
    });
    viewportObserver.observe(containerRef.value);
  }

  window.addEventListener("mousemove", onDrag);
  window.addEventListener("mouseup", stopDrag);

  // 监听全屏状态变化
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("visibilitychange", onVisibilityChange);

  // 初始化 BAS 弹幕服务
  nextTick(() => {
    const danmakuEl = document.getElementById("danmaku");
    if (danmakuEl) {
      try {
        // 重新打开项目或热更新后，旧实例仍可能绑定到已移除的画布。
        basService.pause();
        basService.clear();
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
  previewUnmounted = true;
  ++previewRevision;
  if (previewFrame !== null) cancelAnimationFrame(previewFrame);
  viewportObserver?.disconnect();
  canvasObserver?.disconnect();
  timelineStore.canvasReferenceSize = null;
  timelineStore.parentReferenceSizes = {};
  window.removeEventListener("mousemove", onDrag);
  window.removeEventListener("mouseup", stopDrag);
  document.removeEventListener("fullscreenchange", onFullscreenChange);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  stopPlayback();
});

const resetView = () => {
  if (!containerRef.value) return;
  scale.value = 0.8; // Slightly zoomed out default
  centerStageView(0.8);
};

// 播放控制
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
    <div
      class="preview-playback z-20 grid shrink-0 items-center gap-x-3 border-t border-divider bg-panel px-3 text-foreground"
      data-ui="preview-playback"
    >
      <!-- Left: Timecode -->
      <div class="preview-timecode flex min-w-0 items-center gap-1.5 font-mono text-xs tabular-nums select-none">
        <span class="shrink-0 rounded-sm bg-surface px-1.5 py-1 font-medium text-foreground">{{ currentTimecode }}</span>
        <span class="text-muted-foreground/60">/</span>
        <span class="truncate text-muted-foreground" :title="durationTimecode">{{ durationTimecode }}</span>
      </div>

      <!-- Center: Transport -->
      <div class="preview-transport flex items-center gap-1">
        <button @click="playFromStart" class="transport-button" :title="t('preview.playback.fromStart')">
          <RotateCcw class="size-3.5" />
        </button>
        <button @click="seekToStart" class="transport-button" :title="t('preview.playback.seekToStart')">
          <SkipBack class="size-4 fill-current" />
        </button>
        <button
          @click="togglePlay"
          class="preview-play-button mx-1 inline-flex h-8 w-10 items-center justify-center rounded-md text-primary-foreground transition-colors"
          :title="isPlaying ? t('preview.playback.pause') : t('preview.playback.play')"
        >
          <Pause v-if="isPlaying" class="size-4 fill-current" />
          <Play v-else class="ml-0.5 size-4 fill-current" />
        </button>
        <button @click="skipForward" class="transport-button" :title="t('preview.playback.skipForward')">
          <SkipForward class="size-4 fill-current" />
        </button>
      </div>

      <!-- Right: Zoom + Resolution -->
      <div class="preview-settings flex items-center gap-1.5 justify-self-end">
        <!-- Zoom Select -->
        <div class="relative" ref="zoomMenuRef">
          <button
            @click.stop="
              isZoomMenuOpen = !isZoomMenuOpen;
              isResolutionMenuOpen = false;
            "
            class="preview-menu-trigger"
            :aria-expanded="isZoomMenuOpen"
            :title="t('preview.zoom.menu')"
          >
            <span>{{ zoomDisplayLabel }}</span>
            <ChevronDown class="size-3.5 text-muted-foreground" />
          </button>
          <div
            v-if="isZoomMenuOpen"
            class="preview-menu absolute right-0 bottom-full z-50 mb-2 w-44 overflow-hidden rounded-lg border border-border bg-popover p-1.5 text-popover-foreground"
          >
            <button
              @click.stop="
                fitToScreen();
                isZoomMenuOpen = false;
              "
              :class="[
                'flex h-8 w-full items-center justify-between rounded-sm px-2.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                isAtFit ? 'bg-accent text-accent-foreground' : ''
              ]"
            >
              <span>{{ t("preview.zoom.fit") }}</span>
              <Check v-if="isAtFit" class="size-4" />
            </button>
            <div class="my-1.5 h-px bg-border"></div>
            <button
              v-for="preset in ZOOM_PRESETS"
              :key="preset"
              @click.stop="
                setViewportPercent(preset);
                isZoomMenuOpen = false;
              "
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
            @click.stop="
              isResolutionMenuOpen = !isResolutionMenuOpen;
              isZoomMenuOpen = false;
            "
            class="preview-menu-trigger"
            :aria-expanded="isResolutionMenuOpen"
            :title="t('preview.resolution.menu')"
          >
            <span>{{ canvasSizeLabel }}</span>
            <ChevronDown class="size-3.5 text-muted-foreground" />
          </button>
          <div
            v-if="isResolutionMenuOpen"
            class="preview-menu absolute right-0 bottom-full z-50 mb-2 w-72 overflow-hidden rounded-lg border border-border bg-popover p-2 text-popover-foreground"
          >
            <!-- 快捷预设 -->
            <div class="flex flex-col gap-1">
              <button
                v-for="preset in CANVAS_PRESETS"
                :key="preset.label"
                @click.stop="
                  setCanvasResolution(preset.width, preset.height);
                  isResolutionMenuOpen = false;
                "
                :class="[
                  'flex h-10 w-full items-center gap-3 rounded-sm px-2.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground',
                  isCanvasPresetSelected(preset) ? 'bg-accent text-accent-foreground' : ''
                ]"
              >
                <span :class="['shrink-0 rounded-[2px] border border-current opacity-70', preset.previewClass]"></span>
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
                <span class="mb-1 block text-xs text-muted-foreground">{{ t("preview.resolution.width") }}</span>
                <input
                  v-model.number="editWidth"
                  type="number"
                  :min="CANVAS_MIN_SIZE"
                  :max="CANVAS_MAX_SIZE"
                  inputmode="numeric"
                  :aria-label="t('preview.resolution.canvasWidth')"
                  class="h-8 w-full rounded-sm border border-border bg-input px-2 text-center font-mono text-xs tabular-nums text-foreground [appearance:textfield] focus:border-ring focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  @keydown.enter.stop="applyCustomResolution()"
                />
              </label>
              <span class="pb-2 text-xs text-muted-foreground">×</span>
              <label class="min-w-0">
                <span class="mb-1 block text-xs text-muted-foreground">{{ t("preview.resolution.height") }}</span>
                <input
                  v-model.number="editHeight"
                  type="number"
                  :min="CANVAS_MIN_SIZE"
                  :max="CANVAS_MAX_SIZE"
                  inputmode="numeric"
                  :aria-label="t('preview.resolution.canvasHeight')"
                  class="h-8 w-full rounded-sm border border-border bg-input px-2 text-center font-mono text-xs tabular-nums text-foreground [appearance:textfield] focus:border-ring focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  @keydown.enter.stop="applyCustomResolution()"
                />
              </label>
              <button
                @click.stop="applyCustomResolution()"
                class="inline-flex size-8 items-center justify-center rounded-sm bg-primary text-primary-foreground transition-colors hover:brightness-110"
                :title="t('preview.resolution.applyCustomSize')"
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

.preview-playback {
  min-height: 3rem;
  grid-template-columns: minmax(0, 1fr) auto minmax(max-content, 1fr);
  grid-template-areas: "time transport settings";
}

.preview-timecode {
  grid-area: time;
}

.preview-transport {
  grid-area: transport;
  justify-self: center;
}

.preview-transport .transport-button {
  border-radius: var(--radius-sm);
}

.preview-settings {
  grid-area: settings;
}

.preview-play-button {
  background: var(--primary-button);
}

.preview-play-button:hover {
  background: var(--primary-button-hover);
}

.preview-play-button:active {
  background: color-mix(in oklab, var(--primary-button-hover) 84%, black);
}

.preview-menu-trigger {
  display: inline-flex;
  min-height: 1.75rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.375rem;
  padding-inline: 0.375rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  transition: background-color var(--motion-fast) ease, border-color var(--motion-fast) ease;
}

.preview-menu-trigger:hover {
  background: var(--accent);
}

.preview-menu-trigger[aria-expanded="true"] {
  border-color: var(--secondary-border);
  background: var(--secondary);
}

.preview-menu {
  max-width: calc(100cqw - 1.5rem);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.2);
}

.preview-view-tools button:focus-visible,
.preview-playback button:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}

@container preview-panel (width < 28rem) {
  .preview-playback {
    grid-template-columns: minmax(0, 1fr) max-content;
    grid-template-areas:
      "transport transport"
      "time settings";
    gap: 0.25rem 0.5rem;
    padding-block: 0.25rem;
  }
}
</style>
