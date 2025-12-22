<script setup lang="ts">
import {
  Folder,
  MessageSquareText,
  SquareMousePointer,
  Waypoints,
  AudioLines,
} from "lucide-vue-next";

defineProps<{
  modelValue: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const tabs = [
  { id: "all", icon: Folder, label: "全部" },
  { id: "text", icon: MessageSquareText, label: "文本弹幕" },
  { id: "button", icon: SquareMousePointer, label: "按钮弹幕" },
  { id: "path", icon: Waypoints, label: "路径弹幕" },
  { id: "audio", icon: AudioLines, label: "音频资源" },
];
</script>

<template>
  <div
    class="w-14 border-r border-sidebar-border flex flex-col items-center py-2 gap-1 bg-sidebar/30"
  >
    <button
      v-for="tab in tabs"
      :key="tab.id"
      @click="emit('update:modelValue', tab.id)"
      class="w-10 h-10 rounded-md flex items-center justify-center transition-all duration-200 relative group"
      :class="
        modelValue === tab.id
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50'
      "
      :title="tab.label"
    >
      <component :is="tab.icon" class="size-5" />
      <span
        v-if="modelValue === tab.id"
        class="absolute left-0 top-2 bottom-2 w-0.5 bg-primary rounded-full"
      ></span>
    </button>
  </div>
</template>
