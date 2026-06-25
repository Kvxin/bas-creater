<script setup lang="ts">
import { ref, computed } from "vue";
import {
  getLinePosFromDb,
  getDbFromLinePos,
  clamp,
  snapToStep,
  formatNumberForDisplay,
  isNearlyEqual,
} from "@/utils/audio/audio-math";
import {
  VOLUME_DB_MIN,
  VOLUME_DB_MAX,
  VOLUME_STEP,
  HIT_AREA_HEIGHT_PX,
  TOOLTIP_OFFSET_PX,
} from "@/utils/audio/constants";

const props = defineProps<{
  clipId: string;
  /** 当前音量（dB），用于初始渲染 */
  currentVolume: number;
  /** 元素容器的 DOMRect */
  elementRect?: DOMRect | null;
}>();

const emit = defineEmits<{
  (e: "volume-change", db: number): void;
  (e: "volume-commit", db: number): void;
  (e: "volume-discard"): void;
  (e: "select"): void;
}>();

// ---- 状态 ----

const surfaceRef = ref<HTMLDivElement | null>(null);
const isDragging = ref(false);
const activePointerId = ref<number | null>(null);
const startVolume = ref(0);
const lastPreviewVolume = ref(0);
const hasChanged = ref(false);
const tooltipPos = ref<{ x: number; y: number } | null>(null);

// ---- 计算 ----

const lineTopPercent = computed(() => getLinePosFromDb(props.currentVolume));

const volumeLabel = computed(() => {
  const digits = 1; // VOLUME_STEP = 0.1 → 1 位小数
  return `${formatNumberForDisplay(props.currentVolume, digits)} dB`;
});

const fractionDigits = computed(() => {
  const stepStr = VOLUME_STEP.toString();
  const dotIndex = stepStr.indexOf(".");
  return dotIndex === -1 ? 0 : stepStr.length - dotIndex - 1;
});

// ---- 辅助函数 ----

function clampVolume(value: number): number {
  return clamp(snapToStep(value, VOLUME_STEP), VOLUME_DB_MIN, VOLUME_DB_MAX);
}

function getVolumeFromPointer(clientY: number): number {
  const rect = surfaceRef.value?.getBoundingClientRect();
  if (!rect) return props.currentVolume;

  const clampedOffset = clamp(clientY - rect.top, 0, rect.height);
  const progressPercent = rect.height <= 0 ? 0 : (clampedOffset / rect.height) * 100;
  return clampVolume(getDbFromLinePos(progressPercent));
}

// ---- 预览 ----

function previewVolume(nextVolume: number) {
  if (isNearlyEqual(nextVolume, lastPreviewVolume.value)) return;

  emit("volume-change", nextVolume);
  lastPreviewVolume.value = nextVolume;
  hasChanged.value = !isNearlyEqual(startVolume.value, nextVolume);
}

function finishDrag(shouldCommit: boolean) {
  activePointerId.value = null;
  isDragging.value = false;

  if (shouldCommit && hasChanged.value) {
    emit("volume-commit", lastPreviewVolume.value);
  } else {
    emit("volume-discard");
  }

  hasChanged.value = false;
  lastPreviewVolume.value = startVolume.value;
  tooltipPos.value = null;
}

function updateFromPointer(clientX: number, clientY: number) {
  tooltipPos.value = {
    x: clientX + TOOLTIP_OFFSET_PX,
    y: clientY - TOOLTIP_OFFSET_PX,
  };
  previewVolume(getVolumeFromPointer(clientY));
}

// ---- 事件处理 ----

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;

  event.preventDefault();
  event.stopPropagation();

  emit("select");

  activePointerId.value = event.pointerId;
  startVolume.value = props.currentVolume;
  lastPreviewVolume.value = props.currentVolume;
  hasChanged.value = false;
  isDragging.value = true;

  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  updateFromPointer(event.clientX, event.clientY);
}

function onPointerMove(event: PointerEvent) {
  if (activePointerId.value !== event.pointerId) return;

  event.preventDefault();
  updateFromPointer(event.clientX, event.clientY);
}

function onPointerUp(event: PointerEvent) {
  if (activePointerId.value !== event.pointerId) return;

  event.preventDefault();
  event.stopPropagation();
  finishDrag(true);
}

function onPointerCancel(event: PointerEvent) {
  if (activePointerId.value !== event.pointerId) return;

  event.preventDefault();
  event.stopPropagation();
  finishDrag(false);
}

function onLostPointerCapture() {
  if (activePointerId.value === null) return;
  finishDrag(hasChanged.value);
}
</script>

<template>
  <div class="pointer-events-none absolute inset-0">
    <div ref="surfaceRef" class="absolute inset-0">
      <!-- 音量线 -->
      <div
        class="pointer-events-none absolute inset-x-0 -translate-y-1/2 border-t transition-colors"
        :class="isDragging ? 'border-white' : 'border-white/50 group-hover/audio:border-white/80'"
        :style="{ top: lineTopPercent + '%' }"
      />

      <!-- 可拖拽命中区域 -->
      <div
        class="absolute inset-x-0 -translate-y-1/2 touch-none cursor-ns-resize pointer-events-auto"
        :style="{ top: lineTopPercent + '%', height: `${HIT_AREA_HEIGHT_PX}px` }"
        title="拖动调整片段音量"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
        @lostpointercapture="onLostPointerCapture"
      />

      <!-- 浮动 dB 值 tooltip（拖动时显示） -->
      <Teleport to="body">
        <div
          v-if="isDragging && tooltipPos"
          class="pointer-events-none fixed left-0 top-0 z-9999 -translate-y-full rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white whitespace-nowrap"
          :style="{
            transform: `translate(${tooltipPos.x}px, ${tooltipPos.y}px)`,
          }"
        >
          {{ volumeLabel }}
        </div>
      </Teleport>
    </div>
  </div>
</template>
