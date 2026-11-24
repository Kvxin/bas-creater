import assert from "node:assert/strict";
import fs from "node:fs";
import type { BasImportResult } from "../../src/utils/basImport";

const shouldUpdate = process.env.UPDATE_GOLDEN === "1";

/** 与 golden 文件比较；`UPDATE_GOLDEN=1` 时改为写入，用于有意变更输出后刷新快照。 */
export const assertGolden = (filePath: string, actual: string) => {
  if (shouldUpdate) {
    fs.writeFileSync(filePath, actual);
    return;
  }
  assert.ok(fs.existsSync(filePath), `Missing golden file ${filePath}; run with UPDATE_GOLDEN=1 to create it`);
  assert.equal(
    actual,
    fs.readFileSync(filePath, "utf8"),
    `Output differs from ${filePath}; run with UPDATE_GOLDEN=1 if the change is intended`
  );
};

/** 稳定的 JSON 序列化，结尾带换行，便于 diff。 */
export const toGoldenJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** 关键帧 ID 为随机值，golden 中按出现顺序替换为稳定占位。 */
export const stabilizeImport = (result: BasImportResult): BasImportResult => ({
  ...result,
  objects: result.objects.map((object) => ({
    ...object,
    keyframes: object.keyframes.map((keyframe, index) => ({ ...keyframe, id: `kf_${index}` }))
  }))
});
