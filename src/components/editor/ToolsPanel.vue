<script setup lang="ts">
import { Button } from "@/components/ui/button";
import {
  Scissors,
  Crop,
  Type,
  Filter,
  Shuffle,
  Download,
} from "lucide-vue-next";
import interact from "interactjs";
import { onMounted } from "vue";

const setupResizable = () => {
  interact(".tools-panel")
    .resizable({
      edges: { left: true },
      modifiers: [
        interact.modifiers.restrictSize({
          min: { width: 256, height: 0 },
        }),
      ],
      inertia: true,
    })
    .on("resizemove", (event: any) => {
      const element = event.target;
      const newWidth = event.rect.width;
      element.style.width = `${newWidth}px`;
    });
};

onMounted(() => {
  setupResizable();
});
</script>

<template>
  <div
    class="w-64 bg-card border-l border-border flex flex-col tools-panel pl-4 select-none"
  >
    <div class="h-14 border-b border-border flex items-center px-4">
      <h2 class="font-semibold">Tools</h2>
    </div>

    <div class="flex-1 p-4 space-y-4">
      <div class="space-y-2">
        <h3 class="text-sm font-medium text-muted-foreground">EDITING</h3>
        <Button variant="ghost" class="w-full justify-start" size="sm">
          <Scissors class="w-4 h-4 mr-2" />
          Cut
        </Button>
        <Button variant="ghost" class="w-full justify-start" size="sm">
          <Crop class="w-4 h-4 mr-2" />
          Crop
        </Button>
      </div>

      <div class="space-y-2">
        <h3 class="text-sm font-medium text-muted-foreground">EFFECTS</h3>
        <Button variant="ghost" class="w-full justify-start" size="sm">
          <Type class="w-4 h-4 mr-2" />
          Add Subtitles
        </Button>
        <Button variant="ghost" class="w-full justify-start" size="sm">
          <Filter class="w-4 h-4 mr-2" />
          Filters
        </Button>
        <Button variant="ghost" class="w-full justify-start" size="sm">
          <Shuffle class="w-4 h-4 mr-2" />
          Transitions
        </Button>
      </div>

      <div class="pt-4 border-t border-border">
        <Button variant="ghost" class="w-full" size="sm">
          <Download class="w-4 h-4 mr-2" />
          Export
        </Button>
      </div>
    </div>
  </div>
</template>
