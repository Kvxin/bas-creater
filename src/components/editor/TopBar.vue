<script setup lang="ts">
import { ref } from "vue";
import { Upload, Save, Sun, Moon } from "lucide-vue-next";
import { Button } from "@/components/ui/button";

const props = withDefaults(
  defineProps<{
    isDark: boolean;
    title?: string;
  }>(),
  { title: "My Project" }
);

const emit = defineEmits<{
  (e: "update:isDark", value: boolean): void;
}>();

function toggleTheme() {
  emit("update:isDark", !props.isDark);
}
</script>

<template>
  <div
    class="h-14 bg-card border-b border-border flex items-center justify-between px-4"
  >
    <div class="flex items-center gap-4">
      <h1 class="text-lg font-semibold">{{ props.title }}</h1>
    </div>

    <div class="flex items-center gap-2">
      <Button variant="outline" size="sm">
        <Upload class="w-4 h-4 mr-2" />
        Import Media
      </Button>
      <Button variant="outline" size="sm">
        <Save class="w-4 h-4 mr-2" />
        Save
      </Button>
      <Button variant="ghost" size="sm" @click="toggleTheme">
        <Sun v-if="!props.isDark" class="w-4 h-4" />
        <Moon v-else class="w-4 h-4" />
      </Button>
    </div>
  </div>
</template>
