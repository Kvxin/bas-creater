import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { AudioResource } from "@/types/resource";

export const useAudioStore = defineStore("audio", () => {
  const audioResources = ref<AudioResource[]>([]);

  const resourceMap = computed(() => {
    const map = new Map<string, AudioResource>();
    for (const resource of audioResources.value) {
      map.set(resource.id, resource);
    }
    return map;
  });

  const add = (resource: AudioResource) => {
    audioResources.value.push(resource);
  };

  const updateName = (id: string, name: string) => {
    const idx = audioResources.value.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const resource = audioResources.value[idx];
    if (!resource) return;
    resource.name = name || resource.file.name;
  };

  const remove = (id: string) => {
    const idx = audioResources.value.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const resource = audioResources.value[idx];
    if (!resource) return;
    URL.revokeObjectURL(resource.url);
    audioResources.value.splice(idx, 1);
  };

  const getById = (id: string) => {
    return audioResources.value.find((r) => r.id === id) ?? null;
  };

  return {
    audioResources,
    resourceMap,
    add,
    updateName,
    remove,
    getById,
  };
});
