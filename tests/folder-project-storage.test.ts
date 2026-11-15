import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createFolderProject, loadProjectDraft, openSelectedProjectDirectory, projectSessionDirectory, saveProjectDraft } from "../src/services/storage/projectStorage";
import { writeProjectAudio } from "../src/services/storage/projectAssets";
import { bundleProject } from "../src/services/storage/projectBundle";
import { openBrowserProject, restoreBrowserProjectFile } from "../src/services/storage/browserProjectFile";
import { listBrowserBackups, readBrowserBackup } from "../src/services/storage/browserBackups";
import { normalizeProjectData } from "../src/services/storage/projectSchema";

function directoryHandle(path: string): FileSystemDirectoryHandle {
  return {
    kind: "directory",
    name: basename(path),
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
    async *values() {
      for (const name of await readdir(path)) {
        const child = join(path, name);
        yield (await stat(child)).isDirectory() ? directoryHandle(child) : { kind: "file", name };
      }
    },
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      const child = join(path, name);
      if (options?.create) await mkdir(child, { recursive: true });
      else if (!(await stat(child).catch(() => null))) throw new DOMException("Missing", "NotFoundError");
      return directoryHandle(child);
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      const filePath = join(path, name);
      if (!(await stat(filePath).catch(() => null))) {
        if (!options?.create) throw new DOMException("Missing", "NotFoundError");
        await writeFile(filePath, "");
      }
      return {
        kind: "file",
        name,
        getFile: async () => new File([await readFile(filePath)], name),
        createWritable: async () => {
          let contents: string | Blob = "";
          return {
            write: async (value: string | Blob) => { contents = value; },
            close: async () => writeFile(filePath, typeof contents === "string" ? contents : Buffer.from(await contents.arrayBuffer())),
            abort: async () => {}
          };
        }
      };
    },
    removeEntry: async (name: string, options?: { recursive?: boolean }) => rm(join(path, name), { recursive: options?.recursive })
  } as unknown as FileSystemDirectoryHandle;
}

test("project edits persist to the selected folder and reopen without IndexedDB", async () => {
  const path = await mkdtemp(join(tmpdir(), "danmakucut-project-"));
  const values = new Map<string, string>();
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  } });
  try {
    const directory = directoryHandle(path);
    const project = await createFolderProject("Folder project", "Track", directory);
    const track = { ...project.tracks[0]!, clips: [{ kind: "resource" as const, id: "clip-1", resourceId: "danmu-1", trackId: "track_1", startTime: 1200, duration: 3000 }] };
    const danmu = { id: "danmu-1", type: "text", name: "Example", content: "Saved text" };
    const support = projectSessionDirectory(project.id) as FileSystemDirectoryHandle;
    assert.equal(support.name, ".Folder project.basproj.danmakucut");
    await writeProjectAudio(support, "audio-1.audio", new File(["audio content"], "original.wav", { type: "audio/wav" }));
    const audio = { id: "audio-1", name: "original.wav", type: "audio/wav", relativePath: "audio-1.audio" };
    const assets = [
      { id: danmu.id, type: "text" as const, binId: null, danmu: danmu as typeof project.danmus[number] },
      { id: audio.id, type: "audio-file" as const, binId: null, audio, location: { kind: "project" as const, path: audio.relativePath } }
    ];
    await saveProjectDraft({ ...project, assets, tracks: [track] });
    const diskProject = JSON.parse(await readFile(join(path, "Folder project.basproj"), "utf8"));
    assert.equal(diskProject.version, 3);
    assert.equal(diskProject.assets.find((asset: { id: string }) => asset.id === "danmu-1").danmu.content, "Saved text");
    assert.equal(diskProject.assets.find((asset: { id: string }) => asset.id === "audio-1").audio.relativePath, "audio-1.audio");
    assert.equal("danmus" in diskProject, false);
    assert.equal("audioMeta" in diskProject, false);
    assert.equal(diskProject.tracks[0].clips[0].resourceId, "danmu-1");
    assert.equal(diskProject.tracks[0].clips[0].startTime, 1200);
    await openSelectedProjectDirectory(directory);
    const restored = await loadProjectDraft(project.id);
    assert.equal(restored?.project.assets.find(asset => asset.id === "danmu-1")?.type, "text");
    assert.equal(restored?.project.tracks[0]?.clips[0]?.resourceId, "danmu-1");
    assert.equal(await restored?.audioResources[0]?.file?.text(), "audio content");
    const destinationPath = join(path, "bundle");
    await mkdir(destinationPath);
    const destination = directoryHandle(destinationPath);
    Object.defineProperty(globalThis, "window", { configurable: true, value: { showDirectoryPicker: async () => destination } });
    assert.equal(await bundleProject(project.id, () => restored!.project), true);
    const copies = (await readdir(destinationPath)).filter(name => name.endsWith(".basproj"));
    assert.equal(copies.length, 1);
    const copied = JSON.parse(await readFile(join(destinationPath, copies[0]!), "utf8"));
    assert.notEqual(copied.id, project.id);
    assert.equal(copied.assets.find((asset: { id: string }) => asset.id === "danmu-1").danmu.content, "Saved text");
    const reopenedCopy = await openSelectedProjectDirectory(destination);
    const loadedCopy = await loadProjectDraft(reopenedCopy.id);
    assert.equal(await loadedCopy?.audioResources[0]?.file.text(), "audio content");
    URL.revokeObjectURL(loadedCopy!.audioResources[0]!.url);
    URL.revokeObjectURL(restored!.audioResources[0]!.url);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
    await rm(path, { recursive: true, force: true });
  }
});

test("opening a legacy browser project copies its assets and backups into the desktop support directory", async () => {
  const path = await mkdtemp(join(tmpdir(), "danmakucut-legacy-"));
  const legacy = join(path, ".danmakucut-project-1");
  const support = join(path, ".Project.basproj.danmakucut");
  const project = { version: 2, id: "project-1", name: "Project", createdAt: 1, updatedAt: 1,
    canvas: { width: 800, height: 450 }, timeline: { duration: 0 }, danmus: [], audioMeta: [], tracks: [] };
  try {
    await writeFile(join(path, "Project.basproj"), JSON.stringify(project));
    await mkdir(join(legacy, "assets", "audio"), { recursive: true });
    await mkdir(join(legacy, ".danmakucut-backups"));
    await mkdir(join(support, ".danmakucut-backups"), { recursive: true });
    await writeFile(join(legacy, "assets", "audio", "sound.wav"), "legacy audio");
    await writeFile(join(legacy, ".danmakucut-backups", "backup-1000-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.basproj"), "browser backup");
    await writeFile(join(support, ".danmakucut-backups", "backup-2000.basproj"), "desktop backup");
    const opened = await openBrowserProject(directoryHandle(path), "Project.basproj");
    assert.equal(opened.assetDirectory.name, ".Project.basproj.danmakucut");
    assert.equal(await readFile(join(support, "assets", "audio", "sound.wav"), "utf8"), "legacy audio");
    assert.equal(await readFile(join(legacy, "assets", "audio", "sound.wav"), "utf8"), "legacy audio");
    assert.deepEqual(await listBrowserBackups(opened.assetDirectory), ["backup-2000.basproj", "backup-1000-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.basproj"]);
    assert.equal(await readBrowserBackup(opened.assetDirectory, "backup-2000.basproj"), "desktop backup");
    await rm(join(support, ".danmakucut-backups", "backup-1000-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.basproj"));
    await openBrowserProject(directoryHandle(path), "Project.basproj");
    await assert.rejects(stat(join(support, ".danmakucut-backups", "backup-1000-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.basproj")), { code: "ENOENT" });
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

test("legacy migration refuses to overwrite conflicting owned assets", async () => {
  const path = await mkdtemp(join(tmpdir(), "danmakucut-conflict-"));
  const legacy = join(path, ".danmakucut-project-1", "assets", "audio");
  const target = join(path, ".Project.basproj.danmakucut", "assets", "audio");
  const project = { version: 2, id: "project-1", name: "Project", createdAt: 1, updatedAt: 1,
    canvas: { width: 800, height: 450 }, timeline: { duration: 0 }, danmus: [], audioMeta: [], tracks: [] };
  try {
    await writeFile(join(path, "Project.basproj"), JSON.stringify(project));
    await mkdir(legacy, { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(join(legacy, "sound.wav"), "old");
    await writeFile(join(target, "sound.wav"), "new");
    await assert.rejects(openBrowserProject(directoryHandle(path), "Project.basproj"), /SUPPORT_DIRECTORY_CONFLICT/);
    assert.equal(await readFile(join(legacy, "sound.wav"), "utf8"), "old");
    assert.equal(await readFile(join(target, "sound.wav"), "utf8"), "new");
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

test("recovering a missing project retains its project-owned assets", async () => {
  const path = await mkdtemp(join(tmpdir(), "danmakucut-recovery-"));
  const audio = join(path, ".Project.basproj.danmakucut", "assets", "audio");
  const project = normalizeProjectData({ version: 2, id: "project-1", name: "Project", createdAt: 1, updatedAt: 1,
    canvas: { width: 800, height: 450 }, timeline: { duration: 0 }, danmus: [], audioMeta: [], tracks: [] });
  try {
    await mkdir(audio, { recursive: true });
    await writeFile(join(audio, "sound.wav"), "audio");
    const restored = await restoreBrowserProjectFile(
      { projectId: project.id, directory: directoryHandle(path), fileName: "Project.basproj" },
      project
    );
    assert.match(restored.fileName, /^recovered-/);
    assert.equal(await readFile(join(path, `.${restored.fileName}.danmakucut`, "assets", "audio", "sound.wav"), "utf8"), "audio");
    assert.equal(await readFile(join(audio, "sound.wav"), "utf8"), "audio");
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});
