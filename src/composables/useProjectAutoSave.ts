import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import { useDanmuStore } from "@/stores/danmu";
import { useTimelineStore } from "@/stores/timeline";
import { useAudioStore } from "@/stores/audio";
import type { AutoSaveStatus, BasProjectData, SerializedAudioMetadata } from "@/types/storage";
import {
  saveProjectDraft,
  loadProjectDraft,
  clearProjectDraft,
  exportProjectFile,
  parseProjectFile,
  requestStoragePersistence,
} from "@/services/storage/projectStorage";

const DEBOUNCE_DELAY_MS = 800;

export function useProjectAutoSave() {
  const danmuStore = useDanmuStore();
  const timelineStore = useTimelineStore();
  const audioStore = useAudioStore();

  const projectName = ref("默认工程");
  const saveStatus = ref<AutoSaveStatus>("idle");
  const lastSavedTime = ref<Date | null>(null);
  const isDirty = ref(false);
  const isHydrating = ref(false);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  /**
   * 立即将当前状态保存到本地持久化存储（IndexedDB + OPFS）
   */
  const saveNow = async () => {
    if (isHydrating.value) return;
    clearTimer();

    saveStatus.value = "saving";
    try {
      const audioFiles = new Map<string, File>();
      const audioMeta: SerializedAudioMetadata[] = audioStore.audioResources.map((res) => {
        if (res.file) {
          audioFiles.set(res.id, res.file);
        }
        return {
          id: res.id,
          name: res.name,
          duration: res.duration,
          coverUrl: res.coverUrl,
          size: res.file?.size,
          type: res.file?.type,
        };
      });

      await saveProjectDraft(
        {
          id: "active_draft",
          name: projectName.value,
          createdAt: Date.now(),
          canvas: {
            width: 800,
            height: 450,
          },
          timeline: {
            duration: timelineStore.duration,
          },
          danmus: JSON.parse(JSON.stringify(danmuStore.danmus)),
          tracks: JSON.parse(JSON.stringify(timelineStore.tracks)),
          audioMeta,
        },
        audioFiles
      );

      isDirty.value = false;
      saveStatus.value = "saved";
      lastSavedTime.value = new Date();
    } catch (err) {
      console.error("[AutoSave] Failed to save project:", err);
      saveStatus.value = "error";
    }
  };

  const queueSave = () => {
    if (isHydrating.value) return;
    isDirty.value = true;
    clearTimer();
    debounceTimer = setTimeout(() => {
      void saveNow();
    }, DEBOUNCE_DELAY_MS);
  };

  /**
   * 从本地存储中恢复上一次编辑的草稿工程
   */
  const restoreProject = async () => {
    isHydrating.value = true;
    try {
      const draft = await loadProjectDraft();
      if (!draft) {
        return false;
      }

      const { project, audioResources } = draft;

      if (project.name) {
        projectName.value = project.name;
      }

      // 1. 恢复音频资源（已携带新生成的 Blob URL）
      audioStore.audioResources = audioResources;

      // 2. 恢复弹幕列表
      if (Array.isArray(project.danmus)) {
        danmuStore.danmus = project.danmus;
        if (project.danmus.length > 0) {
          danmuStore.select(project.danmus[0]?.id ?? null);
        }
      }

      // 3. 恢复时间轴与轨道
      if (Array.isArray(project.tracks) && project.tracks.length > 0) {
        timelineStore.tracks = project.tracks;
      }
      if (typeof project.timeline?.duration === "number") {
        timelineStore.duration = project.timeline.duration;
      }

      lastSavedTime.value = new Date(project.updatedAt || Date.now());
      saveStatus.value = "saved";
      isDirty.value = false;
      return true;
    } catch (err) {
      console.error("[AutoSave] Failed to restore project:", err);
      return false;
    } finally {
      // 等待下一帧状态稳定后再放开自动保存监听
      setTimeout(() => {
        isHydrating.value = false;
      }, 100);
    }
  };

  /**
   * 清空本地草稿并重置为全新工程
   */
  const resetProject = async () => {
    isHydrating.value = true;
    try {
      await clearProjectDraft();
      danmuStore.danmus = [];
      danmuStore.select(null);
      audioStore.audioResources = [];
      timelineStore.tracks = [
        {
          id: "track_1",
          name: "轨道 1",
          clips: [],
          visible: true,
          muted: false,
          locked: false,
        },
      ];
      timelineStore.duration = 0;
      timelineStore.currentTime = 0;
      isDirty.value = false;
      saveStatus.value = "idle";
      lastSavedTime.value = null;
    } finally {
      setTimeout(() => {
        isHydrating.value = false;
      }, 100);
    }
  };

  /**
   * 导出当前工程文件 (.basproj)
   */
  const exportBackup = () => {
    const projectData: BasProjectData = {
      version: 1,
      id: "project_" + Math.random().toString(36).slice(2, 9),
      name: projectName.value,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      canvas: { width: 800, height: 450 },
      timeline: { duration: timelineStore.duration },
      danmus: JSON.parse(JSON.stringify(danmuStore.danmus)),
      tracks: JSON.parse(JSON.stringify(timelineStore.tracks)),
      audioMeta: audioStore.audioResources.map((res) => ({
        id: res.id,
        name: res.name,
        duration: res.duration,
        coverUrl: res.coverUrl,
      })),
    };
    exportProjectFile(projectData);
  };

  /**
   * 导入工程文件并灌装至工作区
   */
  const importBackup = async (file: File) => {
    isHydrating.value = true;
    try {
      const data = await parseProjectFile(file);
      projectName.value = data.name;
      danmuStore.danmus = data.danmus;
      if (data.danmus.length > 0) {
        danmuStore.select(data.danmus[0]?.id ?? null);
      }
      timelineStore.tracks = data.tracks;
      timelineStore.duration = data.timeline.duration;

      // 导入后立即保存为当前活动草稿
      isDirty.value = true;
      setTimeout(() => {
        isHydrating.value = false;
        void saveNow();
      }, 100);
    } catch (err) {
      isHydrating.value = false;
      throw err;
    }
  };

  // 监听各个 Store 的变动以触发防抖自动保存
  watch(
    () => danmuStore.danmus,
    () => queueSave(),
    { deep: true }
  );

  watch(
    () => timelineStore.tracks,
    () => queueSave(),
    { deep: true }
  );

  watch(
    () => audioStore.audioResources.length,
    () => queueSave()
  );

  // 页面关闭/刷新前的保护拦截
  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if (isDirty.value || saveStatus.value === "saving") {
      e.preventDefault();
      e.returnValue = "";
    }
  };

  // 拦截全局快捷键 Ctrl+S / Cmd+S 触发保存
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && (e.key?.toLowerCase() === "s" || e.code === "KeyS")) {
      e.preventDefault();
      e.stopPropagation();
      void saveNow();
    }
  };

  onMounted(() => {
    void requestStoragePersistence();
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("keydown", handleKeyDown);
  });

  onBeforeUnmount(() => {
    clearTimer();
    window.removeEventListener("beforeunload", handleBeforeUnload);
    window.removeEventListener("keydown", handleKeyDown);
  });

  return {
    projectName,
    saveStatus,
    lastSavedTime,
    isDirty,
    isHydrating,
    saveNow,
    restoreProject,
    resetProject,
    exportBackup,
    importBackup,
  };
}
