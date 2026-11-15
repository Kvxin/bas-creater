<script setup lang="ts">
import { ref, computed, nextTick, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useDanmuStore } from "@/stores/danmu";
import { useTimelineStore } from "@/stores/timeline";
import { useAudioStore } from "@/stores/audio";
import { useAssetsStore } from "@/stores/assets";
import type { TimelineTrack } from "@/types/timeline";
import type { DanmuType, AnyDanmu } from "@/types/danmu";
import type { AudioResource } from "@/types/resource";
import type { SerializedAudioMetadata } from "@/types/storage";
import { pickDesktopAudio } from "@/services/storage/desktopProjectFile";
import { pickBrowserAudio } from "@/services/storage/browserMediaFile";
import { getItemName } from "@/utils/resourceUtils";
import { extractAudioCover } from "@/utils/audio/audio-cover";
import { LayoutGrid, List } from "lucide-vue-next";
import {
  hasDesktopProjectSession,
  projectSessionDirectory
} from "@/services/storage/projectStorage";
import { writeProjectAudio } from "@/services/storage/projectAssets";
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

const props = defineProps<{ projectId: string; offlineAudio?: SerializedAudioMetadata[] }>();

import ResourcesSidebar from "./resources/ResourcesSidebar.vue";
import ResourcesHeader from "./resources/ResourcesHeader.vue";
import ResourcesList from "./resources/ResourcesList.vue";
import { useContextMenuStore } from "@/stores/contextMenu";

const danmuStore = useDanmuStore();
const timelineStore = useTimelineStore();
const audioStore = useAudioStore();
const assetsStore = useAssetsStore();
const currentBin = ref<string | null>(null);
const binDialogMode = ref<"create" | "rename" | "delete" | null>(null);
const binDialogName = ref("");
const renameTarget = ref<AnyDanmu | AudioResource | null>(null);
const binDialogError = ref("");
const binDialogOpen = computed({
  get: () => binDialogMode.value !== null,
  set: (open: boolean) => {
    if (!open) {
      binDialogMode.value = null;
      renameTarget.value = null;
      binDialogError.value = "";
    }
  }
});
const activeBin = computed(() => assetsStore.bins.find(bin => bin.id === currentBin.value) ?? null);
const binDialogTitle = computed(() => {
  if (binDialogMode.value === "delete") return t("resources.deleteBinTitle");
  if (binDialogMode.value === "rename") return t(renameTarget.value ? "resources.renameResourceTitle" : "resources.renameBinTitle");
  return t("resources.newBinTitle");
});
const selectedResourceId = ref<string | null>(null);
const binOptions = computed(() => {
  const result: Array<{ id: string; label: string }> = [];
  const visit = (parentId: string | null, prefix: string, seen: Set<string>) => {
    for (const bin of assetsStore.bins.filter(b => b.parentId === parentId)) {
      if (seen.has(bin.id)) continue;
      const label = prefix ? `${prefix} / ${bin.name}` : bin.name;
      result.push({ id: bin.id, label });
      visit(bin.id, label, new Set([...seen, bin.id]));
    }
  };
  visit(null, "", new Set());
  return result;
});
const binMoveOptions = computed(() => binOptions.value.filter(option => {
  let id: string | null = option.id;
  while (id) {
    if (id === currentBin.value) return false;
    id = assetsStore.bins.find(bin => bin.id === id)?.parentId ?? null;
  }
  return true;
}));
const openCreateBin = () => {
  binDialogName.value = "";
  binDialogError.value = "";
  renameTarget.value = null;
  binDialogMode.value = "create";
};
const openRenameBin = () => {
  if (!activeBin.value) return;
  renameTarget.value = null;
  binDialogError.value = "";
  binDialogName.value = activeBin.value.name;
  binDialogMode.value = "rename";
};
const openRenameResource = (item: AnyDanmu | AudioResource) => {
  renameTarget.value = item;
  binDialogName.value = getItemName(item);
  binDialogError.value = "";
  binDialogMode.value = "rename";
};
const openDeleteBin = () => {
  if (!activeBin.value) return;
  renameTarget.value = null;
  binDialogError.value = "";
  binDialogMode.value = "delete";
};
const confirmBinDialog = () => {
  const name = binDialogName.value.trim();
  if (binDialogMode.value === "create" || binDialogMode.value === "rename") {
    if (!name) {
      binDialogError.value = t(renameTarget.value ? "resources.nameRequired" : "resources.binNameRequired");
      return;
    }
    if (binDialogMode.value === "create") assetsStore.createBin(name, currentBin.value);
    else if (renameTarget.value) handleUpdateName(renameTarget.value, name);
    else if (activeBin.value) assetsStore.renameBin(activeBin.value.id, name);
  } else if (binDialogMode.value === "delete" && activeBin.value) {
    const parentId = activeBin.value.parentId;
    assetsStore.removeBin(activeBin.value.id);
    currentBin.value = parentId;
  }
  binDialogOpen.value = false;
};
const moveCurrentBin = (event: Event) => {
  const target = (event.target as HTMLSelectElement).value || null;
  if (currentBin.value) assetsStore.moveBin(currentBin.value, target);
  (event.target as HTMLSelectElement).value = "__select__";
};
const moveSelectedAsset = (event: Event) => {
  if (selectedResourceId.value) assetsStore.moveAsset(selectedResourceId.value, (event.target as HTMLSelectElement).value || null);
  selectedResourceId.value = null;
};
const countReferences = (tracks: TimelineTrack[], id: string): number => tracks.reduce(
  (count, track) => count + track.clips.reduce(
    (n, clip) => n + (clip.kind === "group" ? countReferences(clip.tracks, id) : Number(clip.resourceId === id)), 0
  ), 0
);
const pendingDelete = ref<{ id: string; name: string; count: number; offline: boolean } | null>(null);
const cancelDeleteButton = ref<HTMLButtonElement | null>(null);
watch(pendingDelete, async pending => {
  if (pending) {
    await nextTick();
    cancelDeleteButton.value?.focus();
  }
});
const deleteOffline = (audio: SerializedAudioMetadata) => {
  pendingDelete.value = { id: audio.id, name: audio.name, count: countReferences(timelineStore.rootTracks, audio.id), offline: true };
};
const confirmOfflineDelete = (audio: { id: string }) => {
  timelineStore.removeClipsByResourceId(audio.id);
  if (assetsStore.assets.some(asset => asset.id === audio.id)) assetsStore.removeAsset(audio.id);
};
const contextMenu = useContextMenuStore();
const { t } = useI18n();
const activeTab = ref("all");
const searchQuery = ref("");
const resourceLayout = ref<"list" | "grid">("list");
const audioDragDepth = ref(0);
const isAudioFileDrag = ref(false);

const handleContextMenu = (item: AnyDanmu | AudioResource, event: MouseEvent) => {
  contextMenu.show(event, "resource-item", item, {
    "resource.delete": data => handleDelete(data),
    "resource.rename": data => openRenameResource(data),
    "resource.duplicate": data => duplicateAsset(data)
  });
};

// 根据当前 tab 过滤弹幕列表
const filteredItems = computed<Array<AnyDanmu | AudioResource>>(() => {
  let items: Array<AnyDanmu | AudioResource> = [];

  if (activeTab.value === "all") {
    items = [...danmuStore.danmus, ...audioStore.audioResources];
  } else if (activeTab.value === "audio") {
    items = audioStore.audioResources;
  } else {
    items = danmuStore.danmus.filter((d: AnyDanmu) => d.type === activeTab.value);
  }

  items = items.filter(item => (assetsStore.assets.find(asset => asset.id === item.id)?.binId ?? null) === currentBin.value);
  // 简单的搜索过滤
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase();
    items = items.filter(item => getItemName(item).toLowerCase().includes(query));
  }

  return items;
});

// 处理选中
const handleSelect = (item: AnyDanmu | AudioResource) => {
  selectedResourceId.value = item.id;
  if (item.type !== "audio-file") {
    danmuStore.select(item.id);
  }
  // 如果是音频，目前没有全局选中状态，或者可以在这里处理本地选中
};

// 处理名称更新
const handleUpdateName = (item: AnyDanmu | AudioResource, newName: string) => {
  if (item.type === "audio-file") {
    audioStore.updateName(item.id, newName);
  } else {
    danmuStore.updateDanmu(item.id, { name: newName || undefined });
  }
  console.log(`[ResourcesPanel] 更新名称: ${item.id} -> ${newName || "(默认)"}`);
};
const duplicateAsset = (item: AnyDanmu | AudioResource) => {
  const existing = assetsStore.assets.find(asset => asset.id === item.id);
  if (item.type !== "audio-file") {
    const copy = danmuStore.duplicate(item.id);
    if (copy) assetsStore.upsertAsset({ id: copy.id, type: copy.type, binId: existing?.binId ?? null, danmu: copy });
    return;
  }
  const id = crypto.randomUUID();
  const name = t("common.duplicateName", { name: getItemName(item) });
  const copy: AudioResource = { ...item, id, name, url: URL.createObjectURL(item.file) };
  audioStore.add(copy);
  const audio = existing?.type === "audio-file"
    ? { ...existing.audio, id, name }
    : { id, name, duration: item.duration, size: item.file.size, type: item.file.type, sourcePath: item.sourcePath, relativePath: item.relativePath };
  const location = existing?.type === "audio-file" ? existing.location : undefined;
  assetsStore.upsertAsset({ id, type: "audio-file", binId: existing?.binId ?? null, audio, ...(location ? { location } : {}) });
};


// 处理删除
const handleDelete = (item: AnyDanmu | AudioResource) => {
  pendingDelete.value = { id: item.id, name: getItemName(item), count: countReferences(timelineStore.rootTracks, item.id), offline: false };
};
const executeDelete = () => {
  const pending = pendingDelete.value;
  pendingDelete.value = null;
  if (!pending) return;
  if (pending.offline) {
    confirmOfflineDelete(pending);
    return;
  }
  const item = danmuStore.danmus.find(resource => resource.id === pending.id)
    ?? audioStore.audioResources.find(resource => resource.id === pending.id);
  if (!item) return;
  timelineStore.removeClipsByResourceId(item.id);
  if (assetsStore.assets.some(asset => asset.id === item.id)) assetsStore.removeAsset(item.id);
  if (item.type === "audio-file") audioStore.remove(item.id);
  else danmuStore.remove(item.id);
  if (selectedResourceId.value === item.id) selectedResourceId.value = null;
};

const getAudioDuration = (url: string): Promise<number> => {
  return new Promise(resolve => {
    const audio = document.createElement("audio");
    audio.src = url;
    audio.onloadedmetadata = () => resolve(audio.duration * 1000);
    audio.onerror = () => resolve(0);
  });
};

// 点击选择和拖放音频均从这里创建资源，保证行为一致。
const handleAudioUpload = async (file: File, sourcePath?: string) => {
  let relativePath: string | undefined;
  try {
    if (hasDesktopProjectSession(props.projectId)) {
      if (!sourcePath) throw new Error("Desktop audio requires an absolute source path");
    } else {
      const directory = projectSessionDirectory(props.projectId);
      if (!directory || typeof directory === "string") throw new Error("Project directory is unavailable");
      relativePath = `${crypto.randomUUID()}.audio`;
      await writeProjectAudio(directory, relativePath, file);
    }
    const url = URL.createObjectURL(file);
    try {
      const [duration, coverUrl] = await Promise.all([getAudioDuration(url), extractAudioCover(file)]);
      audioStore.add({
        id: Math.random().toString(36).slice(2),
        type: "audio-file",
        name: file.name,
        url,
        coverUrl: coverUrl ?? undefined,
        file,
        sourcePath,
        relativePath,
        duration
      });
      const resource = audioStore.audioResources[audioStore.audioResources.length - 1]!;
      assetsStore.upsertAsset({
        id: resource.id, type: "audio-file", binId: currentBin.value,
        audio: { id: resource.id, name: resource.name, duration, size: file.size, type: file.type, sourcePath, relativePath },
        location: sourcePath ? { kind: "external", path: sourcePath } : relativePath ? { kind: "project", path: relativePath } : undefined
      });
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  } catch (error) {
    console.error("Failed to import audio", error);
    window.alert(t("projects.copyAudioFailed"));
  }
};

const relinkAudio = async (meta: SerializedAudioMetadata) => {
  try {
    let file: File;
    let sourcePath: string | undefined;
    let relativePath: string | undefined;
    if (hasDesktopProjectSession(props.projectId)) {
      const selection = await pickDesktopAudio();
      if (!selection) return;
      file = selection.file;
      sourcePath = selection.path;
    } else {
      const selection = await pickBrowserAudio();
      if (!selection) return;
      file = await selection.getFile();
    }
    if (!window.confirm(t("projects.relinkConfirm", { name: file.name, size: file.size }))) return;
    if ((meta.size !== undefined && meta.size !== file.size) || (meta.type && file.type && meta.type !== file.type)) {
      if (!window.confirm(t("resources.relinkMismatch", { name: meta.name, oldSize: meta.size ?? "?", newSize: file.size }))) return;
    }
    if (!sourcePath) {
      const directory = projectSessionDirectory(props.projectId);
      if (!directory || typeof directory === "string") throw new Error("Project directory is unavailable");
      relativePath = `${crypto.randomUUID()}.audio`;
      await writeProjectAudio(directory, relativePath, file);
    }
    const url = URL.createObjectURL(file);
    const duration = await getAudioDuration(url);
    audioStore.add({
      id: meta.id,
      type: "audio-file",
      name: meta.name,
      duration,
      coverUrl: meta.coverUrl,
      file,
      url,
      sourcePath,
      relativePath
    });
    const existing = assetsStore.assets.find(asset => asset.id === meta.id);
    assetsStore.upsertAsset({
      id: meta.id, type: "audio-file", binId: existing?.binId ?? null,
      audio: { ...meta, duration, size: file.size, type: file.type, sourcePath, relativePath },
      location: sourcePath ? { kind: "external", path: sourcePath } : relativePath ? { kind: "project", path: relativePath } : undefined
    });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      console.error("Failed to relink audio", error);
      window.alert(t("projects.relinkFailed"));
    }
  }
};

const isAudioFile = (file: File) => file.type.startsWith("audio/");

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

const handleDragEnter = (event: DragEvent) => {
  if (!hasFiles(event)) return;
  audioDragDepth.value += 1;
  isAudioFileDrag.value = true;
};

const handleDragOver = (event: DragEvent) => {
  if (hasFiles(event)) {
    isAudioFileDrag.value = true;
  }
};

const handleDragLeave = (event: DragEvent) => {
  if (!hasFiles(event)) return;
  audioDragDepth.value = Math.max(0, audioDragDepth.value - 1);
  if (audioDragDepth.value === 0) {
    isAudioFileDrag.value = false;
  }
};

const handleDrop = (event: DragEvent) => {
  audioDragDepth.value = 0;
  isAudioFileDrag.value = false;
  if (!hasFiles(event)) return;

  if (hasDesktopProjectSession(props.projectId)) {
    window.alert(t("projects.selectAudioInstead"));
    return;
  }
  const audioFile = Array.from(event.dataTransfer?.files ?? []).find(isAudioFile);
  if (audioFile) {
    void handleAudioUpload(audioFile);
  }
};

// 处理添加新弹幕
const handleAddDanmu = (type: DanmuType) => {
  const newDanmu = danmuStore.add(type);
  assetsStore.upsertAsset({ id: newDanmu.id, type: newDanmu.type, binId: currentBin.value, danmu: newDanmu });
  console.log(`[ResourcesPanel] 添加新弹幕:`, newDanmu);
};

// 处理拖拽开始
const handleDragStart = (item: AnyDanmu | AudioResource, event: DragEvent) => {
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "copy";
    const transferData = {
      ...item,
      // File 对象无法序列化，手动处理
      file:
        item.type === "audio-file"
          ? {
              name: (item as AudioResource).file.name,
              type: (item as AudioResource).file.type
            }
          : undefined
    };
    event.dataTransfer.setData("application/json", JSON.stringify(transferData));
    console.log(`[ResourcesPanel] 开始拖拽: ${getItemName(item)}`);
  }
};

const toggleResourceLayout = () => {
  resourceLayout.value = resourceLayout.value === "list" ? "grid" : "list";
};
</script>

<template>
  <div
    class="panel workbench-panel h-full w-full overflow-hidden flex text-sm select-none"
    data-ui="resources-panel"
    @dragenter.prevent="handleDragEnter"
    @dragover.prevent="handleDragOver"
    @dragleave.prevent="handleDragLeave"
    @drop.prevent="handleDrop"
  >
    <!-- Vertical Tabs -->
    <ResourcesSidebar v-model="activeTab" />

    <!-- List Content -->
    <div class="relative flex-1 flex flex-col min-w-0 bg-background overflow-hidden">
      <div
        v-if="isAudioFileDrag"
        class="absolute inset-1 z-10 flex items-center justify-center border border-dashed border-primary bg-primary/10 text-primary pointer-events-none"
      >
        <span class="text-sm font-medium">{{ t("resources.dropOverlay") }}</span>
      </div>
      <!-- Header -->
      <ResourcesHeader
        :use-desktop-references="hasDesktopProjectSession(props.projectId)"
        v-model:searchQuery="searchQuery"
        @add-danmu="handleAddDanmu"
        @upload-audio="handleAudioUpload"
      />
      <div class="flex flex-wrap items-center gap-1 px-2 py-1 border-b border-border text-xs">
        <select v-model="currentBin" class="min-w-0 flex-1 bg-input" :aria-label="t('resources.bins')">
          <option :value="null">{{ t("resources.rootBin") }}</option>
          <option v-for="bin in binOptions" :key="bin.id" :value="bin.id">{{ bin.label }}</option>
        </select>
        <button class="px-1 hover:bg-accent" @click="openCreateBin">{{ t("resources.newBin") }}</button>
        <button v-if="currentBin" class="px-1 hover:bg-accent" @click="openRenameBin">{{ t("common.rename") }}</button>
        <button v-if="currentBin" class="px-1 hover:bg-accent" @click="openDeleteBin">{{ t("common.delete") }}</button>
        <select v-if="currentBin" class="max-w-28 bg-input" :aria-label="t('resources.moveBin')" @change="moveCurrentBin">
          <option value="__select__" disabled selected>{{ t("resources.moveBin") }}</option>
          <option value="">{{ t("resources.rootBin") }}</option>
          <option v-for="bin in binMoveOptions" :key="bin.id" :value="bin.id">{{ bin.label }}</option>
        </select>
        <select v-if="selectedResourceId" class="max-w-32 bg-input" :aria-label="t('resources.moveAsset')" @change="moveSelectedAsset">
          <option value="__select__" disabled selected>{{ t("resources.moveAsset") }}</option>
          <option value="">{{ t("resources.rootBin") }}</option>
          <option v-for="bin in binOptions" :key="bin.id" :value="bin.id">{{ bin.label }}</option>
        </select>
      </div>

      <div v-if="offlineAudio?.length" class="px-3 py-2 border-b border-border text-xs space-y-2">
        <div class="text-destructive">{{ t("projects.offlineMedia") }}</div>
        <div v-for="audio in offlineAudio.filter(a => (assetsStore.assets.find(asset => asset.id === a.id)?.binId ?? null) === currentBin)" :key="audio.id" class="flex items-center justify-between gap-2">
          <button class="truncate" @click="selectedResourceId = audio.id">{{ audio.name }}</button>
          <button class="underline shrink-0" @click="relinkAudio(audio)">{{ t("projects.relink") }}</button>
          <button class="underline shrink-0" @click="deleteOffline(audio)">{{ t("common.delete") }}</button>
        </div>
      </div>

      <!-- List -->
      <ResourcesList
        :items="filteredItems"
        :layout="resourceLayout"
        :selected-id="danmuStore.selectedId"
        @select="handleSelect"
        @update-name="handleUpdateName"
        @delete="handleDelete"
        @drag-start="handleDragStart"
        @contextmenu="handleContextMenu"
      />

      <!-- Footer: 弹幕数量统计 -->
      <div
        class="h-8 border-t border-border flex items-center justify-between gap-3 px-3 text-xs text-muted-foreground bg-background shrink-0"
      >
        <div class="flex min-w-0 items-center gap-3">
          <span>{{
            t("resources.itemCount", {
              n: danmuStore.danmus.length + audioStore.audioResources.length
            })
          }}</span>
          <span v-if="danmuStore.selected" class="truncate text-primary">
            {{ t("resources.selected", { name: getItemName(danmuStore.selected) }) }}
          </span>
        </div>
        <button
          class="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          :title="resourceLayout === 'list' ? t('resources.viewGrid') : t('resources.viewList')"
          :aria-label="resourceLayout === 'list' ? t('resources.viewGrid') : t('resources.viewList')"
          @click="toggleResourceLayout"
        >
          <LayoutGrid v-if="resourceLayout === 'list'" class="size-3.5" />
          <List v-else class="size-3.5" />
        </button>
      </div>
    </div>
    <Teleport to="body">
      <div v-if="pendingDelete" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @keydown.esc="pendingDelete = null">
        <div role="alertdialog" aria-modal="true" aria-labelledby="delete-asset-message" class="w-full max-w-md rounded border border-border bg-background p-4 shadow-lg">
          <p id="delete-asset-message">{{ t("resources.deleteConfirm", pendingDelete) }}</p>
          <div class="mt-4 flex justify-end gap-2">
            <button ref="cancelDeleteButton" class="rounded border border-border px-3 py-1" @click="pendingDelete = null">{{ t("common.cancel") }}</button>
            <button class="rounded bg-destructive px-3 py-1 text-white" @click="executeDelete">{{ t("common.delete") }}</button>
          </div>
        </div>
      </div>
    </Teleport>
    <Dialog v-model:open="binDialogOpen">
      <DialogContent class="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{{ binDialogTitle }}</DialogTitle>
          <DialogDescription v-if="binDialogMode === 'delete' && activeBin">
            {{ t("resources.deleteBinConfirm", { name: activeBin.name }) }}
          </DialogDescription>
          <DialogDescription v-else>{{ t(renameTarget ? "resources.renameResourceDescription" : "resources.binNameDescription") }}</DialogDescription>
        </DialogHeader>
        <div v-if="binDialogMode !== 'delete'" class="grid gap-2">
          <Label for="resource-bin-name">{{ renameTarget ? t("common.name") : t("resources.binName") }}</Label>
          <Input
            id="resource-bin-name"
            v-model="binDialogName"
            autofocus
            autocomplete="off"
            @keydown.enter.prevent="confirmBinDialog"
          />
          <p v-if="binDialogError" role="alert" class="text-sm text-destructive">{{ binDialogError }}</p>
        </div>
        <DialogFooter>
          <button type="button" class="ui-button" @click="binDialogOpen = false">{{ t("app.cancel") }}</button>
          <button
            type="button"
            :class="binDialogMode === 'delete' ? 'ui-button bg-destructive text-destructive-foreground' : 'ui-button ui-button-primary'"
            @click="confirmBinDialog"
          >
            {{ binDialogMode === "delete" ? t("common.delete") : t("app.save") }}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
