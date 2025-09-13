<script setup lang="ts">
import { Button } from "@/components/ui/button";
import interact from "interactjs";
import {
  FolderOpen,
  Image as ImageIcon,
  Music,
  Video,
  FileText,
  Search,
  Import,
} from "lucide-vue-next";
import { onMounted } from "vue";

export type ResourceTabs = "Danmakus" | "audio" | "images" | "documents";

const props = defineProps<{
  active: ResourceTabs;
  resources: Record<string, any[]>;
}>();

const emit = defineEmits<{
  (e: "update:active", tab: ResourceTabs): void;
}>();

function getResourceTabIcon(tab: string) {
  switch (tab) {
    case "Danmakus":
      return Video;
    case "audio":
      return Music;
    case "images":
      return ImageIcon;
    case "documents":
      return FileText;
    default:
      return FolderOpen;
  }
}

const setupResizable = () => {
  interact(".resource-panel")
    .resizable({
      edges: { right: true },
      modifiers: [
        interact.modifiers.restrictSize({
          min: { width: 256, height: 0 },
        }),
      ],
      inertia: true,
    })
    .on("resizemove", (event: any) => {
      const element = event.target;
      const newWidth = event.rect.width;
      element.style.width = `${newWidth}px`;
    });
};

onMounted(() => {
  setupResizable();
});
</script>

<template>
  <div
    class="w-64 bg-card border-r border-border flex pr-1 resource-panel select-none"
  >
    <!-- Vertical Tabs -->
    <div class="w-12 bg-muted/30 border-r border-border flex flex-col">
      <Button
        v-for="tab in ['Danmakus', 'audio', 'images', 'documents']"
        :key="tab"
        :variant="active === (tab as any) ? 'default' : 'ghost'"
        size="sm"
        class="w-full h-12 rounded-none border-b border-border/50"
        @click="$emit('update:active', tab as any)"
      >
        <component :is="getResourceTabIcon(tab)" class="w-4 h-4" />
      </Button>
    </div>

    <!-- Resource Content -->
    <div class="flex-1 flex flex-col">
      <div
        class="h-14 border-b border-border flex items-center justify-between px-3"
      >
        <h2 class="font-semibold capitalize">{{ active }}</h2>
        <Button variant="ghost" size="sm">
          <Import class="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="sm">
          <Search class="w-4 h-4" />
        </Button>
      </div>

      <div class="flex-1 p-3 space-y-2 overflow-y-auto">
        <div
          v-for="item in (resources as any)[active]"
          :key="item.id"
          class="p-2 rounded border border-border hover:bg-muted/50 cursor-pointer transition-colors"
        >
          <div class="text-sm font-medium truncate">{{ item.name }}</div>
          <div class="text-xs text-muted-foreground flex justify-between">
            <span>{{ item.size }}</span>
            <span v-if="item.duration">{{ item.duration }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
