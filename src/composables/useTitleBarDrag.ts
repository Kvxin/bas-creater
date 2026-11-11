import { getCurrentWindow } from "@tauri-apps/api/window";

const INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

const DRAG_THRESHOLD = 4;

const isInteractiveTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null;

const runWindowAction = (action: () => Promise<void>) => {
  action().catch(error => console.error("[TitleBar] 窗口操作失败", error));
};

/**
 * 自绘标题栏的拖动与双击最大化。
 * 鼠标移动超过阈值后才开始拖动，避免 Linux 下拖动抓取指针后吞掉双击的第二次点击。
 */
export function useTitleBarDrag() {
  let pressPoint: { x: number; y: number } | null = null;

  const onMousedown = (event: MouseEvent) => {
    pressPoint = null;
    if (event.button !== 0 || event.detail > 1 || isInteractiveTarget(event.target)) return;
    event.preventDefault();
    pressPoint = { x: event.screenX, y: event.screenY };
  };

  const onMousemove = (event: MouseEvent) => {
    if (!pressPoint) return;
    if ((event.buttons & 1) === 0) {
      pressPoint = null;
      return;
    }
    const dx = Math.abs(event.screenX - pressPoint.x);
    const dy = Math.abs(event.screenY - pressPoint.y);
    if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
    pressPoint = null;
    runWindowAction(() => getCurrentWindow().startDragging());
  };

  const onMouseup = () => {
    pressPoint = null;
  };

  const onDblclick = (event: MouseEvent) => {
    pressPoint = null;
    if (event.button !== 0 || isInteractiveTarget(event.target)) return;
    runWindowAction(() => getCurrentWindow().toggleMaximize());
  };

  return {
    mousedown: onMousedown,
    mousemove: onMousemove,
    mouseup: onMouseup,
    mouseleave: onMousemove,
    dblclick: onDblclick
  };
}
