import { computed, ref, type Ref } from "vue";

const ZOOM_SENSITIVITY = 0.001;
const MIN_SCALE = 0.1;
const MAX_SCALE = 5.0;

export type UsePreviewViewportParams = {
  containerRef: Ref<HTMLElement | null>;
  canvasWidth: Ref<number>;
  canvasHeight: Ref<number>;
  translate: (key: string) => string;
};

/** 管理预览舞台的缩放、平移、自适应居中与全屏状态。 */
export function usePreviewViewport(params: UsePreviewViewportParams) {
  const { containerRef, canvasWidth, canvasHeight, translate } = params;

  const scale = ref(1);
  const position = ref({ x: 0, y: 0 });
  const isDragging = ref(false);
  const lastMousePos = { x: 0, y: 0 };
  const viewportSize = ref({ width: 0, height: 0 });
  const isFullscreen = ref(false);
  let viewportObserver: ResizeObserver | null = null;

  const fitScale = computed(() => {
    if (!viewportSize.value.width || !viewportSize.value.height) return 1;
    const paddingW = Math.max(0, viewportSize.value.width - 32);
    const paddingH = Math.max(0, viewportSize.value.height - 32);
    const sx = paddingW / canvasWidth.value;
    const sy = paddingH / canvasHeight.value;
    return Math.min(sx, sy);
  });

  const zoomPercent = computed(() => Math.round(scale.value * 100));

  const isAtFit = computed(() => Math.abs(scale.value - fitScale.value) / Math.max(0.01, fitScale.value) < 0.01);

  const zoomDisplayLabel = computed(() => (isAtFit.value ? translate("preview.zoom.fit") : `${zoomPercent.value}%`));

  const contentStyle = computed(() => ({
    transform: `translate(${position.value.x}px, ${position.value.y}px) scale(${scale.value})`,
    transformOrigin: "0 0"
  }));

  const centerStageView = (nextScale = scale.value) => {
    if (!containerRef.value) return;

    const rect = containerRef.value.getBoundingClientRect();
    position.value.x = (rect.width - canvasWidth.value * nextScale) / 2;
    position.value.y = (rect.height - canvasHeight.value * nextScale) / 2;
  };

  const fitToScreen = () => {
    const s = fitScale.value;
    scale.value = s;
    centerStageView(s);
  };

  const setViewportPercent = (percent: number) => {
    scale.value = Math.max(MIN_SCALE, Math.min(MAX_SCALE, percent / 100));
    centerStageView(scale.value);
  };

  const nudgeViewportZoom = (direction: 1 | -1) => {
    scale.value = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale.value + direction * fitScale.value * 0.25));
    centerStageView(scale.value);
  };

  const handleWheel = (e: WheelEvent) => {
    if (!containerRef.value) return;
    e.preventDefault();

    const rect = containerRef.value.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldX = (mouseX - position.value.x) / scale.value;
    const worldY = (mouseY - position.value.y) / scale.value;

    const zoomDelta = -e.deltaY * ZOOM_SENSITIVITY;
    const newScale = Math.min(Math.max(MIN_SCALE, scale.value * (1 + zoomDelta)), MAX_SCALE);

    position.value.x = mouseX - worldX * newScale;
    position.value.y = mouseY - worldY * newScale;
    scale.value = newScale;
  };

  const startDrag = (e: MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      isDragging.value = true;
      lastMousePos.x = e.clientX;
      lastMousePos.y = e.clientY;
      document.body.style.cursor = "grabbing";
    }
  };

  const onDrag = (e: MouseEvent) => {
    if (!isDragging.value) return;
    e.preventDefault();

    const dx = e.clientX - lastMousePos.x;
    const dy = e.clientY - lastMousePos.y;

    position.value.x += dx;
    position.value.y += dy;

    lastMousePos.x = e.clientX;
    lastMousePos.y = e.clientY;
  };

  const stopDrag = () => {
    isDragging.value = false;
    document.body.style.cursor = "";
  };

  const toggleFullscreen = async () => {
    if (!containerRef.value) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await containerRef.value.requestFullscreen();
      }
    } catch {
      // 全屏 API 不可用时静默忽略
    }
  };

  const onFullscreenChange = () => {
    isFullscreen.value = document.fullscreenElement !== null;
  };

  const mountViewportListeners = () => {
    if (containerRef.value) {
      // 编辑器恢复项目时暂时隐藏；等到容器有实际尺寸后再居中。
      viewportObserver = new ResizeObserver(([entry]) => {
        if (!entry || entry.contentRect.width <= 0 || entry.contentRect.height <= 0) return;
        const previous = viewportSize.value;
        const shouldFit = previous.width === 0 || isAtFit.value;
        viewportSize.value = { width: entry.contentRect.width, height: entry.contentRect.height };
        if (shouldFit) fitToScreen();
        else {
          position.value.x += (viewportSize.value.width - previous.width) / 2;
          position.value.y += (viewportSize.value.height - previous.height) / 2;
        }
      });
      viewportObserver.observe(containerRef.value);
    }

    window.addEventListener("mousemove", onDrag);
    window.addEventListener("mouseup", stopDrag);
    document.addEventListener("fullscreenchange", onFullscreenChange);
  };

  const unmountViewportListeners = () => {
    viewportObserver?.disconnect();
    window.removeEventListener("mousemove", onDrag);
    window.removeEventListener("mouseup", stopDrag);
    document.removeEventListener("fullscreenchange", onFullscreenChange);
  };

  return {
    scale,
    position,
    viewportSize,
    isFullscreen,
    fitScale,
    zoomPercent,
    isAtFit,
    zoomDisplayLabel,
    contentStyle,
    centerStageView,
    fitToScreen,
    setViewportPercent,
    nudgeViewportZoom,
    handleWheel,
    startDrag,
    toggleFullscreen,
    mountViewportListeners,
    unmountViewportListeners
  };
}
