<script setup lang="ts">
import { computed, ref, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowDown, ArrowUp, ArrowUpDown, Folder, MessageSquareText, SquareMousePointer, Waypoints, AudioLines, Plus, Trash2 } from "lucide-vue-next";
import { getCoreRowModel, getSortedRowModel, useVueTable, type ColumnDef, type SortingState } from "@tanstack/vue-table";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTimelineStore } from "@/stores/timeline";
import type { AnyDanmu } from "@/types/danmu";
import type { AudioResource } from "@/types/resource";

import { getDefaultName, getItemName, getItemTypeLabel, formatDuration } from "@/utils/resourceUtils";

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

const { t, locale } = useI18n();

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

const getItemDuration = (item: AnyDanmu | AudioResource): number | undefined => {
  if (item.type === "audio-file") {
    return (item as AudioResource).duration;
  }
  return (item as AnyDanmu).durationMs;
};

type ResourceSortRow = {
  item: AnyDanmu | AudioResource;
  name: string;
  type: string;
  duration: number | undefined;
};
type SortColumn = "name" | "type" | "duration";
const collator = computed(() => new Intl.Collator(locale.value, { numeric: true, sensitivity: "base" }));
const tableData = computed<ResourceSortRow[]>(() => props.items.map(item => {
  const duration = getItemDuration(item);
  return {
    item,
    name: getItemName(item),
    type: getItemTypeLabel(item.type),
    duration: duration && Number.isFinite(duration) && duration > 0 ? duration : undefined
  };
}));
const columns: ColumnDef<ResourceSortRow>[] = [
  { accessorKey: "name", sortingFn: (a, b) => collator.value.compare(a.original.name, b.original.name) },
  { accessorKey: "type", sortingFn: (a, b) => collator.value.compare(a.original.type, b.original.type) },
  { accessorKey: "duration", sortUndefined: "last" }
];
const sorting = ref<SortingState>([]);
const table = useVueTable({
  get data() { return tableData.value; },
  columns,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getRowId: row => row.item.id,
  enableSortingRemoval: false,
  state: { get sorting() { return sorting.value; } },
  onSortingChange: updater => {
    sorting.value = typeof updater === "function" ? updater(sorting.value) : updater;
  }
});
const sortedItems = computed(() => table.getRowModel().rows.map(row => row.original.item));
const toggleSort = (id: SortColumn) => {
  const column = table.getColumn(id);
  column?.toggleSorting(column.getIsSorted() === "asc");
};
const sortState = (id: SortColumn) => {
  const value = table.getColumn(id)?.getIsSorted();
  return value === "asc" ? "ascending" : value === "desc" ? "descending" : undefined;
};
const sortIcon = (id: SortColumn) => {
  const value = table.getColumn(id)?.getIsSorted();
  return value === "asc" ? ArrowUp : value === "desc" ? ArrowDown : ArrowUpDown;
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
const handleEditKeydown = (event: KeyboardEvent, item: AnyDanmu | AudioResource) => {
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
const handleDragStart = (item: AnyDanmu | AudioResource, event: DragEvent) => {
  emit("drag-start", item, event);
};

const addToNewTrack = (item: AnyDanmu | AudioResource, event: Event) => {
  event.stopPropagation();
  if (item.type === "audio-file" && timelineStore.activeGroupPath.length) return;
  const trackId = timelineStore.addTrack();
  if (trackId) timelineStore.addClip(item, trackId, 0);
};
</script>

<template>
  <div class="flex-1 flex flex-col min-w-0 overflow-hidden" data-ui="resources-list">
    <div v-if="layout === 'list'" class="flex-1 overflow-y-auto scrollbar-hidden">
      <Table class="table-fixed text-xs">
        <colgroup>
          <col />
          <col class="w-16" />
          <col class="w-20" />
        </colgroup>
        <TableHeader class="sticky top-0 z-10 bg-background">
          <TableRow class="border-border/70 hover:bg-transparent">
            <TableHead scope="col" class="h-9 pl-3 text-xs" :aria-sort="sortState('name')">
              <button type="button" class="flex w-full items-center gap-1 hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary" @click="toggleSort('name')">
                {{ t("common.name") }} <component :is="sortIcon('name')" class="size-3 shrink-0" aria-hidden="true" />
              </button>
            </TableHead>
            <TableHead scope="col" class="h-9 px-1 text-xs" :aria-sort="sortState('type')">
              <button type="button" class="flex w-full items-center justify-center gap-0.5 hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary" @click="toggleSort('type')">
                {{ t("common.type") }} <component :is="sortIcon('type')" class="size-3 shrink-0" aria-hidden="true" />
              </button>
            </TableHead>
            <TableHead scope="col" class="h-9 px-1 text-xs" :aria-sort="sortState('duration')">
              <button type="button" class="flex w-full items-center justify-end gap-0.5 hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary" @click="toggleSort('duration')">
                {{ t("common.duration") }} <component :is="sortIcon('duration')" class="size-3 shrink-0" aria-hidden="true" />
              </button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="item in sortedItems"
            :key="item.id"
            draggable="true"
            tabindex="0"
            :aria-selected="selectedId === item.id"
            :data-state="selectedId === item.id ? 'selected' : undefined"
            class="resource-item group cursor-pointer border-0 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary"
            @dragstart="handleDragStart(item, $event)"
            @click="handleItemClick(item)"
            @contextmenu.prevent="emit('contextmenu', item, $event)"
            @keydown.enter.self.prevent="handleItemClick(item)"
            @keydown.space.self.prevent="handleItemClick(item)"
          >
            <TableCell class="h-9 pl-3">
              <div class="flex min-w-0 items-center gap-2.5">
                <component :is="getIcon(item.type)" class="size-4 shrink-0 text-muted-foreground" :class="{ 'text-primary': selectedId === item.id }" />
                <Input
                  v-if="editingId === item.id"
                  :ref="setEditInputRef"
                  v-model="editingName"
                  type="text"
                  :placeholder="getDefaultName(item)"
                  class="h-6 min-w-0 px-1.5 text-xs"
                  @click.stop
                  @keydown="handleEditKeydown($event, item)"
                  @blur="saveEdit(item)"
                />
                <div
                  v-else
                  class="min-w-0 truncate font-medium text-foreground"
                  :class="{ 'text-muted-foreground': !item.name }"
                  :title="t('resources.itemTooltip', { name: getItemName(item) })"
                  @dblclick="startEdit(item, $event)"
                >
                  {{ getItemName(item) }}
                </div>
              </div>
            </TableCell>
            <TableCell class="text-center">
              <span class="rounded-sm bg-surface px-1.5 py-0.5 text-[11px] text-muted-foreground">{{ getItemTypeLabel(item.type) }}</span>
            </TableCell>
            <TableCell class="relative pr-3 text-right font-mono text-muted-foreground">
              <span class="group-hover:opacity-0 group-focus-within:opacity-0">{{ formatDuration(getItemDuration(item)) }}</span>
              <div class="absolute right-1 top-1/2 flex -translate-y-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                <button type="button" class="size-6 rounded-sm inline-flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground" :title="t('resources.addToNewTrack')" :aria-label="t('resources.addToNewTrack')" @click="addToNewTrack(item, $event)">
                  <Plus class="size-3" />
                </button>
                <button type="button" class="size-6 rounded-sm inline-flex items-center justify-center hover:bg-destructive/15 text-destructive" :title="t('common.delete')" :aria-label="t('common.delete')" @click="handleDeleteItem(item, $event)">
                  <Trash2 class="size-3.5" />
                </button>
              </div>
            </TableCell>
          </TableRow>
          <TableRow v-if="items.length === 0" class="border-0 hover:bg-transparent">
            <TableCell colspan="3">
              <div class="flex h-36 flex-col items-center justify-center text-muted-foreground">
                <Folder class="size-6 mb-3 text-tertiary" />
                <span>{{ t("resources.empty") }}</span>
                <span class="mt-1 text-xs">{{ t("resources.emptyHint") }}</span>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
    <div
      v-else
      class="flex-1 overflow-y-auto scrollbar-hidden grid auto-rows-min grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] content-start gap-2 p-2"
    >
      <div
        v-for="item in items"
        :key="item.id"
        draggable="true"
        @dragstart="handleDragStart(item, $event)"
        @click="handleItemClick(item)"
        @contextmenu.prevent="emit('contextmenu', item, $event)"
        class="resource-item group cursor-pointer text-xs transition-colors"
        role="button"
        tabindex="0"
        :aria-pressed="selectedId === item.id"
        @keydown.enter.self.prevent="handleItemClick(item)"
        @keydown.space.self.prevent="handleItemClick(item)"
        :class="[
          'relative flex min-h-28 flex-col justify-between rounded-sm border border-divider p-3 hover:border-border hover:bg-accent/60',
          selectedId === item.id ? 'bg-secondary text-secondary-foreground ring-1 ring-inset ring-primary/60' : ''
        ]"
      >
        <div
          v-if="item.type === 'audio-file'"
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
          :class="['mb-1 size-5', { 'text-primary': selectedId === item.id }]"
        />
        <!-- 名称显示/编辑 -->
        <div class="w-full min-w-0 pr-10">
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
        <div class="flex w-full items-center justify-between gap-2 text-muted-foreground">
          <span class="rounded-sm bg-surface px-1.5 py-0.5 text-[11px]">
            {{ getItemTypeLabel(item.type) }}
          </span>
          <span class="font-mono text-[11px]">{{ formatDuration(getItemDuration(item)) }}</span>
        </div>
        <!-- 添加到轨道按钮 -->
        <button
          @click="addToNewTrack(item, $event)"
          type="button"
          class="absolute right-8 top-2 size-6 rounded-sm inline-flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-accent text-muted-foreground hover:text-foreground transition-all"
          :title="t('resources.addToNewTrack')"
        >
          <Plus class="size-3" />
        </button>
        <!-- 删除按钮 -->
        <button
          @click="handleDeleteItem(item, $event)"
          type="button"
          class="absolute right-2 top-2 size-6 rounded-sm inline-flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-destructive/15 text-destructive transition-all"
          :title="t('common.delete')"
        >
          <Trash2 class="size-3.5" />
        </button>
      </div>

      <div
        v-if="items.length === 0"
        class="flex h-36 flex-col items-center justify-center text-muted-foreground"
      >
        <Folder class="size-6 mb-3 text-tertiary" />
        <span>{{ t("resources.empty") }}</span>
        <span class="mt-1 text-xs">{{ t("resources.emptyHint") }}</span>
      </div>
    </div>
  </div>
</template>
