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
  PlusCircle,
} from "lucide-vue-next";
import basService from "@/utils/bas";
import {
  createTextDanmu,
  createButtonDanmu,
  createPathDanmu,
  danmuToDSL,
} from "@/utils/danmuFactory";

const tabs = [
  { id: "all", icon: Folder, label: "All" },
  { id: "audio", icon: Music, label: "Audio" },
  { id: "image", icon: Image, label: "Images" },
  { id: "text", icon: Type, label: "Text" },
  { id: "danmu", icon: MessageSquareText, label: "Bullet Comments" },
  { id: "path", icon: Waypoints, label: "Path" },
  { id: "button", icon: SquareMousePointer, label: "Button" },
];

const activeTab = ref("all");

const assets = [
  {
    id: 1,
    name: "voiceover_01.mp3",
    type: "audio",
    size: "2.5MB",
    duration: "01:20",
  },
];

const filteredAssets = computed(() => {
  if (activeTab.value === "all") return assets;
  return assets.filter((a) => a.type === activeTab.value);
});

const getIcon = (type: string) => {
  switch (type) {
    case "audio":
      return Music;
    case "image":
      return Image;
    case "text":
      return Type;
    case "danmu":
      return MessageSquareText;
    case "path":
      return Waypoints;
    case "button":
      return SquareMousePointer;
    default:
      return Folder;
  }
};

// 判断是否是可添加到预览的弹幕类型
const isDanmuType = (type: string) =>
  ["danmu", "path", "button"].includes(type);

// 点击资源项时的处理
const handleAssetClick = (asset: (typeof assets)[0]) => {
  if (!isDanmuType(asset.type)) {
    console.log(`[ResourcesPanel] 点击了非弹幕资源: ${asset.name}`);
    return;
  }

  if (!basService.isReady()) {
    console.warn("[ResourcesPanel] BAS 服务未初始化");
    return;
  }

  // 根据类型创建弹幕对象
  let danmu;
  if (asset.type === "danmu") {
    danmu = createTextDanmu({
      content: asset.name,
      x: 50,
      y: 50,
      fontSize: 5,
      durationMs: 5000,
    });
  } else if (asset.type === "button") {
    danmu = createButtonDanmu({
      text: asset.name,
      x: 50,
      y: 50,
      durationMs: 5000,
    });
  } else if (asset.type === "path") {
    // 简单的心形路径示例
    danmu = createPathDanmu({
      d: "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z",
      viewBox: "0 0 24 24",
      x: 50,
      y: 50,
      scale: 2,
      durationMs: 5000,
    });
  }

  if (danmu) {
    const dsl = danmuToDSL(danmu);
    console.log("[ResourcesPanel] 添加弹幕 DSL:", dsl);
    basService.addRaw(dsl, {
      test: true, // 使用 test 模式，弹幕结束后自动移除
      success: (dm) => {
        console.log("[ResourcesPanel] 弹幕添加成功:", dm);
      },
      error: (msg) => {
        console.error("[ResourcesPanel] 弹幕添加失败:", msg);
      },
    });
  }
};

// 添加新弹幕（快捷按钮）
const addNewDanmu = (type: "danmu" | "button" | "path") => {
  if (!basService.isReady()) {
    console.warn("[ResourcesPanel] BAS 服务未初始化");
    return;
  }

  let danmu;
  if (type === "danmu") {
    danmu = createTextDanmu({
      content: "新弹幕 " + Date.now(),
      x: Math.random() * 80 + 10,
      y: Math.random() * 80 + 10,
      fontSize: 5,
      durationMs: 5000,
    });
  } else if (type === "button") {
    danmu = createButtonDanmu({
      text: "按钮",
      x: Math.random() * 80 + 10,
      y: Math.random() * 80 + 10,
      durationMs: 5000,
    });
  } else {
    danmu = createPathDanmu({
      d: "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z",
      viewBox: "0 0 24 24",
      x: Math.random() * 80 + 10,
      y: Math.random() * 80 + 10,
      scale: 2,
      durationMs: 5000,
    });
  }

  const dsl = danmuToDSL(danmu);
  basService.addRaw(dsl, {
    test: true,
    success: () => console.log("[ResourcesPanel] 新弹幕添加成功"),
    error: (msg) => console.error("[ResourcesPanel] 新弹幕添加失败:", msg),
  });
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
        <span>Resources</span>
        <div class="flex items-center gap-2">
          <!-- 快捷添加按钮 -->
          <div class="flex gap-1">
            <button
              @click="addNewDanmu('danmu')"
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
              placeholder="Search..."
              class="h-7 w-32 bg-sidebar-accent/50 border border-sidebar-border rounded-md pl-7 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring transition-all focus:w-40"
            />
          </div>
        </div>
      </div>

      <!-- List Header -->
      <div
        class="flex items-center px-4 py-2 text-xs font-medium text-muted-foreground border-b border-sidebar-border/50"
      >
        <div class="flex-1">Name</div>
        <div class="w-16 text-right">Size</div>
        <div class="w-16 text-right">Duration</div>
      </div>

      <!-- List Body -->
      <div class="flex-1 overflow-y-auto p-1 space-y-0.5">
        <div
          v-for="asset in filteredAssets"
          :key="asset.id"
          @click="handleAssetClick(asset)"
          class="group flex items-center px-3 py-2 rounded-md hover:bg-sidebar-accent cursor-pointer transition-colors text-xs"
          :class="{ 'border-l-2 border-primary': isDanmuType(asset.type) }"
        >
          <component
            :is="getIcon(asset.type)"
            class="size-4 text-muted-foreground mr-3 group-hover:text-primary transition-colors"
          />
          <div
            class="flex-1 truncate font-medium text-sidebar-foreground group-hover:text-sidebar-accent-foreground"
          >
            {{ asset.name }}
          </div>
          <div class="w-16 text-right text-muted-foreground/70 font-mono">
            {{ asset.size }}
          </div>
          <div class="w-16 text-right text-muted-foreground/70 font-mono">
            {{ asset.duration }}
          </div>
          <!-- 添加按钮（仅弹幕类型显示） -->
          <button
            v-if="isDanmuType(asset.type)"
            @click.stop="handleAssetClick(asset)"
            class="ml-2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-primary/20 text-primary transition-all"
            title="添加到预览"
          >
            <PlusCircle class="size-3.5" />
          </button>
        </div>

        <div
          v-if="filteredAssets.length === 0"
          class="flex flex-col items-center justify-center h-32 text-muted-foreground"
        >
          <Folder class="size-8 mb-2 opacity-20" />
          <span>No items found</span>
        </div>
      </div>
    </div>
  </div>
</template>
