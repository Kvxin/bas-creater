import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import { useDanmuStore } from "@/stores/danmu";
import { useTimelineStore } from "@/stores/timeline";
import { useAudioStore } from "@/stores/audio";
import type { AutoSaveStatus, BasProjectData, SerializedAudioMetadata } from "@/types/storage";
import { PROJECT_VERSION } from "@/services/storage/projectSchema";
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
  /**
   * 导入工程中暂时无法恢复物理文件的音频元数据。
   *
   * .basproj 只保存音频描述信息，不携带本地音频文件；保留这些元数据可以避免
   * 自动保存时覆盖仍被时间轴引用的音频资源，确保工程之后仍能被校验和恢复。
   */
  const importedAudioMeta = ref<SerializedAudioMetadata[]>([]);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 构造当前工程需要持久化的音频元数据。
   *
   * 已加载的音频使用运行时资源信息；未加载但仍被任意嵌套时间轴引用的音频，
   * 则沿用导入工程中的元数据，避免保存后产生悬空资源引用。
   *
   * @returns 当前工程需要写入持久化数据的音频元数据列表
   */
  const getSerializedAudioMetadata = (): SerializedAudioMetadata[] => {
    const resources = new Map(audioStore.audioResources.map((resource) => [resource.id, resource]));
    const referencedIds = new Set<string>();
    const collectReferencedIds = (tracks: typeof timelineStore.rootTracks) => {
      for (const track of tracks) {
        for (const clip of track.clips) {
          if (clip.kind === "resource") referencedIds.add(clip.resourceId);
          else collectReferencedIds(clip.tracks);
        }
      }
    };
    collectReferencedIds(timelineStore.rootTracks);

    const metadata: SerializedAudioMetadata[] = audioStore.audioResources.map((resource) => ({
      id: resource.id,
      name: resource.name,
      duration: resource.duration,
      coverUrl: resource.coverUrl,
      size: resource.file?.size,
      type: resource.file?.type,
    }));
    const knownIds = new Set(metadata.map((item) => item.id));
    for (const item of importedAudioMeta.value) {
      if (referencedIds.has(item.id) && !knownIds.has(item.id)) {
        metadata.push(item);
      }
    }
    return metadata;
  };

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
      for (const resource of audioStore.audioResources) {
        if (resource.file) audioFiles.set(resource.id, resource.file);
      }
      const audioMeta = getSerializedAudioMetadata();

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
            duration: timelineStore.rootDuration,
          },
          danmus: JSON.parse(JSON.stringify(danmuStore.danmus)),
          tracks: JSON.parse(JSON.stringify(timelineStore.rootTracks)),
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
      importedAudioMeta.value = project.audioMeta ?? [];

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
      timelineStore.loadTimeline(project.tracks);

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
      importedAudioMeta.value = [];
      danmuStore.danmus = [];
      danmuStore.select(null);
      audioStore.audioResources = [];
      timelineStore.loadTimeline([
        {
          id: "track_1",
          name: "轨道 1",
          clips: [],
          visible: true,
          muted: false,
          locked: false,
        },
      ]);
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
      version: PROJECT_VERSION,
      id: "project_" + Math.random().toString(36).slice(2, 9),
      name: projectName.value,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      canvas: { width: 800, height: 450 },
      timeline: { duration: timelineStore.rootDuration },
      danmus: JSON.parse(JSON.stringify(danmuStore.danmus)),
      tracks: JSON.parse(JSON.stringify(timelineStore.rootTracks)),
      audioMeta: getSerializedAudioMetadata(),
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
      importedAudioMeta.value = data.audioMeta ?? [];
      projectName.value = data.name;
      danmuStore.danmus = data.danmus;
      if (data.danmus.length > 0) {
        danmuStore.select(data.danmus[0]?.id ?? null);
      }
      timelineStore.loadTimeline(data.tracks);

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
    () => timelineStore.rootTracks,
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
