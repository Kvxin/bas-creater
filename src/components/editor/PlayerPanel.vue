<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  ZoomIn,
  ZoomOut,
} from "lucide-vue-next";
import { Button } from "@/components/ui/button";

const props = withDefaults(
  defineProps<{
    isPlaying: boolean;
    zoom: number;
    currentTime?: number;
    duration?: number;
  }>(),
  {
    currentTime: 0,
    duration: 60,
  }
);

const emit = defineEmits<{
  (e: "toggle"): void;
  (e: "zoom-in"): void;
  (e: "zoom-out"): void;
  (e: "update:current-time", value: number): void;
  (e: "ended"): void;
}>();

const localTime = ref(clamp(props.currentTime));
const SEEK_STEP = 5;

let rafId: number | null = null;
let lastTimestamp: number | null = null;

function clamp(value: number) {
  return Math.min(Math.max(value, 0), props.duration ?? 0);
}

watch(
  () => props.currentTime,
  (value) => {
    localTime.value = clamp(value);
  }
);

watch(
  () => props.duration,
  () => {
    localTime.value = clamp(localTime.value);
  }
);

watch(
  () => props.isPlaying,
  (playing) => {
    if (playing) {
      startPlayback();
    } else {
      stopPlayback();
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  stopPlayback();
});

function startPlayback() {
  if (props.duration <= 0) return;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
  }
  lastTimestamp = null;
  rafId = requestAnimationFrame(step);
}

function stopPlayback() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  lastTimestamp = null;
}

function step(timestamp: number) {
  if (!props.isPlaying) {
    stopPlayback();
    return;
  }

  if (lastTimestamp === null) {
    lastTimestamp = timestamp;
  }

  const deltaSeconds = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;

  const nextTime = clamp(localTime.value + deltaSeconds);
  applySeek(nextTime, { emitEnded: false, suppressProgressUpdate: true });

  if (nextTime >= (props.duration ?? 0)) {
    emit("ended");
    stopPlayback();
    return;
  }

  rafId = requestAnimationFrame(step);
}

function applySeek(
  time: number,
  options: { emitEnded?: boolean; suppressProgressUpdate?: boolean } = {}
) {
  const clamped = clamp(time);
  localTime.value = clamped;
  emit("update:current-time", clamped);

  if (!options.suppressProgressUpdate && clamped >= (props.duration ?? 0)) {
    if (options.emitEnded !== false) {
      emit("ended");
    }
  }
}

function skipBackward() {
  applySeek(localTime.value - SEEK_STEP, { emitEnded: false });
}

function skipForward() {
  applySeek(localTime.value + SEEK_STEP);
}

const progress = computed(() => {
  const duration = props.duration ?? 0;
  if (duration <= 0) return 0;
  return Math.min(localTime.value / duration, 1);
});

function formatTime(value: number) {
  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

const currentLabel = computed(() => formatTime(localTime.value));
const durationLabel = computed(() => formatTime(props.duration ?? 0));
</script>

<template>
  <div class="flex-1 bg-black/90 flex items-center justify-center relative">
    <div class="danmaku-stage"></div>
    <div
      class="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-card/90 backdrop-blur-sm rounded-lg p-4 flex flex-col gap-2 border border-border shadow-md"
    >
      <div class="w-72 h-1.5 rounded-full bg-border/60 overflow-hidden">
        <div
          class="h-full bg-primary transition-[width]"
          :style="{ width: `${progress * 100}%` }"
        />
      </div>
      <div class="flex items-center gap-3">
        <Button variant="ghost" size="sm" @click="skipBackward">
          <SkipBack class="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="sm" @click="$emit('toggle')">
          <Pause v-if="props.isPlaying" class="w-4 h-4" />
          <Play v-else class="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="sm" @click="skipForward">
          <SkipForward class="w-4 h-4" />
        </Button>
        <span class="text-xs font-mono min-w-[80px] text-right">
          {{ currentLabel }} / {{ durationLabel }}
        </span>
        <div class="w-px h-6 bg-border mx-1" />
        <Button variant="ghost" size="sm" @click="$emit('zoom-out')">
          <ZoomOut class="w-4 h-4" />
        </Button>
        <span class="text-sm font-mono w-12 text-center"
          >{{ props.zoom }}%</span
        >
        <Button variant="ghost" size="sm" @click="$emit('zoom-in')">
          <ZoomIn class="w-4 h-4" />
        </Button>
      </div>
    </div>
  </div>
</template>
