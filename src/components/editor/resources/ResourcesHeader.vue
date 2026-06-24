<script setup lang="ts">
import { ref } from "vue";
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
  (
    e: "upload-audio",
    payload: { file: File; duration: number; url: string }
  ): void;
}>();

const audioInputRef = ref<HTMLInputElement | null>(null);

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

const triggerAudioUpload = () => {
  audioInputRef.value?.click();
};

const handleAudioUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files[0]) {
    const file = input.files[0];
    const url = URL.createObjectURL(file);
    const duration = await getAudioDuration(file);

    emit("upload-audio", { file, duration, url });

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
    <span class="text-sm text-muted-foreground truncate">弹幕资源</span>
    <div class="flex items-center gap-2">
      <!-- 快捷添加按钮 -->
      <div class="flex gap-1">
        <button
          @click="emit('add-danmu', 'text')"
          class="size-7 rounded-sm inline-flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="添加文本弹幕"
        >
          <MessageSquareText class="size-3.5" />
        </button>
        <button
          @click="emit('add-danmu', 'button')"
          class="size-7 rounded-sm inline-flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="添加按钮弹幕"
        >
          <SquareMousePointer class="size-3.5" />
        </button>
        <button
          @click="emit('add-danmu', 'path')"
          class="size-7 rounded-sm inline-flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="添加路径弹幕"
        >
          <Waypoints class="size-3.5" />
        </button>
        <button
          @click="triggerAudioUpload"
          class="size-7 rounded-sm inline-flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
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
          :value="searchQuery"
          @input="
            emit('update:searchQuery', ($event.target as HTMLInputElement).value)
          "
          type="text"
          placeholder="搜索..."
          class="h-7 w-32 bg-accent border border-border rounded-sm pl-7 pr-2 text-xs outline-none transition-all focus:border-primary focus:w-40"
        />
      </div>
    </div>
  </div>
</template>
