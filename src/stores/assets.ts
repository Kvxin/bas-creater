import { defineStore } from "pinia";
import { ref } from "vue";
import type { ProjectAsset, ProjectBin } from "@/types/storage";
import { useTimelineStore } from "@/stores/timeline";
import type { TimelineTrack } from "@/types/timeline";

export const useAssetsStore = defineStore("assets", () => {
  const assets = ref<ProjectAsset[]>([]);
  const bins = ref<ProjectBin[]>([]);

  function setProject(nextAssets: ProjectAsset[], nextBins: ProjectBin[]) {
    assets.value = nextAssets;
    bins.value = nextBins;
  }
  function requireBin(id: string | null) {
    if (id !== null && !bins.value.some((bin) => bin.id === id)) throw new Error("Unknown bin");
  }
  function createBin(name: string, parentId: string | null = null) {
    requireBin(parentId);
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Bin name cannot be empty");
    const bin: ProjectBin = { id: crypto.randomUUID(), name: trimmed, parentId };
    bins.value.push(bin);
    return bin;
  }
  function renameBin(id: string, name: string) {
    const bin = bins.value.find((item) => item.id === id);
    if (!bin || !name.trim()) throw new Error("Invalid bin or name");
    bin.name = name.trim();
  }
  function removeBin(id: string) {
    const index = bins.value.findIndex((bin) => bin.id === id);
    if (index < 0) throw new Error("Unknown bin");
    const parentId = bins.value[index]!.parentId;
    for (const bin of bins.value) if (bin.parentId === id) bin.parentId = parentId;
    for (const asset of assets.value) if (asset.binId === id) asset.binId = parentId;
    bins.value.splice(index, 1);
  }
  function moveBin(id: string, parentId: string | null, index?: number) {
    requireBin(parentId);
    const oldIndex = bins.value.findIndex((bin) => bin.id === id);
    if (oldIndex < 0) throw new Error("Unknown bin");
    for (let current = parentId; current !== null;) {
      if (current === id) throw new Error("Bin cycle");
      current = bins.value.find((bin) => bin.id === current)?.parentId ?? null;
    }
    const [bin] = bins.value.splice(oldIndex, 1);
    bin!.parentId = parentId;
    const siblings = bins.value.filter((item) => item.parentId === parentId);
    const target = index === undefined ? siblings.length : Math.max(0, Math.min(index, siblings.length));
    const before = siblings[target];
    bins.value.splice(before ? bins.value.indexOf(before) : bins.value.length, 0, bin!);
  }
  function moveAsset(id: string, binId: string | null, index?: number) {
    requireBin(binId);
    const oldIndex = assets.value.findIndex((asset) => asset.id === id);
    if (oldIndex < 0) throw new Error("Unknown asset");
    const [asset] = assets.value.splice(oldIndex, 1);
    asset!.binId = binId;
    const siblings = assets.value.filter((item) => item.binId === binId);
    const target = index === undefined ? siblings.length : Math.max(0, Math.min(index, siblings.length));
    const before = siblings[target];
    assets.value.splice(before ? assets.value.indexOf(before) : assets.value.length, 0, asset!);
  }
  function upsertAsset(asset: ProjectAsset) {
    requireBin(asset.binId);
    const index = assets.value.findIndex((item) => item.id === asset.id);
    if (index < 0) assets.value.push(asset);
    else assets.value[index] = asset;
  }
  function removeAsset(id: string) {
    const hasReference = (tracks: TimelineTrack[]): boolean => tracks.some((track) => track.clips.some((clip) =>
      clip.kind === "group" ? hasReference(clip.tracks) : clip.resourceId === id));
    if (hasReference(useTimelineStore().rootTracks)) throw new Error("Asset is used by the timeline");
    const index = assets.value.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("Unknown asset");
    assets.value.splice(index, 1);
  }
  return { assets, bins, setProject, createBin, renameBin, removeBin, moveBin, moveAsset, upsertAsset, removeAsset };
});
