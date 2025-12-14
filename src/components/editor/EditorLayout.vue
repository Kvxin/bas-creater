<script setup lang="ts">
import { ref } from 'vue';
import { useEventListener, useDark, useToggle } from '@vueuse/core';
import { Moon, Sun, Video, MonitorPlay } from 'lucide-vue-next';
import ResourcesPanel from './ResourcesPanel.vue';
import PreviewPanel from './PreviewPanel.vue';
import PropertiesPanel from './PropertiesPanel.vue';
import TimelinePanel from './TimelinePanel.vue';

// Theme
const isDark = useDark();
const toggleDark = useToggle(isDark);

// Layout State
const leftWidth = ref(300);
const rightWidth = ref(300);
const bottomHeight = ref(250);

// Drag State
const isDraggingLeft = ref(false);
const isDraggingRight = ref(false);
const isDraggingBottom = ref(false);

// Resizing Logic
const startResizeLeft = () => { isDraggingLeft.value = true; };
const startResizeRight = () => { isDraggingRight.value = true; };
const startResizeBottom = () => { isDraggingBottom.value = true; };

const stopResize = () => {
  isDraggingLeft.value = false;
  isDraggingRight.value = false;
  isDraggingBottom.value = false;
  document.body.style.cursor = '';
};

useEventListener('mousemove', (e: MouseEvent) => {
  if (isDraggingLeft.value) {
    e.preventDefault();
    const newWidth = e.clientX;
    if (newWidth > 150 && newWidth < 600) {
      leftWidth.value = newWidth;
    }
  }
  if (isDraggingRight.value) {
    e.preventDefault();
    const newWidth = window.innerWidth - e.clientX;
    if (newWidth > 150 && newWidth < 600) {
        rightWidth.value = newWidth;
    }
  }
  if (isDraggingBottom.value) {
    e.preventDefault();
    const newHeight = window.innerHeight - e.clientY;
    if (newHeight > 100 && newHeight < 600) {
        bottomHeight.value = newHeight;
    }
  }
});

useEventListener('mouseup', stopResize);
useEventListener('mouseleave', stopResize);

</script>

<template>
  <div class="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden font-sans">
    <!-- Header -->
    <header class="h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0 z-20">
      <div class="flex items-center gap-2">
        <div class="bg-primary rounded p-1 text-primary-foreground">
            <Video class="size-5" />
        </div>
        <h1 class="font-bold text-lg tracking-tight">Lumina <span class="font-normal text-muted-foreground">Cut</span></h1>
      </div>
      
      <div class="flex items-center gap-4">
        <button class="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Export</button>
        <button 
            @click="toggleDark()" 
            class="p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Toggle Theme"
        >
            <Sun v-if="isDark" class="size-5" />
            <Moon v-else class="size-5" />
        </button>
        <div class="size-8 rounded-full bg-linear-to-br from-primary to-chart-1"></div>
      </div>
    </header>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col min-h-0 relative">
      
      <!-- Top Section -->
      <div class="flex-1 flex min-h-0">
        <!-- Left Panel: Resources -->
        <div class="shrink-0 flex" :style="{ width: `${leftWidth}px` }">
            <ResourcesPanel />
        </div>
        
        <!-- Resizer -->
        <div 
            class="w-1 hover:w-1.5 bg-border hover:bg-primary/50 cursor-col-resize transition-all z-10 flex items-center justify-center group -ml-0.5"
            @mousedown="startResizeLeft"
        >
            <div class="h-8 w-0.5 bg-muted-foreground/20 group-hover:bg-primary rounded-full"></div>
        </div>

        <!-- Middle Panel: Preview -->
        <div class="flex-1 min-w-0 bg-background/50 relative">
            <PreviewPanel />
        </div>

        <!-- Resizer -->
        <div 
            class="w-1 hover:w-1.5 bg-border hover:bg-primary/50 cursor-col-resize transition-all z-10 flex items-center justify-center group -mr-0.5"
            @mousedown="startResizeRight"
        >
             <div class="h-8 w-0.5 bg-muted-foreground/20 group-hover:bg-primary rounded-full"></div>
        </div>

        <!-- Right Panel: Properties -->
        <div class="shrink-0 flex" :style="{ width: `${rightWidth}px` }">
            <PropertiesPanel />
        </div>
      </div>

      <!-- Bottom Resizer -->
      <div 
        class="h-1 hover:h-1.5 bg-border hover:bg-primary/50 cursor-row-resize transition-all z-10 flex justify-center items-center group -mt-0.5"
        @mousedown="startResizeBottom"
      >
         <div class="w-12 h-0.5 bg-muted-foreground/20 group-hover:bg-primary rounded-full"></div>
      </div>

      <!-- Bottom Panel: Timeline -->
      <div class="shrink-0 bg-card relative" :style="{ height: `${bottomHeight}px` }">
        <TimelinePanel />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Prevent text selection while resizing */
:global(body.resizing) {
  user-select: none;
  cursor: col-resize;
}
</style>
