import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { AnyDanmu } from "../src/types/danmu";
import type { TimelineTrack } from "../src/types/timeline";
import { convertParsedBas } from "../src/utils/basImport";
import { compileTimelineToBas } from "../src/utils/compiler";
import { parseBas } from "./helpers/basParser";
import { assertGolden, stabilizeImport, toGoldenJson } from "./helpers/golden";

type CompilerFixture = { danmus: AnyDanmu[]; tracks: TimelineTrack[] };

const fixtureDir = path.resolve(import.meta.dirname, "fixtures/compiler");
const fixtureNames = fs
  .readdirSync(fixtureDir)
  .filter((file) => file.endsWith(".json") && !file.endsWith(".import.json"))
  .map((file) => file.slice(0, -".json".length))
  .sort();

const readFixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(fixtureDir, `${name}.json`), "utf8")) as CompilerFixture;

for (const name of fixtureNames) {
  test(`compiler golden: ${name}`, () => {
    const fixture = readFixture(name);
    const code = compileTimelineToBas(fixture.tracks, fixture.danmus, { audioResourceIds: ["audio_1"] });
    assertGolden(path.join(fixtureDir, `${name}.bas`), code);

    // 编译结果必须能被真实 bas.js 解析，并且能经导入链路还原为对象。
    const imported = convertParsedBas(parseBas(code));
    assertGolden(path.join(fixtureDir, `${name}.import.json`), toGoldenJson(stabilizeImport(imported)));
  });
}

test("compiler: mixing keyframes and legacy animations is rejected", () => {
  const fixture = readFixture("keyframes");
  const clip = fixture.tracks[0]!.clips[0]!;
  assert.equal(clip.kind, "resource");
  if (clip.kind !== "resource") return;
  clip.animations = [{ id: "a1", type: "set", duration: 100, properties: { x: 1 } }];
  assert.throws(() => compileTimelineToBas(fixture.tracks, fixture.danmus), /mixes keyframes and legacy animations/);
});

test("compiler: per-clip errors are reported through onError without dropping other clips", () => {
  const fixture = readFixture("button-and-path");
  const errors: string[] = [];
  const code = compileTimelineToBas(fixture.tracks, fixture.danmus.slice(1), { onError: (message) => errors.push(message) });
  assert.deepEqual(errors, ["Clip cb: Missing resource for clip cb"]);
  assert.match(code, /def path obj_cp/);
});

test("compiler: onRange line numbers point at each clip's code", () => {
  const fixture = readFixture("button-and-path");
  const ranges: Array<{ clipId: string; startLine: number; endLine: number }> = [];
  const code = compileTimelineToBas(fixture.tracks, fixture.danmus, {
    onRange: (clipId, startLine, endLine) => ranges.push({ clipId, startLine, endLine })
  });
  const lines = code.split("\n");
  for (const range of ranges) {
    assert.match(lines[range.startLine - 1]!, new RegExp(`^def \\w+ obj_${range.clipId} \\{$`));
  }
  assert.deepEqual(
    ranges.map((range) => range.clipId),
    ["cb", "cp"]
  );
});
