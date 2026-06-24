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
    class="w-11 border-r border-border flex flex-col items-center py-1 gap-0.5 bg-background scrollbar-hidden overflow-y-auto"
    data-ui="resources-tabs"
  >
    <button
      v-for="tab in tabs"
      :key="tab.id"
      @click="emit('update:modelValue', tab.id)"
      class="size-8 rounded-sm flex items-center justify-center transition-colors relative group shrink-0"
      :class="
        modelValue === tab.id
          ? 'bg-secondary text-secondary-foreground border border-secondary-border'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
      "
      :title="tab.label"
    >
      <component :is="tab.icon" class="size-4" />
      <span
        v-if="modelValue === tab.id"
        class="absolute left-0 top-2 bottom-2 w-0.5 bg-primary rounded-full"
      ></span>
    </button>
  </div>
</template>
