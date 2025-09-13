<script setup lang="ts">
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  ZoomIn,
  ZoomOut,
} from "lucide-vue-next";
import { Button } from "@/components/ui/button";

const props = defineProps<{
  isPlaying: boolean;
  zoom: number;
}>();

const emit = defineEmits<{
  (e: "toggle"): void;
  (e: "zoom-in"): void;
  (e: "zoom-out"): void;
}>();
</script>

<template>
  <div class="flex-1 bg-black/90 flex items-center justify-center relative">
    <div class="danmaku-stage"></div>
    <div
      class="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-card/90 backdrop-blur-sm rounded-lg p-3 flex items-center gap-3 border border-border"
    >
      <Button variant="ghost" size="sm">
        <SkipBack class="w-4 h-4" />
      </Button>
      <Button variant="ghost" size="sm" @click="$emit('toggle')">
        <Pause v-if="props.isPlaying" class="w-4 h-4" />
        <Play v-else class="w-4 h-4" />
      </Button>
      <Button variant="ghost" size="sm">
        <SkipForward class="w-4 h-4" />
      </Button>
      <div class="w-px h-6 bg-border mx-2" />
      <Button variant="ghost" size="sm" @click="$emit('zoom-out')">
        <ZoomOut class="w-4 h-4" />
      </Button>
      <span class="text-sm font-mono w-12 text-center">{{ props.zoom }}%</span>
      <Button variant="ghost" size="sm" @click="$emit('zoom-in')">
        <ZoomIn class="w-4 h-4" />
      </Button>
    </div>
  </div>
</template>
