import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { normalizeProjectData } from "../src/services/storage/projectSchema";
import { compileTimelineToBas } from "../src/utils/compiler";
import { parseBas } from "./helpers/basParser";

const fixtureDir = path.join(import.meta.dirname, "fixtures/migration");
const fixtures = fs
  .readdirSync(fixtureDir)
  .filter((name) => name.endsWith(".json") && !name.endsWith(".expected.json"))
  .map((name) => name.slice(0, -".json".length))
  .sort();

const toV3Project = (fixture: { danmu: { id: string; type: string }; duration: number; animations: unknown[] }) => ({
  version: 3,
  id: "project",
  name: "Project",
  createdAt: 1,
  updatedAt: 1,
  canvas: { width: 800, height: 450 },
  assets: [{ id: fixture.danmu.id, type: fixture.danmu.type, binId: null, danmu: fixture.danmu }],
  bins: [],
  tracks: [
    {
      id: "track",
      name: "Track",
      visible: true,
      locked: false,
      clips: [
        {
          id: "clip",
          kind: "resource",
          resourceId: fixture.danmu.id,
          trackId: "track",
          startTime: 0,
          duration: fixture.duration,
          animations: fixture.animations
        }
      ]
    }
  ]
});

// `*.expected.json` 由旧编译器输出的 BAS 经真实 bas.js 解析、再导入为关键帧得到，迁移结果必须与之一致。
for (const name of fixtures) {
  test(`legacy animations migrate to the keyframes their compiled BAS imports as: ${name}`, () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, `${name}.json`), "utf8"));
    const expected = JSON.parse(fs.readFileSync(path.join(fixtureDir, `${name}.expected.json`), "utf8"));
    const project = normalizeProjectData(toV3Project(fixture));
    const clip = project.tracks[0]!.clips[0]!;
    assert.equal(project.version, 4);
    assert.ok(clip.kind === "resource");
    assert.equal("animations" in clip, false);
    assert.deepEqual(
      clip.keyframes?.map(({ id: _id, ...keyframe }) => keyframe),
      expected.keyframes
    );
    assert.doesNotThrow(() => parseBas(compileTimelineToBas(project.tracks, project.danmus)));
  });
}

test("migration rejects legacy properties that keyframes cannot represent and leaves the input untouched", () => {
  const fixture = {
    danmu: { id: "t1", type: "text", content: "a" },
    duration: 2000,
    animations: [{ id: "a1", type: "set", duration: 500, delay: 200, properties: { strokeWidth: 3 } }]
  };
  const source = toV3Project(fixture);
  const original = JSON.stringify(source);
  assert.throws(() => normalizeProjectData(source), /clip.*strokeWidth/);
  assert.equal(JSON.stringify(source), original);
});

test("a non-animatable property set once at the clip start becomes a clip override", () => {
  const project = normalizeProjectData(
    toV3Project({
      danmu: { id: "t1", type: "text", content: "a" },
      duration: 2000,
      animations: [{ id: "a1", type: "set", duration: 0, properties: { bold: 0, x: 10 } }]
    })
  );
  const clip = project.tracks[0]!.clips[0]!;
  assert.ok(clip.kind === "resource");
  assert.deepEqual(clip.overrides, { bold: 0 });
  assert.deepEqual(
    clip.keyframes?.map((keyframe) => [keyframe.timeMs, keyframe.properties]),
    [[0, { x: 10 }]]
  );
});

test("v4 projects can no longer contain legacy animations", () => {
  const source = toV3Project({ danmu: { id: "t1", type: "text" }, duration: 1000, animations: [] });
  assert.throws(() => normalizeProjectData({ ...source, version: 4 }), /Legacy animations/);
  const project = normalizeProjectData(source);
  assert.equal("animations" in project.tracks[0]!.clips[0]!, false);
});
