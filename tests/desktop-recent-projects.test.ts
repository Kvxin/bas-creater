import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteProject, listProjects } from "../src/services/storage/projectStorage";

test("desktop migrates existing recent projects into the config file and persists removal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "danmakucut-recent-"));
  const indexFile = join(directory, "recent-projects.json");
  const oldProject = { id: "old", name: "Old project", createdAt: 1, updatedAt: 2, directory: "C:/old" };
  const currentProject = { id: "current", name: "Current project", createdAt: 3, updatedAt: 4, directory: "C:/current" };
  await writeFile(indexFile, JSON.stringify([currentProject]));
  const values = new Map([["danmakucut-recent-projects", JSON.stringify([oldProject])]]);
  const descriptors = new Map(["window", "localStorage", "isTauri"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let failWrite = true;
  Object.defineProperty(globalThis, "isTauri", { configurable: true, value: true });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: {
    invoke: async (command: string, args: { contents?: string } = {}) => {
      if (command === "read_recent_projects") return readFile(indexFile, "utf8");
      if (command === "write_recent_projects") {
        if (failWrite) throw new Error("disk full");
        return writeFile(indexFile, args.contents!);
      }
      throw new Error(`Unexpected command: ${command}`);
    }
  } } });
  try {
    await assert.rejects(listProjects(), /disk full/);
    assert.equal(values.has("danmakucut-recent-projects"), true);
    assert.deepEqual(JSON.parse(await readFile(indexFile, "utf8")), [currentProject]);
    failWrite = false;
    const projects = await listProjects();
    assert.deepEqual(new Set(projects.map(project => project.id)), new Set(["old", "current"]));
    assert.equal(values.has("danmakucut-recent-projects"), false);
    assert.deepEqual(new Set(JSON.parse(await readFile(indexFile, "utf8")).map((project: { id: string }) => project.id)), new Set(["old", "current"]));
    await deleteProject("old");
    assert.deepEqual(JSON.parse(await readFile(indexFile, "utf8")).map((project: { id: string }) => project.id), ["current"]);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await rm(directory, { recursive: true, force: true });
  }
});
