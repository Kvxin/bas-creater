import type { BasProjectData } from "@/types/storage";
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

/** 检测外部更改后才写入；浏览器文件系统 API 不提供跨进程原子比较并交换。 */
export async function saveBrowserProject(opened: BrowserProjectFile, project: BasProjectData): Promise<BrowserProjectFile> {
  validateFileName(opened.fileName);
  if (!(await ensureDirectoryPermission(opened.directory))) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
  const handle = await opened.directory.getFileHandle(opened.fileName);
  const current = await (await handle.getFile()).text();
  if ((await digest(current)) !== opened.fingerprint) throw new Error("PROJECT_MODIFIED_EXTERNALLY");
  const normalized = normalizeProjectData(project);
  if (normalized.id !== opened.project.id) throw new Error("PROJECT_ID_MISMATCH");
  const contents = JSON.stringify(normalized, null, 2);
  const writable = await handle.createWritable();
  try {
    await writable.write(contents);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
  return { ...opened, project: normalized, fingerprint: await digest(contents) };
}
