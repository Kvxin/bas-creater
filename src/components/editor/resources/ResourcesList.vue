<script setup lang="ts">
import { ref, nextTick } from "vue";
import {
  Folder,
  MessageSquareText,
  SquareMousePointer,
  Waypoints,
  AudioLines,
  Plus,
  Trash2,
} from "lucide-vue-next";
import { Input } from "@/components/ui/input";
import { useTimelineStore } from "@/stores/timeline";
import type { AnyDanmu } from "@/types/danmu";
import type { AudioResource } from "@/types/resource";

import {
  getDefaultName,
  getItemName,
  getItemTypeLabel,
  formatDuration,
} from "@/utils/resourceUtils";

const props = defineProps<{
  items: Array<AnyDanmu | AudioResource>;
  selectedId?: string | null;
}>();

const emit = defineEmits<{
  (e: "select", item: AnyDanmu | AudioResource): void;
  (e: "delete", item: AnyDanmu | AudioResource): void;
  (e: "update-name", item: AnyDanmu | AudioResource, name: string): void;
  (e: "drag-start", item: AnyDanmu | AudioResource, event: DragEvent): void;
  (e: "contextmenu", item: AnyDanmu | AudioResource, event: MouseEvent): void;
}>();

const timelineStore = useTimelineStore();

// 编辑状态
const editingId = ref<string | null>(null);
const editingName = ref("");
const hasInitialFocus = ref(false);

// 设置 input ref 的回调函数（只在首次挂载时聚焦）
const setEditInputRef = (el: any) => {
  if (el && !hasInitialFocus.value) {
    hasInitialFocus.value = true;
    nextTick(() => {
      el.focus?.();
      el.select?.();
    });
  }
};

// 获取弹幕类型对应的图标
const getIcon = (type: string) => {
  switch (type) {
    case "text":
      return MessageSquareText;
    case "button":
      return SquareMousePointer;
    case "path":
      return Waypoints;
    case "audio-file":
      return AudioLines;
    default:
      return Folder;
  }
};

const getItemDuration = (
  item: AnyDanmu | AudioResource
): number | undefined => {
  if (item.type === "audio-file") {
    return (item as AudioResource).duration;
  }
  return (item as AnyDanmu).durationMs;
};

// 点击列表项
const handleItemClick = (item: AnyDanmu | AudioResource) => {
  if (editingId.value && editingId.value !== item.id) {
    cancelEdit();
  }
  emit("select", item);
};

// 双击开始编辑名称
const startEdit = (item: AnyDanmu | AudioResource, event: Event) => {
  event.stopPropagation();
  hasInitialFocus.value = false;
  editingId.value = item.id;
  editingName.value = item.name || "";
};

// 保存编辑
const saveEdit = (item: AnyDanmu | AudioResource) => {
  if (editingId.value === item.id) {
    const newName = editingName.value.trim();
    emit("update-name", item, newName);
  }
  cancelEdit();
};

// 取消编辑
const cancelEdit = () => {
  editingId.value = null;
  editingName.value = "";
};

// 处理编辑输入框按键
const handleEditKeydown = (
  event: KeyboardEvent,
  item: AnyDanmu | AudioResource
) => {
  if (event.key === "Enter") {
    saveEdit(item);
  } else if (event.key === "Escape") {
    cancelEdit();
  }
};

// 删除项
const handleDeleteItem = (item: AnyDanmu | AudioResource, event: Event) => {
  event.stopPropagation();
  emit("delete", item);
};

// 拖拽处理
const handleDragStart = (
  item: AnyDanmu | AudioResource,
  event: DragEvent
) => {
  emit("drag-start", item, event);
};

const addToNewTrack = (item: AnyDanmu | AudioResource, event: Event) => {
  event.stopPropagation();
  const trackId = timelineStore.addTrack();
  timelineStore.addClip(item, trackId, 0);
};
</script>

<template>
  <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
    <!-- List Header -->
    <div
      class="flex items-center px-4 py-2 text-xs font-medium text-muted-foreground border-b border-sidebar-border/50"
    >
      <div class="flex-1">名称</div>
      <div class="w-16 text-center">类型</div>
      <div class="w-16 text-right">时长</div>
      <div class="w-8"></div>
    </div>

    <!-- List Body -->
    <div class="flex-1 overflow-y-auto p-1 space-y-0.5">
      <div
        v-for="item in items"
        :key="item.id"
        draggable="true"
        @dragstart="handleDragStart(item, $event)"
        @click="handleItemClick(item)"
        @contextmenu.prevent="emit('contextmenu', item, $event)"
        class="group flex items-center px-3 py-2 rounded-md hover:bg-sidebar-accent cursor-pointer transition-colors text-xs"
        :class="{
          'bg-sidebar-accent/70 ring-1 ring-primary/50':
            selectedId === item.id,
        }"
      >
        <component
          :is="getIcon(item.type)"
          class="size-4 text-muted-foreground mr-3 group-hover:text-primary transition-colors shrink-0"
          :class="{ 'text-primary': selectedId === item.id }"
        />
        <!-- 名称显示/编辑 -->
        <div class="flex-1 min-w-0 mr-2">
          <!-- 编辑模式 -->
          <Input
            v-if="editingId === item.id"
            :ref="setEditInputRef"
            v-model="editingName"
            type="text"
            :placeholder="getDefaultName(item)"
            class="h-6 px-1.5 text-xs"
            @click.stop
            @keydown="handleEditKeydown($event, item)"
            @blur="saveEdit(item)"
          />
          <!-- 显示模式 -->
          <div
            v-else
            class="truncate font-medium text-sidebar-foreground group-hover:text-sidebar-accent-foreground"
            :class="{ 'text-muted-foreground': !item.name }"
            @dblclick="startEdit(item, $event)"
            :title="getItemName(item) + ' (双击编辑)'"
          >
            {{ getItemName(item) }}
          </div>
        </div>
        <div class="w-14 text-center text-muted-foreground/70 shrink-0">
          <span
            class="px-1.5 py-0.5 rounded text-[10px] bg-sidebar-accent"
            :class="{
              'bg-blue-500/20 text-blue-400': item.type === 'text',
              'bg-orange-500/20 text-orange-400': item.type === 'button',
              'bg-green-500/20 text-green-400': item.type === 'path',
              'bg-purple-500/20 text-purple-400': item.type === 'audio-file',
            }"
          >
            {{ getItemTypeLabel(item.type) }}
          </span>
        </div>
        <div
          class="w-14 text-right text-muted-foreground/70 font-mono shrink-0"
        >
          {{ formatDuration(getItemDuration(item)) }}
        </div>
        <!-- 编辑按钮 (改为添加到轨道) -->
        <button
          @click="addToNewTrack(item, $event)"
          class="ml-1 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-sidebar-accent text-muted-foreground hover:text-primary transition-all"
          title="添加到新轨道"
        >
          <Plus class="size-3" />
        </button>
        <!-- 删除按钮 -->
        <button
          @click="handleDeleteItem(item, $event)"
          class="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/20 text-destructive transition-all"
          title="删除"
        >
          <Trash2 class="size-3.5" />
        </button>
      </div>

      <div
        v-if="items.length === 0"
        class="flex flex-col items-center justify-center h-32 text-muted-foreground"
      >
        <Folder class="size-8 mb-2 opacity-20" />
        <span>暂无项目</span>
        <span class="text-xs mt-1">点击上方按钮添加</span>
      </div>
    </div>
  </div>
</template>
