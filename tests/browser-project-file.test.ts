import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserProject, openBrowserProject, saveBrowserProject } from "../src/services/storage/browserProjectFile";
import { ensureBrowserMediaPermission, readBrowserMedia } from "../src/services/storage/browserMediaFile";

const project = { version: 2, id: "project-1", name: "Project", createdAt: 1, updatedAt: 1,
  canvas: { width: 800, height: 450 }, timeline: { duration: 0 }, danmus: [], audioMeta: [], tracks: [] };

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
