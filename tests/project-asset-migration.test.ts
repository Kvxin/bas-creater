import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProjectData, PROJECT_VERSION } from "../src/core/projectSchema";
import { compileTimelineToBas } from "../src/core/compiler";

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
  assert.equal(project.version, PROJECT_VERSION);
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

test("v3 files with only assets preserve bins, clip overrides, nested timing and offline audio", () => {
  const text = { id: "text-1", type: "text", content: "Source" };
  const audio = { id: "audio-1", name: "offline.wav", sourcePath: "C:/offline.wav", duration: 5000 };
  const bins = [{ id: "bin", name: "Captions", parentId: null }];
  const location = { kind: "external", path: audio.sourcePath };
  const danmuTrack = { type: "danmu", visible: true, locked: false };
  const project = normalizeProjectData({
    version: 3,
    bins,
    assets: [
      { id: text.id, type: "text", binId: "bin", danmu: text },
      { id: audio.id, type: "audio-file", binId: null, audio, location }
    ],
    tracks: [
      {
        ...danmuTrack, id: "root", name: "Root", clips: [{
          kind: "group", id: "group", trackId: "root", startTime: 750, duration: 850,
          tracks: [{
            ...danmuTrack, id: "nested", name: "Nested", clips: [{
              kind: "resource", id: "caption", resourceId: text.id, trackId: "nested", startTime: 250,
              duration: 600, overrides: { content: "Instance" }
            }]
          }]
        }]
      },
      {
        id: "sound", name: "Sound", type: "audio", visible: true, locked: false, clips: [{
          kind: "resource", id: "audio-clip", resourceId: audio.id, trackId: "sound", startTime: 0,
          duration: 1200, sourceInMs: 450
        }]
      }
    ]
  });
  assert.equal(project.version, PROJECT_VERSION);
  assert.deepEqual(project.bins, bins);
  assert.deepEqual(project.danmus, [text]);
  assert.equal(project.assets[0]?.binId, "bin");
  assert.deepEqual(project.audioMeta, [audio]);
  assert.deepEqual(project.assets[1]?.type === "audio-file" && project.assets[1].location, location);
  const group = project.tracks[0]?.clips[0];
  assert.ok(group?.kind === "group");
  assert.equal(group.startTime, 750);
  const caption = group.tracks[0]?.clips[0];
  assert.ok(caption?.kind === "resource");
  assert.equal(caption.startTime, 250);
  assert.deepEqual(caption.overrides, { content: "Instance" });
  assert.equal(project.tracks[1]?.clips[0]?.sourceInMs, 450);
  assert.equal(project.timeline.duration, 1600);
  const script = compileTimelineToBas(project.tracks, project.danmus, {
    audioResourceIds: project.audioMeta.map(item => item.id)
  });
  assert.match(script, /set obj_caption \{\} 1s/);
  assert.match(script, /content = "Instance"/);
  assert.doesNotMatch(script, /offline|audio|Source/);
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

test("project schema preserves valid timeline FPS, display mode, and markers while rejecting invalid metadata", () => {
  const valid = normalizeProjectData({
    ...legacy(),
    timeline: {
      duration: 0,
      zoomScale: 240,
      fps: 60,
      timeDisplayMode: "frames",
      snapEnabled: true,
      markers: [
        { id: "m-2", timeMs: 937.5, label: "Drop" },
        { id: "m-1", timeMs: 468.75 }
      ]
    }
  });
  assert.deepEqual(valid.timeline, {
    duration: 2200,
    zoomScale: 240,
    fps: 60,
    timeDisplayMode: "frames",
    snapEnabled: true,
    markers: [
      { id: "m-1", timeMs: 468.8 },
      { id: "m-2", timeMs: 937.5, label: "Drop" }
    ]
  });

  assert.throws(() => normalizeProjectData({ ...legacy(), timeline: { duration: 0, fps: 0 } }), /fps/i);
  assert.throws(
    () => normalizeProjectData({ ...legacy(), timeline: { duration: 0, timeDisplayMode: "smpte" } }),
    /display mode/i
  );
  assert.throws(
    () => normalizeProjectData({ ...legacy(), timeline: { duration: 0, timeDisplayMode: "bars" } }),
    /display mode/i
  );
  assert.throws(
    () =>
      normalizeProjectData({
        ...legacy(),
        timeline: {
          duration: 0,
          markers: [
            { id: "dup", timeMs: 100 },
            { id: "dup", timeMs: 200 }
          ]
        }
      }),
    /duplicate/i
  );
});
