<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-vue-next";

const { t } = useI18n();
const isMaximized = ref(false);
let unlistenResized: (() => void) | undefined;
let isUnmounted = false;

const syncMaximized = async () => {
  isMaximized.value = await getCurrentWindow().isMaximized();
};

const runWindowAction = async (action: () => Promise<void>) => {
  try {
    await action();
  } catch (error) {
    console.error("[WindowControls] 窗口操作失败", error);
  }
};

const minimizeWindow = () => runWindowAction(() => getCurrentWindow().minimize());

const toggleMaximizeWindow = () =>
  runWindowAction(async () => {
    await getCurrentWindow().toggleMaximize();
    await syncMaximized();
  });

const closeWindow = () => runWindowAction(() => getCurrentWindow().close());

onMounted(async () => {
  try {
    await syncMaximized();
    // 双击标题栏、系统快捷键等途径改变窗口状态时，同步最大化/还原图标
    const unlisten = await getCurrentWindow().onResized(() => void syncMaximized());
    if (isUnmounted) unlisten();
    else unlistenResized = unlisten;
  } catch (error) {
    console.error("[WindowControls] 同步窗口状态失败", error);
  }
});

onBeforeUnmount(() => {
  isUnmounted = true;
  unlistenResized?.();
});
</script>

<template>
  <div class="flex h-full items-stretch" data-ui="window-controls">
    <button
      type="button"
      class="w-11 flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus:outline-none focus-visible:bg-accent"
      :aria-label="t('app.windowMinimize')"
      :title="t('app.windowMinimize')"
      @click="minimizeWindow"
    >
      <Minus class="size-4" />
    </button>
    <button
      type="button"
      class="w-11 flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus:outline-none focus-visible:bg-accent"
      :aria-label="isMaximized ? t('app.windowRestore') : t('app.windowMaximize')"
      :title="isMaximized ? t('app.windowRestore') : t('app.windowMaximize')"
      @click="toggleMaximizeWindow"
    >
      <Copy v-if="isMaximized" class="size-3.5 -scale-x-100" />
      <Square v-else class="size-3.5" />
    </button>
    <button
      type="button"
      class="w-11 flex items-center justify-center text-muted-foreground hover:bg-[#e81123] hover:text-white transition-colors focus:outline-none focus-visible:bg-[#e81123] focus-visible:text-white"
      :aria-label="t('app.windowClose')"
      :title="t('app.windowClose')"
      @click="closeWindow"
    >
      <X class="size-4" />
    </button>
  </div>
</template>
