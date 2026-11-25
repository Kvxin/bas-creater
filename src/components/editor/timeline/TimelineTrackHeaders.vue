<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
  Captions,
  Music2,
  Video
} from "lucide-vue-next";
import type { TimelineTrack, TimelineTrackType } from "@/types/timeline";

const props = defineProps<{
  tracks: TimelineTrack[];
  getTrackType: (track: TimelineTrack) => TimelineTrackType | null;
}>();

const emit = defineEmits<{
  (e: "toggle-expand", trackId: string): void;
  (e: "toggle-visibility", trackId: string): void;
  (e: "toggle-mute", trackId: string): void;
  (e: "remove-track", trackId: string): void;
  (e: "add-track"): void;
  (e: "track-contextmenu", event: MouseEvent, trackId: string): void;
}>();

const { t } = useI18n();
const trackListRef = ref<HTMLElement | null>(null);

const setScrollTop = (scrollTop: number) => {
  if (trackListRef.value) {
    trackListRef.value.scrollTop = scrollTop;
  }
};

defineExpose({ setScrollTop });

const getTrackTypeLabel = (track: TimelineTrack) => {
  const type = props.getTrackType(track);
  if (type === "audio") return t("timeline.track.type.audio");
  if (type === "danmu") return t("timeline.track.type.danmu");
  return t("timeline.track.type.empty");
};

const getTrackTypeIcon = (track: TimelineTrack) => {
  return props.getTrackType(track) === "audio" ? Music2 : Captions;
};

const getTrackPrimaryIcon = (track: TimelineTrack) => {
  if (props.getTrackType(track) === "audio") {
    return track.muted ? VolumeX : Volume2;
  }
  return track.visible ? Eye : EyeOff;
};

const getTrackPrimaryLabel = (track: TimelineTrack) => {
  if (props.getTrackType(track) === "audio") {
    return track.muted ? t("timeline.track.unmute") : t("timeline.track.mute");
  }
  return track.visible ? t("timeline.track.hide") : t("timeline.track.show");
};

const isTrackPrimaryActive = (track: TimelineTrack) => {
  return props.getTrackType(track) === "audio" ? Boolean(track.muted) : track.visible;
};

const toggleTrackPrimaryAction = (track: TimelineTrack) => {
  if (props.getTrackType(track) === "audio") {
    emit("toggle-mute", track.id);
    return;
  }
  emit("toggle-visibility", track.id);
};
</script>

<template>
  <div
    class="w-56 border-r border-divider bg-track-header flex flex-col shrink-0 overflow-hidden"
    ref="trackListRef"
    data-ui="track-headers"
  >
    <!-- 轨道头列表 -->
    <template v-for="track in props.tracks" :key="track.id">
      <div
        class="h-10 grid grid-cols-[1rem_minmax(0,1fr)_1.25rem_1.25rem_1.25rem_1.25rem] items-center gap-1 px-2 text-xs group border-b border-divider hover:bg-accent/50 transition-colors shrink-0"
        :class="{ 'text-muted-foreground/55': !track.visible }"
        :data-track-header-id="track.id"
        @contextmenu="emit('track-contextmenu', $event, track.id)"
      >
        <button
          @click="emit('toggle-expand', track.id)"
          class="size-5 hover:bg-accent rounded-sm transition-colors inline-flex items-center justify-center"
          :aria-label="t('timeline.track.expand')"
        >
          <component :is="track.expanded ? ChevronDown : ChevronRight" class="size-3 text-muted-foreground" />
        </button>

        <div
          class="min-w-0 truncate text-left font-medium text-muted-foreground group-hover:text-foreground"
          :title="track.name"
        >
          {{ track.name }}
        </div>
        <button
          class="size-5 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          :class="{ 'text-primary bg-primary/10': isTrackPrimaryActive(track) }"
          :aria-label="getTrackPrimaryLabel(track)"
          :title="getTrackPrimaryLabel(track)"
          @click.stop="toggleTrackPrimaryAction(track)"
        >
          <component :is="getTrackPrimaryIcon(track)" class="size-3" />
        </button>
        <span
          class="size-5 inline-flex items-center justify-center rounded-sm border border-border/70 bg-background/80 text-muted-foreground"
          :aria-label="t('timeline.track.typeLockedAria', { type: getTrackTypeLabel(track) })"
          :title="t('timeline.track.typeLockedTitle', { type: getTrackTypeLabel(track) })"
        >
          <component :is="getTrackTypeIcon(track)" class="size-3" />
        </span>
        <span
          class="size-5 inline-flex items-center justify-center rounded-sm border border-border/50 bg-background/50 text-muted-foreground/45"
          :title="t('timeline.track.videoPlaceholder')"
          :aria-label="t('timeline.track.videoPlaceholder')"
        >
          <Video class="size-3" />
        </span>
        <button
          class="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 size-5 inline-flex items-center justify-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-opacity"
          :aria-label="t('timeline.track.remove')"
          :title="t('timeline.track.remove')"
          @click.stop="emit('remove-track', track.id)"
        >
          <Trash2 class="size-3" />
        </button>
      </div>

      <!-- Expanded Panel Header -->
      <div
        v-if="track.expanded"
        class="h-16 bg-muted/30 border-b border-divider flex items-center justify-end px-3 text-xs text-muted-foreground shrink-0"
        :class="{ 'opacity-55': !track.visible }"
      >
        <span class="opacity-70">{{ t("timeline.keyframes") }}</span>
      </div>
    </template>

    <button
      @click="emit('add-track')"
      class="w-full h-8 flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-primary hover:bg-accent transition-colors mt-1 shrink-0"
    >
      <Plus class="size-3" />
      {{ t("timeline.addTrack") }}
    </button>

    <!-- 底部占位，防止内容被遮挡 -->
    <div class="h-20 shrink-0"></div>
  </div>
</template>
