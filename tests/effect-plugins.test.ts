import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createPinia, setActivePinia } from "pinia";
import fade from "../src/effects/plugins/fade-in";
import outline from "../src/effects/plugins/text-outline";
import { discoverEffects } from "../src/effects/registry";
import { matchesEffect } from "../src/effects/types";
import { normalizeProjectData, PROJECT_VERSION, serializeProjectData } from "../src/services/storage/projectSchema";
import { useDanmuStore } from "../src/stores/danmu";
import { useTimelineStore } from "../src/stores/timeline";
import type { AnyDanmu, TextDanmu } from "../src/types/danmu";
import type { TimelineClip, TimelineResourceClip, TimelineTrack } from "../src/types/timeline";
import { basNameForClip, compileClipToBas, compileTimelineToBas } from "../src/utils/compiler";

const resource: TextDanmu = { id: "shared", type: "text", content: "字幕" };
const instance = (id: string, extra: Partial<TimelineResourceClip> = {}): TimelineResourceClip => ({
  kind: "resource",
  id,
  trackId: "track",
  resourceId: resource.id,
  startTime: 0,
  duration: 2000,
  ...extra
});
const track = (clips: TimelineClip[], id = "track"): TimelineTrack => ({
  id,
  name: id,
  visible: true,
  locked: false,
  type: "danmu",
  clips
});
function setup(tracks = [track([instance("a"), instance("b")])], sources: AnyDanmu[] = [resource]) {
  setActivePinia(createPinia());
  const timeline = useTimelineStore();
  const danmu = useDanmuStore();
  danmu.danmus = structuredClone(sources);
  timeline.loadTimeline(tracks);
  const get = (id: string) => {
    const clip = timeline.tracks.flatMap(t => t.clips).find(c => c.id === id);
    assert.ok(clip?.kind === "resource");
    return clip;
  };
  const compile = () => compileTimelineToBas(timeline.rootTracks, danmu.danmus);
  const disk = () =>
    serializeProjectData(
      normalizeProjectData({
        version: PROJECT_VERSION,
        tracks: timeline.rootTracks,
        assets: danmu.danmus.map(danmu => ({ id: danmu.id, type: danmu.type, binId: null, danmu })),
        bins: []
      })
    );
  return { timeline, danmu, get, compile, disk };
}

type BasValue = { value: number } | number | string;
type BasSegment = {
  delay: number;
  duration: number;
  valueStart?: Record<string, BasValue>;
  valueEnd: Record<string, BasValue>;
  group: number;
};
interface Parsed {
  defs: { name: string; type: string; attrs: Record<string, BasValue> }[];
  def2set: Record<string, BasSegment[]>;
}
interface Engine {
  workerDisabled: boolean;
  parse(args: { danmaku: { text: string }; success: (result: Parsed) => void; error: (message: string) => void }): void;
  pretreatDanmaku(result: Parsed): void;
}
const element = () => ({ setAttribute() {}, appendChild() {}, removeChild() {}, childNodes: [] });
const windowObject = {} as { BasDanmaku: new (options: object) => Engine };
runInNewContext(readFileSync(new URL("../public/bas.js", import.meta.url), "utf8"), {
  window: windowObject,
  document: { createElement: element, querySelector: element, getElementById: element, createTextNode: element },
  console,
  navigator: { userAgent: "" },
  Worker: undefined,
  setTimeout,
  clearTimeout
});
async function render(script: string) {
  const engine = new windowObject.BasDanmaku({ container: element(), timeSyncFunc: () => 0 });
  engine.workerDisabled = true;
  const parsed = await new Promise<Parsed>((success, error) =>
    engine.parse({ danmaku: { text: script }, success, error })
  );
  engine.pretreatDanmaku(parsed);
  return parsed;
}
const numeric = (val: BasValue | undefined) => (typeof val === "object" ? val.value : Number(val));
function sample(parsed: Parsed, name: string, time: number) {
  let value = numeric(parsed.defs.find(def => def.name === name)?.attrs.alpha ?? 1);
  const segments = parsed.def2set[name]!.filter(s => s.valueEnd.alpha !== undefined);
  assert.ok(new Set(segments.map(s => s.group)).size <= 1);
  for (const s of segments) {
    if (time < s.delay) break;
    const to = numeric(s.valueEnd.alpha);
    if (s.duration > 0 && time < s.delay + s.duration) {
      const from = numeric(s.valueStart?.alpha ?? value);
      return from + ((to - from) * (time - s.delay)) / s.duration;
    }
    value = to;
  }
  return value;
}
const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 0.001, [actual, expected].join(" ≠ "));

test("attach changes only the selected instance's BAS and removing the last effect restores the original export", async () => {
  const { timeline, get, danmu, compile } = setup();
  const original = compile();
  const untouched = JSON.stringify(get("b"));
  const fadeId = timeline.attachEffect("a", fade);
  const outlineId = timeline.attachEffect("a", outline);
  assert.equal(timeline.selectedClipId, "a");
  assert.deepEqual(
    timeline.rootTracks.map(t => t.clips.map(c => c.id)),
    [["a", "b"]]
  );
  assert.deepEqual(danmu.danmus, [resource]);
  assert.equal(JSON.stringify(get("b")), untouched);
  const script = compile();
  assert.equal(script.split("def text obj_b")[1], original.split("def text obj_b")[1]);
  assert.equal(compileClipToBas(get("a"), resource).trim(), script.split("def text obj_b")[0]!.trim());
  const graph = await render(script);
  assert.deepEqual(
    Array.from(graph.defs, def => def.name),
    ["obj_a", "obj_b"]
  );
  assert.equal(numeric(graph.defs[0]!.attrs.strokeWidth), 2);
  assert.equal(graph.defs[0]!.attrs.strokeColor, 0x334155);
  assert.equal(numeric(graph.defs[1]!.attrs.strokeWidth), 0);
  assert.ok([...script.matchAll(/\bset (\w+)/g)].every(match => match[1] === "obj_a"));
  close(sample(graph, "obj_a", 0.25), 0.5);
  close(sample(graph, "obj_b", 0.25), 1);
  timeline.removeEffect("a", fadeId);
  timeline.removeEffect("a", outlineId);
  assert.equal(compile(), original);
});

test("stack order determines static property precedence and updates are atomic", async () => {
  const { timeline, get, compile } = setup();
  const first = timeline.attachEffect("a", outline);
  const second = timeline.attachEffect("a", outline);
  timeline.updateEffect("a", second, outline, { width: 4, color: "#000000" });
  assert.match(compile(), /strokeWidth = 4\n\s+strokeColor = 0x000000/);
  const snapshot = JSON.stringify(get("a"));
  assert.throws(() => timeline.updateEffect("a", second, outline, { width: 20, color: "#000000" }));
  assert.throws(() =>
    timeline.attachEffect("a", {
      ...fade,
      build() {
        throw new Error("broken plugin");
      }
    })
  );
  assert.throws(() => timeline.attachEffect("a", { ...fade, build: () => ({ style: { strokeWidth: -1 } }) }));
  assert.equal(JSON.stringify(get("a")), snapshot);
  timeline.moveEffect("a", first, 1);
  const graph = await render(compile());
  assert.equal(numeric(graph.defs[0]!.attrs.strokeWidth), 2);
  assert.equal(graph.defs[0]!.attrs.strokeColor, 0x334155);
  timeline.removeEffect("a", first);
  assert.equal((await render(compile())).defs[0]!.attrs.strokeColor, 0);
});

test("reject missing, locked, group, audio and incompatible targets before any write", async () => {
  const child = instance("child", { trackId: "nested" });
  const group: TimelineClip = {
    kind: "group",
    id: "grp",
    trackId: "track",
    startTime: 0,
    duration: 2000,
    tracks: [track([child], "nested")]
  };
  const { timeline, compile } = setup(
    [
      track([group, instance("path", { resourceId: "shape" }), instance("button", { resourceId: "btn" })]),
      { ...track([instance("sound", { trackId: "music", resourceId: "wav" })], "music"), type: "audio" }
    ],
    [resource, { type: "path", id: "shape", d: "M0 0 L10 10" }, { type: "button", id: "btn", text: "按钮" }]
  );
  const state = JSON.stringify(timeline.rootTracks);
  for (const id of [null, "missing", "grp", "child", "sound", "path", "button"])
    assert.throws(() => timeline.attachEffect(id, outline));
  assert.equal(JSON.stringify(timeline.rootTracks), state);
  for (const id of ["path", "button"]) timeline.attachEffect(id, fade);
  const graph = await render(compile());
  for (const name of ["obj_path", "obj_button"]) close(sample(graph, name, 0.25), 0.5);
  timeline.enterGroup("grp");
  timeline.rootTracks[0]!.locked = true;
  assert.throws(() => timeline.attachEffect("child", fade));
  timeline.rootTracks[0]!.locked = false;
  timeline.tracks[0]!.locked = true;
  assert.throws(() => timeline.attachEffect("child", fade));
});

test("delayed parented clip combines a fade with linear and step opacity without erasing position or text", async () => {
  const { timeline, compile } = setup([
    track([
      instance("parent", { duration: 5000 }),
      instance("child", {
        startTime: 1000,
        parentClipId: "parent",
        overrides: { opacity: 0.6 },
        keyframes: [
          { id: "k1", timeMs: 1000, properties: { opacity: 0.4, x: 100 } },
          { id: "k2", timeMs: 1500, properties: { opacity: 0.8, content: "切换" }, interpolation: "step" }
        ]
      })
    ])
  ]);
  timeline.attachEffect("child", fade);
  const graph = await render(compile());
  assert.equal(graph.defs[1]!.attrs.parent, "obj_parent");
  const segments = graph.def2set.obj_child!;
  assert.ok(segments.some(s => s.delay === 1 && s.duration === 1 && numeric(s.valueEnd.x) === 100));
  assert.ok(segments.some(s => s.delay === 2.5 && s.valueEnd.content === "切换"));
  for (const [time, expected] of [
    [0.9, 0],
    [1, 0],
    [1.2, 0.4],
    [1.5, 0.5],
    [2, 0.4],
    [2.49, 0.4],
    [2.51, 0.8]
  ])
    close(sample(graph, "obj_child", time!), expected!);
});

test("legacy parallel position and delayed serial alpha survive multiple effects", async () => {
  const { timeline, compile } = setup([
    track([
      instance("a", {
        startTime: 1000,
        animations: [
          { id: "x", type: "set", duration: 1000, properties: { x: 250 } },
          { id: "alpha", type: "set", delay: 500, duration: 500, properties: { opacity: 0.5 } },
          { id: "hold", type: "then", duration: 100, properties: { content: "完成" } }
        ]
      })
    ])
  ]);
  timeline.attachEffect("a", fade);
  const next = timeline.attachEffect("a", fade);
  timeline.updateEffect("a", next, fade, { percent: 50 });
  const graph = await render(compile());
  close(sample(graph, "obj_a", 1.25), 0.25);
  close(sample(graph, "obj_a", 1.8), 0.7);
  close(sample(graph, "obj_a", 2.5), 0.5);
  assert.ok(graph.def2set.obj_a!.some(s => s.delay === 1 && numeric(s.valueEnd.x) === 250));
  assert.ok(graph.def2set.obj_a!.some(s => s.delay === 2 && s.valueEnd.content === "完成"));
});

test("composing opacity respects preceding and overlapping legacy animation groups", async () => {
  const { timeline, compile } = setup([
    track([
      instance("successive", {
        startTime: 500,
        overrides: { opacity: 0.8 },
        animations: [
          { id: "first", type: "set", duration: 400, properties: { opacity: 0.2, x: 120 } },
          { id: "later", type: "set", delay: 800, duration: 700, properties: { opacity: 0.8 } }
        ]
      }),
      instance("overlap", {
        startTime: 500,
        overrides: { opacity: 0.8 },
        animations: [
          { id: "replaced", type: "set", duration: 600, properties: { opacity: 0.2, x: 200 } },
          { id: "effective", type: "set", delay: 250, duration: 675, properties: { opacity: 0.7 } }
        ]
      })
    ])
  ]);
  const cap = {
    ...fade,
    build: () => ({
      opacityLimit: [
        { at: 0, value: 1 },
        { at: 1, value: 1 }
      ]
    })
  };
  timeline.attachEffect("successive", cap);
  timeline.attachEffect("overlap", cap);
  const graph = await render(compile());
  close(sample(graph, "obj_successive", 1.475), 0.35);
  assert.ok(graph.def2set.obj_successive!.some(s => numeric(s.valueEnd.x) === 120));
  close(sample(graph, "obj_overlap", 0.6), 0.8);
  close(sample(graph, "obj_overlap", 1.425), 0.7);
  assert.ok(graph.def2set.obj_overlap!.every(s => s.valueEnd.x === undefined));
});

test("a constant opacity limit only needs a definition for a static host", async () => {
  const { timeline, compile } = setup([track([instance("still")])]);
  timeline.attachEffect("still", {
    ...fade,
    build: () => ({
      opacityLimit: [
        { at: 0, value: 0.4 },
        { at: 1, value: 0.4 }
      ]
    })
  });
  const script = compile();
  assert.doesNotMatch(script, /\bset /);
  const graph = await render(script);
  close(sample(graph, "obj_still", 1.9), 0.4);
  close(Math.max(...graph.def2set.obj_still!.map(s => s.delay + s.duration)), 2);
});

test("copies, splits, trims and moves retain the correct portion of the host effect", async () => {
  const { timeline, get, compile, disk } = setup([track([instance("a")])]);
  const id = timeline.attachEffect("a", fade);
  timeline.updateEffect("a", id, fade, { percent: 100 });
  const right = timeline.splitClip("a", 500);
  assert.ok(right?.kind === "resource");
  assert.deepEqual(get("a").effects![0]!.range, [0, 0.25]);
  assert.deepEqual(right.effects![0]!.range, [0.25, 1]);
  assert.notEqual(right.effects![0]!.id, id);
  close(sample(await render(compile()), basNameForClip(right.id), 0.6), 0.3);
  timeline.trimClip(right.id, 1000, 750);
  assert.deepEqual(get(right.id).effects![0]!.range, [0.5, 0.875]);
  timeline.moveClipToTrack(right.id, "track", { startTime: 2000 });
  close(sample(await render(compile()), basNameForClip(right.id), 2.25), 0.625);
  timeline.copyClipToClipboard(get(right.id));
  const copy = timeline.pasteClipFromClipboard("track", 4000);
  assert.ok(copy?.kind === "resource");
  assert.notEqual(copy.effects![0]!.id, right.effects![0]!.id);
  timeline.updateEffect(copy.id, copy.effects![0]!.id, fade, { percent: 50 });
  assert.equal(get(right.id).effects![0]!.params.percent, 100);
  assert.equal(disk().version, PROJECT_VERSION);
});

test("v5 round-trip renders without the original plugin and rejects invalid snapshots before reopening", async () => {
  const { timeline, disk, compile } = setup();
  const id = timeline.attachEffect("a", fade);
  const expected = compile();
  const data = disk();
  const stored = data.tracks[0]!.clips[0]!.effects![0]!;
  stored.pluginId = "uninstalled.fx";
  stored.pluginVersion = "2.5";
  const reopened = normalizeProjectData(JSON.parse(JSON.stringify(data)));
  assert.equal(matchesEffect(fade, stored), false);
  timeline.loadTimeline(reopened.tracks);
  assert.throws(() => timeline.updateEffect("a", id, fade, { percent: 50 }));
  assert.equal(compile(), expected);
  close(sample(await render(compile()), "obj_a", 0.25), 0.5);
  timeline.removeEffect("a", id);
  assert.doesNotMatch(compile(), /\bset /);
  const invalid = (change: (data: typeof stored) => void) => {
    const corrupted = structuredClone(data);
    change(corrupted.tracks[0]!.clips[0]!.effects![0]!);
    assert.throws(() => normalizeProjectData(corrupted));
  };
  invalid(effect => (effect.range = [0.6, 0.1]));
  invalid(
    effect =>
      (effect.patch.opacityLimit = [
        { at: 0, value: 0 },
        { at: 0, value: 1 },
        { at: 1, value: 1 }
      ])
  );
  invalid(effect => Object.assign(effect.patch, { layers: [] }));
  invalid(effect => Object.assign(effect.patch, { style: { d: "M0 0" } }));
  invalid(effect => (effect.id = "b"));
});

test("v4 independent effect groups migrate as ordinary editable groups with identical BAS", () => {
  const nested = track(
    [instance("layer", { trackId: "layers", keyframes: [{ id: "key", timeMs: 500, properties: { x: 30 } }] })],
    "layers"
  );
  const group: TimelineClip = {
    kind: "group",
    id: "group",
    trackId: "track",
    startTime: 750,
    duration: 2000,
    tracks: [nested]
  };
  const { disk, compile } = setup([track([group])]);
  const input = disk();
  input.version = 4;
  Object.assign(input.tracks[0]!.clips[0]!, { effect: { pluginId: "core.echo-text", layerClipIds: ["layer"] } });
  const reopened = normalizeProjectData(input);
  assert.equal(reopened.version, 5);
  assert.equal(reopened.tracks[0]!.clips[0]!.kind, "group");
  assert.equal("effect" in reopened.tracks[0]!.clips[0]!, false);
  assert.equal(compileTimelineToBas(reopened.tracks, reopened.danmus), compile());
  assert.throws(() => normalizeProjectData({ ...input, version: 5 }));
});

test("catalog discovery isolates broken and duplicate plugins", async () => {
  const catalog = await discoverEffects({
    good: async () => fade,
    first: async () => outline,
    second: async () => outline,
    bad: async () => ({ ...fade, apiVersion: 1 }),
    missing: async () => {
      throw new Error("missing");
    }
  });
  assert.deepEqual(
    catalog.plugins.map(p => p.id),
    [fade.id]
  );
  assert.deepEqual(
    catalog.errors.map(error => error.entry),
    ["bad", "first", "missing", "second"]
  );
});
