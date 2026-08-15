<script setup lang="ts">
import { ref, computed } from "vue";
import { useDanmuStore } from "@/stores/danmu";
import { useTimelineStore } from "@/stores/timeline";
import { useAudioStore } from "@/stores/audio";
import type { DanmuType, AnyDanmu } from "@/types/danmu";
import type { AudioResource } from "@/types/resource";
import { getItemName } from "@/utils/resourceUtils";
import { extractAudioCover } from "@/utils/audio/audio-cover";
import { LayoutGrid, List } from "lucide-vue-next";

import ResourcesSidebar from "./resources/ResourcesSidebar.vue";
import ResourcesHeader from "./resources/ResourcesHeader.vue";
import ResourcesList from "./resources/ResourcesList.vue";
import { useContextMenuStore } from "@/stores/contextMenu";

const danmuStore = useDanmuStore();
const timelineStore = useTimelineStore();
const audioStore = useAudioStore();
const contextMenu = useContextMenuStore();
const activeTab = ref("all");
const searchQuery = ref("");
const resourceLayout = ref<"list" | "grid">("list");
const audioDragDepth = ref(0);
const isAudioFileDrag = ref(false);

const handleContextMenu = (item: AnyDanmu | AudioResource, event: MouseEvent) => {
  contextMenu.show(event, 'resource-item', item, {
    // Override 'resource.delete' to handle local audio files
    'resource.delete': (data) => handleDelete(data),
    // Override 'resource.rename' (if we had logic implemented)
    'resource.rename': (data) => console.log('Local Rename logic', data)
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

  // 简单的搜索过滤
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase();
    items = items.filter((item) =>
      getItemName(item).toLowerCase().includes(query)
    );
  }

  return items;
});

// 处理选中
const handleSelect = (item: AnyDanmu | AudioResource) => {
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
  console.log(
    `[ResourcesPanel] 更新名称: ${item.id} -> ${newName || "(默认)"}`
  );
};

// 处理删除
const handleDelete = (item: AnyDanmu | AudioResource) => {
  if (item.type === "audio-file") {
    audioStore.remove(item.id);
  } else {
    danmuStore.remove(item.id);
  }
  
  // 同步删除轨道中的相关片段
  timelineStore.removeClipsByResourceId(item.id);
  
  console.log(`[ResourcesPanel] 删除: ${item.id}`);
};

const getAudioDuration = (url: string): Promise<number> => {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.src = url;
    audio.onloadedmetadata = () => resolve(audio.duration * 1000);
    audio.onerror = () => resolve(0);
  });
};

// 点击选择和拖放音频均从这里创建资源，保证行为一致。
const handleAudioUpload = async (file: File) => {
  const url = URL.createObjectURL(file);
  const [duration, coverUrl] = await Promise.all([
    getAudioDuration(url),
    extractAudioCover(file),
  ]);
  const resource: AudioResource = {
    id: Math.random().toString(36).slice(2),
    type: "audio-file",
    name: file.name,
    url,
    coverUrl: coverUrl ?? undefined,
    file,
    duration,
  };
  audioStore.add(resource);
  console.log(
    `[ResourcesPanel] 上传音频文件: ${file.name}, 时长: ${duration}ms`
  );
};

const isAudioFile = (file: File) => file.type.startsWith("audio/");

const hasFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes("Files");

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

  const audioFile = Array.from(event.dataTransfer?.files ?? []).find(isAudioFile);
  if (audioFile) {
    void handleAudioUpload(audioFile);
  }
};

// 处理添加新弹幕
const handleAddDanmu = (type: DanmuType) => {
  const newDanmu = danmuStore.add(type);
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
              type: (item as AudioResource).file.type,
            }
          : undefined,
    };
    event.dataTransfer.setData(
      "application/json",
      JSON.stringify(transferData)
    );
    console.log(`[ResourcesPanel] 开始拖拽: ${getItemName(item)}`);
  }
};

const toggleResourceLayout = () => {
  resourceLayout.value = resourceLayout.value === "list" ? "grid" : "list";
};
</script>

<template>
  <div
    class="panel h-full w-full bg-background border border-border rounded-sm overflow-hidden flex text-sm select-none"
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
        <span class="text-sm font-medium">释放以上传音频文件</span>
      </div>
      <!-- Header -->
      <ResourcesHeader
        v-model:searchQuery="searchQuery"
        @add-danmu="handleAddDanmu"
        @upload-audio="handleAudioUpload"
      />

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
          <span
            >共
            {{ danmuStore.danmus.length + audioStore.audioResources.length }}
            个项目</span
          >
          <span v-if="danmuStore.selected" class="truncate text-primary">
            已选中: {{ getItemName(danmuStore.selected) }}
          </span>
        </div>
        <button
          class="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          :title="resourceLayout === 'list' ? '切换为网格布局' : '切换为列表布局'"
          :aria-label="resourceLayout === 'list' ? '切换为网格布局' : '切换为列表布局'"
          @click="toggleResourceLayout"
        >
          <LayoutGrid v-if="resourceLayout === 'list'" class="size-3.5" />
          <List v-else class="size-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>
