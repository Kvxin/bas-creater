import { backupBrowserProject, listBrowserBackups } from "./browserBackups";
import type { BasProjectData } from "@/types/storage";
import { idbDelete, idbGet, idbSet, STORES } from "./indexedDB";
import { normalizeProjectData } from "./projectSchema";

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
  fingerprint: string;
  project: BasProjectData;
};

/** 目录句柄只作为最近项目索引；项目内容以用户目录中的文件为准。 */
export type BrowserProjectLocation = {
  projectId: string;
  directory: FileSystemDirectoryHandle;
  fileName: string;
};

const LOCATION_PREFIX = "browser-project-location:";

export async function rememberBrowserProject(location: BrowserProjectLocation): Promise<void> {
  validateFileName(location.fileName);
  await idbSet(STORES.PROJECTS, LOCATION_PREFIX + location.projectId, location);
}

export async function findBrowserProjectLocation(projectId: string): Promise<BrowserProjectLocation | null> {
  return idbGet<BrowserProjectLocation>(STORES.PROJECTS, LOCATION_PREFIX + projectId);
}

/** 移除最近项目记录，不删除用户目录中的任何文件。 */
export async function forgetBrowserProject(projectId: string): Promise<void> {
  await idbDelete(STORES.PROJECTS, LOCATION_PREFIX + projectId);
}

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

export async function openBrowserProject(directory: FileSystemDirectoryHandle, fileName: string): Promise<BrowserProjectFile> {
  validateFileName(fileName);
  if (!(await ensureDirectoryPermission(directory))) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
  const file = await (await directory.getFileHandle(fileName)).getFile();
  const contents = await file.text();
  return { directory, fileName, project: normalizeProjectData(JSON.parse(contents)), fingerprint: await digest(contents) };
}

/** 只在用户选定的空目录中初始化文件，已有文件或目录都不覆盖。 */
export async function createBrowserProject(
  directory: FileSystemDirectoryHandle,
  fileName: string,
  project: BasProjectData
): Promise<BrowserProjectFile> {
  validateFileName(fileName);
  if (!(await ensureDirectoryPermission(directory))) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
  const iterable = directory as FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> };
  for await (const _entry of iterable.values()) throw new Error("DIRECTORY_NOT_EMPTY");
  const normalized = normalizeProjectData(project);
  const contents = JSON.stringify(normalized, null, 2);
  const handle = await directory.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(contents);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
  return { directory, fileName, project: normalized, fingerprint: await digest(contents) };
}

/** 检测外部更改后才写入；浏览器文件系统 API 不提供跨进程原子比较并交换。 */
export async function saveBrowserProject(opened: BrowserProjectFile, project: BasProjectData, forceBackup = false): Promise<BrowserProjectFile> {
  validateFileName(opened.fileName);
  if (!(await ensureDirectoryPermission(opened.directory))) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
  const save = async (): Promise<BrowserProjectFile> => {
    const handle = await opened.directory.getFileHandle(opened.fileName);
    const current = await (await handle.getFile()).text();
    if ((await digest(current)) !== opened.fingerprint) throw new Error("PROJECT_MODIFIED_EXTERNALLY");
    const normalized = normalizeProjectData(project);
    if (normalized.id !== opened.project.id) throw new Error("PROJECT_ID_MISMATCH");
    const contents = JSON.stringify(normalized, null, 2);
    await backupBrowserProject(opened.directory, current, Date.now(), forceBackup);
    if ((await digest(await (await handle.getFile()).text())) !== opened.fingerprint) throw new Error("PROJECT_MODIFIED_EXTERNALLY");
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
  if (!(await ensureDirectoryPermission(location.directory, true))) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
  const opened = await openBrowserProject(location.directory, location.fileName);
  if (opened.project.id !== location.projectId) throw new Error("PROJECT_ID_MISMATCH");
  const assets = opened.project.audioMeta.filter((item) => item.relativePath).map((item) => item.relativePath!);
  for (const name of assets) if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(name) || name.includes("..")) throw new Error("INVALID_ASSET_NAME");
  if (assets.length) {
    const audio = await (await location.directory.getDirectoryHandle("assets")).getDirectoryHandle("audio");
    for (const name of assets) {
      try { await audio.removeEntry(name); }
      catch (error) { if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error; }
    }
  }
  const backups = await listBrowserBackups(location.directory);
  if (backups.length) {
    const backupDirectory = await location.directory.getDirectoryHandle(".danmakucut-backups");
    for (const name of backups) await backupDirectory.removeEntry(name);
  }
  await location.directory.removeEntry(location.fileName);
}

/** Restore a validated backup even when the current project JSON is corrupt. */
export async function restoreBrowserProjectFile(location: BrowserProjectLocation, backup: BasProjectData): Promise<BrowserProjectFile> {
  validateFileName(location.fileName);
  if (!(await ensureDirectoryPermission(location.directory, true))) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
  if (backup.id !== location.projectId) throw new Error("PROJECT_ID_MISMATCH");
  const contents = await (await (await location.directory.getFileHandle(location.fileName)).getFile()).text();
  try {
    const raw = JSON.parse(contents) as { id?: unknown };
    if (raw && typeof raw === "object" && typeof raw.id === "string" && raw.id !== location.projectId) throw new Error("PROJECT_ID_MISMATCH");
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return saveBrowserProject({ directory: location.directory, fileName: location.fileName, project: backup, fingerprint: await digest(contents) }, backup, true);
}
