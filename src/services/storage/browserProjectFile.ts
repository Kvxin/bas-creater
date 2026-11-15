import { backupBrowserProject } from "./browserBackups";
import type { BasProjectData } from "@/types/storage";
import { normalizeProjectData, serializeProjectData } from "./projectSchema";

type DirectoryPermission = FileSystemDirectoryHandle & {
  queryPermission(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
};

type DirectoryPicker = Window & {
  showDirectoryPicker(options?: { mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle>;
};

export type BrowserProjectFile = {
  directory: FileSystemDirectoryHandle;
  fileName: string;
  assetDirectory: FileSystemDirectoryHandle;
  fingerprint: string;
  project: BasProjectData;
};

export type BrowserProjectLocation = {
  projectId: string;
  directory: FileSystemDirectoryHandle;
  fileName: string;
};


/** 文件夹权限可能在页面重启或浏览器重启后失效。申请权限必须由用户操作触发。 */
export async function ensureDirectoryPermission(directory: FileSystemDirectoryHandle, request = false): Promise<boolean> {
  const handle = directory as DirectoryPermission;
  if (typeof handle.queryPermission !== "function") return false;
  if ((await handle.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return request && typeof handle.requestPermission === "function" &&
    (await handle.requestPermission({ mode: "readwrite" })) === "granted";
}

export async function pickProjectDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!("showDirectoryPicker" in window)) throw new Error("DIRECTORY_PICKER_UNSUPPORTED");
  return (window as DirectoryPicker).showDirectoryPicker({ mode: "readwrite" });
}

/** 只能访问选定目录中的直接子文件，不能使用路径分隔符或相对路径穿越。 */
function validateFileName(fileName: string): void {
  if (!fileName || fileName === "." || fileName === ".." || /[\\/\0]/.test(fileName) || !fileName.endsWith(".basproj")) {
    throw new Error("INVALID_PROJECT_FILE_NAME");
  }
}

async function digest(contents: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(contents));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readCurrentProject(opened: BrowserProjectFile): Promise<string> {
  try { return await (await (await opened.directory.getFileHandle(opened.fileName)).getFile()).text(); }
  catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") throw new Error("PROJECT_MODIFIED_EXTERNALLY");
    throw error;
  }
}

export async function browserProjectHasChanged(opened: BrowserProjectFile): Promise<boolean> {
  if (!(await ensureDirectoryPermission(opened.directory))) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
  try { return await digest(await readCurrentProject(opened)) !== opened.fingerprint; }
  catch (error) {
    if (error instanceof Error && error.message === "PROJECT_MODIFIED_EXTERNALLY") return true;
    throw error;
  }
}

/** 迁移旧版浏览器目录时保留原文件，遇到冲突绝不覆盖。 */
async function copyLegacyDirectory(source: FileSystemDirectoryHandle, target: FileSystemDirectoryHandle): Promise<void> {
  for await (const entry of (source as FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> }).values()) {
    if (entry.kind === "directory") {
      await copyLegacyDirectory(
        await source.getDirectoryHandle(entry.name),
        await target.getDirectoryHandle(entry.name, { create: true })
      );
      continue;
    }
    const file = await (await source.getFileHandle(entry.name)).getFile();
    let existing: File | undefined;
    try { existing = await (await target.getFileHandle(entry.name)).getFile(); }
    catch (error) { if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error; }
    if (existing) {
      if (file.size !== existing.size) throw new Error("SUPPORT_DIRECTORY_CONFLICT");
      const chunkSize = 1024 * 1024;
      for (let offset = 0; offset < file.size; offset += chunkSize) {
        const left = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer());
        const right = new Uint8Array(await existing.slice(offset, offset + chunkSize).arrayBuffer());
        if (left.some((byte, index) => byte !== right[index])) throw new Error("SUPPORT_DIRECTORY_CONFLICT");
      }
      continue;
    }
    const writer = await (await target.getFileHandle(entry.name, { create: true })).createWritable();
    try { await writer.write(file); await writer.close(); }
    catch (error) { await writer.abort().catch(() => {}); throw error; }
  }
}

export async function browserProjectSupportDirectory(directory: FileSystemDirectoryHandle, fileName: string, id: string): Promise<FileSystemDirectoryHandle> {
  validateFileName(fileName);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("INVALID_PROJECT_ID");
  let legacy: FileSystemDirectoryHandle | undefined;
  try { legacy = await directory.getDirectoryHandle(`.danmakucut-${id}`); }
  catch (error) { if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error; }
  const support = await directory.getDirectoryHandle(`.${fileName}.danmakucut`, { create: true });
  if (legacy) {
    const marker = `.legacy-${id}.migrated`;
    try { await support.getFileHandle(marker); return support; }
    catch (error) { if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error; }
    await copyLegacyDirectory(legacy, support);
    const writer = await (await support.getFileHandle(marker, { create: true })).createWritable();
    try { await writer.close(); }
    catch (error) { await writer.abort().catch(() => {}); throw error; }
  }
  return support;
}

export async function openBrowserProject(directory: FileSystemDirectoryHandle, fileName: string): Promise<BrowserProjectFile> {
  validateFileName(fileName);
  if (!(await ensureDirectoryPermission(directory))) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
  const file = await (await directory.getFileHandle(fileName)).getFile();
  const contents = await file.text();
  const project = normalizeProjectData(JSON.parse(contents));
  return { directory, fileName, project, assetDirectory: await browserProjectSupportDirectory(directory, fileName, project.id), fingerprint: await digest(contents) };
}

/** Create a named project without replacing a file in the selected directory. */
export async function createBrowserProject(
  directory: FileSystemDirectoryHandle,
  fileName: string,
  project: BasProjectData
): Promise<BrowserProjectFile> {
  validateFileName(fileName);
  if (!(await ensureDirectoryPermission(directory))) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
  const create = async (): Promise<BrowserProjectFile> => {
  try { await directory.getFileHandle(fileName); throw new Error("PROJECT_ALREADY_EXISTS"); }
  catch (error) { if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error; }
  try { await directory.getDirectoryHandle(fileName); throw new Error("PROJECT_ALREADY_EXISTS"); }
  catch (error) { if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error; }
  const normalized = normalizeProjectData(project);
  const contents = JSON.stringify(serializeProjectData(normalized), null, 2);
  const handle = await directory.getFileHandle(fileName, { create: true });
  if ((await (await handle.getFile()).size) !== 0) throw new Error("PROJECT_ALREADY_EXISTS");
  const writable = await handle.createWritable();
  try {
    await writable.write(contents);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
  return { directory, fileName, assetDirectory: await browserProjectSupportDirectory(directory, fileName, normalized.id), project: normalized, fingerprint: await digest(contents) };
  };
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(`danmakucut-create:${fileName}`, { mode: "exclusive" }, create);
  }
  return create();
}

/** 检测外部更改后才写入；浏览器文件系统 API 不提供跨进程原子比较并交换。 */
export async function saveBrowserProject(opened: BrowserProjectFile, project: BasProjectData, forceBackup = false): Promise<BrowserProjectFile> {
  validateFileName(opened.fileName);
  if (!(await ensureDirectoryPermission(opened.directory))) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
  const save = async (): Promise<BrowserProjectFile> => {
    const current = await readCurrentProject(opened);
    if ((await digest(current)) !== opened.fingerprint) throw new Error("PROJECT_MODIFIED_EXTERNALLY");
    const normalized = normalizeProjectData(project);
    if (normalized.id !== opened.project.id) throw new Error("PROJECT_ID_MISMATCH");
    const contents = JSON.stringify(serializeProjectData(normalized), null, 2);
    await backupBrowserProject(opened.assetDirectory, current, Date.now(), forceBackup);
    if ((await digest(await readCurrentProject(opened))) !== opened.fingerprint) throw new Error("PROJECT_MODIFIED_EXTERNALLY");
    const handle = await opened.directory.getFileHandle(opened.fileName);
    const writable = await handle.createWritable();
    try {
      await writable.write(contents);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => {});
      throw error;
    }
    return { ...opened, project: normalized, fingerprint: await digest(contents) };
  };
  // 跨标签页串行化同一项目；外部程序仍可能在检查和写入之间更改文件。
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(`danmakucut-project:${opened.project.id}`, { mode: "exclusive" }, save);
  }
  return save();
}

/** Removes only the matching project file, never the selected directory or referenced assets. */
export async function deleteBrowserProjectFile(location: BrowserProjectLocation): Promise<void> {
  validateFileName(location.fileName);
  if (!(await ensureDirectoryPermission(location.directory, true))) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
  const contents = await (await (await location.directory.getFileHandle(location.fileName)).getFile()).text();
  if (normalizeProjectData(JSON.parse(contents)).id !== location.projectId) throw new Error("PROJECT_ID_MISMATCH");
  await location.directory.removeEntry(location.fileName);
}

/** Restore a validated backup even when the current project JSON is corrupt. */
export async function restoreBrowserProjectFile(location: BrowserProjectLocation, backup: BasProjectData): Promise<BrowserProjectFile> {
  validateFileName(location.fileName);
  if (!(await ensureDirectoryPermission(location.directory, true))) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
  if (backup.id !== location.projectId) throw new Error("PROJECT_ID_MISMATCH");
  let contents: string;
  try {
    contents = await (await (await location.directory.getFileHandle(location.fileName)).getFile()).text();
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
    // 使用新文件名避免覆盖并发重建的项目，同时保留原项目的附属数据。
    const recoveredName = `recovered-${crypto.randomUUID()}.basproj`;
    const currentSupport = await browserProjectSupportDirectory(location.directory, location.fileName, backup.id);
    const recoveredSupport = await location.directory.getDirectoryHandle(`.${recoveredName}.danmakucut`, { create: true });
    await copyLegacyDirectory(currentSupport, recoveredSupport);
    return createBrowserProject(location.directory, recoveredName, backup);
  }
  try {
    const raw = JSON.parse(contents) as { id?: unknown; version?: unknown };
    if (raw && typeof raw === "object" && typeof raw.id === "string" && raw.id !== location.projectId) throw new Error("PROJECT_ID_MISMATCH");
    if (typeof raw?.version === "number" && raw.version > backup.version) throw new Error("UNSUPPORTED_PROJECT_VERSION");
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return saveBrowserProject({ directory: location.directory, fileName: location.fileName, assetDirectory: await browserProjectSupportDirectory(location.directory, location.fileName, backup.id), project: backup, fingerprint: await digest(contents) }, backup, true);
}

/** Find a project by identity after the user reselects its directory. */
export async function findBrowserProjectFile(directory: FileSystemDirectoryHandle, expectedId?: string): Promise<string> {
  const names: string[] = [];
  const iterable = directory as FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> };
  for await (const entry of iterable.values()) {
    if (entry.kind !== "file" || !entry.name.toLowerCase().endsWith(".basproj")) continue;
    if (expectedId) {
      try {
        const raw = JSON.parse(await (await (await directory.getFileHandle(entry.name)).getFile()).text()) as { id?: unknown };
        if (raw?.id !== expectedId) continue;
      } catch { continue; }
    }
    names.push(entry.name);
  }
  if (!expectedId && names.length > 1) {
    const selected = window.prompt(`Select a project file:\n${names.join("\n")}`);
    if (selected === null) throw new DOMException("Cancelled", "AbortError");
    if (names.includes(selected)) return selected;
  }
  if (names.length !== 1) throw new Error("PROJECT_FILE_NOT_FOUND_OR_AMBIGUOUS");
  return names[0]!;
}
