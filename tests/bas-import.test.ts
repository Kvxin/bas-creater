import test from "node:test";
import assert from "node:assert/strict";
import type { TextDanmu } from "../src/types/danmu";
import type { BasParseResult } from "../src/utils/bas";
import type { TimelineResourceClip } from "../src/types/timeline";
import {
  convertParsedBas,
  decodeBasText,
  formatStartTimeInput,
  parseStartTimeInput
} from "../src/utils/basImport";
import { compileClipToBas } from "../src/utils/compiler";

/**
 * 这些 fixture 直接取自 public/bas.js 解析真实源码后的输出形状：
 * 数值被包装成 `{ numType, value }`，颜色是整数，字符串经过 HTML 实体编码。
 */
const number = (value: number) => ({ numType: "number", value });
const percent = (value: number) => ({ numType: "percent", value });

const textDefaults = {
  alpha: number(1),
  color: 16777215,
  anchorX: number(0),
  anchorY: number(0),
  fontSize: number(25),
  fontFamily: "SimHei",
  bold: number(1),
  textShadow: number(1),
  strokeWidth: number(0),
  strokeColor: 16777215,
  rotateX: number(0),
  rotateY: number(0),
  rotateZ: number(0),
  x: number(0),
  y: number(0),
  zIndex: number(0),
  scale: number(1)
};

const textDef = (name: string, attrs: Record<string, unknown>) => ({
  type: "DefText",
  obj_type: "text",
  name,
  attrs: { ...textDefaults, ...attrs }
});

const unit = (
  targetName: string,
  duration: number,
  attrs: Record<string, unknown>,
  defaultEasing?: string
) => ({
  type: "Unit",
  duration,
  targetName,
  ...(defaultEasing ? { defaultEasing } : {}),
  attrs
});

const parse = (defs: unknown[], sets: unknown[]) =>
  ({ defs, sets }) as unknown as BasParseResult;

const keyframeAt = <K extends { timeMs: number }>(keyframes: K[], timeMs: number): K => {
  const keyframe = keyframes.find(item => item.timeMs === timeMs);
  assert.ok(keyframe, `expected a keyframe at ${timeMs}ms`);
  return keyframe;
};

test("bas import: a plain text object maps to a resource without keyframes", () => {
  const result = convertParsedBas(
    parse(
      [
        textDef("t", {
          content: "你&lt;好",
          x: percent(10),
          y: number(20),
          fontSize: percent(5),
          color: 16711680,
          duration: 6000
        })
      ],
      []
    )
  );

  assert.equal(result.warnings.length, 0);
  assert.equal(result.objects.length, 1);
  const object = result.objects[0]!;
  assert.equal(object.name, "t");
  assert.equal(object.durationMs, 6000);
  assert.deepEqual(object.keyframes, []);

  const resource = object.resource as TextDanmu;
  assert.equal(resource.type, "text");
  assert.equal(resource.content, "你<好");
  assert.equal(resource.x, "10%");
  assert.equal(resource.y, 20);
  assert.equal(resource.fontSize, "5%");
  assert.equal(resource.color, 0xff0000);
  assert.equal(resource.opacity, 1);
  assert.equal(result.durationMs, 6000);
});

test("bas import: bas.js html encoded strings are decoded", () => {
  assert.equal(decodeBasText("&lt;b&gt;换行<br>新行&nbsp;&amp;&nbsp;空格"), "<b>换行\n新行 & 空格");
  assert.equal(decodeBasText("A&amp;lt;B"), "A&lt;B");
});

test("bas import: serial `then` sets produce keyframes at every boundary", () => {
  const result = convertParsedBas(
    parse(
      [textDef("t", { content: "a" })],
      [
        {
          type: "Serial",
          items: [unit("t", 1000, { x: percent(50) }), unit("t", 2000, { alpha: number(0) })]
        }
      ]
    )
  );

  const object = result.objects[0]!;
  assert.deepEqual(
    object.keyframes.map(keyframe => keyframe.timeMs),
    [0, 1000, 3000]
  );
  assert.equal(object.durationMs, 4000);

  const start = keyframeAt(object.keyframes, 0);
  // 该属性只要出现过百分比，整条时间线都会统一成百分比，避免混用单位。
  assert.equal(start.properties.x, "0%");
  assert.equal(start.properties.opacity, 1);

  const middle = keyframeAt(object.keyframes, 1000);
  assert.equal(middle.properties.x, "50%");
  assert.equal(middle.properties.opacity, 1);
  assert.equal(middle.interpolation, "linear");

  const end = keyframeAt(object.keyframes, 3000);
  assert.equal(end.properties.opacity, 0);
});

test("bas import: parallel segments are sampled on their boundaries", () => {
  const result = convertParsedBas(
    parse(
      [textDef("t", { content: "a" })],
      [
        unit("t", 1000, { x: percent(50) }),
        unit("t", 2000, { scale: number(2) })
      ]
    )
  );

  const keyframes = result.objects[0]!.keyframes;
  assert.deepEqual(
    keyframes.map(keyframe => keyframe.timeMs),
    [0, 1000, 2000]
  );

  const middle = keyframeAt(keyframes, 1000);
  assert.equal(middle.properties.x, "50%");
  assert.equal(middle.properties.scale, 1.5);
  assert.equal(keyframeAt(keyframes, 0).properties.x, "0%");

  const end = keyframeAt(keyframes, 2000);
  assert.equal(end.properties.x, "50%");
  assert.equal(end.properties.scale, 2);
});

test("bas import: zero duration sets and content changes become step keyframes", () => {
  // 瞬时设置：段时长为 0，编辑器侧必须用 step 才能在同一时刻跳变。
  const instantaneous = convertParsedBas(
    parse([textDef("t", { content: "a" })], [unit("t", 0, { alpha: number(0) })])
  );
  const start = keyframeAt(instantaneous.objects[0]!.keyframes, 0);
  assert.equal(start.interpolation, "step");
  assert.equal(start.properties.opacity, 0);

  // BAS 在段开始时切换 content：空段占位 1s 后立刻切换，因此 1000ms 处是 step。
  const contentChange = convertParsedBas(
    parse(
      [textDef("t", { content: "a" })],
      [{ type: "Serial", items: [unit("t", 1000, {}), unit("t", 0, { content: "b" })] }]
    )
  );
  const change = keyframeAt(contentChange.objects[0]!.keyframes, 1000);
  assert.equal(change.interpolation, "step");
  assert.equal(change.properties.content, "b");
});

test("bas import: non linear easing is sampled and reported", () => {
  const result = convertParsedBas(
    parse(
      [textDef("t", { content: "a" })],
      [unit("t", 2000, { x: percent(50) }, "ease-in")]
    )
  );

  const keyframes = result.objects[0]!.keyframes;
  assert.ok(keyframes.length > 2, "easing should add intermediate keyframes");
  assert.deepEqual(result.warnings.map(warning => warning.code), ["easingApproximated"]);
  assert.deepEqual(result.warnings[0]?.params, { object: "t", property: "x", easing: "ease-in" });

  // ease-in 起步慢：一半时间只走完不到 1/3 的进度（百分比属性保持 % 单位）。
  const middle = keyframeAt(keyframes, 1000);
  assert.equal(typeof middle.properties.x, "string");
  assert.ok(Number(String(middle.properties.x).replace("%", "")) < 25);
  assert.equal(keyframeAt(keyframes, 2000).properties.x, "50%");
});

test("bas import: unsupported animations warn, single t=0 sets merge into the resource", () => {
  const pathDefaults = {
    borderColor: 0,
    borderAlpha: number(1),
    borderWidth: number(0),
    fillColor: 16777215,
    fillAlpha: number(1),
    x: number(0),
    y: number(0),
    zIndex: number(0),
    scale: number(1)
  };
  const pathDef = {
    type: "DefPath",
    obj_type: "path",
    name: "p",
    attrs: { ...pathDefaults, d: "M0 0 H10 V10 Z" }
  };

  const merged = convertParsedBas(parse([pathDef], [unit("p", 0, { alpha: number(0.5) })]));
  assert.equal(merged.warnings.length, 0);
  assert.equal((merged.objects[0]!.resource as Record<string, unknown>).opacity, 0.5);
  assert.deepEqual(merged.objects[0]!.keyframes, []);

  const ignored = convertParsedBas(
    parse(
      [pathDef],
      [{ type: "Serial", items: [unit("p", 1000, { alpha: number(0) }), unit("p", 1000, { alpha: number(1) })] }]
    )
  );
  assert.deepEqual(ignored.warnings.map(warning => warning.code), ["unsupportedAnimation"]);
  assert.deepEqual(ignored.warnings[0]?.params, { object: "p", property: "alpha" });
  assert.deepEqual(ignored.objects[0]!.keyframes, []);
});

test("bas import: parent references are validated against text objects", () => {
  const withText = convertParsedBas(
    parse([textDef("t", { content: "a" }), textDef("child", { content: "b", parent: "t" })], [])
  );
  assert.equal(withText.objects[1]!.parentName, "t");
  assert.equal(withText.warnings.length, 0);

  const withButton = convertParsedBas(
    parse(
      [
        {
          type: "DefButton",
          obj_type: "button",
          name: "b",
          attrs: { text: "按钮", x: number(0), y: number(0), fontSize: number(25) }
        },
        textDef("child", { content: "b", parent: "b" })
      ],
      []
    )
  );
  assert.equal(withButton.objects[1]!.parentName, undefined);
  assert.deepEqual(withButton.warnings.map(warning => warning.code), ["invalidParent"]);
});

test("bas import: button targets are wrapped into the editor shape", () => {
  const result = convertParsedBas(
    parse(
      [
        {
          type: "DefButton",
          obj_type: "button",
          name: "b",
          attrs: {
            text: "去追番",
            x: number(10),
            y: number(20),
            fontSize: number(25),
            target: { objType: "av", av: 123, page: 2, time: 5000 }
          }
        },
        {
          type: "DefButton",
          obj_type: "button",
          name: "seek",
          attrs: { text: "跳转", target: { objType: "seek" } }
        }
      ],
      []
    )
  );

  assert.deepEqual((result.objects[0]!.resource as Record<string, unknown>).target, {
    av: { av: 123, page: 2, timeMs: 5000 }
  });
  assert.equal((result.objects[1]!.resource as Record<string, unknown>).target, undefined);
  assert.deepEqual(result.warnings.map(warning => warning.code), ["unsupportedTarget"]);
});

test("bas import: imported clips can be compiled back to BAS", () => {
  const result = convertParsedBas(
    parse(
      [textDef("t", { content: "a", duration: 3000 }), textDef("child", { content: "b", parent: "t" })],
      [
        {
          type: "Serial",
          items: [unit("t", 0, { alpha: number(0) }), unit("t", 1000, { x: percent(50) }, "ease-out")]
        },
        unit("child", 500, { alpha: number(0.2) })
      ]
    )
  );

  assert.equal(result.objects.length, 2);
  for (const object of result.objects) {
    const resource = { ...object.resource, id: `res_${object.name}` } as TextDanmu;
    const clip: TimelineResourceClip = {
      kind: "resource",
      id: `clip_${object.name}`,
      resourceId: resource.id,
      trackId: "track_1",
      startTime: 0,
      duration: object.durationMs,
      keyframes: object.keyframes
    };
    assert.doesNotThrow(() => compileClipToBas(clip, resource));
  }
});

test("bas import: start time input accepts seconds, units and clock notation", () => {
  assert.equal(parseStartTimeInput("5"), 5000);
  assert.equal(parseStartTimeInput("5.5s"), 5500);
  assert.equal(parseStartTimeInput("500ms"), 500);
  assert.equal(parseStartTimeInput("00:05.500"), 5500);
  assert.equal(parseStartTimeInput("01:00:05.000"), 3605000);
  assert.equal(parseStartTimeInput(""), null);
  assert.equal(parseStartTimeInput("abc"), null);
  assert.equal(parseStartTimeInput("-1"), null);

  assert.equal(formatStartTimeInput(0), "00:00.000");
  assert.equal(formatStartTimeInput(5500), "00:05.500");
  assert.equal(formatStartTimeInput(3605000), "01:00:05.000");
  assert.equal(parseStartTimeInput(formatStartTimeInput(73250)), 73250);
});
