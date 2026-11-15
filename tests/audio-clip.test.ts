import test from "node:test";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { useAudioStore } from "../src/stores/audio";
import { useTimelineStore } from "../src/stores/timeline";

test("splitting a trimmed audio clip preserves the source file and advances the right source offset", () => {
  setActivePinia(createPinia());
  const audio = useAudioStore();
  const timeline = useTimelineStore();
  audio.add({ id: "audio", type: "audio-file", name: "music.wav", url: "blob:music", file: new File(["audio"], "music.wav"), duration: 30000, sourcePath: "C:/music.wav" });
  timeline.loadTimeline([{ id: "track", name: "Audio", type: "audio", visible: true, locked: false, clips: [{
    id: "clip", kind: "resource", resourceId: "audio", trackId: "track", startTime: 1000, duration: 10000, sourceInMs: 5000
  }] }]);
  const right = timeline.splitClip("clip", 4000);
  assert.equal(right?.kind, "resource");
  assert.equal(right?.resourceId, "audio");
  assert.equal(right?.sourceInMs, 8000);
  assert.equal(right?.duration, 7000);
  const left = timeline.rootTracks[0]!.clips.find(clip => clip.id === "clip");
  assert.equal(left?.duration, 3000);
  assert.equal(left?.sourceInMs, 5000);
  assert.equal(audio.audioResources[0]?.sourcePath, "C:/music.wav");
});
