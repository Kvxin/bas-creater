import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const srcDir = path.join(import.meta.dirname, "../src");

const listFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : /\.(ts|vue)$/.test(entry.name) ? [full] : [];
  });

const importsOf = (file: string) =>
  [...fs.readFileSync(file, "utf8").matchAll(/(?:import|export)[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map(
    (match) => match[1] ?? match[2]!
  );

const relative = (file: string) => path.relative(srcDir, file);

// core 是纯 TypeScript 领域层：只能依赖 core 自身和纯类型目录，不能碰 Vue/Pinia/i18n/store/浏览器或 Tauri。
test("src/core only depends on src/core and src/types", () => {
  const violations = listFiles(path.join(srcDir, "core")).flatMap((file) =>
    importsOf(file)
      .filter((specifier) => !/^@\/(core|types)\//.test(specifier) && !specifier.startsWith("."))
      .map((specifier) => `${relative(file)} -> ${specifier}`)
  );
  assert.deepEqual(violations, []);
});

test("src/core does not touch browser globals", () => {
  const violations = listFiles(path.join(srcDir, "core")).filter((file) =>
    /\b(window|document|localStorage|navigator)\./.test(fs.readFileSync(file, "utf8"))
  );
  assert.deepEqual(violations.map(relative), []);
});

test("src/types stays type-only", () => {
  const violations = listFiles(path.join(srcDir, "types")).flatMap((file) =>
    importsOf(file)
      .filter((specifier) => !/^@\/types\//.test(specifier) && !specifier.startsWith("."))
      .map((specifier) => `${relative(file)} -> ${specifier}`)
  );
  assert.deepEqual(violations, []);
});
