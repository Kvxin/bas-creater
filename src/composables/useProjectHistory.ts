import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAssetsStore } from "@/stores/assets";
import { useDanmuStore } from "@/stores/danmu";
import { useAudioStore } from "@/stores/audio";
import { useTimelineStore } from "@/stores/timeline";
import type { ProjectAsset, ProjectBin } from "@/types/storage";
import type { AnyDanmu } from "@/types/danmu";
import type { TimelineTrack } from "@/types/timeline";
import { restoreProjectAudio } from "@/services/storage/projectStorage";
import type { AudioResource } from "@/types/resource";

const MAX_ENTRIES = 100;
const MAX_BYTES = 10 * 1024 * 1024;

type Snapshot = {
  tracks: TimelineTrack[];
  danmus: AnyDanmu[];
  assets: ProjectAsset[];
  bins: ProjectBin[];
  loadedAudioIds: string[];
  selectedDanmuId: string | null;
  selectedClipIds: string[];
  selectedClipId: string | null;
  selectedKeyframeId: string | null;
  selectedAnimationId: string | null;
  activeGroupPath: string[];
};

type Entry = { before: string; after: string };

/** 工程历史只保留可序列化数据；播放状态和浏览器资源不进入历史。 */
export function useProjectHistory(isHydrating: Ref<boolean>, projectId: string) {
  const { t } = useI18n();
  const timeline = useTimelineStore();
  const danmu = useDanmuStore();
  const audio = useAudioStore();
  const assets = useAssetsStore();
  let undoStack: Entry[] = [];
  let redoStack: Entry[] = [];
  let baseline = "";
  let dirty = false;
  let restoring = false;
  let pointerDown = false;
  let inputActive = false;
  let scheduled = false;
  let loading = false;
  let revision = 0;

  const snapshot = () => JSON.stringify({
    tracks: timeline.rootTracks,
    danmus: danmu.danmus,
    assets: assets.assets.map((asset) => {
      if (asset.type !== "audio-file") return asset;
      const resource = audio.getById(asset.id);
      return resource ? { ...asset, audio: { ...asset.audio, name: resource.name, duration: resource.duration,
        coverUrl: resource.coverUrl, sourcePath: resource.sourcePath, relativePath: resource.relativePath } } : asset;
    }),
    bins: assets.bins,
    loadedAudioIds: audio.audioResources.map((resource) => resource.id),
    selectedDanmuId: danmu.selectedId,
    selectedClipIds: timeline.selectedClipIds,
    selectedClipId: timeline.selectedClipId,
    selectedKeyframeId: timeline.selectedKeyframeId,
    selectedAnimationId: timeline.selectedAnimationId,
    activeGroupPath: timeline.activeGroupPath
  } satisfies Snapshot, (key, value: unknown) =>
    key === "coverUrl" && typeof value === "string" && value.startsWith("blob:") ? undefined : value);

  const projectData = (value: string) => {
    const state = JSON.parse(value) as Snapshot;
    return JSON.stringify([state.tracks, state.danmus, state.assets, state.bins, state.loadedAudioIds]);
  };

  const commit = () => {
    if (!dirty || isHydrating.value || restoring) return;
    dirty = false;
    const after = snapshot();
    if (baseline && projectData(baseline) !== projectData(after)) {
      undoStack.push({ before: baseline, after });
      redoStack = [];
      let bytes = undoStack.reduce((sum, entry) => sum + (entry.before.length + entry.after.length) * 2, 0);
      while (undoStack.length > MAX_ENTRIES || bytes > MAX_BYTES) {
        const removed = undoStack.shift()!;
        bytes -= (removed.before.length + removed.after.length) * 2;
      }
    }
    baseline = after;
  };

  const scheduleCommit = () => {
    if (scheduled) return;
    scheduled = true;
    void nextTick(() => {
      scheduled = false;
      if (!pointerDown && !inputActive) commit();
    });
  };

  const markDirty = () => {
    if (isHydrating.value || restoring) return;
    revision++;
    dirty = true;
    scheduleCommit();
  };

  watch(() => [timeline.rootTracks, danmu.danmus, assets.assets, assets.bins,
    audio.audioResources.map(({ id, name, duration, coverUrl, sourcePath, relativePath }) =>
      [id, name, duration, coverUrl, sourcePath, relativePath])], markDirty, { deep: true, flush: "sync" });
  watch(isHydrating, (hydrating) => {
    if (hydrating) {
      revision++;
      undoStack = [];
      redoStack = [];
      baseline = "";
      dirty = false;
    } else {
      baseline = snapshot();
    }
  }, { flush: "sync" });


  const apply = (state: Snapshot, resources: AudioResource[]) => {
    restoring = true;
    try {
      for (const resource of resources) {
        const asset = state.assets.find((item) => item.id === resource.id);
        if (asset?.type === "audio-file") {
          resource.name = asset.audio.name;
          resource.duration = asset.audio.duration;
          resource.coverUrl = asset.audio.coverUrl;
        }
      }
      timeline.rootTracks = state.tracks;
      danmu.danmus = state.danmus;
      timeline.activeGroupPath = state.activeGroupPath;
      timeline.setSelectedClips(state.selectedClipIds, state.selectedClipId);
      const keep = new Set(resources);
      for (const resource of audio.audioResources) if (!keep.has(resource)) URL.revokeObjectURL(resource.url);
      audio.audioResources = resources;
      assets.setProject(state.assets, state.bins);
      timeline.selectedKeyframeId = state.selectedKeyframeId;
      timeline.selectedAnimationId = state.selectedAnimationId;
      danmu.select(state.selectedDanmuId);
      baseline = snapshot();
      dirty = false;
    } finally {
      restoring = false;
    }
  };

  const isEditable = (target: EventTarget | null) => target instanceof HTMLElement &&
    (target.isContentEditable || !!target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));

  const onKeyDown = async (event: KeyboardEvent) => {
    if (isHydrating.value || event.isComposing || event.keyCode === 229 || isEditable(event.target) || event.altKey) return;
    const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    if (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    const redo = key === "z" && event.shiftKey || !mac && key === "y" && !event.shiftKey;
    if (key !== "z" && !redo) return;
    event.preventDefault();
    if (loading) return;
    commit();
    const source = redo ? redoStack : undoStack;
    const destination = redo ? undoStack : redoStack;
    const entry = source[source.length - 1];
    if (!entry) return;
    const state = JSON.parse(redo ? entry.after : entry.before) as Snapshot;
    const atRevision = revision;
    loading = true;
    const created: AudioResource[] = [];
    let applied = false;
    let unavailableName: string | null = null;
    try {
      const resources: AudioResource[] = [];
      for (const asset of state.assets) {
        if (asset.type !== "audio-file" || !state.loadedAudioIds.includes(asset.id)) continue;
        const sourcePath = asset.location?.kind === "external" ? asset.location.path : asset.audio.sourcePath;
        const relativePath = asset.location?.kind === "project" ? asset.location.path : asset.audio.relativePath;
        const existing = audio.getById(asset.id);
        let resource = existing && existing.sourcePath === sourcePath && existing.relativePath === relativePath ? existing : null;
        if (!resource) {
          unavailableName = asset.audio.name;
          resource = await restoreProjectAudio(projectId, asset);
          if (resource) {
            created.push(resource);
            if ((asset.audio.size !== undefined && resource.file.size !== asset.audio.size) ||
              (asset.audio.type && resource.file.type && resource.file.type !== asset.audio.type)) resource = null;
          }
          if (resource) unavailableName = null;
        }
        if (!resource) {
          unavailableName = asset.audio.name;
          break;
        }
        resources.push(resource);
      }
      if (unavailableName === null) {
        const current = JSON.parse(snapshot()) as Snapshot;
        for (const resource of audio.audioResources) {
          if (resources.includes(resource)) continue;
          const asset = current.assets.find((item) => item.id === resource.id && item.type === "audio-file");
          if (!asset || asset.type !== "audio-file") {
            unavailableName = resource.name;
            break;
          }
          unavailableName = asset.audio.name;
          const probe = await restoreProjectAudio(projectId, asset);
          if (!probe) break;
          URL.revokeObjectURL(probe.url);
          if (probe.file.size !== resource.file.size ||
            (probe.file.type && resource.file.type && probe.file.type !== resource.file.type)) break;
          unavailableName = null;
        }
      }
      if (revision !== atRevision || isHydrating.value) return;
      if (unavailableName !== null) {
        window.alert(t("resources.historyAudioUnavailable", { name: unavailableName }));
        return;
      }
      apply(state, resources);
      applied = true;
      source.pop();
      destination.push(entry);
    } catch (error) {
      if (revision === atRevision && !isHydrating.value) {
        console.error("[ProjectHistory] Failed to restore audio:", error);
        window.alert(t("resources.historyAudioUnavailable", { name: unavailableName || "" }));
      }
    } finally {
      if (!applied) for (const resource of created) URL.revokeObjectURL(resource.url);
      loading = false;
    }
  };

  const onPointerDown = () => {
    if (!dirty && !isHydrating.value) baseline = snapshot();
    pointerDown = true;
  };
  const onPointerUp = () => {
    pointerDown = false;
    scheduleCommit();
  };
  const onFocusIn = (event: FocusEvent) => { inputActive = isEditable(event.target); };
  const onFocusOut = () => {
    inputActive = false;
    scheduleCommit();
  };

  onMounted(() => {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);
  });
  onBeforeUnmount(() => {
    revision++;
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerUp, true);
    window.removeEventListener("focusin", onFocusIn);
    window.removeEventListener("focusout", onFocusOut);
  });
}
