import { invoke } from "@tauri-apps/api/core";
import type { BasProjectData } from "@/types/storage";
import { projectFileName } from "./desktopProjectFile";
import { createBrowserProject, ensureDirectoryPermission } from "./browserProjectFile";
import { serializeProjectData } from "@/core/projectSchema";

export type BundleTarget = {
  directory: string | FileSystemDirectoryHandle;
  assetDirectory: string | FileSystemDirectoryHandle;
  fileName: string;
};

export async function createBundleTarget(directory: string | FileSystemDirectoryHandle, name: string, projectId: string): Promise<BundleTarget> {
  const fileName = projectFileName(name);
  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) throw new Error("INVALID_PROJECT_ID");
  if (typeof directory === "string") {
    const path = `${directory.replace(/[\\/]$/, "")}/${fileName}`;
    await invoke("reserve_project_support", { directory: path });
    return { directory, assetDirectory: path, fileName };
  }
  if (!(await ensureDirectoryPermission(directory, true))) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
  try { await directory.getFileHandle(fileName); throw new Error("PROJECT_ALREADY_EXISTS"); }
  catch (error) { if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error; }
  const supportName = `.${fileName}.danmakucut`;
  try { await directory.getDirectoryHandle(supportName); throw new Error("PROJECT_ALREADY_EXISTS"); }
  catch (error) { if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error; }
  return { directory, assetDirectory: await directory.getDirectoryHandle(supportName, { create: true }), fileName };
}

export async function commitBundleTarget(target: BundleTarget, project: BasProjectData): Promise<void> {
  if (typeof target.directory === "string") {
    await invoke("create_disk_project", { directory: target.assetDirectory, contents: JSON.stringify(serializeProjectData(project), null, 2) });
  } else {
    await createBrowserProject(target.directory, target.fileName, project);
  }
}

function validate(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(name) || name.includes("..")) throw new Error("INVALID_ASSET_NAME");
}
async function webAudioDirectory(directory: FileSystemDirectoryHandle, create: boolean): Promise<FileSystemDirectoryHandle> {
  return (await directory.getDirectoryHandle("assets", { create })).getDirectoryHandle("audio", { create });
}
export async function writeProjectAudio(directory: string | FileSystemDirectoryHandle, name: string, file: File): Promise<void> {
  validate(name);
  if (typeof directory === "string") {
    await invoke("write_project_audio", { directory, name, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
  } else {
    const audio = await webAudioDirectory(directory, true);
    // Assets use fresh UUID-based names. Never overwrite a pre-existing file.
    try { await audio.getFileHandle(name); throw new Error("ASSET_ALREADY_EXISTS"); }
    catch (error) { if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error; }
    const handle = await audio.getFileHandle(name, { create: true });
    const writer = await handle.createWritable();
    try { await writer.write(file); await writer.close(); }
    catch (error) { await writer.abort().catch(() => {}); throw error; }
  }
}
export async function readProjectAudio(directory: string | FileSystemDirectoryHandle, name: string, type?: string): Promise<File> {
  validate(name);
  if (typeof directory === "string") {
    const bytes = await invoke<number[]>("read_project_audio", { directory, name });
    return new File([new Uint8Array(bytes)], name, { type });
  }
  const file = await (await (await webAudioDirectory(directory, false)).getFileHandle(name)).getFile();
  return type && !file.type ? new File([file], name, { type, lastModified: file.lastModified }) : file;
}
