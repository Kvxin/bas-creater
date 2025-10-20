<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import TopBar from "@/components/editor/TopBar.vue";
import ResourcePanel, {
  type ResourceTabs,
} from "@/components/editor/ResourcePanel.vue";
import PlayerPanel from "@/components/editor/PlayerPanel.vue";
import ToolsPanel from "@/components/editor/ToolsPanel.vue";
import TimelinePanel from "@/components/editor/TimelinePanel.vue";
import { useDanmakuStore } from "@/stores/modules";

const isPlaying = ref(false);
const currentTime = ref(0);
const zoom = ref(100);
const activeResourceTab = ref<ResourceTabs>("Danmakus");
const isDark = ref(false);

const danmakuStore = useDanmakuStore();
const { timelineData, danmakuResources } = storeToRefs(danmakuStore);

const timelineDuration = computed(() => {
  const tracks = timelineData.value?.tracks ?? [];
  let maxEnd = 0;
  for (const track of tracks) {
    for (const clip of track.clips ?? []) {
      const end = clip.start + clip.duration;
      if (end > maxEnd) maxEnd = end;
    }
  }
  return tracks.length > 0 ? maxEnd : 30;
});

const resourceMap = computed(() => ({
  Danmakus: danmakuResources.value,
  audio: [],
  images: [],
  documents: [],
}));

watch(timelineDuration, (duration) => {
  if (currentTime.value > duration) {
    currentTime.value = duration;
  }
});

watch(
  currentTime,
  (value) => {
    if (value >= timelineDuration.value) {
      currentTime.value = timelineDuration.value;
      isPlaying.value = false;
    }
  },
  { flush: "post" }
);
function handleTogglePlay() {
  if (isPlaying.value) {
    isPlaying.value = false;
    return;
  }

  if (currentTime.value >= timelineDuration.value) {
    currentTime.value = 0;
  }

  isPlaying.value = true;
}
</script>

<template>
  <div class="h-screen bg-background text-foreground flex flex-col">
    <!-- Top Navigation Bar -->
    <TopBar v-model:isDark="isDark" />

    <!-- Three Panel Layout Above Timeline -->
    <div class="flex-1 flex">
      <ResourcePanel
        v-model:active="activeResourceTab"
        :resources="resourceMap"
      />
      <PlayerPanel
        :is-playing="isPlaying"
        :zoom="zoom"
        :current-time="currentTime"
        :duration="timelineDuration"
        @toggle="handleTogglePlay"
        @zoom-in="zoom = Math.min(400, zoom + 25)"
        @zoom-out="zoom = Math.max(25, zoom - 25)"
        @update:current-time="(val) => (currentTime = val)"
        @ended="isPlaying = false"
      />
      <ToolsPanel />
    </div>

    <!-- Bottom Panel - Timeline -->
    <TimelinePanel :timeline="timelineData" :current-time="currentTime" />
  </div>
</template>
