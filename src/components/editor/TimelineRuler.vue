<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from "vue";

// Props: 支持外部控制/监听播放指针与缩放参数
const props = withDefaults(
  defineProps<{
    modelValue?: number; // 播放指针时间（ms），v-model
    height?: number; // 组件高度
    showControls?: boolean;
    initScale?: number; // 初始 px/ms
    minScale?: number;
    maxScale?: number;
    minMs?: number; // 最小时间（ms）
    maxMs?: number; // 最大时间（ms）
    lockViewport?: boolean; // 是否锁定视窗到[minMs,maxMs]并禁用缩放/平移
  }>(),
  {
    modelValue: 0,
    height: 96,
    showControls: true,
    initScale: 1,
    minScale: 0.01,
    maxScale: 10,
    minMs: 0,
    maxMs: 60000,
    lockViewport: false,
  }
);

const emit = defineEmits<{
  (e: "update:modelValue", v: number): void;
  (e: "update:scale", v: number): void;
  (e: "update:offset", v: number): void;
}>();

// Refs
const boxRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const hudRef = ref<HTMLDivElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);

// 状态
let dpr = Math.max(1, window.devicePixelRatio || 1);
let width = 0;
let height = 0;

// 时间坐标系： x = (timeMs - offsetMs) * scalePxPerMs
let scale = props.initScale; // px per ms
let offset = 0; // 左边界对应的时间 ms
let playheadTime = props.modelValue || 0; // 播放指针（ms）

// 交互

function clampOffset() {
  const min = props.minMs ?? -Infinity;
  const max = props.maxMs ?? Infinity;
  if (!isFinite(min) || !isFinite(max)) return;
  const visibleMs = width > 0 && scale > 0 ? width / scale : 0;
  const maxOffset = Math.max(min, max - visibleMs);
  if (offset < min) offset = min;
  if (offset > maxOffset) offset = maxOffset;
}

let isPointerDown = false;
let pointerStartX = 0;
let pointerStartOffset = 0;
let moved = false;
const clickThreshold = 6; // px

// 重绘节流
let needsDraw = true;
let rafId = 0;

function resizeCanvas() {
  const canvas = canvasRef.value!;
  const box = boxRef.value!;
  // Use content box size to avoid feedback loops from borders/rounding
  const cw = box.clientWidth;
  const ch = box.clientHeight;
  width = Math.max(0, Math.floor(cw));
  height = Math.max(0, Math.floor(ch));
  // Keep CSS sizing via classes (w-full h-full); only set backing-store size for DPR
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  // 如果提供了[minMs, maxMs]，让整个刻度尺刚好覆盖这个时间范围，
  // 从而与下方基于 totalMs 的百分比布局保持一致
  const min = props.minMs ?? 0;
  const max = props.maxMs ?? 0;
  const range = Math.max(0, max - min);
  if (range > 0 && width > 0) {
    scale = width / range; // px per ms，使 0~range 的时间刚好铺满宽度
    emit("update:scale", scale);
    offset = min; // 左边界从最小时间开始
    emit("update:offset", offset);
  }

  clampOffset();
  draw();
}

const niceSteps = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 30000,
  60000, 120000,
];
function chooseStep(scalePxPerMs: number) {
  const minPx = 56;
  for (const s of niceSteps) {
    if (s * scalePxPerMs >= minPx) return s;
  }
  return niceSteps[niceSteps.length - 1];
}

function formatTime(ms: number, forceSeconds?: boolean) {
  if (!forceSeconds && scale >= 1) return Math.round(ms) + " ms";
  const sec = ms / 1000;
  if (Math.abs(sec) >= 60) {
    const m = Math.floor(sec / 60);
    const s = (sec - m * 60).toFixed(2);
    return m + "m " + s + "s";
  }
  return sec.toFixed(3) + " s";
}

function draw() {
  needsDraw = false;
  const canvas = canvasRef.value!;
  const hud = hudRef.value!;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  // 背景
  ctx.fillStyle = "#f7f7f8";
  ctx.fillRect(0, 0, width, height);

  // 可见时间范围
  const startMs = offset;
  const endMs = offset + width / scale;

  // 主/次刻度
  const majorStep = chooseStep(scale);
  let minorStep = majorStep / 5;
  if (minorStep < 1) minorStep = 1;

  // 网格线与刻度
  ctx.strokeStyle = "#cfcfcf";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#333";
  ctx.font = "12px system-ui, Arial";

  // 细线
  ctx.beginPath();
  for (
    let t = Math.floor(startMs / minorStep) * minorStep;
    t <= endMs;
    t += minorStep
  ) {
    const x = Math.round((t - offset) * scale) + 0.5;
    const isMajor = Math.round(t / majorStep) * majorStep === t;
    const y0 = isMajor ? 12 : 20;
    const y1 = height * 0.55;
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
  }
  ctx.stroke();

  // 主刻度与标签
  ctx.fillStyle = "#111";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.beginPath();
  for (
    let t = Math.floor(startMs / majorStep) * majorStep;
    t <= endMs;
    t += majorStep
  ) {
    const x = Math.round((t - offset) * scale) + 0.5;
    const y0 = 8;
    const y1 = height * 0.65;
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    const label = formatTime(t, majorStep >= 1000 || scale < 0.1);
    ctx.fillText(label, x, height * 0.68);
  }
  ctx.stroke();

  // 零刻度线（0秒）
  if (0 >= startMs && 0 <= endMs) {
    const x0 = Math.round((0 - offset) * scale) + 0.5;
    ctx.strokeStyle = "#ff3b30";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, 6);
    ctx.lineTo(x0, height - 6);
    ctx.stroke();
  }

  // 底部阴影
  ctx.fillStyle = "rgba(0,0,0,0.02)";
  ctx.fillRect(0, height * 0.82, width, height * 0.18);

  // 播放指针
  const playX = (playheadTime - offset) * scale;
  if (playX >= -10 && playX <= width + 10) {
    ctx.strokeStyle = "#ff3b30";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playX + 0.5, 6);
    ctx.lineTo(playX + 0.5, height - 6);
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = "#ff3b30";
    ctx.moveTo(playX - 6, 6);
    ctx.lineTo(playX + 6, 6);
    ctx.lineTo(playX, 16);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();

  // HUD
  const centerTime = offset + width / 2 / scale;
  hud.textContent = "center: " + formatTime(centerTime);
}

function scheduleDraw() {
  if (!needsDraw) {
    needsDraw = true;
    rafId = window.requestAnimationFrame(draw);
  }
}

function toTime(clientX: number) {
  const canvas = canvasRef.value!;
  const rect = canvas.getBoundingClientRect();
  const localX = clientX - rect.left;
  return offset + localX / scale;
}

function onPointerDown(e: PointerEvent) {
  isPointerDown = true;
  moved = false;
  pointerStartX = e.clientX;
  pointerStartOffset = offset;
  canvasRef.value?.setPointerCapture?.(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  const canvas = canvasRef.value!;
  const box = boxRef.value!;
  const tooltip = tooltipRef.value!;
  const rect = canvas.getBoundingClientRect();
  const localX = e.clientX - rect.left;
  const t = offset + localX / scale;

  // tooltip in box coords
  const boxRect = box.getBoundingClientRect();
  tooltip.style.left = localX + boxRect.left + "px";
  tooltip.style.top = boxRect.top + window.scrollY + 8 + "px";
  tooltip.style.transform = "translate(-50%,-160%)";
  tooltip.style.display = "block";
  tooltip.textContent = formatTime(t);

  if (isPointerDown && !props.lockViewport) {
    const dx = e.clientX - pointerStartX;
    if (Math.abs(dx) > clickThreshold) moved = true;
    offset = pointerStartOffset - dx / scale;
    clampOffset();
    emit("update:offset", offset);
    scheduleDraw();
  }
}

function onPointerUp(e: PointerEvent) {
  isPointerDown = false;
  canvasRef.value?.releasePointerCapture?.(e.pointerId);
  const dx = e.clientX - pointerStartX;
  if (!moved && Math.abs(dx) <= clickThreshold) {
    let t = toTime(e.clientX);
    const min = props.minMs ?? -Infinity;
    const max = props.maxMs ?? Infinity;
    if (isFinite(min) && isFinite(max)) {
      if (t < min) t = min;
      if (t > max) t = max;
    }
    playheadTime = t;
    emit("update:modelValue", playheadTime);
    console.log("selected time (ms):", playheadTime);
    console.log(props.minMs, props.maxMs);
    scheduleDraw();
  }
}

function onPointerLeave() {
  const tooltip = tooltipRef.value!;
  tooltip.style.display = "none";
}

function minAllowedScale() {
  const min = props.minMs ?? 0;
  const max = props.maxMs ?? 0;
  const range = Math.max(0, max - min);
  if (width > 0 && range > 0) {
    return Math.max(props.minScale, width / range);
  }
  return props.minScale;
}

function onWheel(e: WheelEvent) {
  if (props.lockViewport) return; // 锁定视窗时禁用缩放
  e.preventDefault();
  // 以当前选中的时间节点（播放指针 playheadTime）为缩放锚点
  const anchorX = (playheadTime - offset) * scale; // 指针当前的屏幕 x 位置（px）
  const delta = e.deltaY;
  const zoomFactor = delta < 0 ? 1.12 : 0.88;
  const newScale = Math.min(
    props.maxScale,
    Math.max(minAllowedScale(), scale * zoomFactor)
  );
  if (newScale !== scale) {
    scale = newScale;
    emit("update:scale", scale);
  }
  // 保持指针在相同的屏幕 x 位置
  offset = playheadTime - anchorX / scale;
  clampOffset();
  emit("update:offset", offset);
  scheduleDraw();
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === "ArrowLeft") {
    playheadTime -= 10;
    emit("update:modelValue", playheadTime);
    scheduleDraw();
  } else if (e.key === "ArrowRight") {
    playheadTime += 10;
    emit("update:modelValue", playheadTime);
    scheduleDraw();
  }
}

function reset() {
  scale = props.initScale;
  offset = 0;
  playheadTime = 0;
  emit("update:modelValue", playheadTime);
  scheduleDraw();
}

// 暴露方法

// 初始化：0秒作为左边界（E），并限制在[minMs,maxMs]
offset = props.minMs ?? 0;
clampOffset();

defineExpose({
  reset,
  setPlayhead(ms: number) {
    playheadTime = ms;
    emit("update:modelValue", ms);
    scheduleDraw();
  },
  setScale(pxPerMs: number) {
    scale = Math.min(props.maxScale, Math.max(props.minScale, pxPerMs));
    scheduleDraw();
  },
  setOffset(ms: number) {
    offset = ms;
    scheduleDraw();
  },
});

// 生命周期
let ro: ResizeObserver | null = null;
onMounted(async () => {
  await nextTick();
  const box = boxRef.value!;
  dpr = Math.max(1, window.devicePixelRatio || 1);
  resizeCanvas();
  window.addEventListener("resize", () => {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    resizeCanvas();
  });

  // 事件
  const canvas = canvasRef.value!;
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);

  ro = new ResizeObserver(resizeCanvas);
  ro.observe(box);

  scheduleDraw();
});

onBeforeUnmount(() => {
  const canvas = canvasRef.value;
  if (canvas) {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    canvas.removeEventListener("wheel", onWheel);
  }
  window.removeEventListener("keydown", onKeyDown);
  ro?.disconnect();
  cancelAnimationFrame(rafId);
});

// 同步外部 v-model 到内部 playheadTime
watch(
  () => props.modelValue,
  (v) => {
    if (typeof v === "number" && v !== playheadTime) {
      playheadTime = v;
      scheduleDraw();
    }
  }
);
</script>

<template>
  <div class="w-full mx-auto p-2 box-border h-full">
    <div
      ref="boxRef"
      class="relative bg-[#f7f7f8] border border-[#ddd] rounded-lg overflow-hidden flex items-center select-none [touch-action:pan-y] h-full"
    >
      <canvas ref="canvasRef" class="block w-full h-full"></canvas>
      <div
        class="absolute top-0 bottom-0 left-0 w-0 border-l-2 border-dashed border-black/50 pointer-events-none"
      ></div>
      <div
        ref="hudRef"
        class="absolute left-3 top-2 bg-black/60 text-white px-2 py-1.5 rounded-md text-xs pointer-events-none"
      >
        center: 0 ms
      </div>
      <div
        ref="tooltipRef"
        style="display: none"
        class="absolute -translate-x-1/2 -translate-y-[140%] bg-[#111] text-white px-1.5 py-1 rounded text-xs pointer-events-none whitespace-nowrap"
      >
        0 ms
      </div>
    </div>

    <!-- <div v-if="showControls" class="mt-2 flex items-center gap-2">
      <label
        >缩放: <span>{{ scale.toFixed(2) }} px/ms</span></label
      >
      <button
        type="button"
        @click="reset"
        class="px-2.5 py-1.5 rounded-md border border-[#ccc] bg-white cursor-pointer"
      >
        重置
      </button>
      <label class="ml-3"
        >说明：滚轮缩放（鼠标所在位置为缩放中心），拖拽左右平移，单击设置播放指针。</label
      >
    </div> -->
  </div>
</template>
