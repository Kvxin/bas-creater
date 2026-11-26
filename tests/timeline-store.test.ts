import test from "node:test";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import type { TimelineClip, TimelineGroupClip, TimelineResourceClip, TimelineTrack } from "../src/types/timeline";
import type { BasImportObject } from "../src/core/basImport";
import { BASE_KEYFRAME_ID } from "../src/core/keyframes";
import { i18n } from "../src/i18n";
import { useAssetsStore } from "../src/stores/assets";
import { useAudioStore } from "../src/stores/audio";
import { useDanmuStore } from "../src/stores/danmu";
import { useTimelineStore } from "../src/stores/timeline";

const setup = () => {
  setActivePinia(createPinia());
  const assets = useAssetsStore();
  assets.upsertAsset({ id: "text", type: "text", binId: null, danmu: { id: "text", type: "text", content: "hello" } });
  return { timeline: useTimelineStore(), danmu: useDanmuStore(), audio: useAudioStore() };
};

const track = (id: string, clips: TimelineClip[] = [], extra: Partial<TimelineTrack> = {}): TimelineTrack => ({
  id, name: id, type: clips.length ? "danmu" : undefined, visible: true, muted: false, locked: false, clips, ...extra
});

const textClip = (id: string, trackId: string, startTime: number, extra: Partial<TimelineResourceClip> = {}): TimelineResourceClip => ({
  id, kind: "resource", resourceId: "text", trackId, startTime, duration: 1000, keyframes: [], ...extra
});

const group = (id: string, trackId: string, startTime: number, tracks: TimelineTrack[]): TimelineGroupClip => ({
  kind: "group", id, trackId, startTime, duration: 1000, tracks
});

const allIds = (clip: TimelineClip): string[] =>
  clip.kind === "group" ? [clip.id, ...clip.tracks.flatMap((item) => [item.id, ...item.clips.flatMap(allIds)])] : [clip.id];

test("addClip types empty tracks, rejects mismatched resources, and removing the last clip clears the type", () => {
  const { timeline, danmu, audio } = setup();
  audio.add({ id: "audio", type: "audio-file", name: "a.wav", url: "blob:a", file: new File(["a"], "a.wav"), duration: 3000 });
  timeline.loadTimeline([track("t")]);
  const clip = timeline.addClip(danmu.danmus[0]!, "t", 500)!;
  const target = timeline.tracks[0]!;
  assert.equal(target.type, "danmu");
  assert.deepEqual([clip.startTime, clip.duration], [500, 5000]);
  assert.equal(timeline.selectedClipId, clip.id);
  assert.equal(timeline.selectedKeyframeId, BASE_KEYFRAME_ID);
  assert.equal(danmu.selectedId, "text");
  assert.equal(timeline.addClip(audio.audioResources[0]!, "t", 0), undefined);
  assert.equal(target.clips.length, 1);
  timeline.removeClip(clip.id);
  assert.equal(target.type, undefined);
  assert.equal(timeline.selectedClipId, null);
});

test("moveClipToTrack only moves between compatible unlocked tracks", () => {
  const { timeline } = setup();
  timeline.loadTimeline([track("a", [textClip("c", "a", 0)]), track("b"), track("au", [], { type: "audio" })]);
  assert.equal(timeline.moveClipToTrack("c", "au"), false);
  assert.equal(timeline.moveClipToTrack("c", "b", { startTime: 200 }), true);
  const [a, b] = timeline.tracks;
  assert.equal(a!.type, undefined);
  assert.equal(b!.type, "danmu");
  assert.deepEqual([b!.clips[0]!.trackId, b!.clips[0]!.startTime], ["b", 200]);
  a!.locked = true;
  assert.equal(timeline.moveClipToTrack("c", "a"), false);
});

test("copyClipToTrack and clipboard paste clone nested groups with fresh ids and remapped parents", () => {
  const { timeline } = setup();
  const inner = track("inner", [textClip("p", "inner", 0), textClip("ch", "inner", 0, { parentClipId: "p" })]);
  timeline.loadTimeline([track("root", [group("g", "root", 0, [inner])]), track("empty")]);
  const source = timeline.tracks[0]!.clips[0]!;
  const sourceIds = allIds(source);

  const copy = timeline.copyClipToTrack("g", "root", { startTime: 2000 }) as TimelineGroupClip;
  assert.equal(copy.startTime, 2000);
  assert.ok(allIds(copy).every((id) => !sourceIds.includes(id)));
  const [copiedParent, copiedChild] = copy.tracks[0]!.clips as TimelineResourceClip[];
  assert.equal(copiedChild!.parentClipId, copiedParent!.id);
  assert.deepEqual(allIds(source), sourceIds);

  timeline.copyClipToClipboard(source);
  assert.equal(timeline.hasClipboardClip(), true);
  const pasted = timeline.pasteClipFromClipboard("empty", 300)!;
  assert.equal(pasted.startTime, 300);
  assert.equal(timeline.tracks[1]!.type, "danmu");
  assert.equal(timeline.selectedClipId, pasted.id);
  assert.ok(allIds(pasted).every((id) => !sourceIds.includes(id)));
  timeline.clearClipboard();
  assert.equal(timeline.pasteClipFromClipboard("empty", 0), null);
});

test("createGroup and ungroupClip round-trip keeps absolute times", () => {
  const { timeline } = setup();
  timeline.loadTimeline([track("a", [textClip("c1", "a", 1000)]), track("b", [textClip("c2", "b", 3000)])]);
  timeline.setSelectedClips(["c1", "c2", "missing"]);
  assert.deepEqual(timeline.selectedClipIds, ["c1", "c2"]);
  assert.equal(timeline.canCreateGroup(), true);
  const created = timeline.createGroup()!;
  assert.equal(created.name, i18n.global.t("groups.defaultName", { n: 1 }));
  assert.deepEqual([created.startTime, created.duration], [1000, 3000]);
  assert.equal(timeline.tracks.length, 1);
  assert.deepEqual(created.tracks.map((item) => item.clips[0]!.startTime), [0, 2000]);
  assert.equal(timeline.selectedClipId, created.id);

  assert.equal(timeline.ungroupClip(created.id), true);
  assert.deepEqual(timeline.tracks.map((item) => item.clips[0]!.startTime), [1000, 3000]);
  assert.deepEqual(timeline.selectedClipIds, ["c1", "c2"]);
});

test("moving or copying a clip into a later group shifts the group to keep absolute times", () => {
  const { timeline } = setup();
  timeline.loadTimeline([
    track("r", [group("g", "r", 2000, [track("inner", [textClip("ic", "inner", 0)])])]),
    track("s", [textClip("c1", "s", 500)]),
    track("s2", [textClip("c2", "s2", 3000)])
  ]);
  assert.equal(timeline.canMoveClipIntoGroup("g", "g"), false);
  assert.equal(timeline.moveClipIntoGroup("c1", "g"), true);
  const target = timeline.tracks[0]!.clips[0] as TimelineGroupClip;
  assert.equal(target.startTime, 500);
  assert.equal(target.tracks[0]!.clips[0]!.startTime, 1500);
  assert.deepEqual([target.tracks[1]!.clips[0]!.id, target.tracks[1]!.clips[0]!.startTime], ["c1", 0]);
  assert.equal(timeline.tracks[1]!.type, undefined);

  assert.equal(timeline.copyClipIntoGroup("c2", "g"), true);
  const copied = target.tracks[2]!.clips[0]!;
  assert.notEqual(copied.id, "c2");
  assert.equal(copied.startTime, 2500);
  assert.equal(timeline.tracks[2]!.clips[0]!.id, "c2");
  assert.equal(timeline.selectedClipId, "g");
});

test("entering and leaving a group converts the playhead between local and parent time", () => {
  const { timeline } = setup();
  timeline.loadTimeline([track("r", [group("g", "r", 2000, [track("inner", [textClip("ic", "inner", 0)])])])]);
  timeline.setCurrentTime(2500);
  timeline.enterGroup("g");
  assert.deepEqual(timeline.activeGroupPath, ["g"]);
  assert.equal(timeline.currentTime, 500);
  assert.equal(timeline.tracks[0]!.id, "inner");
  timeline.setCurrentTime(700);
  timeline.leaveGroup();
  assert.deepEqual(timeline.activeGroupPath, []);
  assert.equal(timeline.currentTime, 2700);
  assert.equal(timeline.selectedClipId, "g");
});

test("keyframe edits clamp times, merge nearby keyframes, and keep the base keyframe selected", () => {
  const { timeline } = setup();
  timeline.loadTimeline([track("t", [textClip("c", "t", 0)])]);
  const clip = () => timeline.tracks[0]!.clips[0] as TimelineResourceClip;
  assert.equal(timeline.addClipKeyframe("c", { timeMs: 0, properties: { x: "10%" } }), null);
  assert.equal(timeline.selectedKeyframeId, BASE_KEYFRAME_ID);
  const first = timeline.addClipKeyframe("c", { timeMs: 500, properties: { x: "10%" } })!;
  assert.equal(first.interpolation, "linear");
  assert.equal(timeline.selectedKeyframeId, first.id);
  assert.equal(timeline.upsertClipKeyframeAtTime("c", 510, { y: "5%" })!.id, first.id);
  assert.deepEqual(clip().keyframes![0]!.properties, { x: "10%", y: "5%" });
  const second = timeline.upsertClipKeyframeAtTime("c", 800, { x: "20%" })!;
  assert.equal(clip().keyframes!.length, 2);
  timeline.updateClipKeyframe("c", first.id, { timeMs: 0 });
  assert.equal(clip().keyframes![0]!.timeMs, 1);
  timeline.removeClipKeyframe("c", second.id);
  assert.equal(clip().keyframes!.length, 1);
  assert.equal(timeline.selectedKeyframeId, BASE_KEYFRAME_ID);
});

test("preview overlay changes effective params until committed", () => {
  const { timeline } = setup();
  const audioClip: TimelineResourceClip = { ...textClip("ac", "au", 0), resourceId: "audio", params: { volume: 0, muted: false } };
  timeline.loadTimeline([track("au", [audioClip], { type: "audio" })]);
  const clip = timeline.tracks[0]!.clips[0]!;
  timeline.previewClipParams("ac", { volume: -6 });
  assert.equal(timeline.getEffectiveVolume(clip), -6);
  assert.equal(clip.params?.volume, 0);
  timeline.discardPreview();
  assert.equal(timeline.getEffectiveVolume(clip), 0);
  timeline.previewClipParams("ac", { volume: -6 });
  timeline.commitPreview();
  assert.equal(clip.params?.volume, -6);
  timeline.toggleClipMuted("ac");
  assert.equal(timeline.isClipMuted(clip), true);
});

test("splitClipLeft and splitClipRight keep the requested half selected", () => {
  const { timeline } = setup();
  timeline.loadTimeline([track("t", [textClip("l", "t", 0), textClip("r", "t", 2000)])]);
  const left = timeline.splitClipRight("l", 400)!;
  assert.deepEqual([left.id, left.duration], ["l", 400]);
  assert.equal(timeline.selectedClipId, "l");
  const right = timeline.splitClipLeft("r", 2400)!;
  assert.deepEqual([right.startTime, right.duration], [2400, 600]);
  assert.deepEqual(timeline.tracks[0]!.clips.map((clip) => clip.id), ["l", right.id]);
});

const basObject = (name: string, extra: Partial<BasImportObject> = {}): BasImportObject => ({
  name, resource: { type: "text", content: name }, durationMs: 1000, keyframes: [], ...extra
});

test("importBasObjects groups multiple objects, links parents, and rolls back on failure", () => {
  const { timeline, danmu } = setup();
  timeline.loadTimeline([track("t")]);
  const result = timeline.importBasObjects([basObject("a"), basObject("b", { durationMs: 2000, parentName: "a" })], {
    createTrack: true,
    startTimeMs: 500
  });
  const imported = timeline.tracks[1]!.clips[0] as TimelineGroupClip;
  assert.equal(result.groupClipId, imported.id);
  assert.equal(imported.name, i18n.global.t("dialogs.basImport.groupName", { n: 1 }));
  assert.deepEqual([imported.startTime, imported.duration], [500, 2000]);
  const [a, b] = imported.tracks.map((item) => item.clips[0] as TimelineResourceClip);
  assert.equal(b!.parentClipId, a!.id);
  assert.equal(danmu.danmus.length, 3);

  const before = JSON.stringify(timeline.rootTracks);
  const button = basObject("btn", { resource: { type: "button", text: "x" } });
  assert.throws(() => timeline.importBasObjects([button, basObject("c", { parentName: "btn" })], { createTrack: true }));
  assert.equal(JSON.stringify(timeline.rootTracks), before);
  assert.equal(danmu.danmus.length, 3);

  const single = timeline.importBasObjects([basObject("solo")], { trackId: "t", startTimeMs: 250 });
  assert.equal(single.groupClipId, null);
  assert.deepEqual([timeline.tracks[0]!.type, timeline.tracks[0]!.clips[0]!.startTime], ["danmu", 250]);
});

test("disposing timeline drag and playhead scopes cancels active drags without committing on mouseup", async () => {
  const { computed, effectScope, ref } = await import("vue");
  const { useTimelineInteractions } = await import("../src/composables/useTimelineInteractions");
  const { useTimelinePlayhead } = await import("../src/composables/useTimelinePlayhead");

  const listeners = new Map<string, Set<(event: any) => void>>();
  const stubWindow = {
    innerWidth: 1200,
    addEventListener(type: string, fn: (event: any) => void) {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener(type: string, fn: (event: any) => void) {
      listeners.get(type)?.delete(fn);
    }
  };
  const stubDocument = {
    body: { style: { cursor: "" } },
    elementFromPoint: () => null,
    elementsFromPoint: () => []
  };
  const prevWindow = (globalThis as any).window;
  const prevDocument = (globalThis as any).document;
  (globalThis as any).window = stubWindow;
  (globalThis as any).document = stubDocument;

  const dispatch = (type: string, event: Record<string, unknown> = {}) => {
    for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
  };

  try {
    const { timeline, danmu, audio } = setup();
    const initialClip: TimelineResourceClip = {
      ...textClip("c1", "t", 0, 1000),
      keyframes: [{ id: "kf1", timeMs: 200, interpolation: "linear", properties: { x: "10%" } }]
    };
    timeline.loadTimeline([track("t", [initialClip])]);

    const scope = effectScope();
    const api = scope.run(() => {
      const pixelsPerSecond = ref(100);
      const scrollLeft = ref(0);
      const editingGroupId = ref<string | null>(null);
      const timelineContentRef = ref<HTMLElement | null>({
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 300 })
      } as unknown as HTMLElement);

      const interactions = useTimelineInteractions({
        timelineStore: timeline,
        danmuStore: danmu,
        audioStore: audio,
        pixelsPerSecond,
        editingGroupId,
        getTrackType: (t) => t.type ?? null,
        getClipTimelineType: () => "danmu"
      });
      const playhead = useTimelinePlayhead({
        tracks: computed(() => timeline.tracks),
        duration: computed(() => timeline.duration),
        currentTime: computed(() => timeline.currentTime),
        pixelsPerSecond,
        scrollLeft,
        timelineContentRef,
        setCurrentTime: (ms) => timeline.setCurrentTime(ms),
        translate: (k) => k
      });
      return { interactions, playhead };
    })!;

    const clip = timeline.tracks[0]!.clips[0] as TimelineResourceClip;
    const mouseEvent = (clientX: number) =>
      ({
        button: 0,
        clientX,
        clientY: 10,
        target: { dataset: {} },
        stopPropagation() {},
        preventDefault() {}
      }) as unknown as MouseEvent;

    // 启动片段拖拽、拉伸、关键帧拖拽与播放头拖拽
    api.interactions.startDragClip(mouseEvent(0), clip);
    dispatch("mousemove", { clientX: 50, clientY: 10, altKey: false });
    assert.equal(api.interactions.tempState.startTime, 500);

    api.interactions.startResizeClip(mouseEvent(0), clip, "right");
    dispatch("mousemove", { clientX: 80, clientY: 10 });

    api.interactions.startDragKeyframe(mouseEvent(0), clip, { id: "kf1", timeMs: 200, isBase: false });
    dispatch("mousemove", { clientX: 40, clientY: 10 });

    api.playhead.startDragPlayhead(mouseEvent(0));

    // 先卸载作用域，再触发 mouseup
    scope.stop();
    assert.equal(stubDocument.body.style.cursor, "");
    assert.equal(listeners.get("mousemove")?.size ?? 0, 0);
    assert.equal(listeners.get("mouseup")?.size ?? 0, 0);

    dispatch("mouseup", { clientX: 50, clientY: 10 });

    const afterClip = timeline.tracks[0]!.clips[0] as TimelineResourceClip;
    assert.equal(afterClip.startTime, 0);
    assert.equal(afterClip.duration, 1000);
    assert.equal(afterClip.keyframes?.[0]?.timeMs, 200);
  } finally {
    (globalThis as any).window = prevWindow;
    (globalThis as any).document = prevDocument;
  }
});

test("frame timecode and stepFrameTimeMs round-trip across 30fps and 60fps without truncation drift", async () => {
  const { formatFrameTimecode, stepFrameTimeMs } = await import("../src/core/timeline");

  for (const fps of [24, 25, 30, 60]) {
    let timeMs = 0;
    for (let frame = 0; frame < fps * 2; frame += 1) {
      const sec = Math.floor(frame / fps);
      const rem = frame % fps;
      const expected = `00:${String(sec).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
      assert.equal(formatFrameTimecode(timeMs, fps), expected);
      timeMs = stepFrameTimeMs(timeMs, 1, fps, 10000);
    }
  }

  // 从两帧中间位置（112ms @ 30fps，位于第 3 帧 100ms 与第 4 帧 133.3ms 之间）步进先对齐紧邻帧边界
  assert.equal(stepFrameTimeMs(112, 1, 30, 5000), 133.3);
  assert.equal(stepFrameTimeMs(112, -1, 30, 5000), 100);
});

test("frame & millisecond ruler ticks, frame grid snapping, Shift bypass, and clip-end magnetic snapping", async () => {
  const {
    collectTimelineSnapCandidates,
    getRulerTicks,
    resolveTimelineSnap
  } = await import("../src/core/timeline");

  const frameTicks = getRulerTicks({
    startTimeMs: 0,
    endTimeMs: 1000,
    scale: 120, // 240px/s -> 1 frame @ 30fps = 8px >= 7px
    mode: "frames",
    fps: 30
  });
  const majorFrameLabels = frameTicks.filter((tick) => tick.kind === "major").map((tick) => tick.label);
  assert.deepEqual(majorFrameLabels, ["00:00:00", "00:01:00"]);
  assert.equal(frameTicks.some((tick) => tick.kind === "minor"), true);

  const msTicks = getRulerTicks({
    startTimeMs: 0,
    endTimeMs: 1000,
    scale: 100,
    mode: "milliseconds"
  });
  assert.deepEqual(
    msTicks.filter((tick) => tick.kind === "major").map((tick) => tick.label),
    ["00:00.000", "00:01.000"]
  );

  // 帧网格吸附 & Shift 临时旁路
  const frameSnap = resolveTimelineSnap(31, {
    pixelsPerSecond: 200,
    mode: "frames",
    fps: 30,
    snapEnabled: true
  });
  assert.deepEqual(frameSnap, { timeMs: 33.3, kind: "frame" });
  assert.deepEqual(
    resolveTimelineSnap(31, {
      pixelsPerSecond: 200,
      mode: "frames",
      fps: 30,
      snapEnabled: true,
      disableSnap: true
    }),
    { timeMs: 31, kind: null }
  );

  // 语义候选（标记点）优先于帧网格，且支持片段尾部吸附到标记点
  const candidates = collectTimelineSnapCandidates({
    tracks: [],
    markers: [{ id: "m1", timeMs: 1500 }]
  });
  const endSnapped = resolveTimelineSnap(985, {
    candidates,
    pixelsPerSecond: 200, // threshold 6px = 30ms; 985 + 500 = 1485 is 15ms from 1500
    mode: "frames",
    fps: 30,
    snapEnabled: true,
    clipDurationMs: 500
  });
  assert.deepEqual(endSnapped, { timeMs: 1000, kind: "marker" });
});

test("60fps consecutive single-frame keyframes, sub-frame splits, and timeline markers inside nested groups", async () => {
  const { compileTimelineToBas } = await import("../src/core/compiler");
  const { parseBas } = await import("./helpers/basParser");
  const { timeline, danmu } = setup();

  timeline.loadTimeline([track("t", [textClip("c", "t", 0, { duration: 1000 })])], { fps: 60 });
  assert.equal(timeline.fps, 60);

  // 60fps 下相邻三帧（16.7ms、33.3ms、50ms）各自独立保存，不会被合并容差吞掉
  timeline.stepFrames(1);
  assert.equal(timeline.currentTime, 16.7);
  const kf1 = timeline.upsertClipKeyframeAtTime("c", timeline.currentTime, { x: "10%" })!;
  timeline.stepFrames(1);
  assert.equal(timeline.currentTime, 33.3);
  const kf2 = timeline.upsertClipKeyframeAtTime("c", timeline.currentTime, { x: "20%" })!;
  timeline.stepFrames(1);
  assert.equal(timeline.currentTime, 50);
  const kf3 = timeline.upsertClipKeyframeAtTime("c", timeline.currentTime, { x: "30%" })!;
  assert.notEqual(kf1.id, kf2.id);
  assert.notEqual(kf2.id, kf3.id);

  // 编译为 BAS 并经真实 bas.js 解析器验证
  const compiled = compileTimelineToBas(timeline.rootTracks, danmu.danmus);
  const parsed = parseBas(compiled);
  assert.equal(parsed.defs.length, 1);

  // 在 16.7ms 帧边界分割片段保留 0.1ms 精度
  const right = timeline.splitClip("c", 16.7)!;
  const left = timeline.tracks[0]!.clips[0]!;
  assert.deepEqual([left.duration, right.startTime, right.duration], [16.7, 16.7, 983.3]);

  // 根时间轴标记点在进入嵌套分组后自动映射为局部时间，并支持按局部游标增删与跳转
  timeline.loadTimeline([track("r", [group("g", "r", 2000, [track("in", [textClip("ic", "in", 0)])])])]);
  timeline.addMarker(2250, "Marker 1");
  timeline.addMarker(2750, "Marker 2");
  timeline.enterGroup("g");
  assert.deepEqual(
    timeline.markers.map((marker) => marker.timeMs),
    [250, 750]
  );
  assert.equal(timeline.seekToAdjacentMarker(1), true);
  assert.equal(timeline.currentTime, 250);
  assert.equal(timeline.toggleMarkerAtCurrentTime().action, "removed");
  assert.deepEqual(
    timeline.rootMarkers.map((marker) => marker.timeMs),
    [2750]
  );
});

test("non-destructive trim preserves out-of-bounds keyframes, shifts left trims, compiles to BAS, and round-trips schema", async () => {
  const { compileTimelineToBas } = await import("../src/core/compiler");
  const { getEffectiveDanmuAtTime } = await import("../src/core/keyframes");
  const { normalizeProjectData, serializeProjectData, PROJECT_VERSION } = await import("../src/core/projectSchema");
  const { parseBas } = await import("./helpers/basParser");

  const { timeline, danmu } = setup();
  const baseText = danmu.danmus.find((item) => item.id === "text")!;
  const initialClip: TimelineResourceClip = {
    ...textClip("c", "t", 1000, { duration: 5000 }),
    overrides: { x: "0%" },
    keyframes: [
      { id: "kf_2s", timeMs: 2000, interpolation: "linear", properties: { x: "100%" } },
      { id: "kf_3s", timeMs: 3000, interpolation: "linear", properties: { y: "50%" } }
    ]
  };
  timeline.loadTimeline([track("t", [initialClip])]);
  const clip = () => timeline.tracks[0]!.clips[0] as TimelineResourceClip;

  // 1. 5s 缩到 1s：关键帧保留原位（不 clamp、不堆叠），1s 处保持原速走到 50%
  timeline.trimClip("c", 1000, 1000);
  assert.deepEqual(
    clip().keyframes!.map((kf) => kf.timeMs),
    [2000, 3000]
  );
  assert.equal(getEffectiveDanmuAtTime(baseText, clip(), 2000).x, "50%");

  const shortBas = compileTimelineToBas(timeline.rootTracks, danmu.danmus);
  assert.match(shortBas, /x = 50%/);
  assert.equal(parseBas(shortBas).defs.length, 1);

  // 拉回 10s：原本在 2s 和 3s 的关键帧完好恢复，且不再堆叠
  timeline.trimClip("c", 1000, 10000);
  assert.deepEqual(
    clip().keyframes!.map((kf) => kf.timeMs),
    [2000, 3000]
  );
  assert.equal(getEffectiveDanmuAtTime(baseText, clip(), 3000).x, "100%");
  assert.equal(getEffectiveDanmuAtTime(baseText, clip(), 11000).x, "100%");

  // 2. 左边缘向内裁剪 +1s（start 1000 -> 2000, duration 10000 -> 9000）：
  //    baseKeyframeTimeMs 变为 -1000，关键帧平移为 1000 和 2000，绝对时间轴位置保持 3000 和 4000 不动
  timeline.trimClip("c", 2000, 9000);
  assert.equal(clip().baseKeyframeTimeMs, -1000);
  assert.deepEqual(
    clip().keyframes!.map((kf) => kf.timeMs),
    [1000, 2000]
  );
  assert.equal(getEffectiveDanmuAtTime(baseText, clip(), 2000).x, "50%");
  assert.equal(getEffectiveDanmuAtTime(baseText, clip(), 3000).x, "100%");

  const leftTrimmedBas = compileTimelineToBas(timeline.rootTracks, danmu.danmus);
  assert.match(leftTrimmedBas, /x = 50%/);
  assert.match(leftTrimmedBas, /x = 100%/);
  assert.equal(parseBas(leftTrimmedBas).defs.length, 1);

  // 持久化 schema 支持负关键帧时间与 baseKeyframeTimeMs 往返校验
  const project = serializeProjectData({
    version: PROJECT_VERSION,
    id: "proj_trim",
    name: "TrimTest",
    createdAt: 1,
    updatedAt: 1,
    canvas: { width: 800, height: 450 },
    assets: [{ id: baseText.id, type: baseText.type, binId: null, danmu: baseText }],
    bins: [],
    danmus: [baseText],
    audioMeta: [],
    tracks: timeline.rootTracks,
    timeline: { duration: timeline.duration }
  });
  const restored = normalizeProjectData(project);
  const restoredClip = restored.tracks[0]!.clips[0] as TimelineResourceClip;
  assert.equal(restoredClip.baseKeyframeTimeMs, -1000);
  assert.deepEqual(
    restoredClip.keyframes!.map((kf) => kf.timeMs),
    [1000, 2000]
  );

  // 3. 左边缘向外拉回原起点 1000，再继续向左扩展到 500：无损还原并正确产生 +500ms 前置保持段
  timeline.trimClip("c", 1000, 10000);
  assert.equal(clip().baseKeyframeTimeMs, undefined);
  assert.deepEqual(
    clip().keyframes!.map((kf) => kf.timeMs),
    [2000, 3000]
  );

  timeline.trimClip("c", 500, 10500);
  assert.equal(clip().baseKeyframeTimeMs, 500);
  assert.deepEqual(
    clip().keyframes!.map((kf) => kf.timeMs),
    [2500, 3500]
  );
  assert.equal(getEffectiveDanmuAtTime(baseText, clip(), 750).x, "0%");
  assert.equal(getEffectiveDanmuAtTime(baseText, clip(), 2000).x, "50%");

  const leftExtendedBas = compileTimelineToBas(timeline.rootTracks, danmu.danmus);
  assert.equal(parseBas(leftExtendedBas).defs.length, 1);
  // 0.5s 延时进场 + 0.5s 保持基础帧，随后 2s 动画到 100%
  assert.match(leftExtendedBas, /then set obj_c \{\} 0\.5s/);
  assert.match(leftExtendedBas, /then set obj_c \{ x = 100% \} 2s/);

  // 在左扩展片段的前置保持段（绝对时间 700ms，即局部 200ms < baseKeyframeTimeMs 500ms）分割
  const rightHalf = timeline.splitClip("c", 700) as TimelineResourceClip;
  assert.equal(rightHalf.baseKeyframeTimeMs, 300);
  assert.deepEqual(
    rightHalf.keyframes!.map((kf) => kf.timeMs),
    [2300, 3300]
  );
});
