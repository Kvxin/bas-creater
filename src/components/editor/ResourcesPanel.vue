<script setup lang="ts">
import { ref, computed } from "vue";
import {
  Folder,
  Music,
  Image,
  Type,
  Search,
  MessageSquareText,
  Waypoints,
  SquareMousePointer,
  Trash2,
} from "lucide-vue-next";
import { useDanmuStore } from "@/stores/danmu";
import type { DanmuType, AnyDanmu } from "@/types/danmu";

const danmuStore = useDanmuStore();

const tabs = [
  { id: "all", icon: Folder, label: "全部" },
  { id: "text", icon: MessageSquareText, label: "文本弹幕" },
  { id: "button", icon: SquareMousePointer, label: "按钮弹幕" },
  { id: "path", icon: Waypoints, label: "路径弹幕" },
];

const activeTab = ref("all");

// 根据当前 tab 过滤弹幕列表
const filteredDanmus = computed(() => {
  if (activeTab.value === "all") return danmuStore.danmus;
  return danmuStore.danmus.filter((d) => d.type === activeTab.value);
});

// 获取弹幕类型对应的图标
const getIcon = (type: DanmuType) => {
  switch (type) {
    case "text":
      return MessageSquareText;
    case "button":
      return SquareMousePointer;
    case "path":
      return Waypoints;
    default:
      return Folder;
  }
};

// 获取弹幕显示名称
const getDanmuName = (danmu: AnyDanmu): string => {
  switch (danmu.type) {
    case "text":
      return danmu.content || "文本弹幕";
    case "button":
      return danmu.text || "按钮弹幕";
    case "path":
      return "路径弹幕";
    default:
      return "未知弹幕";
  }
};

// 获取弹幕类型标签
const getDanmuTypeLabel = (type: DanmuType): string => {
  switch (type) {
    case "text":
      return "文本";
    case "button":
      return "按钮";
    case "path":
      return "路径";
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
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
};

// 点击弹幕项 - 选中
const handleDanmuClick = (danmu: AnyDanmu) => {
  danmuStore.select(danmu.id);
  console.log(`[ResourcesPanel] 选中弹幕: ${danmu.id}`);
};

// 删除弹幕
const handleDeleteDanmu = (danmu: AnyDanmu, event: Event) => {
  event.stopPropagation();
  danmuStore.remove(danmu.id);
  console.log(`[ResourcesPanel] 删除弹幕: ${danmu.id}`);
};

// 添加新弹幕（快捷按钮）
const addNewDanmu = (type: DanmuType) => {
  const newDanmu = danmuStore.add(type);
  console.log(`[ResourcesPanel] 添加新弹幕:`, newDanmu);
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
          v-for="danmu in filteredDanmus"
          :key="danmu.id"
          @click="handleDanmuClick(danmu)"
          class="group flex items-center px-3 py-2 rounded-md hover:bg-sidebar-accent cursor-pointer transition-colors text-xs"
          :class="{
            'bg-sidebar-accent/70 ring-1 ring-primary/50': danmuStore.selectedId === danmu.id,
          }"
        >
          <component
            :is="getIcon(danmu.type)"
            class="size-4 text-muted-foreground mr-3 group-hover:text-primary transition-colors"
            :class="{ 'text-primary': danmuStore.selectedId === danmu.id }"
          />
          <div
            class="flex-1 truncate font-medium text-sidebar-foreground group-hover:text-sidebar-accent-foreground"
          >
            {{ getDanmuName(danmu) }}
          </div>
          <div class="w-16 text-center text-muted-foreground/70">
            <span
              class="px-1.5 py-0.5 rounded text-[10px] bg-sidebar-accent"
              :class="{
                'bg-blue-500/20 text-blue-400': danmu.type === 'text',
                'bg-orange-500/20 text-orange-400': danmu.type === 'button',
                'bg-green-500/20 text-green-400': danmu.type === 'path',
              }"
            >
              {{ getDanmuTypeLabel(danmu.type) }}
            </span>
          </div>
          <div class="w-16 text-right text-muted-foreground/70 font-mono">
            {{ formatDuration(danmu.durationMs) }}
          </div>
          <!-- 删除按钮 -->
          <button
            @click="handleDeleteDanmu(danmu, $event)"
            class="ml-2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/20 text-destructive transition-all"
            title="删除弹幕"
          >
            <Trash2 class="size-3.5" />
          </button>
        </div>

        <div
          v-if="filteredDanmus.length === 0"
          class="flex flex-col items-center justify-center h-32 text-muted-foreground"
        >
          <Folder class="size-8 mb-2 opacity-20" />
          <span>暂无弹幕</span>
          <span class="text-xs mt-1">点击上方按钮添加</span>
        </div>
      </div>

      <!-- Footer: 弹幕数量统计 -->
      <div
        class="h-8 border-t border-sidebar-border flex items-center justify-between px-4 text-xs text-muted-foreground bg-sidebar/30"
      >
        <span>共 {{ danmuStore.danmus.length }} 个弹幕</span>
        <span v-if="danmuStore.selectedId" class="text-primary">
          已选中: {{ getDanmuName(danmuStore.selected!) }}
        </span>
      </div>
    </div>
  </div>
</template>
