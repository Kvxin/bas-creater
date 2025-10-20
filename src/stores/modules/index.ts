// 导出所有 store modules
export { useThemeStore, type ThemeConfig } from "./theme";
export {
  useDanmakuStore,
  type DanmakuItem,
  type DanmakuType,
  DANMAKU_TYPE_LABELS,
} from "./danmaku";

// 如果将来有更多模块，可以在这里继续导出
// export { useUserStore } from "./user";
// export { useAppStore } from "./app";
// export { useSettingsStore } from "./settings";
