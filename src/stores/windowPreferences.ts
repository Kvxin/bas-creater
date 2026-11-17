import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { getWindowPreferences, setAppWindowControls, isDesktopApp } from "@/utils/desktop";
import type { WindowPreferences } from "@/types/windowPreferences";

export const useWindowPreferencesStore = defineStore("window-preferences", () => {
  const isDesktop = isDesktopApp();
  const preferences = ref<WindowPreferences>({ platform: "web", useAppWindowControls: false });
  const isSaving = ref(false);
  const hasError = ref(false);
  const isLinux = computed(() => isDesktop && preferences.value.platform === "linux");
  const hasTrafficLights = computed(() => isDesktop && preferences.value.platform === "macos");
  const hasCustomControls = computed(() => isDesktop && preferences.value.useAppWindowControls);
  const usesCustomTitleBar = computed(() => hasTrafficLights.value || hasCustomControls.value);

  const initialize = async () => {
    try {
      preferences.value = await getWindowPreferences();
    } catch (error) {
      console.error("[WindowPreferences] 读取窗口设置失败", error);
      // IPC 不可用时保留一组可操作的按钮；正常启动以 Rust 返回的平台为准。
      preferences.value = { platform: isDesktopApp() ? "unknown" : "web", useAppWindowControls: isDesktopApp() };
      hasError.value = true;
    }
  };

  const setCustomControls = async (enabled: boolean) => {
    if (!isLinux.value || isSaving.value) return;
    isSaving.value = true;
    hasError.value = false;
    try {
      preferences.value = await setAppWindowControls(enabled);
    } catch (error) {
      console.error("[WindowPreferences] 切换窗口设置失败", error);
      hasError.value = true;
    } finally {
      isSaving.value = false;
    }
  };

  return {
    preferences,
    isLinux,
    hasTrafficLights,
    hasCustomControls,
    usesCustomTitleBar,
    isSaving,
    hasError,
    initialize,
    setCustomControls
  };
});
