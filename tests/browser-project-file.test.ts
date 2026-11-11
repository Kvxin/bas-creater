import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserProject, openBrowserProject, saveBrowserProject } from "../src/services/storage/browserProjectFile";
import { ensureBrowserMediaPermission, readBrowserMedia } from "../src/services/storage/browserMediaFile";

const project = { version: 2, id: "project-1", name: "Project", createdAt: 1, updatedAt: 1,
  canvas: { width: 800, height: 450 }, timeline: { duration: 0 }, danmus: [], audioMeta: [], tracks: [] };

function fakeBackupDirectory() {
  return { values: async function* () {}, getFileHandle: async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }) }), removeEntry: async () => {} };
}

function directoryFixture(initial?: string) {
  let contents = initial;
  const fileHandle = {
    kind: "file", name: "project.basproj",
    getFile: async () => new File([contents ?? ""], "project.basproj"),
    createWritable: async () => {
      let next = "";
      return { write: async (data: string) => { next = data; }, close: async () => { contents = next; }, abort: async () => {} };
    }
  };
  const directory = {
    kind: "directory", name: "project", queryPermission: async () => "granted",
    getDirectoryHandle: async () => fakeBackupDirectory(),
    values: async function* () { if (contents !== undefined) yield fileHandle; },
    getFileHandle: async (_name: string, options?: { create?: boolean }) => {
      if (contents === undefined && !options?.create) throw new DOMException("Missing", "NotFoundError");
      return fileHandle;
    }
  } as unknown as FileSystemDirectoryHandle;
  return { directory, read: () => contents, modify: (value: string) => { contents = value; } };
}

test("creates a project only in an empty directory", async () => {
  const fs = directoryFixture();
  const opened = await createBrowserProject(fs.directory, "project.basproj", project);
  assert.equal(opened.project.id, "project-1");
  assert.equal(JSON.parse(fs.read()!).id, "project-1");
  await assert.rejects(createBrowserProject(fs.directory, "project.basproj", project), /DIRECTORY_NOT_EMPTY/);
});

test("saves a project and refuses externally modified files", async () => {
  const fs = directoryFixture(JSON.stringify(project));
  const opened = await openBrowserProject(fs.directory, "project.basproj");
  const saved = await saveBrowserProject(opened, { ...project, name: "Changed" });
  assert.equal(JSON.parse(fs.read()!).name, "Changed");
  fs.modify(JSON.stringify({ ...project, name: "External" }));
  await assert.rejects(saveBrowserProject(saved, project), /PROJECT_MODIFIED_EXTERNALLY/);
  assert.equal(JSON.parse(fs.read()!).name, "External");
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
