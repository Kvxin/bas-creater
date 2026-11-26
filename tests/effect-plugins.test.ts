import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createPinia, setActivePinia } from "pinia";
import fade from "../src/effects/plugins/fade-in";
import outline from "../src/effects/plugins/text-outline";
import { discoverEffects } from "../src/effects/registry";
import { matchesEffect, type EffectInstance } from "../src/effects/types";
import { basNameForClip, compileClipToBas, compileTimelineToBas } from "../src/core/compiler";
import { getEffectiveDanmuAtTime } from "../src/core/keyframes";
import { normalizeProjectData, PROJECT_VERSION, serializeProjectData } from "../src/core/projectSchema";
import { useDanmuStore } from "../src/stores/danmu";
import { useTimelineStore } from "../src/stores/timeline";
import type { AnyDanmu, TextDanmu } from "../src/types/danmu";
import type { TimelineClip, TimelineResourceClip, TimelineTrack } from "../src/types/timeline";

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
function valueAt(parsed: Parsed, name: string, key: string, time: number) {
  let value = parsed.defs.find(def => def.name === name)?.attrs[key];
  const segments = parsed.def2set[name]!.filter(s => s.valueEnd[key] !== undefined).sort((a, b) => a.delay - b.delay);
  for (const s of segments) if (time >= s.delay + s.duration) value = s.valueEnd[key];
  return typeof value === "object" ? value.value : value;
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
          { id: "k1", timeMs: 1000, properties: { opacity: 0.4, x: "25%" } },
          { id: "k2", timeMs: 1500, properties: { opacity: 0.8, content: "切换" }, interpolation: "step" }
        ]
      })
    ])
  ]);
  timeline.attachEffect("child", fade);
  const graph = await render(compile());
  assert.equal(graph.defs[1]!.attrs.parent, "obj_parent");
  const segments = graph.def2set.obj_child!;
  assert.ok(segments.some(s => s.delay === 1 && s.duration === 1 && numeric(s.valueEnd.x) === 25));
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
  const migrated = normalizeProjectData({
    version: 3,
    canvas: { width: 800, height: 450 },
    assets: [{ id: resource.id, type: resource.type, binId: null, danmu: resource }],
    bins: [],
    tracks: [
      track([
        Object.assign(instance("a", { startTime: 1000 }), {
          animations: [
            { id: "x", type: "set", duration: 1000, properties: { x: 250 } },
            { id: "alpha", type: "set", delay: 500, duration: 500, properties: { opacity: 0.5 } },
            { id: "hold", type: "then", duration: 100, properties: { content: "完成" } }
          ]
        })
      ])
    ]
  });
  const { timeline, compile } = setup(migrated.tracks);
  timeline.attachEffect("a", fade);
  const next = timeline.attachEffect("a", fade);
  timeline.updateEffect("a", next, fade, { percent: 50 });
  const graph = await render(compile());
  close(sample(graph, "obj_a", 1.25), 0.25);
  close(sample(graph, "obj_a", 1.8), 0.7);
  close(sample(graph, "obj_a", 2.5), 0.5);
  assert.equal(valueAt(graph, "obj_a", "x", 2), 31.25);
  assert.ok(graph.def2set.obj_a!.some(s => s.delay === 2 && s.valueEnd.content === "完成"));
});

test("composing opacity respects preceding and overlapping legacy animation groups", async () => {
  const migrated = normalizeProjectData({
    version: 3,
    canvas: { width: 800, height: 450 },
    assets: [{ id: resource.id, type: resource.type, binId: null, danmu: resource }],
    bins: [],
    tracks: [
      track([
        Object.assign(
          instance("successive", {
            startTime: 500,
            overrides: { opacity: 0.8 }
          }),
          {
            animations: [
              { id: "first", type: "set", duration: 400, properties: { opacity: 0.2, x: 120 } },
              { id: "later", type: "set", delay: 800, duration: 700, properties: { opacity: 0.8 } }
            ]
          }
        ),
        Object.assign(
          instance("overlap", {
            startTime: 500,
            overrides: { opacity: 0.8 }
          }),
          {
            animations: [
              { id: "replaced", type: "set", duration: 600, properties: { opacity: 0.2, x: 200 } },
              { id: "effective", type: "set", delay: 250, duration: 675, properties: { opacity: 0.7 } }
            ]
          }
        )
      ])
    ]
  });
  const { timeline, compile } = setup(migrated.tracks);
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
  assert.ok(graph.def2set.obj_successive!.some(s => numeric(s.valueEnd.x) === 15));
  close(sample(graph, "obj_overlap", 0.6), 0.7);
  close(sample(graph, "obj_overlap", 1.425), 0.7);
  assert.equal(valueAt(graph, "obj_overlap", "x", 1.1), 25);
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

test("round-trip renders without the original plugin and rejects invalid snapshots before reopening", async () => {
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
  invalid(effect => (effect.span = [0, 2500]));
  invalid(effect => (effect.span = [1500, 500]));
  invalid(effect => Reflect.deleteProperty(effect, "span"));
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
    [instance("layer", { trackId: "layers", keyframes: [{ id: "key", timeMs: 500, properties: { x: "3.75%" } }] })],
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
  assert.equal(reopened.version, PROJECT_VERSION);
  assert.equal(reopened.tracks[0]!.clips[0]!.kind, "group");
  assert.equal("effect" in reopened.tracks[0]!.clips[0]!, false);
  assert.equal(compileTimelineToBas(reopened.tracks, reopened.danmus), compile());
  assert.throws(() => normalizeProjectData({ ...input, version: 5 }));
});

test("dynamic effects (opacityLimit and color) act within their span while static defStyle applies to the whole clip", async () => {
  const { timeline, get, compile } = setup([track([instance("a", { startTime: 1000 })])]);
  const tint = { ...outline, id: "test.tint", params: {}, build: () => ({ color: 0x00ff00 }) };
  const fadeId = timeline.attachEffect("a", fade);
  timeline.updateEffect("a", fadeId, fade, { percent: 100 });
  const tintId = timeline.attachEffect("a", tint);
  const outlineId = timeline.attachEffect("a", outline);
  timeline.updateEffectSpan("a", fadeId, [500, 1500]);
  timeline.updateEffectSpan("a", tintId, [1000, 1500]);
  // 纯静态 defStyle（如文字描边 strokeWidth/strokeColor）在 BAS 中仅支持 def 初始化，不能缩小为局部时间段。
  assert.throws(() => timeline.updateEffectSpan("a", outlineId, [1000, 1500]));
  assert.deepEqual(
    get("a").effects!.map(effect => effect.span),
    [
      [500, 1500],
      [1000, 1500],
      [0, 2000]
    ]
  );
  const script = compile();
  assert.match(script, /strokeWidth = 2/);
  assert.doesNotMatch(script, /set obj_a \{[^}]*strokeWidth/);
  const graph = await render(script);
  for (const [time, expected] of [
    [0.9, 0],
    [1.25, 1],
    [1.49, 1],
    [1.75, 0.25],
    [2, 0.5],
    [2.25, 0.75],
    [2.75, 1]
  ])
    close(sample(graph, "obj_a", time!), expected!);
  for (const [time, color] of [
    [1.5, 0xffffff],
    [2.25, 0x00ff00],
    [2.75, 0xffffff]
  ]) {
    assert.equal(valueAt(graph, "obj_a", "color", time!), color);
  }
  timeline.updateEffectSpan("a", tintId, [0, 2000]);
  assert.match(compile(), /color = 0x00ff00/);
  assert.doesNotMatch(compile(), /set obj_a \{[^}]*color/);
});

test("clip edits keep effect durations and drop effects outside the remaining clip", () => {
  const { timeline, get } = setup([track([instance("a", { duration: 4000 })])]);
  const early = timeline.attachEffect("a", fade);
  const late = timeline.attachEffect("a", fade);
  timeline.updateEffectSpan("a", early, [0, 1000]);
  timeline.updateEffectSpan("a", late, [2000, 4000]);
  const timing = (id: string) => get(id).effects?.map(effect => [effect.span, effect.range]);
  timeline.trimClip("a", 0, 6000);
  assert.deepEqual(timing("a"), [
    [
      [0, 1000],
      [0, 1]
    ],
    [
      [2000, 4000],
      [0, 1]
    ]
  ]);
  timeline.trimClip("a", 500, 5500);
  timeline.updateClip("a", { duration: 2000 });
  assert.deepEqual(timing("a"), [
    [
      [0, 500],
      [0.5, 1]
    ],
    [
      [1500, 2000],
      [0, 0.25]
    ]
  ]);
  const right = timeline.splitClip("a", 1500);
  assert.ok(right?.kind === "resource");
  assert.deepEqual(get("a").effects!.map(effect => effect.id), [early]);
  assert.deepEqual(timing(right.id), [
    [
      [500, 1000],
      [0, 0.25]
    ]
  ]);
  assert.notEqual(right.effects![0]!.id, late);
  timeline.trimClip(right.id, 1500, 400);
  assert.equal(get(right.id).effects, undefined);
});

test("editing effect state follows the selected clip and rejects stale effect ids", () => {
  const { timeline } = setup([track([instance("a")]), track([instance("b")])]);
  const effectId = timeline.attachEffect("a", fade);

  timeline.setEditingEffect("a", effectId);
  assert.equal(timeline.editingEffect?.effect.id, effectId);

  timeline.selectedClipId = "b";
  assert.equal(timeline.editingEffect, null);

  timeline.setEditingEffect("a", effectId);
  timeline.setEditingEffect("a", "missing-effect");
  assert.equal(timeline.editingEffect?.effect.id, effectId);

  timeline.setEditingEffect("a", null);
  assert.equal(timeline.editingEffect, null);
});

test("effect spans are validated and cannot fight host keyframes over animated color, while static defStyle coexists", () => {
  const { timeline, get, compile } = setup([
    track([instance("a", { keyframes: [{ id: "k", timeMs: 1000, properties: { color: 0xff0000 } }] })])
  ]);
  const tint = { ...outline, id: "test.tint", params: {}, build: () => ({ color: 0x00ff00 }) };
  const id = timeline.attachEffect("a", tint);
  assert.doesNotThrow(compile);
  for (const span of [
    [-1, 500],
    [0, 2001],
    [800, 400],
    [500, 500]
  ] as [number, number][])
    assert.throws(() => timeline.updateEffectSpan("a", id, span));
  assert.throws(() => timeline.updateEffectSpan("a", id, [0, 1000]), /color/);
  assert.deepEqual(get("a").effects![0]!.span, [0, 2000]);
  const outlineId = timeline.attachEffect("a", outline);
  assert.throws(() => timeline.updateEffectSpan("a", outlineId, [0, 1000]));
  assert.doesNotThrow(compile);
});

test("v5 projects migrate effects to spans covering the whole clip", () => {
  const { timeline, disk, compile } = setup();
  timeline.attachEffect("a", fade);
  const expected = compile();
  const data = disk();
  data.version = 5;
  delete (data.tracks[0]!.clips[0]!.effects![0]! as Partial<EffectInstance>).span;
  const reopened = normalizeProjectData(structuredClone(data));
  assert.equal(reopened.version, PROJECT_VERSION);
  assert.deepEqual(reopened.tracks[0]!.clips[0]!.effects![0]!.span, [0, 2000]);
  assert.equal(compileTimelineToBas(reopened.tracks, reopened.danmus), expected);
  (data.tracks[0]!.clips[0]!.effects![0]! as EffectInstance).span = [0, 2000];
  assert.throws(() => normalizeProjectData(data));
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

test("getEffectiveDanmuAtTime reflects attached clip effects (defStyle, color, and opacityLimit)", () => {
  const { timeline, get } = setup([track([instance("a", { startTime: 1000, duration: 2000 })])]);
  const fadeId = timeline.attachEffect("a", fade);
  timeline.updateEffect("a", fadeId, fade, { percent: 100 });
  timeline.updateEffectSpan("a", fadeId, [0, 1000]);
  timeline.attachEffect("a", outline);
  const tint = { ...outline, id: "test.tint", params: {}, build: () => ({ color: 0x00ff00 }) };
  const tintId = timeline.attachEffect("a", tint);
  timeline.updateEffectSpan("a", tintId, [500, 1500]);

  const clip = get("a");
  const at1250 = getEffectiveDanmuAtTime(resource, clip, 1250);
  assert.equal(at1250.type, "text");
  if (at1250.type === "text") {
    close(at1250.opacity ?? 1, 0.25);
    assert.equal(at1250.strokeWidth, 2);
    assert.equal(at1250.strokeColor, 0x334155);
    assert.equal(at1250.color, 0xffffff);
  }
  const at1750 = getEffectiveDanmuAtTime(resource, clip, 1750);
  if (at1750.type === "text") {
    close(at1750.opacity ?? 1, 0.75);
    assert.equal(at1750.color, 0x00ff00);
    assert.equal(at1750.strokeWidth, 2);
  }
});
