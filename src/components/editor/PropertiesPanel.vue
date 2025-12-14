<script setup lang="ts">
import { Settings, Sliders } from 'lucide-vue-next';
</script>

<template>
  <div class="h-full w-full bg-sidebar border-l border-sidebar-border flex flex-col text-sm">
    <div class="h-12 border-b border-sidebar-border flex items-center px-4 font-medium text-sidebar-foreground justify-between">
      <span>Properties</span>
      <Settings class="size-4 text-muted-foreground" />
    </div>
    <div class="flex-1 overflow-y-auto p-4 space-y-6">
      <div class="space-y-2">
        <label class="text-xs font-medium text-muted-foreground uppercase">Transform</label>
        <div class="grid grid-cols-2 gap-2">
            <div class="bg-sidebar-accent rounded px-2 py-1 text-xs flex items-center justify-between border border-sidebar-border">
                <span class="text-muted-foreground">X</span>
                <span>1920</span>
            </div>
            <div class="bg-sidebar-accent rounded px-2 py-1 text-xs flex items-center justify-between border border-sidebar-border">
                <span class="text-muted-foreground">Y</span>
                <span>1080</span>
            </div>
        </div>
      </div>

      <div class="space-y-2">
        <label class="text-xs font-medium text-muted-foreground uppercase">Opacity</label>
        <div class="h-1 w-full bg-sidebar-accent rounded-full overflow-hidden">
            <div class="h-full w-[70%] bg-primary"></div>
        </div>
        <div class="flex justify-between text-xs text-muted-foreground">
            <span>0%</span>
            <span>70%</span>
            <span>100%</span>
        </div>
      </div>
    </div>
  </div>
</template>
