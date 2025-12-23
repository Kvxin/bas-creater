<script setup lang="ts">
import { ref, computed, watch } from "vue";
import {
  Clock,
  ZoomIn,
  ZoomOut,
  Play,
  Pause,
  Plus,
  Trash2,
} from "lucide-vue-next";
import TimeRuler from "./TimeRuler.vue";
import { formatTime } from "@/utils/timeline";
import { useTimelineStore } from "@/stores/timeline";
import { useDanmuStore } from "@/stores/danmu";
import { compileTimelineToBas } from "@/utils/compiler";
import basService from "@/utils/bas";

const timelineStore = useTimelineStore();
const danmuStore = useDanmuStore();

// 像素/秒 计算
const pixelsPerSecond = computed(() => timelineStore.zoomScale * 2);

// 总宽度 (逻辑时长 + 20% 缓冲，确保有空余拖拽空间)
const totalWidth = computed(() => {
  return ((timelineStore.duration * 1.2) / 1000) * pixelsPerSecond.value;
});

// 滚动容器
const timelineContentRef = ref<HTMLElement | null>(null);
const trackListRef = ref<HTMLElement | null>(null);
const scrollLeft = ref(0);

const handleScroll = (e: Event) => {
  const target = e.target as HTMLElement;
  scrollLeft.value = target.scrollLeft;
  
  // 同步左侧轨道列表的垂直滚动
  if (trackListRef.value) {
    trackListRef.value.scrollTop = target.scrollTop;
  }
};

// 缩放控制
const zoomIn = () => {
  timelineStore.zoomScale = Math.min(100, timelineStore.zoomScale + 10);
};

const zoomOut = () => {
  timelineStore.zoomScale = Math.max(10, timelineStore.zoomScale - 10);
};

// 格式化当前时间显示
const currentTimeDisplay = computed(() => {
  const { h, m, s, ms } = formatTime(timelineStore.currentTime);
  const frames = Math.floor((ms / 1000) * 30);
  return `${h > 0 ? String(h).padStart(2, "0") + ":" : ""}${String(m).padStart(
    2,
    "0"
  )}:${String(s).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
});

// 处理拖拽放置
const handleDrop = (event: DragEvent, trackId: string) => {
  const data = event.dataTransfer?.getData("application/json");
  if (data && timelineContentRef.value) {
    try {
      const item = JSON.parse(data);
      // 计算拖放位置的时间
      const rect = timelineContentRef.value.getBoundingClientRect();
      // 这里 relativeX 直接用 clientX - rect.left + scrollLeft 即可
      // 因为 timelineContentRef 现在就是单纯的滚动容器
      const relativeX =
        event.clientX - rect.left + scrollLeft.value;
        
      const timeMs = Math.max(
        0,
        Math.floor((relativeX / pixelsPerSecond.value) * 1000)
      );

      timelineStore.addClip(item, trackId, timeMs);
    } catch (e) {
      console.error("解析拖拽数据失败", e);
    }
  }
};

// 添加轨道
const handleAddTrack = () => {
  timelineStore.addTrack();
};

// 获取 Clip 样式
const getClipStyle = (clip: any) => {
  const left = (clip.startTime / 1000) * pixelsPerSecond.value;
  const width = (clip.duration / 1000) * pixelsPerSecond.value;
  return {
    left: `${left}px`,
    width: `${width}px`,
  };
};

const getClipName = (clip: any) => {
    return clip.name || 'Unknown Clip';
}

// 游标位置 (相对于内容区域)
const playheadStyle = computed(() => {
  const left = (timelineStore.currentTime / 1000) * pixelsPerSecond.value;
  return {
    left: `${left}px`,
  };
});

// 标尺区域的游标位置 (相对于视口，需要减去 scrollLeft)
const rulerPlayheadStyle = computed(() => {
  const rawLeft = (timelineStore.currentTime / 1000) * pixelsPerSecond.value;
  return {
    left: `${rawLeft - scrollLeft.value}px`,
    display: rawLeft - scrollLeft.value >= 0 ? 'block' : 'none' // 简单优化，视口外隐藏
  };
});

// 处理 TimeRuler 发出的点击事件
const handleRulerClick = (timeMs: number) => {
  updateTime(timeMs);
};

// 处理轨道区域点击
const handleTimelineClick = (e: MouseEvent) => {
  // 如果正在拖拽 Playhead，不处理点击
  if (isDraggingPlayhead.value) return;
  
  const rect = timelineContentRef.value!.getBoundingClientRect();
  const clickX = e.clientX - rect.left + scrollLeft.value;
  // 计算时间 (ms)
  const time = Math.max(0, (clickX / pixelsPerSecond.value) * 1000);
  
  updateTime(time);
};

const updateTime = (time: number) => {
  timelineStore.setCurrentTime(time);
  // 如果是暂停状态，也要同步 BAS 引擎时间，方便预览静态帧
  if (!timelineStore.isPlaying) {
      basService.seek(time / 1000);
  }
}

// Playhead 拖拽逻辑
const isDraggingPlayhead = ref(false);

const startDragPlayhead = (e: MouseEvent) => {
  isDraggingPlayhead.value = true;
  document.body.style.cursor = "ew-resize";
  window.addEventListener("mousemove", onDragPlayhead);
  window.addEventListener("mouseup", stopDragPlayhead);
};

const onDragPlayhead = (e: MouseEvent) => {
  if (!isDraggingPlayhead.value || !timelineContentRef.value) return;
  
  const rect = timelineContentRef.value.getBoundingClientRect();
  const moveX = e.clientX - rect.left + scrollLeft.value;
  const time = Math.max(0, (moveX / pixelsPerSecond.value) * 1000);
  
  timelineStore.setCurrentTime(time);
  if (!timelineStore.isPlaying) {
      basService.seek(time / 1000, false);
  }
};

const stopDragPlayhead = () => {
  isDraggingPlayhead.value = false;
  document.body.style.cursor = "";
  window.removeEventListener("mousemove", onDragPlayhead);
  window.removeEventListener("mouseup", stopDragPlayhead);
  
  if (!timelineStore.isPlaying) {
      basService.seek(timelineStore.currentTime / 1000, true);
  }
};

</script>

<template>
  <div
    class="h-full w-full bg-sidebar border-t border-sidebar-border flex flex-col select-none"
  >
    <!-- 顶部工具栏 -->
    <div
      class="h-9 bg-sidebar-accent/30 border-b border-sidebar-border flex items-center px-2 text-xs text-muted-foreground gap-4 shrink-0"
    >
      <Clock class="size-3.5" />
      <span class="font-mono text-foreground/80">{{ currentTimeDisplay }}</span>

      <div class="flex-1"></div>

      <div class="flex items-center gap-2">
        <span class="text-[10px] w-8 text-right"
          >{{ timelineStore.zoomScale }}%</span
        >
        <div class="flex gap-0.5 border border-sidebar-border rounded overflow-hidden">
          <button
            class="p-1 hover:bg-sidebar-accent cursor-pointer"
            @click="zoomOut"
          >
            <ZoomOut class="size-3" />
          </button>
          <div class="w-px bg-sidebar-border"></div>
          <button
            class="p-1 hover:bg-sidebar-accent cursor-pointer"
            @click="zoomIn"
          >
            <ZoomIn class="size-3" />
          </button>
        </div>
      </div>
    </div>

    <!-- 头部区域 (Header Row) -->
    <div class="flex h-8 shrink-0 bg-sidebar border-b border-sidebar-border">
      <!-- 左上角：轨道列表头 -->
      <div class="w-40 shrink-0 border-r border-sidebar-border bg-sidebar-accent/10 flex items-center px-2 text-xs font-medium text-muted-foreground z-20">
        轨道列表
      </div>
      
      <!-- 右侧：时间刻度尺 (固定视口，内部 canvas 重绘) -->
      <div class="flex-1 relative overflow-hidden cursor-pointer bg-sidebar">
        <TimeRuler 
            :scale="timelineStore.zoomScale" 
            :scroll-left="scrollLeft" 
            :padding-left="0" 
            @click="handleRulerClick"
        />
        <!-- 标尺上的游标指示器 -->
        <div 
            class="absolute top-0 bottom-0 w-px bg-destructive z-30 pointer-events-none"
            :style="rulerPlayheadStyle"
        >
            <div class="absolute -top-1 -left-1.5 w-3 h-3 bg-destructive rotate-45 rounded-[1px]"></div>
        </div>
      </div>
    </div>

    <!-- 主体区域 (Body Row) -->
    <div class="flex-1 flex overflow-hidden">
      <!-- 左侧：轨道列表 (无滚动条，由右侧控制 scrollTop) -->
      <div
        class="w-40 border-r border-sidebar-border bg-sidebar/50 flex flex-col shrink-0 overflow-hidden"
        ref="trackListRef"
      >
          <!-- 轨道头列表 -->
          <div
              v-for="track in timelineStore.tracks"
              :key="track.id"
              class="h-10 border-b border-sidebar-border flex items-center px-3 text-xs group hover:bg-sidebar-accent/30 transition-colors shrink-0"
          >
              <div class="flex-1 truncate font-medium">{{ track.name }}</div>
              <button class="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive transition-opacity">
                  <Trash2 class="size-3" />
              </button>
          </div>
          
          <button
              @click="handleAddTrack"
              class="w-full h-8 flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-primary hover:bg-sidebar-accent/50 transition-colors mt-1 shrink-0"
          >
              <Plus class="size-3" />
              添加轨道
          </button>
          
          <!-- 底部占位，防止内容被遮挡 -->
          <div class="h-20 shrink-0"></div>
      </div>

      <!-- 右侧：时间轴内容 (主滚动容器) -->
      <div
        class="flex-1 flex flex-col overflow-auto relative bg-background/30"
        ref="timelineContentRef"
        @scroll="handleScroll"
      >
        <!-- Tracks Container -->
        <div
          class="relative"
          :style="{ width: Math.max(1000, totalWidth) + 'px' }"
          @mousedown.self="handleTimelineClick"
        >
            <!-- 轨道行 -->
            <div
                v-for="track in timelineStore.tracks"
                :key="track.id"
                class="h-10 border-b border-sidebar-border/50 relative group bg-sidebar/10 hover:bg-sidebar/30 transition-colors"
                @dragover.prevent
                @drop="handleDrop($event, track.id)"
            >
                <!-- Clips -->
                <div
                    v-for="clip in track.clips"
                    :key="clip.id"
                    class="absolute top-1 bottom-1 rounded border border-primary/40 bg-primary/20 hover:bg-primary/30 text-[10px] flex items-center px-2 text-primary-foreground overflow-hidden cursor-move select-none"
                    :style="getClipStyle(clip)"
                    :title="getClipName(clip)"
                >
                    <span class="truncate text-foreground/90 font-medium">{{ getClipName(clip) }}</span>
                </div>
            </div>
            
            <!-- 底部占位 -->
            <div class="h-20"></div>

            <!-- Playhead Line (内容区域) -->
            <div 
                class="absolute top-0 bottom-0 w-px bg-destructive z-30 group cursor-ew-resize"
                :style="playheadStyle"
                @mousedown.stop="startDragPlayhead"
            >
                 <!-- 拖拽把手 (只在内容区显示一个透明的点击区域即可，或者显示线) -->
                 <div class="absolute top-0 -left-2 w-4 h-full bg-transparent"></div> <!-- Hit area -->
            </div>
        </div>
      </div>
    </div>
  </div>
</template>
