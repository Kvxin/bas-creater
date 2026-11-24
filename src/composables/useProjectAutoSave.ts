import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { useDanmuStore } from "@/stores/danmu";
import { useTimelineStore } from "@/stores/timeline";
import { useAudioStore } from "@/stores/audio";
import { useAssetsStore } from "@/stores/assets";
import { useProjectHistory } from "@/composables/useProjectHistory";
import type { AutoSaveStatus, BasProjectData, ProjectAsset, SerializedAudioMetadata } from "@/types/storage";
import { normalizeProjectData, PROJECT_VERSION } from "@/services/storage/projectSchema";
import {
  saveProjectDraft,
  loadProjectDraft,
  clearProjectDraft,
  exportProjectFile,
  projectHasExternalChanges,
  parseProjectFile,
} from "@/services/storage/projectStorage";

const DEBOUNCE_DELAY_MS = 800;

export function useProjectAutoSave(projectId: string) {
  const danmuStore = useDanmuStore();
  const timelineStore = useTimelineStore();
  const audioStore = useAudioStore();
  const assetsStore = useAssetsStore();

  const projectName = ref("默认工程");
  const saveStatus = ref<AutoSaveStatus>("idle");
  const lastSaveError = ref("");
  const lastSavedTime = ref<Date | null>(null);
  const isDirty = ref(false);
  const isHydrating = ref(true);
  useProjectHistory(isHydrating, projectId);
  const createdAt = ref(Date.now());
  const canvas = ref({ width: 800, height: 450 });
  let saveBlocked = false;
  let revision = 0;
  let saveChain: Promise<void> = Promise.resolve();
  /**
   * 导入工程中暂时无法恢复物理文件的音频元数据。
   *
   * .basproj 只保存音频描述信息，不携带本地音频文件；保留这些元数据可以避免
   * 自动保存时覆盖仍被时间轴引用的音频资源，确保工程之后仍能被校验和恢复。
   */
  const importedAudioMeta = computed<SerializedAudioMetadata[]>(() => {
    const loaded = new Set(audioStore.audioResources.map((resource) => resource.id));
    return assetsStore.assets.flatMap((asset) =>
      asset.type === "audio-file" && !loaded.has(asset.id) ? [asset.audio] : []);
  });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 构造当前工程需要持久化的音频元数据。
   *
   * 已加载的音频使用运行时资源信息；暂时未加载的音频，
   * 则沿用导入工程中的元数据，避免保存后产生悬空资源引用。
   *
   * @returns 当前工程需要写入持久化数据的音频元数据列表
   */
  const getSerializedAudioMetadata = (): SerializedAudioMetadata[] => {
    const existing = new Map(assetsStore.assets.flatMap((asset) =>
      asset.type === "audio-file" ? [[asset.id, asset.audio] as const] : []));
    for (const resource of audioStore.audioResources) {
      existing.set(resource.id, {
        ...existing.get(resource.id),
        id: resource.id, name: resource.name, duration: resource.duration ?? existing.get(resource.id)?.duration,
        coverUrl: resource.coverUrl ?? existing.get(resource.id)?.coverUrl, size: resource.file?.size, type: resource.file?.type,
        sourcePath: resource.sourcePath,
        relativePath: resource.relativePath,
      });
    }
    return [...existing.values()];
  };

  const syncRuntimeAssets = () => {
    for (const audio of getSerializedAudioMetadata()) {
      const old = assetsStore.assets.find((asset) => asset.id === audio.id);
      if (old && old.type !== "audio-file") throw new Error("Conflicting asset ID");
      const loaded = audioStore.audioResources.find((resource) => resource.id === audio.id);
      const location = loaded ? (loaded.sourcePath ? { kind: "external" as const, path: loaded.sourcePath } :
        loaded.relativePath ? { kind: "project" as const, path: loaded.relativePath } : old?.location) : old?.location ??
        (audio.sourcePath ? { kind: "external" as const, path: audio.sourcePath } :
          audio.relativePath ? { kind: "project" as const, path: audio.relativePath } : undefined);
      if (!old || JSON.stringify(old.audio) !== JSON.stringify(audio) ||
        JSON.stringify(old.location) !== JSON.stringify(location)) {
        assetsStore.upsertAsset({ id: audio.id, type: "audio-file", binId: old?.binId ?? null, audio, ...(location ? { location } : {}) });
      }
    }
  };

  const getProjectSnapshot = (): BasProjectData => {
    const audioMetadata = getSerializedAudioMetadata();
    const assets: ProjectAsset[] = assetsStore.assets.map((asset) => {
      if (asset.type !== "audio-file") return asset;
      const loaded = audioStore.audioResources.find((item) => item.id === asset.id);
      if (!loaded) return asset;
      const audio = audioMetadata.find((item) => item.id === asset.id)!;
      const location = loaded.sourcePath ? { kind: "external" as const, path: loaded.sourcePath } :
        loaded.relativePath ? { kind: "project" as const, path: loaded.relativePath } : asset.location;
      return { ...asset, audio, ...(location ? { location } : {}) };
    });
    const ids = new Set(assets.map((asset) => asset.id));
    for (const audio of audioMetadata) {
      if (assets.some((asset) => asset.id === audio.id && asset.type !== "audio-file")) throw new Error("Conflicting asset ID");
    }
    for (const audio of audioMetadata) {
      if (!ids.has(audio.id)) {
        const location = audio.sourcePath ? { kind: "external" as const, path: audio.sourcePath } :
          audio.relativePath ? { kind: "project" as const, path: audio.relativePath } : undefined;
        assets.push({ id: audio.id, type: "audio-file", binId: null, audio, ...(location ? { location } : {}) });
      }
    }
    return normalizeProjectData({
      version: PROJECT_VERSION, id: projectId, name: projectName.value,
      createdAt: createdAt.value, updatedAt: Date.now(), canvas: canvas.value,
      timeline: { duration: timelineStore.rootDuration },
      tracks: JSON.parse(JSON.stringify(timelineStore.rootTracks)),
      assets, bins: JSON.parse(JSON.stringify(assetsStore.bins)),
    });
  };

  const clearTimer = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  /**
   * 立即将当前状态保存到项目文件。
   */
  const saveNow = async (): Promise<boolean> => {
    if (isHydrating.value || saveBlocked) return false;
    clearTimer();
    const savedRevision = revision;
    saveStatus.value = "saving";
    lastSaveError.value = "";
    try {
      const snapshot = getProjectSnapshot();
      const pending = saveChain.then(() => saveProjectDraft(snapshot));
      saveChain = pending.catch(() => {});
      await pending;

      isDirty.value = revision !== savedRevision;
      saveStatus.value = "saved";
      lastSavedTime.value = new Date();
      return true;
    } catch (err) {
      console.error("[AutoSave] Failed to save project:", err);
      saveStatus.value = "error";
      lastSaveError.value = String(err);
      return false;
    }
  };

  const queueSave = () => {
    if (isHydrating.value) return;
    isDirty.value = true;
    revision++;
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
      const draft = await loadProjectDraft(projectId);
      if (!draft) {
        return false;
      }

      const { project, audioResources } = draft;
      createdAt.value = project.createdAt;
      canvas.value = project.canvas;
      assetsStore.setProject(project.assets, project.bins);
      saveBlocked = false;

      if (project.name) {
        projectName.value = project.name;
      }

      // 1. 恢复音频资源（已携带新生成的 Blob URL）
      for (const resource of audioStore.audioResources) URL.revokeObjectURL(resource.url);
      audioStore.audioResources = audioResources;

      // 2. 弹幕数据已随 assets 恢复，这里只恢复选中项
      danmuStore.select(danmuStore.danmus[0]?.id ?? null);

      // 3. 恢复时间轴与轨道
      timelineStore.isPlaying = false;
      timelineStore.loadTimeline(project.tracks);

      lastSavedTime.value = new Date(project.updatedAt || Date.now());
      saveStatus.value = "saved";
      isDirty.value = false;
      return true;
    } catch (err) {
      saveBlocked = true;
      saveStatus.value = "error";
      lastSaveError.value = String(err);
      console.error("[AutoSave] Failed to restore project:", err);
      return false;
    } finally {
      // 等待恢复触发的响应式更新完成，避免将其当作用户修改。
      await nextTick();
      isHydrating.value = false;
    }
  };

  /**
   * 清空本地草稿并重置为全新工程
   */
  const resetProject = async () => {
    isHydrating.value = true;
    try {
      await clearProjectDraft(projectId);
      saveBlocked = false;
      assetsStore.setProject([], []);
      canvas.value = { width: 800, height: 450 };
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
  const exportBackup = async () => {
    const projectData = getProjectSnapshot();
    await exportProjectFile(projectData);
  };

  /**
   * 导入工程文件并灌装至工作区
   */
  const importBackup = async (file: File) => {
    isHydrating.value = true;
    try {
      const data = await parseProjectFile(file);
      for (const resource of audioStore.audioResources) URL.revokeObjectURL(resource.url);
      audioStore.audioResources = [];
      assetsStore.setProject(data.assets, data.bins);
      createdAt.value = data.createdAt;
      canvas.value = data.canvas;
      saveBlocked = false;
      projectName.value = data.name;
      danmuStore.select(danmuStore.danmus[0]?.id ?? null);
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
    () => timelineStore.rootTracks,
    () => queueSave(),
    { deep: true }
  );

  watch(
    () => audioStore.audioResources.map(({ id, name, duration, coverUrl, sourcePath, relativePath }) =>
      [id, name, duration, coverUrl, sourcePath, relativePath]),
    () => { if (!isHydrating.value) { syncRuntimeAssets(); queueSave(); } },
    { deep: true }
  );
  watch(() => [assetsStore.assets, assetsStore.bins], () => queueSave(), { deep: true });
  watch(projectName, () => queueSave());

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

  let isCheckingExternalChanges = false;
  let disposed = false;
  const checkExternalChanges = async () => {
    if (isHydrating.value || isCheckingExternalChanges) return;
    isCheckingExternalChanges = true;
    try {
      await saveChain;
      const checkedRevision = revision;
      const changed = await projectHasExternalChanges(projectId);
      if (!disposed && changed && revision === checkedRevision && saveStatus.value !== "saving") {
        saveStatus.value = "error";
        lastSaveError.value = "PROJECT_MODIFIED_EXTERNALLY";
      }
    } catch (error) {
      console.warn("[AutoSave] Failed to check external changes:", error);
    } finally {
      isCheckingExternalChanges = false;
    }
  };
  const checkOnVisibility = () => {
    if (document.visibilityState === "visible") void checkExternalChanges();
  };

  onMounted(() => {
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("focus", checkExternalChanges);
    document.addEventListener("visibilitychange", checkOnVisibility);
  });

  onBeforeUnmount(() => {
    disposed = true;
    clearTimer();
    window.removeEventListener("beforeunload", handleBeforeUnload);
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("focus", checkExternalChanges);
    document.removeEventListener("visibilitychange", checkOnVisibility);
  });

  return {
    projectName,
    saveStatus,
    lastSaveError,
    lastSavedTime,
    isDirty,
    isHydrating,
    importedAudioMeta,
    getProjectSnapshot,
    saveNow,
    restoreProject,
    resetProject,
    exportBackup,
    importBackup,
  };
}
