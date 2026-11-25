<script setup lang="ts">
import { useI18n } from "vue-i18n";
import {
  Clock,
  ZoomIn,
  ZoomOut,
  ChevronRight,
  Scissors,
  ScissorsLineDashed,
  FolderPlus,
  Ungroup,
  ArrowLeft
} from "lucide-vue-next";
import { useTimelineStore } from "@/stores/timeline";
import { runSplitAction } from "@/utils/splitAction";

const props = defineProps<{
  currentTimeDisplay: string;
}>();

const emit = defineEmits<{
  (e: "zoom-in"): void;
  (e: "zoom-out"): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
</script>

<template>
  <!-- 顶部工具栏 -->
  <div
    class="toolbar h-10 bg-panel flex items-center justify-between px-2 py-1 text-xs text-muted-foreground gap-4 shrink-0"
  >
    <div class="flex items-center gap-2">
      <Clock class="size-3.5" />
      <span class="font-mono text-foreground/80">{{ props.currentTimeDisplay }}</span>
      <button
        type="button"
        class="size-7 inline-flex items-center justify-center rounded-sm hover:bg-accent disabled:opacity-40"
        data-ui="create-group"
        :title="t('groups.createHint')"
        :aria-label="t('groups.create')"
        :disabled="!timelineStore.canCreateGroup()"
        @click="timelineStore.createGroup()"
      >
        <FolderPlus class="size-4" />
      </button>
      <button
        type="button"
        class="size-7 inline-flex items-center justify-center rounded-sm hover:bg-accent disabled:opacity-40"
        data-ui="ungroup"
        :title="t('groups.ungroupHint')"
        :aria-label="t('groups.ungroup')"
        :disabled="!timelineStore.canUngroupClip()"
        @click="timelineStore.ungroupClip()"
      >
        <Ungroup class="size-4" />
      </button>
      <button
        type="button"
        class="size-7 inline-flex items-center justify-center rounded-sm hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
        data-ui="split-element"
        :title="t('menus.splitElement')"
        :aria-label="t('menus.splitElement')"
        :disabled="!timelineStore.canSplitClip(timelineStore.selectedClipId)"
        @click="runSplitAction(() => timelineStore.splitClip(timelineStore.selectedClipId))"
      >
        <Scissors class="size-3.5" />
      </button>
      <button
        type="button"
        class="size-7 inline-flex items-center justify-center rounded-sm hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
        data-ui="split-left"
        :title="t('menus.splitLeft')"
        :aria-label="t('menus.splitLeft')"
        :disabled="!timelineStore.canSplitClip(timelineStore.selectedClipId)"
        @click="runSplitAction(() => timelineStore.splitClipLeft(timelineStore.selectedClipId))"
      >
        <ScissorsLineDashed class="size-3.5 rotate-180" />
      </button>
      <button
        type="button"
        class="size-7 inline-flex items-center justify-center rounded-sm hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
        data-ui="split-right"
        :title="t('menus.splitRight')"
        :aria-label="t('menus.splitRight')"
        :disabled="!timelineStore.canSplitClip(timelineStore.selectedClipId)"
        @click="runSplitAction(() => timelineStore.splitClipRight(timelineStore.selectedClipId))"
      >
        <ScissorsLineDashed class="size-3.5" />
      </button>
    </div>

    <div class="flex items-center gap-2">
      <span class="text-xs w-10 text-right tabular-nums">{{ timelineStore.zoomScale }}%</span>
      <div class="flex gap-0.5 border border-border rounded-sm overflow-hidden bg-accent">
        <button
          class="size-7 inline-flex items-center justify-center hover:bg-foreground/10 cursor-pointer"
          @click="emit('zoom-out')"
          :aria-label="t('preview.zoom.out')"
          :title="t('preview.zoom.out')"
          data-ui="timeline-zoom-out"
        >
          <ZoomOut class="size-3" />
        </button>
        <div class="w-px bg-border"></div>
        <button
          class="size-7 inline-flex items-center justify-center hover:bg-foreground/10 cursor-pointer"
          @click="emit('zoom-in')"
          :aria-label="t('preview.zoom.in')"
          :title="t('preview.zoom.in')"
          data-ui="timeline-zoom-in"
        >
          <ZoomIn class="size-3" />
        </button>
      </div>
    </div>
  </div>

  <!-- 分组层级面包屑 -->
  <nav
    class="flex min-h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 text-xs"
    data-ui="group-breadcrumb"
    :aria-label="t('groups.root')"
  >
    <button
      v-if="timelineStore.activeGroupPath.length"
      type="button"
      class="inline-flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-accent"
      :title="t('groups.back')"
      :aria-label="t('groups.back')"
      @click="timelineStore.leaveGroup()"
    >
      <ArrowLeft class="size-3.5" />
    </button>
    <button
      type="button"
      class="shrink-0 rounded-sm px-2 py-1 hover:bg-accent"
      @click="timelineStore.navigateToGroup(0)"
    >
      {{ t("groups.root") }}
    </button>
    <template v-for="(group, index) in timelineStore.activeGroups" :key="group.id">
      <ChevronRight class="size-3 shrink-0 text-muted-foreground" />
      <button
        type="button"
        class="max-w-48 shrink-0 truncate rounded-sm px-2 py-1 hover:bg-accent"
        :class="{ 'text-primary font-medium': index === timelineStore.activeGroups.length - 1 }"
        @click="timelineStore.navigateToGroup(index + 1)"
      >
        {{ group.name }}
      </button>
    </template>
  </nav>
</template>
