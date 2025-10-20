<script setup lang="ts">
import { computed, ref } from "vue";
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

const resourceMap = computed(() => ({
  Danmakus: danmakuResources.value,
  audio: [],
  images: [],
  documents: [],
}));
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
        @toggle="isPlaying = !isPlaying"
        @zoom-in="zoom = Math.min(400, zoom + 25)"
        @zoom-out="zoom = Math.max(25, zoom - 25)"
      />
      <ToolsPanel />
    </div>

    <!-- Bottom Panel - Timeline -->
    <TimelinePanel :timeline="timelineData" :current-time="currentTime" />
  </div>
</template>
