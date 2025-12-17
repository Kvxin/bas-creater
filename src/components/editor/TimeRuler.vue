<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { getGridPixel, getGridSize, formatTime } from "@/utils/timeline";

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

// 获取刻度间隔配置
const getTickIntervals = (scale: number) => {
  if (scale >= 80) {
    // 毫秒级
    return { minor: 50, medium: 250, major: 1000 };
  } else if (scale >= 40) {
    // 秒级
    return { minor: 1000, medium: 5000, major: 10000 };
  } else {
    // 分钟级
    return { minor: 10000, medium: 30000, major: 60000 };
  }
};

// 根据可视宽度和缩放比例计算需要显示的最大时间
const calculateMaxTime = (visibleWidth: number, scale: number) => {
  const gridMs = getGridSize(scale);
  const pixelPerMs = getGridPixel(scale, gridMs) / gridMs;
  // 计算可视区域能显示的时间，并向上取整到大刻度的倍数
  const intervals = getTickIntervals(scale);
  const visibleTimeMs = visibleWidth / pixelPerMs;
  // 向上取整到大刻度的下一个倍数，确保铺满
  return (
    Math.ceil(visibleTimeMs / intervals.major) * intervals.major +
    intervals.major
  );
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

  // 计算实际绘制区域宽度（减去左侧 padding）
  const drawableWidth = width - props.paddingLeft;

  // 根据可视宽度自动计算最大时间
  const maxTime = calculateMaxTime(drawableWidth, props.scale);

  // 绘制刻度
  for (let time = 0; time <= maxTime; time += intervals.minor) {
    // 添加 paddingLeft 偏移，使刻度与轨道对齐
    const x =
      props.paddingLeft + getGridPixel(props.scale, time) - props.scrollLeft;

    if (x < props.paddingLeft - 50 || x > width + 50) continue;

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
