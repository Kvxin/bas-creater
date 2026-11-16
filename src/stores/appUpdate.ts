import { computed, nextTick, ref } from "vue";
import { defineStore } from "pinia";
import { useStorage } from "@vueuse/core";
import {
  checkAppUpdate,
  downloadAppUpdate,
  getAppUpdateStatus,
  installAppUpdate,
  isDesktopApp,
  listenToUpdateProgress
} from "@/utils/desktop";
import { prepareForAppUpdate } from "@/services/updatePreparation";
import type { AppUpdateStatus, UpdateProgress } from "@/types/appUpdate";

export const useAppUpdateStore = defineStore("app-update", () => {
  const status = ref<AppUpdateStatus | null>(null);
  const autoDownload = useStorage("danmakucut:auto-download-updates", false);
  const dismissedVersion = useStorage("danmakucut:dismissed-update", "");
  const isChecking = ref(false);
  const isDownloading = ref(false);
  const isInstalling = ref(false);
  const hasChecked = ref(false);
  const error = ref("");
  const progress = ref<UpdateProgress>({ downloaded: 0, total: null });
  const isBusy = computed(() => isChecking.value || isDownloading.value || isInstalling.value);
  const showPrompt = computed(
    () => !!status.value?.availableVersion && dismissedVersion.value !== status.value.availableVersion
  );
  const errorDetail = ref("");

  const fail = (key: string, cause: unknown) => {
    error.value = key;
    errorDetail.value = cause instanceof Error ? cause.message : String(cause);
  };

  const download = async () => {
    if (isBusy.value || !status.value?.supported || !status.value.availableVersion) return;
    isDownloading.value = true;
    error.value = "";
    errorDetail.value = "";
    progress.value = { downloaded: 0, total: null };
    try {
      status.value = await downloadAppUpdate();
    } catch (cause) {
      fail("updates.downloadFailed", cause);
    } finally {
      isDownloading.value = false;
    }
  };

  const check = async () => {
    if (!isDesktopApp() || isBusy.value) return;
    isChecking.value = true;
    error.value = "";
    errorDetail.value = "";
    let succeeded = false;
    try {
      status.value = await checkAppUpdate();
      hasChecked.value = true;
      succeeded = true;
    } catch (cause) {
      fail("updates.checkFailed", cause);
    } finally {
      isChecking.value = false;
    }
    if (succeeded && autoDownload.value && !status.value?.ready) await download();
  };

  const install = async () => {
    if (isBusy.value || !status.value?.ready || !status.value.supported) return;
    isInstalling.value = true;
    error.value = "";
    errorDetail.value = "";
    try {
      await nextTick();
      if (!(await prepareForAppUpdate())) {
        error.value = "updates.saveFailed";
        return;
      }
      await installAppUpdate();
    } catch (cause) {
      fail("updates.installFailed", cause);
    } finally {
      isInstalling.value = false;
    }
  };

  const setAutoDownload = (enabled: boolean) => {
    autoDownload.value = enabled;
    if (enabled) void check();
  };
  const dismiss = () => {
    dismissedVersion.value = status.value?.availableVersion ?? "";
  };

  // 由 App 唯一调用，卸载时取消计时器和 IPC 监听。
  const start = (): (() => void) => {
    if (!isDesktopApp()) return () => {};
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getAppUpdateStatus()
      .then(result => {
        if (!disposed && !status.value) status.value = result;
      })
      .catch(cause => fail("updates.checkFailed", cause));
    void listenToUpdateProgress(value => {
      progress.value = value;
    })
      .then(stop => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(cause => fail("updates.downloadFailed", cause));
    // 开发环境不自动联网和下载正式版，但设置页仍可手动检查。
    const initial = import.meta.env.DEV ? undefined : window.setTimeout(() => void check(), 1000);
    const interval = import.meta.env.DEV ? undefined : window.setInterval(() => void check(), 6 * 60 * 60 * 1000);
    return () => {
      disposed = true;
      window.clearTimeout(initial);
      window.clearInterval(interval);
      unlisten?.();
    };
  };

  return {
    status,
    autoDownload,
    isChecking,
    isDownloading,
    isInstalling,
    hasChecked,
    error,
    errorDetail,
    progress,
    isBusy,
    showPrompt,
    check,
    download,
    install,
    dismiss,
    setAutoDownload,
    start
  };
});
