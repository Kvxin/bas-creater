<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  ZoomIn,
  ZoomOut,
} from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { storeToRefs } from "pinia";
import basService, { type BasDanmakuObj } from "@/utils/bas";
import { useDanmakuStore, type DanmakuItem } from "@/stores/modules";

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
    const clamped = clamp(value);
    localTime.value = clamped;
    if (basService.isReady() && !props.isPlaying) {
      basService.seek(clamped, false);
    }
  }
);

watch(
  () => props.duration,
  () => {
    localTime.value = clamp(localTime.value);
    if (basService.isReady() && !props.isPlaying) {
      basService.seek(localTime.value, false);
    }
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
  basService.pause();
  basService.clear();
});

function startPlayback() {
  if (props.duration <= 0) return;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
  }
  lastTimestamp = null;
  rafId = requestAnimationFrame(step);
  if (basService.isReady()) {
    basService.play();
  }
}

function stopPlayback() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  lastTimestamp = null;
  if (basService.isReady()) {
    basService.pause();
  }
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
  if (basService.isReady()) {
    basService.seek(clamped, false);
  }

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

const stageRef = ref<HTMLDivElement | null>(null);
const danmakuStore = useDanmakuStore();
const { danmakus } = storeToRefs(danmakuStore);

const pendingDanmakus = ref<DanmakuItem[]>(danmakus.value.slice());

watch(
  () => props.currentTime,
  (value) => {
    const clamped = clamp(value);
    localTime.value = clamped;
    if (basService.isReady() && !props.isPlaying) {
      basService.seek(clamped, false);
    }
  }
);

watch(
  danmakus,
  (items) => {
    pendingDanmakus.value = items.slice();
    syncDanmakus();
  },
  { deep: true }
);

function buildDanmakuPayload(
  item: DanmakuItem,
  index: number
): BasDanmakuObj {
  const row = index % 6;
  const column = Math.floor(index / 6);
  const baseY = 60 + row * 70;
  const baseX = 120 + column * 200;

  const targetName = `dm_${item.id}`;
  const isButton = item.type === "button";
  const isPath = item.type === "path";

  const textColor = isButton ? 0xffffff : isPath ? 0x4ade80 : 0xfef08a;
  const fillColor = isButton ? 0x2563eb : 0x000000;

  const def = isButton
    ? {
        type: "DefButton",
        obj_type: "button",
        name: targetName,
        attrs: {
          text: item.name,
          x: baseX,
          y: baseY,
          fontSize: 24,
          textColor,
          fillColor,
          fillAlpha: 0.85,
          alpha: 1,
          width: 160,
          height: 48,
          borderRadius: 12,
        },
      }
    : {
        type: "DefText",
        obj_type: "text",
        name: targetName,
        attrs: {
          content: item.name,
          alpha: 1,
          color: textColor,
          fontSize: 28,
          fontFamily: "SimHei",
          textShadow: 1,
          bold: 1,
          x: baseX,
          y: baseY,
        },
      };

  return {
    dmid: item.id,
    stime: item.start,
    duration: item.duration,
    defs: [def],
    sets: [
      {
        type: "Serial",
        items: [
          {
            type: "Unit",
            targetName,
            duration: Math.max(200, (item.duration ?? 3) * 1000),
            defaultEasing: "linear",
            attrs: {},
          },
          {
            type: "Unit",
            targetName,
            duration: 200,
            defaultEasing: "linear",
            attrs: { alpha: 0 },
          },
        ],
      },
    ],
  };
}

function syncDanmakus() {
  if (!basService.isReady()) return;
  basService.clear();
  pendingDanmakus.value.forEach((item, index) => {
    basService.addParsed(buildDanmakuPayload(item, index));
  });
  basService.seek(localTime.value, false);
  if (props.isPlaying) {
    basService.play();
  } else {
    basService.pause();
  }
}

onMounted(async () => {
  await nextTick();
  if (!stageRef.value) return;
  try {
    basService.init({
      container: stageRef.value,
      easing: "linear",
      visible: true,
    });
  } catch (err) {
    console.error(err);
    return;
  }
  syncDanmakus();
  basService.seek(localTime.value, false);
  if (props.isPlaying) {
    basService.play();
  } else {
    basService.pause();
  }
});
</script>

<template>
  <div class="flex-1 bg-black/90 flex items-center justify-center relative">
    <div ref="stageRef" class="danmaku-stage"></div>
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
