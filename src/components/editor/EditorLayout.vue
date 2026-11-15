<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEventListener, useDark } from "@vueuse/core";
import { MessageSquareText, Check, Cloud, Loader2, Settings, ArrowLeft } from "lucide-vue-next";
import ResourcesPanel from "./ResourcesPanel.vue";
import PreviewPanel from "./PreviewPanel.vue";
import PropertiesPanel from "./PropertiesPanel.vue";
import TimelinePanel from "./TimelinePanel.vue";
import WindowControls from "./WindowControls.vue";
import AssetBundleDialog from "./AssetBundleDialog.vue";
import { bundleProject } from "@/services/storage/projectBundle";
import { useTitleBarDrag } from "@/composables/useTitleBarDrag";
import { useI18n } from "vue-i18n";
import SettingsView from "@/views/SettingsView.vue";
import { useProjectAutoSave } from "@/composables/useProjectAutoSave";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTimelineStore } from "@/stores/timeline";
import { useDanmuStore } from "@/stores/danmu";
import { compileTimelineToBas, formatBasParseError } from "@/utils/compiler";
import { parseBasDSL } from "@/utils/bas";
import { isDesktopApp, isMacOS, saveTextFile } from "@/utils/desktop";

const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ close: [] }>();
const { t, locale } = useI18n();
const autoSave = useProjectAutoSave(props.projectId);
const saveErrorMessage = computed(() => {
  const message = autoSave.lastSaveError.value.toLowerCase();
  if (message.includes("modified_externally")) return t("projects.saveConflict");
  if (message.includes("permission") || message.includes("denied") || message.includes("notallowed"))
    return t("projects.savePermission");
  if (message.includes("space") || message.includes("quota") || message.includes("disk full"))
    return t("projects.saveSpace");
  return t("projects.saveFailed");
});
const isReady = ref(false);
const loadFailed = ref(false);
const isLeaving = ref(false);
const timelineStore = useTimelineStore();
const danmuStore = useDanmuStore();
const isExportDialogOpen = ref(false);
const isBundleDialogOpen = ref(false);
const collectProject = () => bundleProject(props.projectId, autoSave.getProjectSnapshot);
const exportFileName = ref("bas-creater-timeline");
const exportError = ref("");
const isSettingsOpen = ref(false);
// 桌面端隐藏系统标题栏，由顶部 header 充当可拖动的标题栏
const isDesktop = isDesktopApp();
const hasCustomWindowControls = isDesktop && !isMacOS();
const hasTrafficLights = isDesktop && isMacOS();
const titleBarListeners = isDesktop ? useTitleBarDrag() : {};

const openExportDialog = () => {
  exportError.value = "";
  isExportDialogOpen.value = true;
};

const exportTimelineAsTxt = async () => {
  exportError.value = "";
  try {
    const ranges: Array<{ clipId: string; startLine: number; endLine: number }> = [];
    const content = compileTimelineToBas(timelineStore.rootTracks, danmuStore.danmus, {
      audioResourceIds: autoSave.getProjectSnapshot().audioMeta.map((audio) => audio.id),
      onRange: (clipId, startLine, endLine) => ranges.push({ clipId, startLine, endLine })
    });
    if (content.trim()) {
      try {
        await parseBasDSL(content);
      } catch (error) {
        throw new Error(formatBasParseError(error, content, ranges));
      }
    }
    const safeName = exportFileName.value.trim().replace(/[\\/:*?"<>|]/g, "_") || "bas-creater-timeline";
    const saved = await saveTextFile({
      fileName: `${safeName}.txt`,
      content,
      filters: [{ name: "Text", extensions: ["txt"] }]
    });
    if (saved) isExportDialogOpen.value = false;
  } catch (error) {
    exportError.value = error instanceof Error ? error.message : String(error);
  }
};

let unlistenClose: (() => void) | undefined;
let unmounted = false;
let allowWindowClose = false;

const flushBeforeLeaving = async (): Promise<boolean> => {
  if (!isReady.value && !loadFailed.value) return false;
  if (!loadFailed.value) {
    while (autoSave.isDirty.value || autoSave.saveStatus.value === "saving") {
      if (!(await autoSave.saveNow()))
        return window.confirm(`${saveErrorMessage.value}\n\n${t("projects.discardAfterSaveFailed")}`);
    }
  }
  return true;
};

onMounted(async () => {
  if (isDesktop) {
    const appWindow = getCurrentWindow();
    try {
      const unlisten = await appWindow.onCloseRequested(async event => {
        if (allowWindowClose) return;
        event.preventDefault();
        if (isLeaving.value) return;
        isLeaving.value = true;
        try {
          if (await flushBeforeLeaving()) {
            allowWindowClose = true;
            await appWindow.close();
          }
        } catch (error) {
          allowWindowClose = false;
          console.error("[Editor] Failed to close window", error);
        } finally {
          isLeaving.value = false;
        }
      });
      if (unmounted) unlisten();
      else unlistenClose = unlisten;
    } catch (error) {
      console.error("[Editor] Failed to register close handler", error);
    }
  }
  isReady.value = await autoSave.restoreProject();
  loadFailed.value = !isReady.value;
});
onBeforeUnmount(() => {
  unmounted = true;
  unlistenClose?.();
  stopResize();
});

const closeProject = async () => {
  if (isLeaving.value) return;
  isLeaving.value = true;
  try {
    if (await flushBeforeLeaving()) emit("close");
  } finally {
    isLeaving.value = false;
  }
};

// Theme
const isDark = useDark({ initialValue: "dark" });

// Layout State
const leftWidth = ref(300);
const rightWidth = ref(280);
const bottomHeight = ref(280);
const viewportWidth = ref(window.innerWidth);
const viewportHeight = ref(window.innerHeight);
// 缩小窗口时优先保留预览可用宽度，面板的拖动尺寸仍然独立保存。
const visibleLeftWidth = computed(() => Math.min(leftWidth.value, Math.max(180, viewportWidth.value - 594)));
const visibleRightWidth = computed(() =>
  Math.min(rightWidth.value, Math.max(210, viewportWidth.value - visibleLeftWidth.value - 384))
);
const visibleBottomHeight = computed(() => Math.min(bottomHeight.value, viewportHeight.value * 0.45));
useEventListener("resize", () => {
  viewportWidth.value = window.innerWidth;
  viewportHeight.value = window.innerHeight;
});

// Drag State
const isDraggingLeft = ref(false);
const isDraggingRight = ref(false);
const isDraggingBottom = ref(false);

// Resizing Logic
const startResizeLeft = () => {
  isDraggingLeft.value = true;
  document.body.style.cursor = "col-resize";
};
const startResizeRight = () => {
  isDraggingRight.value = true;
  document.body.style.cursor = "col-resize";
};
const startResizeBottom = () => {
  isDraggingBottom.value = true;
  document.body.style.cursor = "row-resize";
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
    if (newWidth >= 180 && newWidth <= 600) {
      leftWidth.value = newWidth;
    }
  }
  if (isDraggingRight.value) {
    e.preventDefault();
    const newWidth = window.innerWidth - e.clientX;
    if (newWidth >= 210 && newWidth <= 600) {
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
      class="h-12 bg-workspace text-foreground flex items-center justify-between pl-3 shrink-0 z-20 select-none border-b border-border"
      :class="{
        'border-b border-border': isDesktop,
        'pl-[5.5rem]': hasTrafficLights,
        'pr-3': !hasCustomWindowControls
      }"
      v-on="titleBarListeners"
      data-ui="title-bar"
    >
      <div class="flex items-center gap-2 min-w-0">
        <button
          type="button"
          class="size-8 flex items-center justify-center rounded-sm hover:bg-accent"
          :title="t('projects.back')"
          :aria-label="t('projects.back')"
          :disabled="isLeaving || (!isReady && !loadFailed)"
          @click="closeProject"
        >
          <ArrowLeft class="size-4" />
        </button>
        <div class="size-8 rounded-sm hover:bg-accent flex items-center justify-center text-foreground">
          <MessageSquareText class="size-5" />
        </div>
        <h1
          class="h-8 px-2 rounded-sm flex items-center text-sm font-semibold tracking-normal truncate hover:bg-accent"
        >
          {{ autoSave.projectName.value }}
        </h1>

        <!-- 自动保存状态指示徽章 -->
        <div
          class="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-muted-foreground select-none"
          :title="
            autoSave.saveStatus.value === 'error'
              ? saveErrorMessage
              : autoSave.lastSavedTime.value
                ? `上次保存时间: ${autoSave.lastSavedTime.value.toLocaleTimeString()}`
                : ''
          "
        >
          <Loader2 v-if="autoSave.saveStatus.value === 'saving'" class="size-3.5 animate-spin text-primary" />
          <Check
            v-else-if="autoSave.saveStatus.value === 'saved' && !autoSave.isDirty.value"
            class="size-3.5 text-constructive"
          />
          <Cloud v-else class="size-3.5 text-muted-foreground/60" />
          <span class="text-[11px]">
            {{
              autoSave.saveStatus.value === "saving"
                ? t("app.saving")
                : autoSave.saveStatus.value === "error"
                  ? saveErrorMessage
                  : autoSave.isDirty.value
                    ? t("app.unsaved")
                    : t("app.saved")
            }}
          </span>
        </div>
      </div>

      <div class="flex h-full shrink-0 items-center gap-2">
        <button type="button" :disabled="!isReady" @click="isBundleDialogOpen = true" class="ui-button">
          {{ locale === "en" ? "Collect project" : locale === "ja" ? "プロジェクトを収集" : "打包工程" }}
        </button>
        <button type="button" @click="openExportDialog" class="ui-button ui-button-primary">
          {{ t("app.export") }}
        </button>
        <button
          type="button"
          @click="isSettingsOpen = !isSettingsOpen"
          class="size-8 rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-ring flex items-center justify-center"
          :aria-label="isSettingsOpen ? t('app.backToEditor') : t('app.settings')"
          :title="isSettingsOpen ? t('app.backToEditor') : t('app.settings')"
          :aria-pressed="isSettingsOpen"
        >
          <ArrowLeft v-if="isSettingsOpen" class="size-4" />
          <Settings v-else class="size-4" />
        </button>
        <WindowControls v-if="hasCustomWindowControls" class="ml-1" />
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
          <Input
            id="export-file-name"
            v-model="exportFileName"
            :placeholder="t('app.exportFileNamePlaceholder')"
            autocomplete="off"
            @keydown.enter="exportTimelineAsTxt"
          />
          <p class="text-xs text-muted-foreground">{{ t("app.exportFileExtensionHint") }}</p>
        </div>
        <p v-if="exportError" role="alert" class="text-sm text-destructive break-words">{{ exportError }}</p>
        <DialogFooter>
          <button type="button" class="ui-button" @click="isExportDialogOpen = false">{{ t("app.cancel") }}</button>
          <button type="button" class="ui-button ui-button-primary" @click="exportTimelineAsTxt">
            {{ t("app.exportConfirm") }}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <AssetBundleDialog v-model:open="isBundleDialogOpen" :bundle="collectProject" />

    <!-- Main Content -->
    <div v-if="loadFailed" class="flex-1 flex items-center justify-center text-destructive">
      {{ t("projects.loadFailed") }}
    </div>
    <SettingsView v-else-if="isSettingsOpen && isReady" v-model:is-dark="isDark" @close="isSettingsOpen = false" />
    <div v-show="!isSettingsOpen && isReady" class="flex-1 flex flex-col min-h-0 relative bg-workspace pb-1.5 pt-1.5">
      <!-- Top Section -->
      <div class="flex-1 flex min-h-0 px-1.5">
        <!-- Left Panel: Resources -->
        <div class="shrink-0 flex min-w-0" :style="{ width: `${visibleLeftWidth}px` }">
          <ResourcesPanel
            :project-id="props.projectId"
            :offline-audio="autoSave.importedAudioMeta.value"
          />
        </div>

        <!-- Resizer -->
        <div
          class="panel-resizer w-1.5 cursor-col-resize z-10 flex items-center justify-center group"
          @mousedown="startResizeLeft"
          role="separator"
          tabindex="0"
          aria-orientation="vertical"
          :aria-valuenow="visibleLeftWidth"
          :aria-valuemin="180"
          :aria-valuemax="Math.min(600, Math.max(180, viewportWidth - 594))"
          @keydown.left.prevent="leftWidth = Math.max(180, visibleLeftWidth - 16)"
          @keydown.right.prevent="leftWidth = Math.min(600, visibleLeftWidth + 16)"
          :aria-label="t('app.resizeResources')"
        >
          <div class="h-8 w-px bg-border group-hover:bg-primary rounded-full"></div>
        </div>

        <!-- Middle Panel: Preview -->
        <div class="flex-1 min-w-0 relative">
          <PreviewPanel />
        </div>

        <!-- Resizer -->
        <div
          class="panel-resizer w-1.5 cursor-col-resize z-10 flex items-center justify-center group"
          @mousedown="startResizeRight"
          role="separator"
          tabindex="0"
          aria-orientation="vertical"
          :aria-valuenow="visibleRightWidth"
          :aria-valuemin="210"
          :aria-valuemax="Math.min(600, Math.max(210, viewportWidth - visibleLeftWidth - 384))"
          @keydown.left.prevent="rightWidth = Math.min(600, visibleRightWidth + 16)"
          @keydown.right.prevent="rightWidth = Math.max(210, visibleRightWidth - 16)"
          :aria-label="t('app.resizeProperties')"
        >
          <div class="h-8 w-px bg-border group-hover:bg-primary rounded-full"></div>
        </div>

        <!-- Right Panel: Properties -->
        <div class="shrink-0 flex min-w-0" :style="{ width: `${visibleRightWidth}px` }">
          <PropertiesPanel />
        </div>
      </div>

      <!-- Bottom Resizer -->
      <div
        class="panel-resizer mx-1.5 h-1.5 cursor-row-resize z-10 flex justify-center items-center group"
        @mousedown="startResizeBottom"
        role="separator"
        tabindex="0"
        aria-orientation="horizontal"
        :aria-valuenow="visibleBottomHeight"
        :aria-valuemin="100"
        :aria-valuemax="Math.min(600, viewportHeight * 0.45)"
        @keydown.up.prevent="bottomHeight = Math.min(600, visibleBottomHeight + 16)"
        @keydown.down.prevent="bottomHeight = Math.max(100, visibleBottomHeight - 16)"
        :aria-label="t('app.resizeTimeline')"
      >
        <div class="w-12 h-px bg-border group-hover:bg-primary rounded-full"></div>
      </div>

      <!-- Bottom Panel: Timeline -->
      <div class="shrink-0 relative px-1.5" :style="{ height: `${visibleBottomHeight}px` }">
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
