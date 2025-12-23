import type { AnyDanmu } from "@/types/danmu";
import type { AudioResource } from "@/types/resource";

export const getDefaultName = (item: AnyDanmu | AudioResource): string => {
  switch (item.type) {
    case "text":
      return "文本弹幕";
    case "button":
      return "按钮弹幕";
    case "path":
      return "路径弹幕";
    case "audio-file":
      return (item as AudioResource).file.name || "未命名音频";
    default:
      return "未知项目";
  }
};

export const getItemName = (item: AnyDanmu | AudioResource): string => {
  return item.name || getDefaultName(item);
};

export const getItemTypeLabel = (type: string): string => {
  switch (type) {
    case "text":
      return "文本";
    case "button":
      return "按钮";
    case "path":
      return "路径";
    case "audio-file":
      return "音频";
    default:
      return "未知";
  }
};

export const formatDuration = (ms?: number): string => {
  if (!ms) return "--";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(
    remainingSeconds
  ).padStart(2, "0")}`;
};
