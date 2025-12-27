<script setup lang="ts">
import { RouterView } from 'vue-router'
import GlobalContextMenu from '@/components/GlobalContextMenu.vue'
import ClipDetailsDialog from '@/components/dialogs/ClipDetailsDialog.vue'
</script>

<template>
  <RouterView />
  <GlobalContextMenu />
  <ClipDetailsDialog />
</template>

