<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { getGridPixel, getGridSize, formatTime, getPixelsPerSecond } from "@/utils/timeline";

type Props = {
  scale?: number; // 缩放比例 (1-100)
  scrollLeft?: number; // 滚动偏移量（像素）
  paddingLeft?: number; // 左侧内边距（像素），用于对齐轨道
};

const props = withDefaults(defineProps<Props>(), {
  scale: 50,
  scrollLeft: 0,
  paddingLeft: 8, // 对应 p-2 = 8px
});

const emit = defineEmits<{
  (e: "click", timeMs: number): void;
}>();

// 根据点击位置计算对应的时间（毫秒）
const getTimeFromX = (clientX: number): number => {
  const container = containerRef.value;
  if (!container) return 0;

  const rect = container.getBoundingClientRect();
  // 计算相对于容器的 x 坐标，减去 paddingLeft
  const relativeX = clientX - rect.left - props.paddingLeft + props.scrollLeft;

  // 使用 timeline 工具函数反向计算时间
  const gridMs = getGridSize(props.scale);
  const pixelPerGrid = getGridPixel(props.scale, gridMs);
  const timeMs = Math.max(0, (relativeX / pixelPerGrid) * gridMs);

  return Math.round(timeMs);
};

// 处理点击事件
const handleClick = (event: MouseEvent) => {
  const timeMs = getTimeFromX(event.clientX);
  console.log(`点击时间: ${timeMs}ms (${formatTime(timeMs).str})`);
  emit("click", timeMs);
};

const canvasRef = ref<HTMLCanvasElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);
let resizeObserver: ResizeObserver | null = null;

// 颜色配置
const colors = {
  background: "transparent",
  majorTick: "hsl(var(--foreground))",
  mediumTick: "hsl(var(--muted-foreground))",
  minorTick: "hsl(var(--muted-foreground) / 0.5)",
  text: "hsl(var(--foreground))",
};

// 刻度高度配置
const tickHeight = {
  major: 14,
  medium: 8,
  minor: 4,
};

// 文字区域高度
const textAreaHeight = 14;

// 获取刻度间隔配置 (基于 PPS 像素/秒)
const getTickIntervals = (scale: number) => {
  const pps = getPixelsPerSecond(scale);

  // 1. 高倍缩放 (PPS >= 100): 1s >= 100px
  if (pps >= 100) {
    // scale=50 (100px/s) -> major=1s, medium=0.5s, minor=0.1s
    // scale=100 (200px/s) -> major=1s, medium=0.25s, minor=0.05s
    return { 
      minor: pps >= 200 ? 50 : 100, 
      medium: pps >= 200 ? 250 : 500, 
      major: 1000 
    };
  } 
  
  // 2. 中等缩放 (PPS >= 40): 1s >= 40px
  // scale=25 (50px/s)
  if (pps >= 40) {
    return { minor: 500, medium: 1000, major: 5000 };
  } 
  
  // 3. 低倍缩放 (PPS < 40)
  // scale=10 (20px/s) -> 5s=100px
  return { minor: 1000, medium: 5000, major: 10000 };
};

// 绘制时间刻度
const drawRuler = () => {
  const canvas = canvasRef.value;
  const container = containerRef.value;
  if (!canvas || !container) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // 设置canvas尺寸（考虑设备像素比）
  const dpr = window.devicePixelRatio || 1;
  const rect = container.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;

  // 清空画布
  ctx.clearRect(0, 0, width, height);

  // 获取刻度间隔
  const intervals = getTickIntervals(props.scale);
  const pps = getPixelsPerSecond(props.scale);

  // 计算可视区域对应的时间范围
  // x = paddingLeft + (time * pps / 1000) - scrollLeft
  // => time = (x - paddingLeft + scrollLeft) * 1000 / pps
  
  // 增加额外的渲染缓冲区域 (左右各 100px)
  const bufferPixel = 100;
  const startPixel = -bufferPixel;
  const endPixel = width + bufferPixel;

  const rawStartTime = ((startPixel - props.paddingLeft + props.scrollLeft) * 1000) / pps;
  const rawEndTime = ((endPixel - props.paddingLeft + props.scrollLeft) * 1000) / pps;

  // 对齐到最小刻度
  const startTime = Math.max(0, Math.floor(rawStartTime / intervals.minor) * intervals.minor);
  const endTime = Math.ceil(rawEndTime / intervals.minor) * intervals.minor;

  // 绘制刻度
  for (let time = startTime; time <= endTime; time += intervals.minor) {
    // 添加 paddingLeft 偏移，使刻度与轨道对齐
    const x =
      props.paddingLeft + getGridPixel(props.scale, time) - props.scrollLeft;

    // 再次检查可见性（虽然循环范围已经限制了，但为了保险）
    if (x < -50 || x > width + 50) continue;

    let tickH = tickHeight.minor;
    let tickColor = colors.minorTick;

    // 判断刻度类型
    if (time % intervals.major === 0) {
      tickH = tickHeight.major;
      tickColor = colors.majorTick;

      // 绘制时间文本
      const formatted = formatTime(time);
      ctx.fillStyle = colors.text;
      ctx.font = "10px sans-serif";
      // 第一个刻度左对齐，其他居中对齐
      ctx.textAlign = time === 0 ? "left" : "center";
      ctx.fillText(formatted.str, x, textAreaHeight - 2);
    } else if (time % intervals.medium === 0) {
      tickH = tickHeight.medium;
      tickColor = colors.mediumTick;
    }

    // 绘制刻度线（从底部向上绘制）
    ctx.beginPath();
    ctx.strokeStyle = tickColor;
    ctx.lineWidth = 1;
    ctx.moveTo(x, height);
    ctx.lineTo(x, height - tickH);
    ctx.stroke();
  }
};

// 监听属性变化重新绘制
watch(() => [props.scale, props.scrollLeft, props.paddingLeft], drawRuler, {
  immediate: false,
});

onMounted(() => {
  // 初始绘制
  drawRuler();

  // 监听容器大小变化
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      drawRuler();
    });
    resizeObserver.observe(containerRef.value);
  }
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
  }
});
</script>

<template>
  <div
    ref="containerRef"
    class="time-ruler w-full h-8 relative cursor-pointer"
    @click="handleClick"
  >
    <canvas
      ref="canvasRef"
      class="absolute inset-0 pointer-events-none"
    ></canvas>
  </div>
</template>

<style scoped>
.time-ruler {
  min-height: 32px;
}
</style>
