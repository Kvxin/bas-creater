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

const coreDir = path.join(srcDir, "core");
const typesDir = path.join(srcDir, "types");

const isWithinDir = (target: string, dir: string): boolean => {
  const rel = path.relative(dir, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

const isAllowedImport = (fromFile: string, specifier: string, allowedDirs: readonly string[]): boolean => {
  if (specifier.startsWith("@/")) {
    const resolved = path.resolve(srcDir, specifier.slice(2));
    return allowedDirs.some((dir) => isWithinDir(resolved, dir));
  }
  if (specifier.startsWith(".")) {
    const resolved = path.resolve(path.dirname(fromFile), specifier);
    return allowedDirs.some((dir) => isWithinDir(resolved, dir));
  }
  return false;
};

// core 是纯 TypeScript 领域层：只能依赖 core 自身和纯类型目录，不能碰 Vue/Pinia/i18n/store/浏览器或 Tauri。
test("src/core only depends on src/core and src/types", () => {
  const violations = listFiles(coreDir).flatMap((file) =>
    importsOf(file)
      .filter((specifier) => !isAllowedImport(file, specifier, [coreDir, typesDir]))
      .map((specifier) => `${relative(file)} -> ${specifier}`)
  );
  assert.deepEqual(violations, []);
});

test("src/core does not touch browser globals", () => {
  const violations = listFiles(coreDir).filter((file) =>
    /\b(window|document|localStorage|navigator)\./.test(fs.readFileSync(file, "utf8"))
  );
  assert.deepEqual(violations.map(relative), []);
});

test("src/types stays type-only", () => {
  const violations = listFiles(typesDir).flatMap((file) =>
    importsOf(file)
      .filter((specifier) => !isAllowedImport(file, specifier, [typesDir]))
      .map((specifier) => `${relative(file)} -> ${specifier}`)
  );
  assert.deepEqual(violations, []);
});

test("relative imports cannot escape allowed architecture boundaries", () => {
  const sampleCoreFile = path.join(coreDir, "compiler.ts");
  const sampleTypesFile = path.join(typesDir, "danmu.ts");

  assert.equal(isAllowedImport(sampleCoreFile, "./keyframes", [coreDir, typesDir]), true);
  assert.equal(isAllowedImport(sampleCoreFile, "../types/danmu", [coreDir, typesDir]), true);
  assert.equal(isAllowedImport(sampleCoreFile, "../stores/danmu", [coreDir, typesDir]), false);
  assert.equal(isAllowedImport(sampleCoreFile, "../i18n", [coreDir, typesDir]), false);
  assert.equal(isAllowedImport(sampleCoreFile, "vue", [coreDir, typesDir]), false);

  assert.equal(isAllowedImport(sampleTypesFile, "./timeline", [typesDir]), true);
  assert.equal(isAllowedImport(sampleTypesFile, "../core/compiler", [typesDir]), false);
});
