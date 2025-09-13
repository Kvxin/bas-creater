<script setup lang="ts">
import { ref, computed, h } from "vue";

import TimelineRuler from "@/components/editor/TimelineRuler.vue";
import { useAntdApp } from "@/composables/useAntdApp";
const { message, notification, modal } = useAntdApp();
import {
  AudioLines,
  Captions,
  Lock as LucideLock,
  VolumeX,
  Eye,
} from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import type { TreeNodeItem } from "@/components/ui/tree";
import {
  FileTextOutlined,
  BranchesOutlined,
  AppstoreAddOutlined,
  FolderOpenOutlined,
} from "@ant-design/icons-vue";

const currentTime = ref(0);
const viewportScale = ref(1);
const danmakuName = ref("");
const viewportOffset = ref(0);
const selectedKeys = ref<Array<string | number>>([]);
const expandedKeys = ref<Array<string | number>>([]);
const treeNodes = ref<TreeNodeItem[]>([
  {
    id: "danmu-root",
    label: "弹幕",
    selectable: false,
    children: [
      { id: "text", label: "文本弹幕" },
      { id: "path", label: "path弹幕" },
      { id: "button", label: "按钮弹幕" },
    ],
  },
]);
const loadChildren = async (node: TreeNodeItem) => {
  return [
    { id: `${node.id}-1`, label: "子项 1" },
    { id: `${node.id}-2`, label: "子项 2" },
  ];
};

const treeQuery = ref("");

function toAntNode(n: TreeNodeItem): any {
  const hasKids = !!n.children?.length || !!(n as any).hasChildren;
  const iconRender = () => {
    if (n.id === "text" || String(n.label).includes("文本"))
      return h(FileTextOutlined);
    if (n.id === "path" || String(n.label).toLowerCase().includes("path"))
      return h(BranchesOutlined);
    if (n.id === "button" || String(n.label).includes("按钮"))
      return h(AppstoreAddOutlined);
    return null;
  };
  return {
    key: n.id,
    title: n.label,
    disabled: (n as any).disabled,
    isLeaf: !hasKids,
    icon: iconRender,
    children: n.children?.map(toAntNode),
  };
}

function filterAntNodes(nodes: any[], q: string): any[] {
  const res: any[] = [];
  for (const n of nodes) {
    const kids = n.children ? filterAntNodes(n.children, q) : [];
    const hit = String(n.title).toLowerCase().includes(q);
    if (hit || kids.length) res.push({ ...n, children: kids });
  }
  return res;
}

const antdTreeData = computed(() => treeNodes.value.map(toAntNode));
const filteredAntTreeData = computed(() => {
  const q = treeQuery.value.trim().toLowerCase();
  if (!q) return antdTreeData.value;
  return filterAntNodes(antdTreeData.value, q);
});

function findNodeById(
  nodes: TreeNodeItem[],
  id: string | number
): TreeNodeItem | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNodeById(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

async function onAntLoadData(treeNode: any) {
  const id = treeNode.key as string | number;
  const node = findNodeById(treeNodes.value, id);
  if (!node) return;
  if (node.children && node.children.length) return;
  const children = await loadChildren(node);
  node.children = children;
}

import type { AnyDanmu } from "@/types/danmu";
import { createDanmuByKey } from "@/utils/danmuFactory";

const emit = defineEmits<{
  (e: "confirm-danmu", value: AnyDanmu[]): void;
}>();

function onConfirmDanmu() {
  const items: AnyDanmu[] = selectedKeys.value.map((k) =>
    createDanmuByKey(String(k))
  );
  console.log(items);

  emit("confirm-danmu", items);
}

const timelinePaddingX = 8;
const props = defineProps<{
  timeline: {
    tracks: {
      id: string;
      type: string;
      clips: { id: string; name: string; start: number; duration: number }[];
    }[];
  };
  currentTime: number;
}>();

const totalMs = computed(() => {
  let maxEnd = 0;
  for (const track of props.timeline.tracks) {
    for (const clip of track.clips) {
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
    default:
      return "bg-muted-foreground";
  }
}
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
                <Dialog>
                  <DialogTrigger as-child>
                    <Button
                      class="flex items-center justify-center w-7 h-7 rounded-[4px] text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-all active:bg-accent/30 hover:-translate-y-[1px]"
                      title="添加弹幕"
                      variant="ghost"
                    >
                      <Captions :size="16" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent class="sm:max-w-[520px]">
                    <DialogHeader>
                      <DialogTitle>选择弹幕</DialogTitle>
                    </DialogHeader>
                    <div class="space-y-2">
                      <a-input
                        v-model:value="danmakuName"
                        allow-clear
                        placeholder="弹幕名字"
                      />
                      <div class="max-h-[100vh] overflow-auto">
                        <a-tree
                          :tree-data="filteredAntTreeData"
                          show-icon
                          block-node
                          v-model:selectedKeys="selectedKeys"
                          v-model:expandedKeys="expandedKeys"
                          :load-data="onAntLoadData"
                        />
                      </div>
                    </div>
                    <DialogFooter class="mt-2">
                      <DialogClose as-child>
                        <Button variant="ghost">取消</Button>
                      </DialogClose>
                      <DialogClose as-child>
                        <Button @click="onConfirmDanmu">确认</Button>
                      </DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
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
                  <span
                    class="text-xs font-semibold text-foreground capitalize leading-[1.2]"
                    >{{ track.type }}</span
                  >
                  <span
                    class="text-[10px] text-muted-foreground font-mono leading-[1.2]"
                    >{{ track.id }}</span
                  >
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
                  :class="getTrackColor(track.type)"
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
