<script setup lang="ts">
import { ref, computed } from "vue";
import { Clock, ZoomIn, ZoomOut } from "lucide-vue-next";
import TimeRuler from "./TimeRuler.vue";
import { formatTime } from "@/utils/timeline";

// 时间轴缩放比例 (1-100)
const scale = ref(50);
// 当前播放时间（毫秒）
const currentTime = ref(12050);
// 滚动偏移量
const scrollLeft = ref(0);

// 缩放控制
const zoomIn = () => {
  scale.value = Math.min(100, scale.value + 10);
};

const zoomOut = () => {
  scale.value = Math.max(10, scale.value - 10);
};

// 格式化当前时间显示（时:分:秒:帧）
const currentTimeDisplay = computed(() => {
  const { h, m, s, ms } = formatTime(currentTime.value);
  const frames = Math.floor((ms / 1000) * 30); // 假设30fps
  return `${h > 0 ? String(h).padStart(2, "0") + ":" : ""}${String(m).padStart(
    2,
    "0"
  )}:${String(s).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
});
</script>

<template>
  <div
    class="h-full w-full bg-sidebar border-t border-sidebar-border flex flex-col select-none"
  >
    <!-- 顶部工具栏 -->
    <div
      class="h-8 bg-sidebar-accent/30 border-b border-sidebar-border flex items-center px-2 text-xs text-muted-foreground gap-4"
    >
      <Clock class="size-3" />
      <span class="font-mono">{{ currentTimeDisplay }}</span>
      <div class="flex-1"></div>
      <div class="flex items-center gap-2">
        <span class="text-[10px]">{{ scale }}%</span>
        <div class="flex gap-1">
          <button
            class="p-1 hover:bg-sidebar-accent rounded cursor-pointer"
            @click="zoomOut"
            title="缩小"
          >
            <ZoomOut class="size-3" />
          </button>
          <button
            class="p-1 hover:bg-sidebar-accent rounded cursor-pointer"
            @click="zoomIn"
            title="放大"
          >
            <ZoomIn class="size-3" />
          </button>
        </div>
      </div>
    </div>

    <!-- 时间刻度尺 -->
    <div class="border-b border-sidebar-border/50">
      <TimeRuler :scale="scale" :scroll-left="scrollLeft" :padding-left="8" />
    </div>

    <!-- 轨道区域 -->
    <div class="flex-1 relative overflow-hidden bg-sidebar p-2">
      <!-- Timeline Tracks -->
      <div class="space-y-1">
        <div
          class="h-8 bg-sidebar-accent/50 rounded w-full relative border border-sidebar-border/50"
        >
          <div
            class="absolute left-[10%] w-[30%] h-full bg-primary/20 border border-primary/50 rounded flex items-center px-2 text-xs text-primary-foreground truncate"
          >
            Clip_01.mp4
          </div>
        </div>
        <div
          class="h-8 bg-sidebar-accent/50 rounded w-full relative border border-sidebar-border/50"
        >
          <div
            class="absolute left-[35%] w-[20%] h-full bg-chart-1/20 border border-chart-1/50 rounded flex items-center px-2 text-xs text-foreground truncate"
          >
            Audio_Track.mp3
          </div>
        </div>
      </div>

      <!-- Playhead -->
      <div class="absolute top-0 left-[30%] h-full w-px bg-destructive z-10">
        <div
          class="absolute top-0 -left-[5px] w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-8 border-t-destructive"
        ></div>
      </div>
    </div>
  </div>
</template>
