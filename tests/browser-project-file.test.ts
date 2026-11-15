import test from "node:test";
import assert from "node:assert/strict";
import { browserProjectHasChanged, createBrowserProject, openBrowserProject, saveBrowserProject } from "../src/services/storage/browserProjectFile";
import { ensureBrowserMediaPermission, readBrowserMedia } from "../src/services/storage/browserMediaFile";

const project = { version: 2, id: "project-1", name: "Project", createdAt: 1, updatedAt: 1,
  canvas: { width: 800, height: 450 }, timeline: { duration: 0 }, danmus: [], audioMeta: [], tracks: [] };

function directoryFixture(initial?: string, unrelated = false) {
  const files = new Map<string, string>();
  if (initial !== undefined) files.set("project.basproj", initial);
  if (unrelated) files.set("unrelated.txt", "unrelated");
  function makeDirectory(name: string): FileSystemDirectoryHandle {
    const entries = name === "project" ? files : new Map<string, string>();
    const directories = new Map<string, FileSystemDirectoryHandle>();
    return {
      kind: "directory", name, queryPermission: async () => "granted" as PermissionState,
      values: async function* () {
        for (const entry of entries.keys()) yield { kind: "file", name: entry };
        for (const entry of directories.keys()) yield { kind: "directory", name: entry };
      },
      getDirectoryHandle: async (child: string, options?: { create?: boolean }) => {
        if (entries.has(child)) throw new DOMException("Wrong type", "TypeMismatchError");
        if (!directories.has(child)) {
          if (!options?.create) throw new DOMException("Missing", "NotFoundError");
          directories.set(child, makeDirectory(child));
        }
        return directories.get(child)!;
      },
      getFileHandle: async (child: string, options?: { create?: boolean }) => {
        if (directories.has(child)) throw new DOMException("Wrong type", "TypeMismatchError");
        if (!entries.has(child)) {
          if (!options?.create) throw new DOMException("Missing", "NotFoundError");
          entries.set(child, "");
        }
        return {
          kind: "file", name: child,
          getFile: async () => new File([entries.get(child)!], child),
          createWritable: async () => {
            let next = "";
            return { write: async (data: string) => { next = data; }, close: async () => { entries.set(child, next); }, abort: async () => {} };
          }
        };
      },
      removeEntry: async (child: string) => { entries.delete(child); }
    } as unknown as FileSystemDirectoryHandle;
  }
  const directory = makeDirectory("project");
  return { directory, read: () => files.get("project.basproj"), modify: (value: string) => { files.set("project.basproj", value); } };
}

function fakeBackupDirectory(): FileSystemDirectoryHandle {
  return directoryFixture().directory;
}

test("creates a project alongside unrelated files but never overwrites an existing project", async () => {
  const fs = directoryFixture(undefined, true);
  const opened = await createBrowserProject(fs.directory, "project.basproj", project);
  assert.equal(opened.project.id, "project-1");
  const other = await createBrowserProject(fs.directory, "other.basproj", { ...project, id: "project-2" });
  assert.notEqual(opened.assetDirectory, other.assetDirectory);
  assert.equal(opened.assetDirectory.name, ".project.basproj.danmakucut");
  assert.equal(other.assetDirectory.name, ".other.basproj.danmakucut");
  assert.equal(await (await (await fs.directory.getFileHandle("unrelated.txt")).getFile()).text(), "unrelated");
  const original = fs.read();
  await assert.rejects(createBrowserProject(fs.directory, "project.basproj", project), /PROJECT_ALREADY_EXISTS/);
  assert.equal(fs.read(), original);
});

test("saves a project and refuses externally modified files", async () => {
  const fs = directoryFixture(JSON.stringify(project));
  const opened = await openBrowserProject(fs.directory, "project.basproj");
  const saved = await saveBrowserProject(opened, { ...project, name: "Changed" });
  assert.equal(await browserProjectHasChanged(saved), false);
  assert.equal(JSON.parse(fs.read()!).name, "Changed");
  fs.modify(JSON.stringify({ ...project, name: "External" }));
  assert.equal(await browserProjectHasChanged(saved), true);
  await assert.rejects(saveBrowserProject(saved, project), /PROJECT_MODIFIED_EXTERNALLY/);
  assert.equal(JSON.parse(fs.read()!).name, "External");
});

test("a project deleted outside the application is reported as a conflict without recreating it", async () => {
  const fs = directoryFixture(JSON.stringify(project));
  const opened = await openBrowserProject(fs.directory, "project.basproj");
  await fs.directory.removeEntry("project.basproj");
  assert.equal(await browserProjectHasChanged(opened), true);
  await assert.rejects(saveBrowserProject(opened, project), /PROJECT_MODIFIED_EXTERNALLY/);
  assert.equal(fs.read(), undefined);
});

test("rejects paths outside selected directory and mismatched project IDs", async () => {
  const fs = directoryFixture(JSON.stringify(project));
  await assert.rejects(openBrowserProject(fs.directory, "../project.basproj"), /INVALID_PROJECT_FILE_NAME/);
  const opened = await openBrowserProject(fs.directory, "project.basproj");
  await assert.rejects(saveBrowserProject(opened, { ...project, id: "another" }), /PROJECT_ID_MISMATCH/);
});

test("does not read a media file until permission is granted", async () => {
  let permission: PermissionState = "prompt";
  const file = { queryPermission: async () => permission, requestPermission: async () => { permission = "granted"; return permission; }, getFile: async () => new File(["data"], "test.wav") } as unknown as FileSystemFileHandle;
  assert.equal(await ensureBrowserMediaPermission(file), false);
  await assert.rejects(readBrowserMedia(file), /MEDIA_PERMISSION_REQUIRED/);
  assert.equal(await ensureBrowserMediaPermission(file, true), true);
  assert.equal(await (await readBrowserMedia(file)).text(), "data");
});

test("does not write when directory permission is denied", async () => {
  let wrote = false;
  const directory = {
    queryPermission: async () => "denied",
    getFileHandle: async () => { wrote = true; throw new Error("unexpected write"); }
  } as unknown as FileSystemDirectoryHandle;
  await assert.rejects(openBrowserProject(directory, "project.basproj"), /DIRECTORY_PERMISSION_REQUIRED/);
  assert.equal(wrote, false);
});

test("aborts the writable stream when writing fails", async () => {
  let aborted = false;
  const existing = JSON.stringify(project);
  const fileHandle = {
    getFile: async () => new File([existing], "project.basproj"),
    createWritable: async () => ({
      write: async () => { throw new Error("disk full"); },
      close: async () => { throw new Error("unexpected close"); },
      abort: async () => { aborted = true; }
    })
  };
  const directory = { queryPermission: async () => "granted", getFileHandle: async () => fileHandle, getDirectoryHandle: async () => fakeBackupDirectory() } as unknown as FileSystemDirectoryHandle;
  const opened = await openBrowserProject(directory, "project.basproj");
  await assert.rejects(saveBrowserProject(opened, project), /disk full/);
  assert.equal(aborted, true);
});

test("serializes project saves with Web Locks when available", async () => {
  const fs = directoryFixture(JSON.stringify(project));
  const opened = await openBrowserProject(fs.directory, "project.basproj");
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let lockName = "";
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: {
    request: async (name: string, _options: unknown, callback: () => Promise<unknown>) => { lockName = name; return callback(); }
  } } });
  try {
    await saveBrowserProject(opened, project);
    assert.equal(lockName, "danmakucut-project:project-1");
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("disk removal validates project identity and removes only the project file", async () => {
  const { deleteBrowserProjectFile } = await import("../src/services/storage/browserProjectFile");
  let removed = "";
  const contents = JSON.stringify(project);
  const directory = {
    queryPermission: async () => "granted",
    getFileHandle: async () => ({ getFile: async () => new File([contents], "project.basproj") }),
    getDirectoryHandle: async () => fakeBackupDirectory(),
    removeEntry: async (name: string) => { removed = name; }
  } as unknown as FileSystemDirectoryHandle;
  await assert.rejects(deleteBrowserProjectFile({ projectId: "other", directory, fileName: "project.basproj" }), /PROJECT_ID_MISMATCH/);
  assert.equal(removed, "");
  await deleteBrowserProjectFile({ projectId: project.id, directory, fileName: "project.basproj" });
  assert.equal(removed, "project.basproj");
});


test("backup copies previous content at most once per interval", async () => {
  const { backupBrowserProject } = await import("../src/services/storage/browserBackups");
  const files = new Map<string, string>();
  const backupDir = {
    values: async function* () { for (const name of files.keys()) yield { kind: "file", name }; },
    getFileHandle: async (name: string) => ({ createWritable: async () => { let value = ""; return { write: async (text: string) => { value = text; }, close: async () => { files.set(name, value); }, abort: async () => {} }; } }),
    removeEntry: async (name: string) => { files.delete(name); }
  };
  const dir = { getDirectoryHandle: async () => backupDir } as unknown as FileSystemDirectoryHandle;
  await backupBrowserProject(dir, "old", 1_000_000);
  await backupBrowserProject(dir, "new", 1_000_001);
  assert.deepEqual([...files.values()], ["old"]);
  await backupBrowserProject(dir, "new", 1_300_001);
  assert.deepEqual([...files.values()], ["old", "new"]);
  await backupBrowserProject(dir, "before restore", 1_300_002, true);
  assert.deepEqual([...files.values()], ["old", "new", "before restore"]);
});

test("project assets reject traversal and preserve copied audio", async () => {
  const { writeProjectAudio, readProjectAudio } = await import("../src/services/storage/projectAssets");
  const files = new Map<string, File>();
  const audio = {
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (!files.has(name) && !options?.create) throw new DOMException("Missing", "NotFoundError");
      return {
        getFile: async () => files.get(name)!,
        createWritable: async () => { let file: File; return { write: async (value: File) => { file = value; }, close: async () => { files.set(name, file); }, abort: async () => {} }; }
      };
    }
  };
  const assets = { getDirectoryHandle: async () => audio };
  const dir = { getDirectoryHandle: async () => assets } as unknown as FileSystemDirectoryHandle;
  await assert.rejects(writeProjectAudio(dir, "../x", new File(["audio"], "source.wav")), /INVALID_ASSET_NAME/);
  await writeProjectAudio(dir, "safe.audio", new File(["audio"], "source.wav"));
  assert.equal(await (await readProjectAudio(dir, "safe.audio")).text(), "audio");
  await assert.rejects(writeProjectAudio(dir, "safe.audio", new File(["new"], "other.wav")), /ASSET_ALREADY_EXISTS/);
  assert.equal(await (await readProjectAudio(dir, "safe.audio")).text(), "audio");
});

test("disk removal preserves project-owned assets and backups", async () => {
  const { deleteBrowserProjectFile } = await import("../src/services/storage/browserProjectFile");
  const deleted: string[] = [];
  const projectWithAsset = { ...project, audioMeta: [{ id: "audio-1", name: "sound", relativePath: "owned.audio" }] };
  const backups = {
    values: async function* () { yield { kind: "file", name: "backup-1000-aaaaaaaa.basproj" }; yield { kind: "file", name: "unrelated.txt" }; },
    removeEntry: async (name: string) => { deleted.push(`backup/${name}`); }
  };
  const audio = { removeEntry: async (name: string) => { deleted.push(`audio/${name}`); } };
  const root = {
    queryPermission: async () => "granted",
    getFileHandle: async () => ({ getFile: async () => new File([JSON.stringify(projectWithAsset)], "project.basproj") }),
    getDirectoryHandle: async (name: string) => name === "assets" ? { getDirectoryHandle: async () => audio } : backups,
    removeEntry: async (name: string) => { deleted.push(name); }
  } as unknown as FileSystemDirectoryHandle;
  await deleteBrowserProjectFile({ projectId: project.id, directory: root, fileName: "project.basproj" });
  assert.deepEqual(deleted, ["project.basproj"]);
});

test("a validated backup can recover corrupted project JSON", async () => {
  const { restoreBrowserProjectFile } = await import("../src/services/storage/browserProjectFile");
  const fs = directoryFixture("{corrupt");
  const restored = await restoreBrowserProjectFile({ projectId: project.id, directory: fs.directory, fileName: "project.basproj" }, project);
  assert.equal(restored.project.id, project.id);
  assert.equal(JSON.parse(fs.read()!).name, project.name);
});

test("missing browser project is recovered under a fresh filename", async () => {
  const { restoreBrowserProjectFile, findBrowserProjectFile } = await import("../src/services/storage/browserProjectFile");
  const files = new Map<string, string>();
  const dir = {
    queryPermission: async () => "granted",
    values: async function* () { for (const name of files.keys()) yield { kind: "file", name }; },
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (!files.has(name) && !options?.create) throw new DOMException("Missing", "NotFoundError");
      if (options?.create) files.set(name, "");
      return { getFile: async () => new File([files.get(name)!], name), createWritable: async () => { let text = ""; return { write: async (value: string) => { text = value; }, close: async () => { files.set(name, text); }, abort: async () => {} }; } };
    },
    getDirectoryHandle: async (name: string) => {
      if (name.endsWith(".basproj")) throw new DOMException("Missing", "NotFoundError");
      return fakeBackupDirectory();
    }
  } as unknown as FileSystemDirectoryHandle;
  const restored = await restoreBrowserProjectFile({ projectId: project.id, directory: dir, fileName: "project.basproj" }, project);
  assert.match(restored.fileName, /^recovered-/);
  assert.equal(await findBrowserProjectFile(dir), restored.fileName);
  assert.equal(JSON.parse(files.get(restored.fileName)!).id, project.id);
});
