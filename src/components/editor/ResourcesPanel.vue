<script setup lang="ts">
import { ref, computed } from "vue";
import { useDanmuStore } from "@/stores/danmu";
import type { DanmuType, AnyDanmu } from "@/types/danmu";
import type { AudioResource } from "@/types/resource";
import { getItemName } from "@/utils/resourceUtils";

import ResourcesSidebar from "./resources/ResourcesSidebar.vue";
import ResourcesHeader from "./resources/ResourcesHeader.vue";
import ResourcesList from "./resources/ResourcesList.vue";

const danmuStore = useDanmuStore();

const localAudioResources = ref<AudioResource[]>([]);
const activeTab = ref("all");
const searchQuery = ref("");

// 根据当前 tab 过滤弹幕列表
const filteredItems = computed<Array<AnyDanmu | AudioResource>>(() => {
  let items: Array<AnyDanmu | AudioResource> = [];

  if (activeTab.value === "all") {
    items = [...danmuStore.danmus, ...localAudioResources.value];
  } else if (activeTab.value === "audio") {
    items = localAudioResources.value;
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
    const idx = localAudioResources.value.findIndex((r) => r.id === item.id);
    if (idx !== -1 && localAudioResources.value[idx]) {
      localAudioResources.value[idx].name =
        newName || localAudioResources.value[idx].file.name;
    }
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
    const idx = localAudioResources.value.findIndex((r) => r.id === item.id);
    if (idx !== -1 && localAudioResources.value[idx]) {
      URL.revokeObjectURL(localAudioResources.value[idx].url);
      localAudioResources.value.splice(idx, 1);
    }
  } else {
    danmuStore.remove(item.id);
  }
  console.log(`[ResourcesPanel] 删除: ${item.id}`);
};

// 处理音频上传
const handleAudioUpload = (payload: {
  file: File;
  duration: number;
  url: string;
}) => {
  const { file, duration, url } = payload;
  const resource: AudioResource = {
    id: Math.random().toString(36).slice(2),
    type: "audio-file",
    name: file.name,
    url,
    file,
    duration,
  };
  localAudioResources.value.push(resource);
  console.log(
    `[ResourcesPanel] 上传音频文件: ${file.name}, 时长: ${duration}ms`
  );
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
</script>

<template>
  <div
    class="h-full w-full bg-sidebar border-r border-sidebar-border flex text-sm select-none"
  >
    <!-- Vertical Tabs -->
    <ResourcesSidebar v-model="activeTab" />

    <!-- List Content -->
    <div class="flex-1 flex flex-col min-w-0 bg-background/50">
      <!-- Header -->
      <ResourcesHeader
        v-model:searchQuery="searchQuery"
        @add-danmu="handleAddDanmu"
        @upload-audio="handleAudioUpload"
      />

      <!-- List -->
      <ResourcesList
        :items="filteredItems"
        :selected-id="danmuStore.selectedId"
        @select="handleSelect"
        @update-name="handleUpdateName"
        @delete="handleDelete"
        @drag-start="handleDragStart"
      />

      <!-- Footer: 弹幕数量统计 -->
      <div
        class="h-8 border-t border-sidebar-border flex items-center justify-between px-4 text-xs text-muted-foreground bg-sidebar/30"
      >
        <span
          >共
          {{ danmuStore.danmus.length + localAudioResources.length }}
          个项目</span
        >
        <span v-if="danmuStore.selected" class="text-primary">
          已选中: {{ getItemName(danmuStore.selected) }}
        </span>
      </div>
    </div>
  </div>
</template>