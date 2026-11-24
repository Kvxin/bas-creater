import test from "node:test";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { useAssetsStore } from "../src/stores/assets";
import { useDanmuStore } from "../src/stores/danmu";

const audioAsset = {
  id: "audio",
  type: "audio-file" as const,
  binId: null,
  audio: { id: "audio", name: "Song" }
};

test("danmu store reads and writes danmaku through the assets store only", () => {
  setActivePinia(createPinia());
  const assets = useAssetsStore();
  const danmu = useDanmuStore();
  const bin = assets.createBin("Bin");
  assets.upsertAsset(audioAsset);

  const created = danmu.add("text");
  assert.deepEqual(assets.assets.map((asset) => asset.id), ["audio", created.id]);
  assert.deepEqual(danmu.danmus.map((item) => item.id), [created.id]);

  assets.moveAsset(created.id, bin.id);
  danmu.updateDanmu(created.id, { content: "updated" });
  const stored = assets.assets.find((asset) => asset.id === created.id);
  assert.equal(stored?.binId, bin.id);
  assert.equal(stored?.type !== "audio-file" && stored?.danmu.type === "text" && stored.danmu.content, "updated");
  assert.equal(danmu.danmus[0], stored?.type !== "audio-file" ? stored?.danmu : undefined);

  const copy = danmu.duplicate(created.id);
  assert.equal(assets.assets.find((asset) => asset.id === copy?.id)?.binId, bin.id);

  danmu.remove(created.id);
  assert.deepEqual(assets.assets.map((asset) => asset.id), ["audio", copy?.id]);
  assert.equal(danmu.selectedId, copy?.id);
});

test("replacing the danmaku list keeps asset order, bins and audio assets", () => {
  setActivePinia(createPinia());
  const assets = useAssetsStore();
  const danmu = useDanmuStore();
  const bin = assets.createBin("Bin");
  assets.setProject(
    [
      { id: "a", type: "text", binId: bin.id, danmu: { id: "a", type: "text", content: "a" } },
      audioAsset,
      { id: "b", type: "text", binId: null, danmu: { id: "b", type: "text", content: "b" } }
    ],
    assets.bins
  );

  danmu.danmus = [
    { id: "c", type: "text", content: "c" },
    { id: "a", type: "button", text: "a" }
  ];
  assert.deepEqual(
    assets.assets.map((asset) => [asset.id, asset.type, asset.binId]),
    [
      ["a", "button", bin.id],
      ["audio", "audio-file", null],
      ["c", "text", null]
    ]
  );
  assert.throws(() => (danmu.danmus = [{ id: "audio", type: "text" }]), /Conflicting asset ID/);
  assert.throws(
    () =>
      (danmu.danmus = [
        { id: "x", type: "text" },
        { id: "x", type: "text" }
      ]),
    /Duplicate danmaku ID/
  );
});
