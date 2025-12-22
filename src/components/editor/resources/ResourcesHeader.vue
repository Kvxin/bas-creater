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
    class="h-12 border-b border-sidebar-border flex items-center justify-between px-4 font-medium text-sidebar-foreground bg-sidebar/50 backdrop-blur-sm"
  >
    <span>弹幕资源</span>
    <div class="flex items-center gap-2">
      <!-- 快捷添加按钮 -->
      <div class="flex gap-1">
        <button
          @click="emit('add-danmu', 'text')"
          class="p-1 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-primary transition-colors"
          title="添加文本弹幕"
        >
          <MessageSquareText class="size-3.5" />
        </button>
        <button
          @click="emit('add-danmu', 'button')"
          class="p-1 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-primary transition-colors"
          title="添加按钮弹幕"
        >
          <SquareMousePointer class="size-3.5" />
        </button>
        <button
          @click="emit('add-danmu', 'path')"
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
          :value="searchQuery"
          @input="
            emit('update:searchQuery', ($event.target as HTMLInputElement).value)
          "
          type="text"
          placeholder="搜索..."
          class="h-7 w-32 bg-sidebar-accent/50 border border-sidebar-border rounded-md pl-7 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring transition-all focus:w-40"
        />
      </div>
    </div>
  </div>
</template>
