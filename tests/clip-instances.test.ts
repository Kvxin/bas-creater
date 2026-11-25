import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import type { TextDanmu } from "../src/types/danmu";
import type { TimelineResourceClip, TimelineTrack } from "../src/types/timeline";
import { basNameForClip, compileTimelineToBas } from "../src/core/compiler";
import { getEffectiveDanmuAtTime } from "../src/core/keyframes";
import { splitClipAnimation } from "../src/core/splitClip";

const resource: TextDanmu = { id: "asset", type: "text", content: "shared", x: 0 };
const clip = (id: string, overrides: Partial<TextDanmu> = {}): TimelineResourceClip => ({
  id, kind: "resource", resourceId: "asset", trackId: "track", startTime: 0, duration: 1000, overrides
});
const track = (clips: TimelineResourceClip[]): TimelineTrack => ({
  id: "track", name: "track", type: "danmu", clips, visible: true, locked: false
});

test("BAS names preserve readable clip IDs without collisions for escaped IDs", () => {
  assert.equal(basNameForClip("clip_972utgp"), "obj_clip_972utgp");
  const ids = ["a-b", "a_b", "encoded_61_2d_62", "", "empty", "文字", "😀"];
  const names = ids.map(basNameForClip);
  assert.equal(new Set(names).size, ids.length);
  for (const name of names) assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*$/);
});

test("shared asset instances keep independent base properties and export distinct names", () => {
  const first = clip("a-b", { content: "first", x: 10 });
  const second = clip("a_b", { content: "second", x: 20 });
  assert.equal(getEffectiveDanmuAtTime(resource, first, 0).x, 10);
  assert.equal(getEffectiveDanmuAtTime(resource, second, 0).x, 20);
  assert.equal(resource.x, 0);
  const code = compileTimelineToBas([track([first, second])], [resource]);
  assert.notEqual(basNameForClip(first.id), basNameForClip(second.id));
  assert.match(code, /content = "first"/);
  assert.match(code, /content = "second"/);
});

test("parent references use the target instance BAS name and reject cycles", () => {
  const parent = clip("parent");
  const child = { ...clip("child"), parentClipId: parent.id };
  const code = compileTimelineToBas([track([parent, child])], [resource]);
  assert.ok(code.includes(`parent = "${basNameForClip(parent.id)}"`));
  assert.throws(() => compileTimelineToBas([track([{ ...parent, parentClipId: child.id }, child])], [resource]), /Cyclic parent/);
  const button = { id: "button", type: "button" as const, text: "Not a parent" };
  const buttonParent = { ...parent, resourceId: button.id };
  assert.throws(() => compileTimelineToBas([track([buttonParent, child])], [resource, button]), /must be text/);
});

test("split samples per-instance base without changing the asset", () => {
  const source = { ...clip("one", { x: 20 }), keyframes: [{ id: "frame", timeMs: 1000, properties: { x: 100 } }] };
  const split = splitClipAnimation(source, resource, 500);
  assert.equal(split.rightProperties.x, 60);
  assert.equal(split.leftKeyframes.at(-1)?.properties.x, 60);
  assert.equal(resource.x, 0);
});

test("parented mixed coordinates sample and split in BAS root-normalized units", () => {
  const source = {
    ...clip("child", { x: 100, y: 90 }),
    parentClipId: "parent",
    keyframes: [{ id: "frame", timeMs: 1000, properties: { x: "50%", y: "50%" } }]
  };
  const reference = { width: 800, height: 450 };
  const sampled = getEffectiveDanmuAtTime(resource, source, 500, null, reference);
  assert.equal(sampled.x, 250);
  assert.equal(sampled.y, 157.5);
  const split = splitClipAnimation(source, resource, 500, reference);
  assert.equal(split.rightProperties.x, sampled.x);
  assert.equal(split.rightProperties.y, sampled.y);
  assert.throws(() => splitClipAnimation(source, resource, 500), /reference size/);
});

test("BAS schedules discrete text at its keyframe while position animates before it", async () => {
  const source = {
    ...clip("animated"),
    duration: 5000,
    keyframes: [
      { id: "first", timeMs: 3000, properties: { content: "new", x: 300 } },
      { id: "second", timeMs: 4000, properties: { content: "" } }
    ]
  };
  const code = compileTimelineToBas([track([source])], [resource]);
  const element = () => ({ setAttribute() {}, appendChild() {}, removeChild() {}, childNodes: [] });
  const window = {} as { BasDanmaku: new (options: object) => {
    workerDisabled: boolean;
    parse: (options: object) => void;
    pretreatDanmaku: (dm: object) => void;
  } };
  runInNewContext(readFileSync("public/bas.js", "utf8"), {
    window, console, navigator: { userAgent: "" }, Worker: undefined, setTimeout, clearTimeout,
    document: { createElement: element, querySelector: element, getElementById: element, createTextNode: element }
  });
  const engine = new window.BasDanmaku({ container: element(), timeSyncFunc: () => 0 });
  engine.workerDisabled = true;
  type Segment = { delay: number; duration: number; valueEnd: { content?: string; x?: { value: number } }; group: number };
  const { promise, resolve, reject } = Promise.withResolvers<{ def2set: Record<string, Segment[]> }>();
  engine.parse({ danmaku: { text: code }, success: resolve, error: reject });
  const parsed = await promise;
  engine.pretreatDanmaku(parsed);
  const segments = parsed.def2set[basNameForClip(source.id)]!.filter(segment => segment.group !== -1);
  const position = segments.find(segment => segment.valueEnd.x !== undefined);
  assert.equal(position?.delay, 0);
  assert.equal(position?.duration, 3);
  assert.equal(position?.valueEnd.x?.value, 300);
  const contentAt = (time: number) => segments.reduce(
    (content, segment) => segment.delay <= time && segment.valueEnd.content !== undefined
      ? segment.valueEnd.content : content,
    resource.content
  );
  assert.equal(contentAt(2.9), "shared");
  assert.equal(contentAt(3.1), "new");
  assert.equal(contentAt(4.1), "");
});
