import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const srcDir = path.join(import.meta.dirname, "../src");
const coreDir = path.join(srcDir, "core");
const typesDir = path.join(srcDir, "types");
const effectsDir = path.join(srcDir, "effects");
const effectsRegistryFile = path.join(effectsDir, "registry.ts");

const listFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : /\.(ts|vue)$/.test(entry.name) ? [full] : [];
  });

/** 使用 TypeScript AST 提取源码中的所有静态导入（含副作用导入）、重新导出、动态 import() 与 import 类型。 */
const importsOfSource = (sourceText: string, fileName = "module.ts"): string[] => {
  const specifiers: string[] = [];
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteralLike(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const firstArg = node.arguments[0];
      if (firstArg && ts.isStringLiteralLike(firstArg)) {
        specifiers.push(firstArg.text);
      }
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
};

const relative = (file: string) => path.relative(srcDir, file).split(path.sep).join("/");

const isWithinDir = (target: string, dir: string): boolean => {
  const rel = path.relative(dir, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

const resolveImportTarget = (fromFile: string, specifier: string): string | null => {
  if (specifier.startsWith("@/")) return path.resolve(srcDir, specifier.slice(2));
  if (specifier.startsWith(".")) return path.resolve(path.dirname(fromFile), specifier);
  return null;
};

const isAllowedImport = (
  fromFile: string,
  specifier: string,
  allowedDirs: readonly string[],
  forbiddenTargets: readonly string[] = []
): boolean => {
  const resolved = resolveImportTarget(fromFile, specifier);
  if (!resolved) return false;
  const normalized = resolved.replace(/\.ts$/, "");
  if (forbiddenTargets.some((target) => target.replace(/\.ts$/, "") === normalized)) return false;
  return allowedDirs.some((dir) => isWithinDir(resolved, dir));
};

const scanSourceViolations = (
  fromFile: string,
  sourceText: string,
  allowedDirs: readonly string[],
  forbiddenTargets: readonly string[] = []
): string[] =>
  importsOfSource(sourceText, fromFile)
    .filter((specifier) => !isAllowedImport(fromFile, specifier, allowedDirs, forbiddenTargets))
    .map((specifier) => `${relative(fromFile)} -> ${specifier}`);

// core 是纯 TypeScript 领域层：只能依赖 core、types 以及纯 effects 领域模块（不含带 Vue ref 的 registry.ts），不能碰 Vue/Pinia/i18n/store/浏览器或 Tauri。
test("src/core only depends on src/core, src/types, and pure src/effects modules", () => {
  const pureEffectFiles = listFiles(effectsDir).filter((file) => file !== effectsRegistryFile);
  const violations = [...listFiles(coreDir), ...pureEffectFiles].flatMap((file) =>
    scanSourceViolations(file, fs.readFileSync(file, "utf8"), [coreDir, typesDir, effectsDir], [effectsRegistryFile])
  );
  assert.deepEqual(violations, []);
});

test("src/core and pure src/effects do not touch browser globals", () => {
  const pureEffectFiles = listFiles(effectsDir).filter((file) => file !== effectsRegistryFile);
  const violations = [...listFiles(coreDir), ...pureEffectFiles].filter((file) =>
    /\b(window|document|localStorage|navigator)\./.test(fs.readFileSync(file, "utf8"))
  );
  assert.deepEqual(violations.map(relative), []);
});

test("src/types stays type-only", () => {
  const violations = listFiles(typesDir).flatMap((file) =>
    scanSourceViolations(file, fs.readFileSync(file, "utf8"), [typesDir])
  );
  assert.deepEqual(violations, []);
});

test("scanner catches side-effect imports, dynamic imports, and relative imports escaping boundaries", () => {
  const sampleCoreFile = path.join(coreDir, "compiler.ts");
  const sampleTypesFile = path.join(typesDir, "danmu.ts");

  const coreSource = [
    `import "./keyframes";`,
    `import type { AnyDanmu } from "../types/danmu";`,
    `import { applyOpacityLimits } from "@/effects/opacity";`,
    `import "@/effects/registry";`,
    `import "../stores/danmu";`,
    `import "@/i18n";`,
    `export * from "../utils/bas";`,
    `const lazy = () => import("../stores/timeline");`,
    `type External = import("vue").Ref<number>;`
  ].join("\n");

  assert.deepEqual(
    scanSourceViolations(sampleCoreFile, coreSource, [coreDir, typesDir, effectsDir], [effectsRegistryFile]),
    [
      "core/compiler.ts -> @/effects/registry",
      "core/compiler.ts -> ../stores/danmu",
      "core/compiler.ts -> @/i18n",
      "core/compiler.ts -> ../utils/bas",
      "core/compiler.ts -> ../stores/timeline",
      "core/compiler.ts -> vue"
    ]
  );

  const typesSource = [`import type { TimelineTrack } from "./timeline";`, `import "../core/compiler";`].join("\n");
  assert.deepEqual(scanSourceViolations(sampleTypesFile, typesSource, [typesDir]), [
    "types/danmu.ts -> ../core/compiler"
  ]);
});
