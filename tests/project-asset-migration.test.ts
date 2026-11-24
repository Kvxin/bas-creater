import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProjectData } from "../src/services/storage/projectSchema";

const legacy = () => ({
  version: 2,
  id: "project-1",
  name: "Project",
  createdAt: 1,
  updatedAt: 2,
  canvas: { width: 800, height: 450 },
  timeline: { duration: 5000 },
  danmus: [{ id: "text-1", type: "text", name: "Caption", content: "Hello", x: 42 }],
  audioMeta: [{ id: "audio-1", name: "missing.wav", sourcePath: "C:/missing.wav", duration: 5000 }],
  tracks: [{ id: "track-1", name: "Track", visible: true, locked: false, type: "danmu", clips: [
    { kind: "resource", id: "clip-1", resourceId: "text-1", trackId: "track-1", startTime: 0, duration: 1000, keyframes: [] },
    { kind: "resource", id: "clip-2", resourceId: "text-1", trackId: "track-1", startTime: 1200, duration: 1000, keyframes: [] }
  ] }]
});

test("legacy assets and repeated timeline references migrate without losing appearance or offline audio", () => {
  const project = normalizeProjectData(legacy());
  assert.equal(project.version, 4);
  const text = project.assets.find(asset => asset.id === "text-1");
  assert.equal(text?.type, "text");
  if (text?.type === "text") assert.equal(text.danmu.content, "Hello");
  const audio = project.assets.find(asset => asset.id === "audio-1");
  assert.equal(audio?.type, "audio-file");
  if (audio?.type === "audio-file") assert.equal(audio.audio.sourcePath, "C:/missing.wav");
  const clips = project.tracks[0]!.clips;
  assert.equal(clips[0]?.resourceId, "text-1");
  assert.equal(clips[1]?.resourceId, "text-1");
  assert.equal(clips[0]?.kind === "resource" && clips[0].overrides?.content, "Hello");
  assert.equal(clips[1]?.kind === "resource" && clips[1].overrides?.x, "5.25%");
});

test("future projects cannot be silently opened and rewritten by an older version", () => {
  assert.throws(() => normalizeProjectData({ ...legacy(), version: 999 }), /version/i);
});

test("ambiguous legacy parent references are not silently attached to an arbitrary clip", () => {
  const data = legacy();
  data.danmus.push({ id: "child", type: "text", name: "Child", content: "Child", x: 0, parentId: "text-1" } as typeof data.danmus[number]);
  data.tracks[0]!.clips.push({ kind: "resource", id: "child-clip", resourceId: "child", trackId: "track-1", startTime: 0, duration: 1000, keyframes: [] });
  assert.throws(() => normalizeProjectData(data), /parent/i);
});

test("legacy animations migrate to keyframes and mixed animation data is rejected without mutating the input", () => {
  const source = legacy();
  const clip = source.tracks[0]!.clips[0]!;
  const animation = { id: "animation-1", type: "then", duration: 500, properties: { x: 100 } };
  Object.assign(clip, { animations: [animation] });
  const migrated = project => project.tracks[0]!.clips[0]!;
  const project = normalizeProjectData(source);
  assert.equal("animations" in migrated(project), false);
  assert.deepEqual(migrated(project).keyframes?.map(({ timeMs, properties }) => [timeMs, properties]), [
    [0, { x: "5.25%" }],
    [500, { x: "12.5%" }]
  ]);
  Object.assign(clip, { keyframes: [{ id: "frame-1", timeMs: 500, properties: { x: 50 } }] });
  const original = JSON.stringify(source);
  assert.throws(() => normalizeProjectData(source), /clip-1.*both keyframes and legacy animations/i);
  assert.equal(JSON.stringify(source), original);
});
