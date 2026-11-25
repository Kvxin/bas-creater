import test from "node:test";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { useAssetsStore } from "../src/stores/assets";
import { useTimelineStore } from "../src/stores/timeline";

test("bins are virtual, reject cycles, and keep assets when a parent bin is removed", () => {
  setActivePinia(createPinia());
  const store = useAssetsStore();
  const parent = store.createBin("Parent");
  const child = store.createBin("Child", parent.id);
  store.upsertAsset({ id: "asset", type: "text", binId: child.id, danmu: { id: "asset", type: "text", content: "hello" } });
  assert.throws(() => store.moveBin(parent.id, child.id), /cycle/i);
  assert.equal(store.bins.find(bin => bin.id === parent.id)?.parentId, null);
  store.removeBin(child.id);
  assert.equal(store.assets.find(asset => asset.id === "asset")?.binId, parent.id);
  store.removeBin(parent.id);
  assert.equal(store.assets.find(asset => asset.id === "asset")?.binId, null);
});

test("an asset used inside a nested timeline group cannot be removed silently", () => {
  setActivePinia(createPinia());
  const assets = useAssetsStore();
  const timeline = useTimelineStore();
  assets.upsertAsset({ id: "asset", type: "text", binId: null, danmu: { id: "asset", type: "text", content: "hello" } });
  timeline.loadTimeline([{ id: "root", name: "Root", type: "danmu", visible: true, locked: false, clips: [{
    id: "group", kind: "group", trackId: "root", startTime: 0, duration: 1000, tracks: [{
      id: "inner", name: "Inner", type: "danmu", visible: true, locked: false, clips: [{
        id: "clip", kind: "resource", resourceId: "asset", trackId: "inner", startTime: 0, duration: 1000
      }]
    }]
  }] }]);
  assert.throws(() => assets.removeAsset("asset"), /used by the timeline/i);
  assert.equal(assets.assets[0]?.id, "asset");
});
