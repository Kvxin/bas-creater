<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  Search,
  MessageSquareText,
  SquareMousePointer,
  Waypoints,
  AudioLines,
} from "lucide-vue-next";
import type { DanmuType } from "@/types/danmu";

defineProps<{
  searchQuery?: string;
}>();

const emit = defineEmits<{
  (e: "update:searchQuery", value: string): void;
  (e: "add-danmu", type: DanmuType): void;
  (e: "upload-audio", file: File): void;
}>();

const audioInputRef = ref<HTMLInputElement | null>(null);

const { t } = useI18n();

const triggerAudioUpload = () => {
  audioInputRef.value?.click();
};

const handleAudioUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files[0]) {
    const file = input.files[0];
    emit("upload-audio", file);

    // 重置 input 以便重复上传同一文件
    input.value = "";
  }
};
</script>

<template>
  <div
    class="h-11 border-b border-border flex items-center justify-between gap-2 pl-3 pr-2 font-medium text-foreground bg-background shrink-0"
    data-ui="resources-header"
  >
    <span class="text-sm text-muted-foreground truncate">{{ t('resources.title') }}</span>
    <div class="flex items-center gap-2">
      <!-- 快捷添加按钮 -->
      <div class="flex gap-1">
        <button
          @click="emit('add-danmu', 'text')"
          class="size-7 rounded-sm inline-flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          :title="t('resources.addText')"
        >
          <MessageSquareText class="size-3.5" />
        </button>
        <button
          @click="emit('add-danmu', 'button')"
          class="size-7 rounded-sm inline-flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          :title="t('resources.addButton')"
        >
          <SquareMousePointer class="size-3.5" />
        </button>
        <button
          @click="emit('add-danmu', 'path')"
          class="size-7 rounded-sm inline-flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          :title="t('resources.addPath')"
        >
          <Waypoints class="size-3.5" />
        </button>
        <button
          @click="triggerAudioUpload"
          class="size-7 rounded-sm inline-flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          :title="t('resources.uploadAudio')"
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
          :value="searchQuery"
          @input="
            emit('update:searchQuery', ($event.target as HTMLInputElement).value)
          "
          type="text"
          :placeholder="t('resources.search')"
          class="h-7 w-32 bg-accent border border-border rounded-sm pl-7 pr-2 text-xs outline-none transition-all focus:border-primary focus:w-40"
        />
      </div>
    </div>
  </div>
</template>
