import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { BasProjectData } from "@/types/storage";
import { normalizeProjectData, serializeProjectData } from "@/core/projectSchema";
export type DesktopProjectSession = { directory: string; contents: string; project: BasProjectData };

/** Must be called directly from the user's click. */
export async function pickDesktopDirectory(): Promise<string | null> {
  return await open({ directory: true, multiple: false });
}

export async function pickDesktopProjectFile(): Promise<string | null> {
  return await open({ multiple: false, filters: [{ name: "BAS Project", extensions: ["basproj"] }] });
}

export function projectFileName(name: string): string {
  const base = name.trim().replace(/\.basproj$/i, "");
  if (!base || base === "." || base === ".." || /[\\/:*?"<>|\0]/.test(base) || /[. ]$/.test(base)) {
    throw new Error("INVALID_PROJECT_FILE_NAME");
  }
  return `${base}.basproj`;
}

export async function createDesktopProject(directory: string, project: BasProjectData): Promise<DesktopProjectSession> {
  const contents = JSON.stringify(serializeProjectData(project), null, 2);
  const path = `${directory.replace(/[\\/]$/, "")}/${projectFileName(project.name)}`;
  await invoke("reserve_project_support", { directory: path });
  await invoke("create_disk_project", { directory: path, contents });
  return { directory: path, contents, project };
}
export async function openDesktopProject(directory: string, expectedId?: string): Promise<DesktopProjectSession> {
  const path = /\.basproj$/i.test(directory) ? directory : `${directory.replace(/[\\/]$/, "")}/project.basproj`;
  const contents = await invoke<string>("read_disk_project", { directory: path });
  const project = normalizeProjectData(JSON.parse(contents));
  if (expectedId && project.id !== expectedId) throw new Error("PROJECT_ID_MISMATCH");
  return { directory: path, contents, project };
}
export async function saveDesktopProject(session: DesktopProjectSession, project: BasProjectData): Promise<DesktopProjectSession> {
  if (project.id !== session.project.id) throw new Error("PROJECT_ID_MISMATCH");
  const contents = JSON.stringify(serializeProjectData(project), null, 2);
  await invoke("save_disk_project", { directory: session.directory, expected: session.contents, contents, forceBackup: false });
  return { ...session, contents, project };
}

/** Returns a file backed by an explicitly selected path; the original is never modified. */
export async function pickDesktopAudio(): Promise<{ file: File; path: string } | null> {
  const path = await open({ multiple: false, filters: [{ name: "Audio", extensions: ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"] }] });
  return path ? { file: await readDesktopAudio(path), path } : null;
}
export async function readDesktopAudio(path: string, mimeType = "audio/*"): Promise<File> {
  const bytes = await invoke<number[]>("read_audio_reference", { path });
  const name = path.split(/[\\/]/).pop() || "audio";
  return new File([new Uint8Array(bytes)], name, { type: mimeType });
}

export async function deleteDesktopProjectFile(directory: string, projectId: string): Promise<void> {
  await invoke("delete_disk_project_file", { directory, projectId });
}

