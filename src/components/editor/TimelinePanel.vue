<script setup lang="ts">
import { computed, ref, watch } from "vue";

import TimelineRuler from "@/components/editor/TimelineRuler.vue";
import {
  AudioLines,
  Captions,
  Lock as LucideLock,
  VolumeX,
  Eye,
} from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import DanmuSelectorDialog from "@/components/editor/DanmuSelectorDialog.vue";
import type { TreeNodeItem } from "@/components/ui/tree";
import { FileText, GitBranch, Boxes } from "lucide-vue-next";
import {
  useDanmakuStore,
  DANMAKU_TYPE_LABELS,
  type DanmakuType,
} from "@/stores/modules";

const danmakuStore = useDanmakuStore();

const currentTime = ref(0);
const viewportScale = ref(1);
const danmakuName = ref("");
const viewportOffset = ref(0);
const dialogOpen = ref(false);
const selectedKeys = ref<Array<string | number>>([]);

const typeOrder = Object.keys(DANMAKU_TYPE_LABELS) as DanmakuType[];
const typeIconMap: Record<DanmakuType, any> = {
  text: FileText,
  path: GitBranch,
  button: Boxes,
};
const treeNodes = ref<TreeNodeItem[]>(
  typeOrder.map((type) => ({
    id: type,
    label: DANMAKU_TYPE_LABELS[type],
  }))
);

const timelinePaddingX = 8;
const props = defineProps<{
  timeline: {
    tracks: {
      id: string;
      type: string;
      label?: string;
      clips: {
        id: string;
        name: string;
        start: number;
        duration: number;
        type?: string;
      }[];
    }[];
  };
  currentTime: number;
}>();

watch(
  () => props.currentTime,
  (value) => {
    currentTime.value = (value ?? 0) * 1000;
  },
  { immediate: true }
);

const totalMs = computed(() => {
  let maxEnd = 0;
  for (const track of props.timeline.tracks ?? []) {
    for (const clip of track.clips ?? []) {
      const end = (clip.start + clip.duration) * 1000;
      if (end > maxEnd) maxEnd = end;
    }
  }

  return Math.max(1, maxEnd);
});

function getTrackColor(type: string) {
  switch (type) {
    case "video":
      return "bg-blue-600";
    case "audio":
      return "bg-green-600";
    case "subtitle":
      return "bg-purple-600";
    case "text":
      return "bg-purple-600";
    case "path":
      return "bg-amber-500";
    case "button":
      return "bg-emerald-500";
    default:
      return "bg-gray-600";
  }
}

function getTrackTypeClass(type: string) {
  switch (type) {
    case "video":
      return "bg-primary";
    case "audio":
      return "bg-green-600";
    case "subtitle":
      return "bg-purple-600";
    case "text":
      return "bg-purple-500";
    case "path":
      return "bg-amber-500";
    case "button":
      return "bg-emerald-500";
    default:
      return "bg-muted-foreground";
  }
}

function isDanmakuType(value: string): value is DanmakuType {
  return typeOrder.includes(value as DanmakuType);
}

function getNodeIcon(node: TreeNodeItem) {
  const key = String(node.id);
  if (isDanmakuType(key)) {
    return typeIconMap[key];
  }
  return null as any;
}

function getTrackLabel(type: string, fallback?: string) {
  if (isDanmakuType(type)) {
    return DANMAKU_TYPE_LABELS[type];
  }
  return fallback ?? type;
}

function resetDialog() {
  danmakuName.value = "";
  selectedKeys.value = [];
}

function handleDialogCancel() {
  dialogOpen.value = false;
  resetDialog();
}

function handleDialogConfirm() {
  const trimmedName = danmakuName.value.trim();
  if (!trimmedName) {
    alert("弹幕名字不能为空");
    return;
  }

  const selectedTypeKey = selectedKeys.value[0];
  if (!selectedTypeKey) {
    alert("请选择弹幕类型");
    return;
  }

  const typeKey = String(selectedTypeKey);
  if (!isDanmakuType(typeKey)) {
    alert("请选择有效的弹幕类型");
    return;
  }

  const created = danmakuStore.addDanmaku({
    name: trimmedName,
    type: typeKey,
  });

  if (!created) {
    alert("弹幕名字已存在，请使用其他名称");
    return;
  }

  dialogOpen.value = false;
  resetDialog();
}

watch(dialogOpen, (isOpen) => {
  if (!isOpen) {
    resetDialog();
  }
});
</script>

<template>
  <div class="h-64 bg-card border-t border-border">
    <div class="flex-1 overflow-x-auto h-full">
      <div class="min-w-[800px] h-full relative flex">
        <div class="w-[200px] md:w-64 border-r border-border">
          <div
            class="h-16 bg-muted/30 border-b border-border flex items-center justify-between px-3"
          >
            <div class="flex items-center gap-2">
              <div
                class="flex items-center gap-[2px] p-[2px] rounded-md border border-border bg-accent/10"
              >
                <Button
                  class="flex items-center justify-center w-7 h-7 rounded-[4px] text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-all active:bg-accent/30 hover:-translate-y-[1px]"
                  title="添加弹幕"
                  variant="ghost"
                  @click="dialogOpen = true"
                >
                  <Captions :size="16" />
                </Button>
                <DanmuSelectorDialog
                  v-if="dialogOpen"
                  v-model:open="dialogOpen"
                  v-model:danmakuName="danmakuName"
                  v-model:selectedKeys="selectedKeys"
                  :tree-nodes="treeNodes"
                  :get-node-icon="getNodeIcon"
                  @confirm="handleDialogConfirm"
                  @cancel="handleDialogCancel"
                />
                <Button
                  class="flex items-center justify-center w-7 h-7 rounded-[4px] text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-all active:bg-accent/30 hover:-translate-y-[1px]"
                  title="添加音频轨道"
                  variant="ghost"
                >
                  <AudioLines :size="16" />
                </Button>
              </div>
              <div
                class="flex items-center gap-[2px] p-[2px] rounded-md border border-border bg-accent/10"
              >
                <Button
                  class="flex items-center justify-center w-7 h-7 rounded-[4px] text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-all active:bg-accent/30 hover:-translate-y-[1px]"
                  title="锁定轨道"
                  variant="ghost"
                >
                  <LucideLock :size="16" />
                </Button>
                <Button
                  class="flex items-center justify-center w-7 h-7 rounded-[4px] text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-all active:bg-accent/30 hover:-translate-y-[1px]"
                  title="静音轨道"
                  variant="ghost"
                >
                  <VolumeX :size="16" />
                </Button>
              </div>
            </div>
          </div>
          <div class="p-0 bg-background">
            <div
              v-for="track in timeline.tracks"
              :key="track.id"
              class="h-12 flex items-center border-b border-border bg-background transition-colors px-3 hover:bg-muted/50 last:border-b-0"
            >
              <div class="flex items-center gap-1 mr-3">
                <button
                  class="flex items-center justify-center w-5 h-5 rounded text-muted-foreground hover:bg-accent/20 hover:text-primary transition"
                  title="显示/隐藏"
                >
                  <Eye :size="12" />
                </button>
                <button
                  class="flex items-center justify-center w-5 h-5 rounded text-muted-foreground hover:bg-accent/20 hover:text-yellow-500 transition"
                  title="锁定"
                >
                  <LucideLock :size="12" />
                </button>
                <button
                  v-if="track.type === 'audio'"
                  class="flex items-center justify-center w-5 h-5 rounded text-muted-foreground hover:bg-accent/20 hover:text-destructive transition"
                  title="静音"
                >
                  <VolumeX :size="12" />
                </button>
              </div>
              <div class="flex items-center gap-2 flex-1">
                <div
                  class="w-1 h-6 rounded shrink-0"
                  :class="getTrackTypeClass(track.type)"
                ></div>
                <div class="flex flex-col gap-px">
                  <span class="text-xs font-semibold text-foreground leading-[1.2]">
                    {{ getTrackLabel(track.type, track.label) }}
                  </span>
                  <span
                    class="text-[10px] text-muted-foreground font-mono leading-[1.2]"
                  >
                    {{ track.id }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧时间轴区域 -->
        <div class="flex-1 relative overflow-hidden">
          <div class="h-16 bg-muted/30 border-b border-border flex">
            <TimelineRuler
              v-model="currentTime"
              :min-ms="0"
              :max-ms="totalMs"
              :show-controls="false"
              @update:scale="viewportScale = $event"
              @update:offset="viewportOffset = $event"
            />
          </div>
          <!-- 素材轨道显示区域 -->
          <div class="space-y-1 p-2">
            <div
              v-for="track in timeline.tracks"
              :key="track.id"
              class="h-12 flex items-center gap-2"
            >
              <div
                class="flex-1 relative h-8 bg-muted/30 rounded border border-border"
              >
                <div
                  v-for="clip in track.clips"
                  :key="clip.id"
                  class="absolute h-full rounded border border-border text-white text-[11px] font-medium cursor-pointer transition-all hover:opacity-90 hover:-translate-y-px flex items-center px-2 select-none"
                  :class="getTrackColor(clip.type ?? track.type)"
                  :style="{
                    left: `${((clip.start * 1000) / totalMs) * 100}%`,
                    width: `${((clip.duration * 1000) / totalMs) * 100}%`,
                  }"
                >
                  {{ clip.name }}
                </div>
              </div>
            </div>
          </div>

          <!-- 播放指针（限定在右侧区域内） -->
          <div
            class="absolute top-16 bottom-0 w-0.5 bg-red-500 pointer-events-none"
            :style="{
              left: `calc(${timelinePaddingX}px + ${
                (currentTime - viewportOffset) * viewportScale
              }px)`,
            }"
          >
            <div
              class="w-3 h-3 bg-red-500 rounded-full -translate-x-1/2 -translate-y-1/2"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
