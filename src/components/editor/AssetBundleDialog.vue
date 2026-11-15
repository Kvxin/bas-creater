<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const props = defineProps<{
  open: boolean;
  bundle: () => Promise<boolean>;
}>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const { locale } = useI18n();
const busy = ref(false);
const error = ref("");
const complete = ref(false);
const text = computed(() => {
  if (locale.value === "en") return {
    title: "Collect project", description: "Choose a destination folder to create an independent project copy with its audio. Existing files are not overwritten. The current project and originals are unchanged; an interrupted or failed operation may leave partial files in the destination.",
    choose: "Choose folder and collect", cancel: "Cancel", close: "Close", working: "Collecting…", done: "Project copy created successfully.", failed: "Could not collect the project",
    offline: "Audio is unavailable or permission was denied. Relink it and try again", exists: "A destination file already exists", unsupported: "This browser cannot select a folder"
  };
  if (locale.value === "ja") return {
    title: "プロジェクトを収集", description: "保存先を選択して、音声を含む独立したコピーを作成します。既存ファイル、元のプロジェクトや素材は変更しません。中断や失敗時は保存先に途中のファイルが残る場合があります。",
    choose: "フォルダーを選択して収集", cancel: "キャンセル", close: "閉じる", working: "収集中…", done: "プロジェクトのコピーを作成しました。", failed: "プロジェクトを収集できませんでした",
    offline: "音声を開けないか、アクセスが拒否されました。再リンクしてから再試行してください", exists: "保存先に同名のファイルがあります", unsupported: "このブラウザーではフォルダーを選択できません"
  };
  return {
    title: "集中打包工程", description: "选择目标目录，创建包含音频的独立工程副本。不会覆盖已有文件，也不会修改当前工程或原始文件。中断或失败时，目标目录可能留下未完成的文件。",
    choose: "选择目录并打包", cancel: "取消", close: "关闭", working: "正在打包…", done: "工程副本已创建。", failed: "打包失败",
    offline: "音频不可用或没有访问权限，请重新链接后重试", exists: "目标文件已存在", unsupported: "当前浏览器不支持选择文件夹"
  };
});
watch(() => props.open, (open) => { if (open) { error.value = ""; complete.value = false; } });
const errorMessage = computed(() => {
  if (error.value.startsWith("AUDIO_OFFLINE: ")) return `${text.value.offline}: ${error.value.slice(15)}`;
  if (error.value.includes("ALREADY_EXISTS")) return text.value.exists;
  if (error.value.includes("DIRECTORY_PICKER_UNSUPPORTED")) return text.value.unsupported;
  return error.value;
});
async function start() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    complete.value = await props.bundle();
  } catch (cause) {
    if (!(cause instanceof DOMException && cause.name === "AbortError")) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="!busy && emit('update:open', $event)">
    <DialogContent class="sm:max-w-[460px]" :show-close-button="!busy" @escape-key-down="busy && $event.preventDefault()" @interact-outside="busy && $event.preventDefault()">
      <DialogHeader>
        <DialogTitle>{{ text.title }}</DialogTitle>
        <DialogDescription>{{ text.description }}</DialogDescription>
      </DialogHeader>
      <p v-if="complete" role="status" class="text-sm text-constructive">{{ text.done }}</p>
      <p v-if="error" role="alert" class="text-sm text-destructive break-words">{{ text.failed }}: {{ errorMessage }}</p>
      <DialogFooter>
        <button type="button" class="ui-button" :disabled="busy" @click="emit('update:open', false)">{{ complete ? text.close : text.cancel }}</button>
        <button v-if="!complete" type="button" class="ui-button ui-button-primary" :disabled="busy" @click="start">{{ busy ? text.working : text.choose }}</button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
