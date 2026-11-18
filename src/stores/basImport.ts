import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * BAS 导入弹窗的状态。
 *
 * 与 `clipDetails` 相同的模式：右键菜单/命令只负责 `open(trackId)`，
 * 弹窗组件自身保存源码、开始时间并完成解析与写入。
 */
export const useBasImportStore = defineStore("basImport", () => {
  const visible = ref(false);
  /** 右键打开时的目标轨道；命令也可以不指定（新建轨道）。 */
  const trackId = ref<string | null>(null);

  function open(targetTrackId: string | null = null) {
    trackId.value = targetTrackId;
    visible.value = true;
  }

  function close() {
    visible.value = false;
    trackId.value = null;
  }

  return {
    visible,
    trackId,
    open,
    close
  };
});
