<script setup lang="ts">
import { RouterView } from "vue-router";
import GlobalContextMenu from "@/components/GlobalContextMenu.vue";
import ClipDetailsDialog from "@/components/dialogs/ClipDetailsDialog.vue";
import { onBeforeUnmount } from "vue";
import { useEventListener } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { useAppUpdateStore } from "@/stores/appUpdate";
import AppUpdatePanel from "@/components/AppUpdatePanel.vue";

const updates = useAppUpdateStore();
const { t } = useI18n();
onBeforeUnmount(updates.start());
// 编辑器的全局快捷键不受 inert 限制，安装期间在捕获阶段阻断，避免保存后又产生编辑。
useEventListener(
  window,
  "keydown",
  event => {
    if (!updates.isInstalling) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  { capture: true }
);
</script>

<template>
  <div class="contents" :inert="updates.isInstalling">
    <RouterView />
    <GlobalContextMenu />
    <ClipDetailsDialog />
  </div>
  <AppUpdatePanel
    v-if="updates.showPrompt && !updates.isInstalling"
    compact
    class="fixed bottom-4 right-4 z-[60] w-96 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover p-4 shadow-lg"
  />
  <div
    v-if="updates.isInstalling"
    role="alert"
    aria-busy="true"
    class="fixed inset-0 z-[100] flex items-center justify-center bg-background/90 p-8 text-center"
  >
    {{ t("updates.installing") }}
  </div>
</template>
