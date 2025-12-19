<script setup lang="ts">
import { ref, computed, nextTick } from "vue";
import {
  Folder,
  Search,
  MessageSquareText,
  Waypoints,
  SquareMousePointer,
  Trash2,
  Pencil,
  AudioLines,
} from "lucide-vue-next";
import { useDanmuStore } from "@/stores/danmu";
import { Input } from "@/components/ui/input";
import type { DanmuType, AnyDanmu } from "@/types/danmu";
import type { AudioResource } from "@/types/resource";

const danmuStore = useDanmuStore();

const localAudioResources = ref<AudioResource[]>([]);

const getAudioDuration = (file: File): Promise<number> => {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    audio.src = url;
    audio.onloadedmetadata = () => {
      resolve(audio.duration * 1000);
      URL.revokeObjectURL(url);
    };
    audio.onerror = () => resolve(0);
  });
};

const tabs = [
  { id: "all", icon: Folder, label: "全部" },
  { id: "text", icon: MessageSquareText, label: "文本弹幕" },
  { id: "button", icon: SquareMousePointer, label: "按钮弹幕" },
  { id: "path", icon: Waypoints, label: "路径弹幕" },
  { id: "audio", icon: AudioLines, label: "音频资源" },
];

const activeTab = ref("all");

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

// 根据当前 tab 过滤弹幕列表
const filteredItems = computed<Array<AnyDanmu | AudioResource>>(() => {
  if (activeTab.value === "all")
    return [...danmuStore.danmus, ...localAudioResources.value];
  if (activeTab.value === "audio") return localAudioResources.value;
  return danmuStore.danmus.filter((d: AnyDanmu) => d.type === activeTab.value);
});

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

// 获取弹幕默认名称（当没有自定义名称时使用）
const getDefaultName = (item: AnyDanmu | AudioResource): string => {
  switch (item.type) {
    case "text":
      return (item as { content: string }).content || "文本弹幕";
    case "button":
      return (item as { text: string }).text || "按钮弹幕";
    case "path":
      return "路径弹幕";
    case "audio-file":
      return (item as AudioResource).file.name || "未命名音频";
    default:
      return "未知项目";
  }
};

// 获取弹幕显示名称（优先使用自定义名称）
const getItemName = (item: AnyDanmu | AudioResource): string => {
  return item.name || getDefaultName(item);
};

// 获取弹幕类型标签
const getItemTypeLabel = (type: string): string => {
  switch (type) {
    case "text":
      return "文本";
    case "button":
      return "按钮";
    case "path":
      return "路径";
    case "audio-file":
      return "音频";
    default:
      return "未知";
  }
};

// 格式化时长显示
const formatDuration = (ms?: number): string => {
  if (!ms) return "--";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(
    remainingSeconds
  ).padStart(2, "0")}`;
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
  // 如果正在编辑其他项，先取消
  if (editingId.value && editingId.value !== item.id) {
    cancelEdit();
  }
  // 目前 store.select 只支持弹幕 ID，如果是音频，暂时可能只需高亮或不做 store 选中
  // 这里暂时只对弹幕做 store 选中
  if (item.type !== "audio-file") {
    danmuStore.select(item.id);
  }
};

// 双击开始编辑名称
const startEdit = (item: AnyDanmu | AudioResource, event: Event) => {
  event.stopPropagation();
  hasInitialFocus.value = false; // 重置聚焦标记
  editingId.value = item.id;
  editingName.value = item.name || "";
};

// 保存编辑
const saveEdit = (item: AnyDanmu | AudioResource) => {
  if (editingId.value === item.id) {
    const newName = editingName.value.trim();
    if (item.type === "audio-file") {
      const idx = localAudioResources.value.findIndex((r) => r.id === item.id);
      if (idx !== -1 && localAudioResources.value[idx]) {
        localAudioResources.value[idx].name =
          newName || localAudioResources.value[idx].file.name;
      }
    } else {
      // 更新弹幕名称
      danmuStore.updateDanmu(item.id, { name: newName || undefined });
    }
    console.log(
      `[ResourcesPanel] 更新名称: ${item.id} -> ${newName || "(默认)"}`
    );
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

// 音频上传处理
const audioInputRef = ref<HTMLInputElement | null>(null);

const triggerAudioUpload = () => {
  audioInputRef.value?.click();
};

const handleAudioUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files[0]) {
    const file = input.files[0];
    const url = URL.createObjectURL(file);
    const duration = await getAudioDuration(file);

    // 添加到本地列表
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

    // 重置 input 以便重复上传同一文件
    input.value = "";
  }
};

// 添加新弹幕（快捷按钮）
const addNewDanmu = (type: DanmuType) => {
  const newDanmu = danmuStore.add(type);
  console.log(`[ResourcesPanel] 添加新弹幕:`, newDanmu);
};

// 拖拽处理
const handleDragStart = (
  item: AnyDanmu | AudioResource,
  event: DragEvent
) => {
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "copy";
    // 序列化 item 数据。注意：File 对象无法通过 JSON 传递，如果需要传递文件引用，
    // 在同一页面内通常建议通过全局状态或 ID 查找，这里为了演示 "打印详细信息"
    // 我们尽可能序列化基本字段。
    const transferData = {
      ...item,
      // 如果是 audio resource，file 属性在 JSON 中会丢失，这里手动处理一下文件名等元数据
      file: item.type === 'audio-file' ? { name: (item as AudioResource).file.name, type: (item as AudioResource).file.type } : undefined
    };
    event.dataTransfer.setData("application/json", JSON.stringify(transferData));
    console.log(`[ResourcesPanel] 开始拖拽: ${getItemName(item)}`);
  }
};
</script>

<template>
  <div
    class="h-full w-full bg-sidebar border-r border-sidebar-border flex text-sm select-none"
  >
    <!-- Vertical Tabs -->
    <div
      class="w-14 border-r border-sidebar-border flex flex-col items-center py-2 gap-1 bg-sidebar/30"
    >
      <button
        v-for="tab in tabs"
        :key="tab.id"
        @click="activeTab = tab.id"
        class="w-10 h-10 rounded-md flex items-center justify-center transition-all duration-200 relative group"
        :class="
          activeTab === tab.id
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50'
        "
        :title="tab.label"
      >
        <component :is="tab.icon" class="size-5" />
        <span
          v-if="activeTab === tab.id"
          class="absolute left-0 top-2 bottom-2 w-0.5 bg-primary rounded-full"
        ></span>
      </button>
    </div>

    <!-- List Content -->
    <div class="flex-1 flex flex-col min-w-0 bg-background/50">
      <!-- Header -->
      <div
        class="h-12 border-b border-sidebar-border flex items-center justify-between px-4 font-medium text-sidebar-foreground bg-sidebar/50 backdrop-blur-sm"
      >
        <span>弹幕资源</span>
        <div class="flex items-center gap-2">
          <!-- 快捷添加按钮 -->
          <div class="flex gap-1">
            <button
              @click="addNewDanmu('text')"
              class="p-1 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-primary transition-colors"
              title="添加文本弹幕"
            >
              <MessageSquareText class="size-3.5" />
            </button>
            <button
              @click="addNewDanmu('button')"
              class="p-1 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-primary transition-colors"
              title="添加按钮弹幕"
            >
              <SquareMousePointer class="size-3.5" />
            </button>
            <button
              @click="addNewDanmu('path')"
              class="p-1 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-primary transition-colors"
              title="添加路径弹幕"
            >
              <Waypoints class="size-3.5" />
            </button>
            <button
              @click="triggerAudioUpload"
              class="p-1 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-primary transition-colors"
              title="上传音频文件"
            >
              <AudioLines class="size-3.5" />
            </button>
            <!-- 隐藏的音频输入框 -->
            <input
              type="file"
              ref="audioInputRef"
              accept="audio/*"
              class="hidden"
              @change="handleAudioUpload"
            />
          </div>
          <div class="relative">
            <Search
              class="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              placeholder="搜索..."
              class="h-7 w-32 bg-sidebar-accent/50 border border-sidebar-border rounded-md pl-7 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring transition-all focus:w-40"
            />
          </div>
        </div>
      </div>

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
          v-for="item in filteredItems"
          :key="item.id"
          draggable="true"
          @dragstart="handleDragStart(item, $event)"
          @click="handleItemClick(item)"
          class="group flex items-center px-3 py-2 rounded-md hover:bg-sidebar-accent cursor-pointer transition-colors text-xs"
          :class="{
            'bg-sidebar-accent/70 ring-1 ring-primary/50':
              danmuStore.selectedId === item.id,
          }"
        >
          <component
            :is="getIcon(item.type)"
            class="size-4 text-muted-foreground mr-3 group-hover:text-primary transition-colors shrink-0"
            :class="{ 'text-primary': danmuStore.selectedId === item.id }"
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
          <!-- 编辑按钮 -->
          <button
            @click="startEdit(item, $event)"
            class="ml-1 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-sidebar-accent text-muted-foreground hover:text-primary transition-all"
            title="编辑名称"
          >
            <Pencil class="size-3" />
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
          v-if="filteredItems.length === 0"
          class="flex flex-col items-center justify-center h-32 text-muted-foreground"
        >
          <Folder class="size-8 mb-2 opacity-20" />
          <span>暂无项目</span>
          <span class="text-xs mt-1">点击上方按钮添加</span>
        </div>
      </div>

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
