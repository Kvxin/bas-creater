import { invoke } from "@tauri-apps/api/core";

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
