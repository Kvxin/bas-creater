<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import {
  BAR_WIDTH,
  BAR_STEP,
  WAVEFORM_GAIN_SAMPLE_COUNT,
  WAVEFORM_COLOR,
  WAVEFORM_BURN_COLOR,
} from "@/utils/audio/constants";
import { getBarFractionFromOutputAmplitude } from "@/utils/audio/audio-math";
import {
  waveformCache,
  buildWaveformSampleBuckets,
  sampleSourceWaveformSummary,
  type SourceWaveformSummary,
} from "@/utils/audio/waveform-cache";

const props = defineProps<{
  audioUrl: string;
  clipDurationMs: number;
  /** 音频源中的起始偏移（秒），用于 trim */
  sourceStartSec?: number;
  /** 增益采样数组（200个点），每个点对应片段中一个位置的线性增益 */
  gainSamples?: number[];
  /** 像素/秒 缩放比例 */
  pixelsPerSecond: number;
  /** 水平滚动位置（px） */
  scrollLeft: number;
  /** 轨道容器可视宽度（px） */
  trackWidth: number;
  /** 波形颜色 */
  color?: string;
  /** 削波指示器颜色 */
  burnColor?: string;
}>();

const containerRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

// 波形摘要缓存引用
const summaryRef = ref<SourceWaveformSummary | null>(null);
const heightRef = ref(0);
const lastRenderSignatureRef = ref<string | null>(null);

const clipDurationSec = () => Math.max(0.001, props.clipDurationMs / 1000);
const sourceStartSec = () => props.sourceStartSec ?? 0;

// ---- 清理 Canvas ----

function clearCanvas() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  lastRenderSignatureRef.value = null;
}

// ---- 主绘制函数 ----

function drawVisible() {
  const container = containerRef.value;
  const canvas = canvasRef.value;
  const summary = summaryRef.value;
  const height = heightRef.value;

  if (!container || !canvas || !summary || height <= 0) {
    clearCanvas();
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const elementWidth = containerRect.width;
  if (elementWidth <= 0) {
    clearCanvas();
    return;
  }

  // 查找可滚动的父容器以确定可视区域
  const scrollParent = findScrollParent(container);
  let clipLeft: number;
  let clipRight: number;

  if (scrollParent) {
    const parentRect = scrollParent.getBoundingClientRect();
    clipLeft = Math.max(0, parentRect.left - containerRect.left);
    clipRight = Math.min(elementWidth, parentRect.right - containerRect.left);
  } else {
    clipLeft = Math.max(0, -containerRect.left);
    clipRight = Math.min(elementWidth, window.innerWidth - containerRect.left);
  }

  const visibleWidth = clipRight - clipLeft;
  if (visibleWidth <= 0) {
    clearCanvas();
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const canvasW = Math.max(1, Math.ceil(visibleWidth * dpr));
  const canvasH = Math.max(1, Math.round(height * dpr));
  const barCount = Math.max(1, Math.floor(visibleWidth / BAR_STEP));

  const durationSec = clipDurationSec();
  const pps = props.pixelsPerSecond;
  const gain = props.gainSamples ?? null;
  const color = props.color ?? WAVEFORM_COLOR;
  const burnColor = props.burnColor ?? WAVEFORM_BURN_COLOR;

  // 构建渲染签名用于去重
  const renderSignature = JSON.stringify({
    elementWidth,
    clipLeft,
    clipRight,
    visibleWidth,
    canvasW,
    canvasH,
    barCount,
    dpr,
    clipDurationSec: durationSec,
    sourceStartSec: sourceStartSec(),
    pixelsPerSecond: pps,
    summarySourceKey: summary.sourceKey,
    summarySampleRate: summary.sampleRate,
    summaryTotalSamples: summary.totalSamples,
    summaryBucketSize: summary.bucketSize,
    gainSamples: gain,
    color,
    burnColor,
  });

  if (lastRenderSignatureRef.value === renderSignature) {
    return; // 签名未变，跳过重绘
  }
  lastRenderSignatureRef.value = renderSignature;

  // 设置 Canvas 尺寸
  canvas.width = canvasW;
  canvas.height = canvasH;
  canvas.style.width = `${visibleWidth}px`;
  canvas.style.height = `${height}px`;
  canvas.style.left = `${clipLeft}px`;

  // 构建采样桶
  const sampleBuckets = buildWaveformSampleBuckets({
    clipLeftPx: clipLeft,
    clipRightPx: clipRight,
    barCount,
    pixelsPerSecond: pps,
    clipDurationSec: durationSec,
    sourceStartSec: sourceStartSec(),
    sampleRate: summary.sampleRate,
    maxSampleExclusive: summary.totalSamples,
    barStepPx: BAR_STEP,
  });

  const amplitudes = sampleSourceWaveformSummary(summary, sampleBuckets);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvasW, canvasH);

  const backingScaleX = dpr;
  const backingScaleY = canvasH / height;
  const clipBottom = canvasH;

  for (let i = 0; i < barCount; i++) {
    const barCenterPx = clipLeft + i * BAR_STEP + BAR_WIDTH * 0.5;
    const clipCenterSec = Math.max(0, Math.min(durationSec, barCenterPx / pps));

    // 获取该位置的增益
    let gainValue = 1;
    if (gain) {
      gainValue = sampleGainAtClipTime(gain, clipCenterSec, durationSec);
    }

    const amplitude = Math.max(0, amplitudes[i] ?? 0);
    const outputAmplitude = amplitude * Math.max(0, gainValue);
    const fraction = getBarFractionFromOutputAmplitude(outputAmplitude);
    const barH = fraction > 0 ? Math.max(1, fraction * height) : 0;
    if (barH <= 0) continue;

    const barLeft = i * BAR_STEP;
    const barRight = barLeft + BAR_WIDTH;
    const deviceLeft = Math.round(barLeft * backingScaleX);
    const deviceRight = Math.max(deviceLeft + 1, Math.round(barRight * backingScaleX));
    const deviceTop = Math.round((height - barH) * backingScaleY);
    const deviceHeight = Math.max(1, clipBottom - deviceTop);

    // 绘制主波形条
    ctx.fillStyle = color;
    ctx.fillRect(deviceLeft, deviceTop, deviceRight - deviceLeft, deviceHeight);

    // 削波指示器
    if (outputAmplitude > 1) {
      const burnH = Math.max(1, Math.round(BAR_WIDTH * backingScaleY));
      ctx.fillStyle = burnColor;
      ctx.fillRect(deviceLeft, deviceTop, deviceRight - deviceLeft, burnH);
    }
  }
}

// ---- 增益采样（在片段时间线上的线性插值） ----

function sampleGainAtClipTime(samples: number[], clipTimeSec: number, durationSec: number): number {
  if (samples.length === 0 || durationSec <= 0) return 1;
  const progress = Math.max(0, Math.min(1, clipTimeSec / durationSec));
  const rawIndex = progress * (samples.length - 1);
  const lo = Math.floor(rawIndex);
  const hi = Math.min(samples.length - 1, lo + 1);
  const lowSample = samples[lo] ?? 1;
  if (lo === hi) return lowSample;
  const highSample = samples[hi] ?? lowSample;
  return lowSample + (highSample - lowSample) * (rawIndex - lo);
}

// ---- 查找可滚动父元素 ----

function findScrollParent(element: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = element.parentElement;
  while (el) {
    const overflow = getComputedStyle(el).overflow;
    if (overflow.includes("scroll") || overflow.includes("auto")) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

// ---- 加载波形数据 ----

let loadCancelToken = 0;

async function loadWaveform() {
  const token = ++loadCancelToken;
  summaryRef.value = null;
  clearCanvas();

  try {
    const summary = await waveformCache.getSourceSummary(props.audioUrl);
    if (token !== loadCancelToken) return; // 已被取消
    summaryRef.value = summary;
    drawVisible();
  } catch {
    // 加载失败（损坏文件、不支持的格式等），静默处理
    if (token !== loadCancelToken) return;
    clearCanvas();
  }
}

// ---- Resize 观察 ----

let resizeObserver: ResizeObserver | null = null;

function setupResizeObserver() {
  if (!containerRef.value) return;
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      heightRef.value = entry.contentRect.height;
      drawVisible();
    }
  });
  resizeObserver.observe(containerRef.value);
}

// ---- 滚动事件 ----

let scrollParent: HTMLElement | null = null;

function setupScrollListener() {
  const container = containerRef.value;
  if (!container) return;

  scrollParent = findScrollParent(container);
  if (scrollParent) {
    scrollParent.addEventListener("scroll", drawVisible, { passive: true });
  }
}

function teardownScrollListener() {
  if (scrollParent) {
    scrollParent.removeEventListener("scroll", drawVisible);
    scrollParent = null;
  }
}

// ---- 生命周期 ----

onMounted(() => {
  setupResizeObserver();
  setupScrollListener();
  void loadWaveform();
});

onUnmounted(() => {
  loadCancelToken++;
  resizeObserver?.disconnect();
  resizeObserver = null;
  teardownScrollListener();
});

// ---- 响应 props 变化 ----

watch(
  () => [props.audioUrl, props.clipDurationMs, props.sourceStartSec],
  () => {
    void loadWaveform();
  },
);

watch(
  () => [
    props.gainSamples,
    props.pixelsPerSecond,
    props.scrollLeft,
    props.trackWidth,
    props.color,
    props.burnColor,
  ],
  () => {
    drawVisible();
  },
);

// 暴露方法供父组件调用
defineExpose({ redraw: drawVisible });
</script>

<template>
  <div ref="containerRef" class="relative size-full pointer-events-none overflow-hidden">
    <canvas ref="canvasRef" class="absolute bottom-0 pointer-events-none" />
  </div>
</template>
