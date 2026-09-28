<script setup lang="ts">
import { ref, nextTick } from "vue";
import { useI18n } from "vue-i18n";
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
  layout: "list" | "grid";
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

const { t } = useI18n();

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
  <div class="flex-1 flex flex-col min-w-0 overflow-hidden" data-ui="resources-list">
    <!-- List Header -->
    <div
      v-if="layout === 'list'"
      class="flex items-center px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border/70 bg-background"
    >
      <div class="flex-1">{{ t('common.name') }}</div>
      <div class="w-16 text-center">{{ t('common.type') }}</div>
      <div class="w-16 text-right">{{ t('common.duration') }}</div>
      <div class="w-8"></div>
    </div>

    <!-- List Body -->
    <div
      class="flex-1 overflow-y-auto scrollbar-hidden"
      :class="
        layout === 'grid'
          ? 'grid auto-rows-min grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] content-start gap-2 p-2'
          : 'space-y-0.5 p-1'
      "
    >
      <div
        v-for="item in items"
        :key="item.id"
        draggable="true"
        @dragstart="handleDragStart(item, $event)"
        @click="handleItemClick(item)"
        @contextmenu.prevent="emit('contextmenu', item, $event)"
        class="group cursor-pointer text-xs transition-colors"
        :class="[
          layout === 'grid'
            ? 'relative flex min-h-28 flex-col justify-between rounded-sm border border-border bg-background p-3 hover:border-primary/60 hover:bg-accent/60'
            : 'flex h-8 items-center rounded-sm px-2 hover:bg-accent',
          selectedId === item.id
            ? 'bg-secondary text-secondary-foreground ring-1 ring-secondary-border'
            : '',
        ]"
      >
        <div
          v-if="layout === 'grid' && item.type === 'audio-file'"
          class="mb-1 flex h-20 w-full items-center justify-center overflow-hidden rounded-sm bg-accent"
        >
          <img
            v-if="item.coverUrl"
            :src="item.coverUrl"
            :alt="t('resources.coverAlt', { name: getItemName(item) })"
            class="size-full object-cover"
          />
          <AudioLines v-else class="size-7 text-muted-foreground" />
        </div>
        <component
          v-else
          :is="getIcon(item.type)"
          class="text-muted-foreground group-hover:text-foreground transition-colors shrink-0"
          :class="[
            layout === 'grid' ? 'mb-1 size-5' : 'mr-2.5 size-4',
            { 'text-primary': selectedId === item.id },
          ]"
        />
        <!-- 名称显示/编辑 -->
        <div :class="layout === 'grid' ? 'w-full min-w-0 pr-10' : 'mr-2 min-w-0 flex-1'">
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
            class="truncate font-medium text-foreground group-hover:text-accent-foreground"
            :class="{ 'text-muted-foreground': !item.name }"
            @dblclick="startEdit(item, $event)"
            :title="t('resources.itemTooltip', { name: getItemName(item) })"
          >
            {{ getItemName(item) }}
          </div>
        </div>
        <div
          v-if="layout === 'list'"
          class="w-14 text-center text-muted-foreground/70 shrink-0"
        >
          <span
            class="px-1.5 py-0.5 rounded-sm text-[10px] bg-accent"
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
          v-if="layout === 'list'"
          class="w-14 text-right text-muted-foreground/70 font-mono shrink-0"
        >
          {{ formatDuration(getItemDuration(item)) }}
        </div>
        <div
          v-else
          class="flex w-full items-center justify-between gap-2 text-muted-foreground/70"
        >
          <span
            class="rounded-sm bg-accent px-1.5 py-0.5 text-[10px]"
            :class="{
              'bg-blue-500/20 text-blue-400': item.type === 'text',
              'bg-orange-500/20 text-orange-400': item.type === 'button',
              'bg-green-500/20 text-green-400': item.type === 'path',
              'bg-purple-500/20 text-purple-400': item.type === 'audio-file',
            }"
          >
            {{ getItemTypeLabel(item.type) }}
          </span>
          <span class="font-mono text-[10px]">{{ formatDuration(getItemDuration(item)) }}</span>
        </div>
        <!-- 添加到轨道按钮 -->
        <button
          @click="addToNewTrack(item, $event)"
          class="size-6 rounded-sm inline-flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-accent text-muted-foreground hover:text-foreground transition-all"
          :class="layout === 'grid' ? 'absolute right-8 top-2' : 'ml-1'"
          :title="t('resources.addToNewTrack')"
        >
          <Plus class="size-3" />
        </button>
        <!-- 删除按钮 -->
        <button
          @click="handleDeleteItem(item, $event)"
          class="size-6 rounded-sm inline-flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-destructive/15 text-destructive transition-all"
          :class="layout === 'grid' ? 'absolute right-2 top-2' : ''"
          :title="t('common.delete')"
        >
          <Trash2 class="size-3.5" />
        </button>
      </div>

      <div
        v-if="items.length === 0"
        class="flex h-36 flex-col items-center justify-center border border-dashed border-border text-muted-foreground"
        :class="layout === 'grid' ? '' : 'mx-2'"
      >
        <Folder class="size-8 mb-2 opacity-20" />
        <span>{{ t('resources.empty') }}</span>
        <span class="mt-1 text-xs">{{ t('resources.emptyHint') }}</span>
      </div>
    </div>
  </div>
</template>
