<script setup lang="ts">
import { ref } from "vue";
import VideoEditorLayout from "@/components/editor/EditorLayout.vue";
import ProjectsView from "@/views/ProjectsView.vue";

const activeProjectId = ref<string | null>(null);
</script>

<template>
  <VideoEditorLayout v-if="activeProjectId" :key="activeProjectId" :project-id="activeProjectId" @close="activeProjectId = null" />
  <ProjectsView v-else @open="activeProjectId = $event" />
</template>
