<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
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

const { t } = useI18n();

// computed：标签需随语言切换重新求值，普通 const 会在首次渲染后冻结语言。
const tabs = computed(() => [
  { id: "all", icon: Folder, label: t("resources.tabAll") },
  { id: "text", icon: MessageSquareText, label: t("danmu.type.text") },
  { id: "button", icon: SquareMousePointer, label: t("danmu.type.button") },
  { id: "path", icon: Waypoints, label: t("danmu.type.path") },
  { id: "audio", icon: AudioLines, label: t("resources.tabAudio") },
]);
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
