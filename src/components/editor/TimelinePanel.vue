<script setup lang="ts">
import { ref, computed, watch, reactive, onMounted, onUnmounted } from "vue";
import {
  Clock,
  ZoomIn,
  ZoomOut,
  Play,
  Pause,
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
} from "lucide-vue-next";
import TimeRuler from "./TimeRuler.vue";
import { formatTime } from "@/utils/timeline";
import { useTimelineStore } from "@/stores/timeline";
import { useDanmuStore } from "@/stores/danmu";
import { compileTimelineToBas } from "@/utils/compiler";
import basService from "@/utils/bas";
import { useContextMenuStore } from "@/stores/contextMenu";

import type { AnimationSegment } from "@/types/timeline";

const timelineStore = useTimelineStore();
const danmuStore = useDanmuStore();
const contextMenu = useContextMenuStore();

const handleContextMenu = (e: MouseEvent, type: 'track' | 'clip' | 'background', data?: any) => {
  e.preventDefault();
  e.stopPropagation();

  if (type === 'track') {
    contextMenu.show(e, 'track-header', { id: data });
  } else if (type === 'clip') {
    // data is the clip object.
    contextMenu.show(e, 'timeline-clip', data);
  } else {
    contextMenu.show(e, 'timeline-bg');
  }
};

// 计算动画片段的样式
const getAnimationSegmentStyle = (clip: any, anim: AnimationSegment, index: number) => {
    let startOffset = 0;
    
    // Check if dragging or resizing this specific animation
    const isDragging = isDraggingAnimation.value && draggedAnimationId.value === anim.id;
    const isResizing = isResizingAnimation.value && resizingAnimationId.value === anim.id;
    
    // Use temp state if active
    const delay = (isDragging && anim.type === 'set') ? tempAnimationState.delay : (anim.delay || 0);
    const duration = isResizing ? tempAnimationState.duration : anim.duration;

    if (anim.type === 'set') {
        startOffset = delay;
    } else {
        // For 'then', calculate start based on previous items
        for (let i = 0; i < index; i++) {
            const prev = clip.animations[i];
            if (!prev) continue;
            
            // If prev is being resized, use its temp duration
            const prevDuration = (isResizingAnimation.value && resizingAnimationId.value === prev.id) 
                ? tempAnimationState.duration 
                : prev.duration;
            const prevDelay = (isDraggingAnimation.value && draggedAnimationId.value === prev.id && prev.type === 'set')
                ? tempAnimationState.delay
                : (prev.delay || 0);
            
            // Check if prev is a 'then' block being dragged (inserting gap AFTER it? No, insert BEFORE it)
            // If dragging prev (then block), it visually shifts right.
            // Does it affect subsequent blocks? Yes, subsequent blocks shift right too.
            const prevGap = (isDraggingAnimation.value && draggedAnimationId.value === prev.id && prev.type === 'then')
                ? tempAnimationState.delay
                : 0;

            startOffset += prevDuration + prevDelay + prevGap;
        }
        
        // If current block is 'then' and being dragged, add its own gap offset
        if (isDragging && anim.type === 'then') {
            startOffset += tempAnimationState.delay;
        }
    }
    
    const leftPercent = (startOffset / clip.duration) * 100;
    const widthPercent = (duration / clip.duration) * 100;
    
    // Colors
    const bgColor = anim.type === 'set' ? 'rgba(16, 185, 129, 0.9)' : 'rgba(245, 158, 11, 0.9)'; // Green / Orange
    const borderColor = anim.type === 'set' ? 'rgba(5, 150, 105, 1)' : 'rgba(217, 119, 6, 1)';

    return {
        left: `${leftPercent}%`,
        width: `${widthPercent}%`,
        height: '80%', // Fill most of the expanded row height
        top: '10%',
        backgroundColor: bgColor,
        borderColor: borderColor,
        borderWidth: '1px',
        borderRadius: '2px',
        zIndex: isDragging || isResizing ? 20 : 15
    };
}

const handleAnimationClick = (clip: any, anim: AnimationSegment, e: MouseEvent) => {
    e.stopPropagation();
    timelineStore.setSelectedClip(clip.id);
    timelineStore.setSelectedAnimation(anim.id);
    danmuStore.select(clip.resourceId);
}

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

// 删除轨道
const handleRemoveTrack = (trackId: string) => {
  timelineStore.removeTrack(trackId);
};

// 临时状态，用于拖拽/调整大小时的高性能更新
const tempState = reactive({
  startTime: 0,
  duration: 0
});

const tooltipPosition = reactive({ x: 0, y: 0 });

// 获取 Clip 样式
const getClipStyle = (clip: any) => {
  let startTime = clip.startTime;
  let duration = clip.duration;
  let zIndex = 1;

  // 如果正在拖拽这个片段，使用临时状态
  if (isDraggingClip.value && draggedClipId.value === clip.id) {
    startTime = tempState.startTime;
    zIndex = 100;
  } 
  // 如果正在调整这个片段大小，使用临时状态
  else if (isResizingClip.value && resizingClipId.value === clip.id) {
    startTime = tempState.startTime;
    duration = tempState.duration;
    zIndex = 100;
  }

  const left = (startTime / 1000) * pixelsPerSecond.value;
  const width = (duration / 1000) * pixelsPerSecond.value;
  
  return {
    left: `${left}px`,
    width: `${width}px`,
    zIndex
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

// Clip 拖拽逻辑
const isDraggingClip = ref(false);
const draggedClipId = ref<string | null>(null);
const initialClipStartTime = ref(0);
const dragStartX = ref(0);

const handleClipClick = (clip: any, e: MouseEvent) => {
    timelineStore.setSelectedClip(clip.id);
    danmuStore.select(clip.resourceId);
};

const startDragClip = (e: MouseEvent, clip: any) => {
  // 左键点击才触发
  if (e.button !== 0) return;
  
  // 如果点击的是 resize handle，不要触发拖拽移动
  if ((e.target as HTMLElement).dataset.handle) return;

  e.stopPropagation(); // 阻止冒泡
  
  // 拖拽时同时也选中
  timelineStore.setSelectedClip(clip.id);

  isDraggingClip.value = true;
  draggedClipId.value = clip.id;
  initialClipStartTime.value = clip.startTime;
  dragStartX.value = e.clientX;
  
  // 初始化临时状态
  tempState.startTime = clip.startTime;
  tempState.duration = clip.duration;
  
  // 初始化 tooltip 位置
  tooltipPosition.x = e.clientX + 15;
  tooltipPosition.y = e.clientY + 15;

  document.body.style.cursor = "move";
  window.addEventListener("mousemove", onDragClip);
  window.addEventListener("mouseup", stopDragClip);
};

const onDragClip = (e: MouseEvent) => {
  if (!isDraggingClip.value || !draggedClipId.value) return;
  
  const deltaX = e.clientX - dragStartX.value;
  const deltaMs = (deltaX / pixelsPerSecond.value) * 1000;
  
  let newStartTime = initialClipStartTime.value + deltaMs;
  newStartTime = Math.max(0, newStartTime); // 限制最小时间为 0
  
  // 只更新本地临时状态，不触发 Store 更新
  tempState.startTime = newStartTime;

  // 更新 tooltip 位置
  tooltipPosition.x = e.clientX + 15;
  tooltipPosition.y = e.clientY + 15;
};

const stopDragClip = () => {
  if (isDraggingClip.value && draggedClipId.value) {
      // 拖拽结束，一次性提交到 Store
      timelineStore.updateClip(draggedClipId.value, { startTime: tempState.startTime });
  }

  isDraggingClip.value = false;
  draggedClipId.value = null;
  document.body.style.cursor = "";
  window.removeEventListener("mousemove", onDragClip);
  window.removeEventListener("mouseup", stopDragClip);
};

// Clip 调整大小逻辑 (Resize)
const isResizingClip = ref(false);
const resizingClipId = ref<string | null>(null);
const resizingHandle = ref<'left' | 'right' | null>(null);
const initialResizeStartTime = ref(0);
const initialResizeDuration = ref(0);
const resizeStartX = ref(0);

const startResizeClip = (e: MouseEvent, clip: any, handle: 'left' | 'right') => {
    e.stopPropagation();
    e.preventDefault(); // 防止选中文本
    
    isResizingClip.value = true;
    resizingClipId.value = clip.id;
    resizingHandle.value = handle;
    initialResizeStartTime.value = clip.startTime;
    initialResizeDuration.value = clip.duration;
    resizeStartX.value = e.clientX;
    
    // 初始化临时状态
    tempState.startTime = clip.startTime;
    tempState.duration = clip.duration;
    
    // 初始化 tooltip 位置
    tooltipPosition.x = e.clientX + 15;
    tooltipPosition.y = e.clientY + 15;
    
    document.body.style.cursor = handle === 'left' ? 'w-resize' : 'e-resize';
    window.addEventListener('mousemove', onResizeClip);
    window.addEventListener('mouseup', stopResizeClip);
};

const onResizeClip = (e: MouseEvent) => {
    if (!isResizingClip.value || !resizingClipId.value) return;
    
    const deltaX = e.clientX - resizeStartX.value;
    const deltaMs = (deltaX / pixelsPerSecond.value) * 1000;
    
    if (resizingHandle.value === 'right') {
        // 右侧拖拽：只改变时长
        let newDuration = initialResizeDuration.value + deltaMs;
        newDuration = Math.max(100, newDuration); // 最小 100ms
        
        // 更新临时状态
        tempState.duration = newDuration;
    } else {
        // 左侧拖拽：改变开始时间和时长
        let newStartTime = initialResizeStartTime.value + deltaMs;
        let newDuration = initialResizeDuration.value - deltaMs;
        
        // 限制
        if (newStartTime < 0) {
            newStartTime = 0;
            newDuration = initialResizeStartTime.value + initialResizeDuration.value;
        }
        if (newDuration < 100) {
            newDuration = 100;
            newStartTime = initialResizeStartTime.value + initialResizeDuration.value - 100;
        }
        
        // 更新临时状态
        tempState.startTime = newStartTime;
        tempState.duration = newDuration;
    }
    
    // 更新 tooltip 位置
    tooltipPosition.x = e.clientX + 15;
    tooltipPosition.y = e.clientY + 15;
};

const stopResizeClip = () => {
    if (isResizingClip.value && resizingClipId.value) {
        // 调整结束，一次性提交到 Store
        timelineStore.updateClip(resizingClipId.value, { 
            startTime: tempState.startTime,
            duration: tempState.duration
        });
    }

    isResizingClip.value = false;
    resizingClipId.value = null;
    resizingHandle.value = null;
    document.body.style.cursor = "";
    window.removeEventListener('mousemove', onResizeClip);
    window.removeEventListener('mouseup', stopResizeClip);
};

// Animation Drag/Resize Logic
const isDraggingAnimation = ref(false);
const draggedAnimationId = ref<string | null>(null);
const initialAnimationDelay = ref(0);
const dragAnimStartX = ref(0);

const isResizingAnimation = ref(false);
const resizingAnimationId = ref<string | null>(null);
const initialAnimationDuration = ref(0);
const resizeAnimStartX = ref(0);

const tempAnimationState = reactive({
    delay: 0,
    duration: 0
});

// Helper to find animation start time (offset) within clip
const getAnimationStartOffset = (clip: any, anim: AnimationSegment, index: number) => {
    let startOffset = 0;
    if (anim.type === 'set') {
        startOffset = anim.delay || 0;
    } else {
        // 'then': cumulative
        for (let i = 0; i < index; i++) {
            const prev = clip.animations[i];
            startOffset += prev.duration + (prev.delay || 0);
        }
    }
    return startOffset;
}

const startDragAnimation = (e: MouseEvent, clip: any, anim: AnimationSegment) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).dataset.handle) return; // Ignore resize handle
    
    e.stopPropagation();
    
    timelineStore.setSelectedClip(clip.id);
    timelineStore.setSelectedAnimation(anim.id);

    isDraggingAnimation.value = true;
    draggedAnimationId.value = anim.id;
    dragAnimStartX.value = e.clientX;
    
    // For 'set', we track absolute delay. For 'then', we track the *new gap* (delta).
    if (anim.type === 'set') {
        initialAnimationDelay.value = anim.delay || 0;
        tempAnimationState.delay = anim.delay || 0;
    } else {
        initialAnimationDelay.value = 0; // Represents gap
        tempAnimationState.delay = 0;
    }
    
    document.body.style.cursor = "move";
    window.addEventListener("mousemove", onDragAnimation);
    window.addEventListener("mouseup", stopDragAnimation);
}

const onDragAnimation = (e: MouseEvent) => {
    if (!isDraggingAnimation.value || !draggedAnimationId.value) return;
    
    const deltaX = e.clientX - dragAnimStartX.value;
    const deltaMs = (deltaX / pixelsPerSecond.value) * 1000;
    
    // Determine type from selected animation
    // Note: We need access to the animation object or type here.
    // We can infer it or look it up.
    // Simple way: check selectedAnimationId in store? Or just assume logic based on initialization.
    // Let's look it up.
    const clip = timelineStore.tracks.find(t => t.clips.some(c => c.id === timelineStore.selectedClipId))?.clips.find(c => c.id === timelineStore.selectedClipId);
    const anim = clip?.animations?.find(a => a.id === draggedAnimationId.value);
    
    if (!anim) return;

    if (anim.type === 'set') {
        let newDelay = initialAnimationDelay.value + deltaMs;
        newDelay = Math.max(0, newDelay);
        tempAnimationState.delay = newDelay;
    } else {
        // 'then': dragging right creates a gap
        let gap = deltaMs; // initialAnimationDelay is 0
        gap = Math.max(0, gap);
        tempAnimationState.delay = gap;
    }
}

const stopDragAnimation = () => {
    if (isDraggingAnimation.value && draggedAnimationId.value && timelineStore.selectedClipId) {
        const clip = timelineStore.tracks.find(t => t.clips.some(c => c.id === timelineStore.selectedClipId))?.clips.find(c => c.id === timelineStore.selectedClipId);
        const anim = clip?.animations?.find(a => a.id === draggedAnimationId.value);

        if (clip && anim) {
            if (anim.type === 'set') {
                timelineStore.updateClipAnimation(
                    timelineStore.selectedClipId, 
                    draggedAnimationId.value, 
                    { delay: tempAnimationState.delay }
                );
            } else if (tempAnimationState.delay > 50) { // Threshold to create gap
                // Create 'gap' animation
                const index = clip.animations!.findIndex(a => a.id === anim.id);
                if (index !== -1) {
                    const gapAnim: AnimationSegment = {
                        id: `anim_${Date.now()}`,
                        type: 'then',
                        duration: tempAnimationState.delay,
                        properties: {} // Empty properties = maintain state
                    };
                    timelineStore.insertClipAnimation(timelineStore.selectedClipId, index, gapAnim);
                }
            }
        }
    }
    isDraggingAnimation.value = false;
    draggedAnimationId.value = null;
    document.body.style.cursor = "";
    window.removeEventListener("mousemove", onDragAnimation);
    window.removeEventListener("mouseup", stopDragAnimation);
}

const startResizeAnimation = (e: MouseEvent, clip: any, anim: AnimationSegment) => {
    e.stopPropagation();
    e.preventDefault();
    
    timelineStore.setSelectedClip(clip.id);
    timelineStore.setSelectedAnimation(anim.id);

    isResizingAnimation.value = true;
    resizingAnimationId.value = anim.id;
    initialAnimationDuration.value = anim.duration;
    resizeAnimStartX.value = e.clientX;
    
    tempAnimationState.duration = anim.duration;
    
    document.body.style.cursor = "e-resize";
    window.addEventListener("mousemove", onResizeAnimation);
    window.addEventListener("mouseup", stopResizeAnimation);
}

const onResizeAnimation = (e: MouseEvent) => {
    if (!isResizingAnimation.value || !resizingAnimationId.value) return;
    
    const deltaX = e.clientX - resizeAnimStartX.value;
    const deltaMs = (deltaX / pixelsPerSecond.value) * 1000;
    
    let newDuration = initialAnimationDuration.value + deltaMs;
    newDuration = Math.max(100, newDuration); // Min 100ms
    
    tempAnimationState.duration = newDuration;
}

const stopResizeAnimation = () => {
     if (isResizingAnimation.value && resizingAnimationId.value && timelineStore.selectedClipId) {
        timelineStore.updateClipAnimation(
            timelineStore.selectedClipId, 
            resizingAnimationId.value, 
            { duration: tempAnimationState.duration }
        );
    }
    isResizingAnimation.value = false;
    resizingAnimationId.value = null;
    document.body.style.cursor = "";
    window.removeEventListener("mousemove", onResizeAnimation);
    window.removeEventListener("mouseup", stopResizeAnimation);
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

// 键盘事件处理 (删除片段)
const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === "Delete" || e.key === "Backspace") {
    // 如果焦点在输入框中，不触发删除
    const activeTag = document.activeElement?.tagName.toLowerCase();
    if (activeTag === "input" || activeTag === "textarea" || (document.activeElement as HTMLElement).isContentEditable) {
      return;
    }

    if (timelineStore.selectedAnimationId && timelineStore.selectedClipId) {
      timelineStore.removeClipAnimation(timelineStore.selectedClipId, timelineStore.selectedAnimationId);
      timelineStore.selectedAnimationId = null;
    } else if (timelineStore.selectedClipId) {
      timelineStore.removeClip(timelineStore.selectedClipId);
      timelineStore.selectedClipId = null;
    }
  }
};

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
});

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
          <template v-for="track in timelineStore.tracks" :key="track.id">
              <div
                  class="h-10 border-b border-sidebar-border flex items-center px-2 text-xs group hover:bg-sidebar-accent/30 transition-colors shrink-0"
                  @contextmenu="handleContextMenu($event, 'track', track.id)"
              >
                  <button 
                      @click="timelineStore.toggleTrackExpand(track.id)"
                      class="p-0.5 hover:bg-sidebar-accent rounded mr-1 transition-colors"
                  >
                      <component :is="track.expanded ? ChevronDown : ChevronRight" class="size-3 text-muted-foreground" />
                  </button>

                  <div class="flex-1 truncate font-medium">{{ track.name }}</div>
                  <button 
                      class="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive transition-opacity"
                      @click="handleRemoveTrack(track.id)"
                  >
                      <Trash2 class="size-3" />
                  </button>
              </div>
              
              <!-- Expanded Panel Header -->
              <div v-if="track.expanded" class="h-16 border-b border-sidebar-border bg-sidebar-accent/5 flex items-center px-8 text-[10px] text-muted-foreground shrink-0 border-l-4 border-l-primary/20">
                  <span class="opacity-70">动画关键帧</span>
              </div>
          </template>
          
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
          @contextmenu.prevent="handleContextMenu($event, 'background')"
        >
            <!-- 轨道行 -->
            <template v-for="track in timelineStore.tracks" :key="track.id">
                <div
                    class="h-10 border-b border-sidebar-border/50 relative group bg-sidebar/10 hover:bg-sidebar/30 transition-colors"
                    @dragover.prevent
                    @drop="handleDrop($event, track.id)"
                >
                    <!-- Clips -->
                    <div
                        v-for="clip in track.clips"
                        :key="clip.id"
                        class="absolute top-1 bottom-1 rounded border border-primary/40 bg-primary/20 hover:bg-primary/30 text-[10px] flex items-center px-2 text-primary-foreground overflow-hidden cursor-move select-none"
                        :class="{ 'ring-2 ring-primary ring-offset-1 z-10': timelineStore.selectedClipId === clip.id }"
                        :style="getClipStyle(clip)"
                        :title="getClipName(clip)"
                        @click.stop="handleClipClick(clip, $event)"
                        @mousedown.stop="startDragClip($event, clip)"
                        @contextmenu.stop="handleContextMenu($event, 'clip', clip)"
                    >
                        <span class="truncate text-foreground/90 font-medium z-10 relative pointer-events-none">{{ getClipName(clip) }}</span>
                        
                        <!-- Resize Handles -->
                        <template v-if="timelineStore.selectedClipId === clip.id">
                            <div 
                                class="absolute left-0 top-0 bottom-0 w-2 cursor-w-resize hover:bg-primary/50 z-20 flex items-center justify-center group/handle"
                                data-handle="left"
                                @mousedown.stop="startResizeClip($event, clip, 'left')"
                            >
                                <div class="w-1 h-3 bg-primary/40 rounded-full group-hover/handle:bg-primary"></div>
                            </div>
                            
                            <div 
                                class="absolute right-0 top-0 bottom-0 w-2 cursor-e-resize hover:bg-primary/50 z-20 flex items-center justify-center group/handle"
                                data-handle="right"
                                @mousedown.stop="startResizeClip($event, clip, 'right')"
                            >
                                <div class="w-1 h-3 bg-primary/40 rounded-full group-hover/handle:bg-primary"></div>
                            </div>
                        </template>
                    </div>
                </div>

                <!-- Expanded Animation Row -->
                <div v-if="track.expanded" class="h-16 border-b border-sidebar-border/50 relative bg-sidebar/5">
                     <!-- Animation Ghost Containers (aligned with clips) -->
                     <div 
                        v-for="clip in track.clips"
                        :key="clip.id"
                        class="absolute top-0 bottom-0 pointer-events-none" 
                        :style="{ ...getClipStyle(clip), border: 'none', background: 'transparent' }" 
                    >
                         <!-- Animation Segments -->
                         <div class="absolute inset-0">
                             <div 
                                v-for="(anim, index) in clip.animations" 
                                :key="anim.id"
                                class="absolute pointer-events-auto hover:brightness-110 cursor-pointer group/anim"
                                :class="{ 'ring-1 ring-white': timelineStore.selectedAnimationId === anim.id }"
                                :style="getAnimationSegmentStyle(clip, anim, index)"
                                @click="handleAnimationClick(clip, anim, $event)"
                                @mousedown.stop="startDragAnimation($event, clip, anim)"
                                title="动画片段"
                             >
                                <!-- Resize Handle for Animation -->
                                <div 
                                    class="absolute right-0 top-0 bottom-0 w-1 cursor-e-resize hover:bg-white/50 z-20 opacity-0 group-hover/anim:opacity-100"
                                    data-handle="right"
                                    @mousedown.stop="startResizeAnimation($event, clip, anim)"
                                ></div>
                             </div>
                        </div>
                    </div>
                </div>
            </template>
            
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
    
    <!-- Drag/Resize Tooltip -->
    <div
      v-if="isDraggingClip || isResizingClip"
      class="fixed z-50 pointer-events-none bg-popover text-popover-foreground px-2 py-1.5 rounded shadow-md border border-border text-xs font-mono whitespace-pre flex flex-col gap-0.5"
      :style="{ top: tooltipPosition.y + 'px', left: tooltipPosition.x + 'px' }"
    >
      <div v-if="isDraggingClip">Start: {{ formatTime(tempState.startTime).str }}</div>
      <div v-else-if="isResizingClip">Start:    {{ formatTime(tempState.startTime).str }}
Duration: {{ formatTime(tempState.duration).str }}
End:      {{ formatTime(tempState.startTime + tempState.duration).str }}</div>
    </div>
  </div>
</template>

