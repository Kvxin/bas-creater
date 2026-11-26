import test from "node:test";
import assert from "node:assert/strict";
import {
  CLIP_FILMSTRIP_HEIGHT_THRESHOLD,
  computeFilmstripLayout,
  isClipFilmstripExpanded,
  sampleClipDanmusAtTime
} from "@/core/filmstrip";
import type { AnyDanmu } from "@/types/danmu";
import type { TimelineGroupClip, TimelineResourceClip } from "@/types/timeline";

test("isClipFilmstripExpanded switches at track height threshold", () => {
  assert.equal(CLIP_FILMSTRIP_HEIGHT_THRESHOLD, 56);
  assert.equal(isClipFilmstripExpanded(36), false);
  assert.equal(isClipFilmstripExpanded(40), false);
  assert.equal(isClipFilmstripExpanded(55), false);
  assert.equal(isClipFilmstripExpanded(56), true);
  assert.equal(isClipFilmstripExpanded(120), true);
  assert.equal(isClipFilmstripExpanded(Number.NaN), false);
});

test("computeFilmstripLayout tiles seamlessly from left to right and clips partial trailing frame", () => {
  const layout = computeFilmstripLayout({
    clipStartMs: 0,
    clipDurationMs: 3000,
    pixelsPerSecond: 100,
    scrollLeft: 0,
    viewportWidth: 800,
    stripHeight: 45,
    canvasWidth: 800,
    canvasHeight: 450
  });

  // 16:9 at 45px height => 80px wide tiles across a 300px clip => 4 tiles (0, 80, 160, 240..320 clipped at 300)
  assert.equal(layout.clipWidthPx, 300);
  assert.equal(layout.frameHeight, 45);
  assert.equal(layout.frameWidth, 80);
  assert.equal(layout.visibleLeft, 0);
  assert.equal(layout.visibleWidth, 300);
  assert.equal(layout.tiles.length, 4);
  assert.deepEqual(
    layout.tiles.map(tile => tile.x),
    [0, 80, 160, 240]
  );
  // Centers of [0,80], [80,160], [160,240], [240,300] at 100px/s
  assert.deepEqual(
    layout.tiles.map(tile => tile.localTimeMs),
    [400, 1200, 2000, 2700]
  );
});

test("computeFilmstripLayout virtualizes only visible tiles when scrolled", () => {
  const layout = computeFilmstripLayout({
    clipStartMs: 0,
    clipDurationMs: 20000,
    pixelsPerSecond: 200,
    scrollLeft: 1000,
    viewportWidth: 300,
    stripHeight: 45,
    canvasWidth: 800,
    canvasHeight: 450
  });

  // Visible slice is [1000, 1300] with 80px tiles => indices 12 (960..1040) through 16 (1280..1360)
  assert.equal(layout.visibleLeft, 1000);
  assert.equal(layout.visibleWidth, 300);
  assert.deepEqual(
    layout.tiles.map(tile => tile.index),
    [12, 13, 14, 15, 16]
  );
});

test("computeFilmstripLayout returns no tiles when clip is outside viewport", () => {
  const layout = computeFilmstripLayout({
    clipStartMs: 10000,
    clipDurationMs: 2000,
    pixelsPerSecond: 100,
    scrollLeft: 0,
    viewportWidth: 500,
    stripHeight: 50,
    canvasWidth: 800,
    canvasHeight: 450
  });

  assert.equal(layout.visibleWidth, 0);
  assert.deepEqual(layout.tiles, []);
});

test("computeFilmstripLayout shifts sampled time during live left-edge trim", () => {
  const layout = computeFilmstripLayout({
    clipStartMs: 1500,
    clipDurationMs: 1500,
    pixelsPerSecond: 100,
    scrollLeft: 0,
    viewportWidth: 800,
    stripHeight: 45,
    canvasWidth: 800,
    canvasHeight: 450,
    timeOffsetMs: 500,
    sourceDurationMs: 2000
  });

  assert.equal(layout.tiles.length, 2);
  // Tile 0 center = 40px => 400ms + 500ms offset = 900ms; Tile 1 covers [80, 150], center = 115px => 1150ms + 500ms = 1650ms
  assert.deepEqual(
    layout.tiles.map(tile => tile.localTimeMs),
    [900, 1650]
  );
});

test("sampleClipDanmusAtTime interpolates keyframes and resolves parent chains for resource clips", () => {
  const parentResource: AnyDanmu = {
    id: "dm_parent",
    type: "text",
    content: "Parent",
    x: "10%",
    y: "20%",
    opacity: 1
  };
  const childResource: AnyDanmu = {
    id: "dm_child",
    type: "text",
    content: "Child",
    x: "0%",
    y: "50%",
    opacity: 1
  };
  const parentClip: TimelineResourceClip = {
    id: "clip_parent",
    kind: "resource",
    resourceId: parentResource.id,
    trackId: "track_1",
    startTime: 1000,
    duration: 2000,
    keyframes: [{ id: "kf_p1", timeMs: 2000, properties: { x: "50%" } }]
  };
  const childClip: TimelineResourceClip = {
    id: "clip_child",
    kind: "resource",
    resourceId: childResource.id,
    trackId: "track_2",
    startTime: 1000,
    duration: 2000,
    parentClipId: parentClip.id,
    keyframes: [{ id: "kf_c1", timeMs: 2000, properties: { x: "100%" } }]
  };

  const items = sampleClipDanmusAtTime({
    clip: childClip,
    localTimeMs: 1000,
    resourcesById: new Map([
      [parentResource.id, parentResource],
      [childResource.id, childResource]
    ]),
    allClipsById: new Map([
      [parentClip.id, parentClip],
      [childClip.id, childClip]
    ]),
    reference: { width: 800, height: 450 }
  });

  assert.equal(items.length, 1);
  assert.equal(items[0]!.danmu.x, "50%");
  assert.equal(items[0]!.parentChain.length, 1);
  assert.equal(items[0]!.parentChain[0]!.x, "30%");
});

test("sampleClipDanmusAtTime composites visible active danmu clips inside group sorted by zIndex", () => {
  const front: AnyDanmu = { id: "dm_front", type: "text", content: "Front", zIndex: 10 };
  const back: AnyDanmu = { id: "dm_back", type: "button", text: "Back", zIndex: 2 };
  const group: TimelineGroupClip = {
    id: "group_1",
    kind: "group",
    name: "Group 1",
    trackId: "track_1",
    startTime: 500,
    duration: 3000,
    tracks: [
      {
        id: "gt_1",
        name: "T1",
        type: "danmu",
        visible: true,
        locked: false,
        clips: [
          {
            id: "c_front",
            kind: "resource",
            resourceId: front.id,
            trackId: "gt_1",
            startTime: 0,
            duration: 2000
          }
        ]
      },
      {
        id: "gt_2",
        name: "T2",
        type: "danmu",
        visible: true,
        locked: false,
        clips: [
          {
            id: "c_back",
            kind: "resource",
            resourceId: back.id,
            trackId: "gt_2",
            startTime: 1000,
            duration: 2000
          }
        ]
      }
    ]
  };

  const resources = new Map<string, AnyDanmu>([
    [front.id, front],
    [back.id, back]
  ]);

  const at500 = sampleClipDanmusAtTime({
    clip: group,
    localTimeMs: 500,
    resourcesById: resources,
    reference: { width: 800, height: 450 }
  });
  assert.deepEqual(
    at500.map(item => item.danmu.id),
    ["dm_front"]
  );

  const at1500 = sampleClipDanmusAtTime({
    clip: group,
    localTimeMs: 1500,
    resourcesById: resources,
    reference: { width: 800, height: 450 }
  });
  assert.deepEqual(
    at1500.map(item => item.danmu.id),
    ["dm_back", "dm_front"]
  );
});
