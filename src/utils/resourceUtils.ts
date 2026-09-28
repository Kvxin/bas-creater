import { i18n } from "@/i18n";
import type { AnyDanmu } from "@/types/danmu";
import type { AudioResource } from "@/types/resource";

// 纯模块（无组件实例）里通过 i18n.global.t 取词；这些函数都在渲染期间被调用，
// 因此语言切换会自动触发重新渲染。
export const getDefaultName = (item: AnyDanmu | AudioResource): string => {
  switch (item.type) {
    case "text":
      return i18n.global.t("danmu.type.text");
    case "button":
      return i18n.global.t("danmu.type.button");
    case "path":
      return i18n.global.t("danmu.type.path");
    case "audio-file":
      return (
        (item as AudioResource).file.name ||
        i18n.global.t("resources.unnamedAudio")
      );
    default:
      return i18n.global.t("resources.unknownItem");
  }
};

export const getItemName = (item: AnyDanmu | AudioResource): string => {
  return item.name || getDefaultName(item);
};

export const getItemTypeLabel = (type: string): string => {
  switch (type) {
    case "text":
      return i18n.global.t("danmu.short.text");
    case "button":
      return i18n.global.t("danmu.short.button");
    case "path":
      return i18n.global.t("danmu.short.path");
    case "audio-file":
      return i18n.global.t("danmu.short.audio");
    default:
      return i18n.global.t("danmu.short.unknown");
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
