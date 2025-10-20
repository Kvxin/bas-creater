// 导出基础 stores
export { useCounterStore } from "./counter";

// 导出 modules 中的所有 stores
export * from "./modules";

import { useCounterStore } from "./counter";
import { useThemeStore, useDanmakuStore } from "./modules";

export function useStores() {
  return {
    theme: useThemeStore(),
    counter: useCounterStore(),
    danmaku: useDanmakuStore(),
  };
}
