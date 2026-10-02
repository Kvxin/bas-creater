<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useEventListener, useDark, useToggle } from "@vueuse/core";
import {
  Moon,
  Sun,
  Video,
  Check,
  Cloud,
  Loader2,
  Github,
} from "lucide-vue-next";
import ResourcesPanel from "./ResourcesPanel.vue";
import PreviewPanel from "./PreviewPanel.vue";
import PropertiesPanel from "./PropertiesPanel.vue";
import TimelinePanel from "./TimelinePanel.vue";
import { useI18n } from "vue-i18n";
import { SUPPORTED_LOCALES } from "@/i18n";
import { useProjectAutoSave } from "@/composables/useProjectAutoSave";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTimelineStore } from "@/stores/timeline";
import { useDanmuStore } from "@/stores/danmu";
import { compileTimelineToBas } from "@/utils/compiler";

const { t, locale } = useI18n();
const autoSave = useProjectAutoSave();
const timelineStore = useTimelineStore();
const danmuStore = useDanmuStore();
const isExportDialogOpen = ref(false);
const exportFileName = ref("bas-creater-timeline");

const openExportDialog = () => {
  isExportDialogOpen.value = true;
};

const exportTimelineAsTxt = () => {
  const content = compileTimelineToBas(timelineStore.tracks, danmuStore.danmus);
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const safeName = exportFileName.value.trim().replace(/[\\/:*?"<>|]/g, "_") || "bas-creater-timeline";
  link.download = `${safeName}.txt`;
  isExportDialogOpen.value = false;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

onMounted(async () => {
  await autoSave.restoreProject();
});

// Theme
const isDark = useDark({ initialValue: "dark" });
const toggleDark = useToggle(isDark);

// Layout State
const leftWidth = ref(450);
const rightWidth = ref(300);
const bottomHeight = ref(250);

// Drag State
const isDraggingLeft = ref(false);
const isDraggingRight = ref(false);
const isDraggingBottom = ref(false);

// Resizing Logic
const startResizeLeft = () => {
  isDraggingLeft.value = true;
};
const startResizeRight = () => {
  isDraggingRight.value = true;
};
const startResizeBottom = () => {
  isDraggingBottom.value = true;
};

const stopResize = () => {
  isDraggingLeft.value = false;
  isDraggingRight.value = false;
  isDraggingBottom.value = false;
  document.body.style.cursor = "";
};

useEventListener("mousemove", (e: MouseEvent) => {
  if (isDraggingLeft.value) {
    e.preventDefault();
    const newWidth = e.clientX;
    if (newWidth > 150 && newWidth < 600) {
      leftWidth.value = newWidth;
    }
  }
  if (isDraggingRight.value) {
    e.preventDefault();
    const newWidth = window.innerWidth - e.clientX;
    if (newWidth > 150 && newWidth < 600) {
      rightWidth.value = newWidth;
    }
  }
  if (isDraggingBottom.value) {
    e.preventDefault();
    const newHeight = window.innerHeight - e.clientY;
    if (newHeight > 100 && newHeight < 600) {
      bottomHeight.value = newHeight;
    }
  }
});

useEventListener("mouseup", stopResize);
useEventListener("mouseleave", stopResize);
</script>

<template>
  <div
    class="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden font-sans"
    data-ui="editor-shell"
  >
    <!-- Header -->
    <header
      class="h-[3.4rem] bg-background flex items-center justify-between px-3 pt-0.5 shrink-0 z-20"
    >
      <div class="flex items-center gap-2 min-w-0">
        <div class="size-8 rounded-sm hover:bg-accent flex items-center justify-center text-foreground">
          <Video class="size-5" />
        </div>
        <h1 class="h-8 px-2 rounded-sm flex items-center text-[0.9rem] font-medium tracking-normal truncate hover:bg-accent">
          DanmakuCut
        </h1>

        <!-- 自动保存状态指示徽章 -->
        <div
          class="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-muted-foreground select-none"
          :title="autoSave.lastSavedTime.value ? `上次保存时间: ${autoSave.lastSavedTime.value.toLocaleTimeString()}` : ''"
        >
          <Loader2 v-if="autoSave.saveStatus.value === 'saving'" class="size-3.5 animate-spin text-primary" />
          <Check v-else-if="autoSave.saveStatus.value === 'saved' && !autoSave.isDirty.value" class="size-3.5 text-constructive" />
          <Cloud v-else class="size-3.5 text-muted-foreground/60" />
          <span class="text-[11px]">
            {{
              autoSave.saveStatus.value === 'saving'
                ? t('app.saving')
                : autoSave.isDirty.value
                ? t('app.unsaved')
                : t('app.saved')
            }}
          </span>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <a
          href="https://github.com/Kvxin/bas-creater"
          target="_blank"
          rel="noopener noreferrer"
          class="size-8 rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-ring flex items-center justify-center"
          :aria-label="t('app.github')"
          :title="t('app.github')"
        >
          <Github class="size-4" />
        </a>
        <button
          type="button"
          @click="openExportDialog"
          class="h-8 px-3 rounded-sm bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
        >
          {{ t('app.export') }}
        </button>
        <select
          v-model="locale"
          :aria-label="t('app.language')"
          class="h-8 rounded-sm border border-border bg-background px-2 text-xs cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option v-for="item in SUPPORTED_LOCALES" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <button
          @click="toggleDark()"
          class="size-8 rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-ring flex items-center justify-center"
          :aria-label="t('app.toggleTheme')"
        >
          <Sun v-if="isDark" class="size-4" />
          <Moon v-else class="size-4" />
        </button>
        <div
          class="size-8 rounded-sm border border-border bg-linear-to-br from-primary/85 to-chart-2/75"
        ></div>
      </div>
    </header>

    <Dialog :open="isExportDialogOpen" @update:open="isExportDialogOpen = $event">
      <DialogContent class="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{{ t("app.exportTitle") }}</DialogTitle>
          <DialogDescription>{{ t("app.exportDescription") }}</DialogDescription>
        </DialogHeader>
        <div class="space-y-2">
          <Label for="export-file-name">{{ t("app.exportFileName") }}</Label>
          <Input id="export-file-name" v-model="exportFileName" :placeholder="t('app.exportFileNamePlaceholder')" autocomplete="off" @keydown.enter="exportTimelineAsTxt" />
          <p class="text-xs text-muted-foreground">{{ t("app.exportFileExtensionHint") }}</p>
        </div>
        <DialogFooter>
          <button type="button" class="h-9 px-3 rounded-sm border border-border hover:bg-accent transition-colors" @click="isExportDialogOpen = false">{{ t("app.cancel") }}</button>
          <button type="button" class="h-9 px-3 rounded-sm bg-foreground text-background font-medium hover:bg-foreground/90 transition-colors" @click="exportTimelineAsTxt">{{ t("app.exportConfirm") }}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col min-h-0 relative gap-[0.18rem] pb-3">
      <!-- Top Section -->
      <div class="flex-1 flex min-h-0 gap-[0.19rem] px-3">
        <!-- Left Panel: Resources -->
        <div class="shrink-0 flex min-w-0" :style="{ width: `${leftWidth}px` }">
          <ResourcesPanel />
        </div>

        <!-- Resizer -->
        <div
          class="w-[0.18rem] hover:w-1 bg-transparent hover:bg-primary/45 cursor-col-resize transition-all z-10 flex items-center justify-center group rounded-full"
          @mousedown="startResizeLeft"
          :aria-label="t('app.resizeResources')"
        >
          <div
            class="h-8 w-px bg-border group-hover:bg-primary rounded-full"
          ></div>
        </div>

        <!-- Middle Panel: Preview -->
        <div class="flex-1 min-w-0 relative">
          <PreviewPanel />
        </div>

        <!-- Resizer -->
        <div
          class="w-[0.18rem] hover:w-1 bg-transparent hover:bg-primary/45 cursor-col-resize transition-all z-10 flex items-center justify-center group rounded-full"
          @mousedown="startResizeRight"
          :aria-label="t('app.resizeProperties')"
        >
          <div
            class="h-8 w-px bg-border group-hover:bg-primary rounded-full"
          ></div>
        </div>

        <!-- Right Panel: Properties -->
        <div class="shrink-0 flex min-w-0" :style="{ width: `${rightWidth}px` }">
          <PropertiesPanel />
        </div>
      </div>

      <!-- Bottom Resizer -->
      <div
        class="mx-3 h-[0.18rem] hover:h-1 bg-transparent hover:bg-primary/45 cursor-row-resize transition-all z-10 flex justify-center items-center group rounded-full"
        @mousedown="startResizeBottom"
        :aria-label="t('app.resizeTimeline')"
      >
        <div
          class="w-12 h-px bg-border group-hover:bg-primary rounded-full"
        ></div>
      </div>

      <!-- Bottom Panel: Timeline -->
      <div
        class="shrink-0 relative px-3"
        :style="{ height: `${bottomHeight}px` }"
      >
        <TimelinePanel />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Prevent text selection while resizing */
:global(body.resizing) {
  user-select: none;
  cursor: col-resize;
}
</style>
