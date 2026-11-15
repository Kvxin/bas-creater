import { readProjectAudio } from "./projectAssets";
import { invoke } from "@tauri-apps/api/core";
import { listBrowserBackups, readBrowserBackup } from "./browserBackups";
import type { AudioResource } from "@/types/resource";
import type { BasProjectData, ProjectAsset } from "@/types/storage";
import { createDesktopProject, openDesktopProject, saveDesktopProject, readDesktopAudio, deleteDesktopProjectFile, projectFileName, type DesktopProjectSession } from "./desktopProjectFile";
import { normalizeProjectData, serializeProjectData, PROJECT_VERSION } from "./projectSchema";
import { isDesktopApp, saveTextFile } from "@/utils/desktop";
import { browserProjectHasChanged, browserProjectSupportDirectory, createBrowserProject, deleteBrowserProjectFile, findBrowserProjectFile, ensureDirectoryPermission, openBrowserProject, pickProjectDirectory, restoreBrowserProjectFile, saveBrowserProject, type BrowserProjectFile } from "./browserProjectFile";
import { deleteBrowserProjectHandle, loadBrowserProjectHandles, saveBrowserProjectHandle } from "./browserProjectHandles";

export type RecentProject = { id: string; name: string; createdAt: number; updatedAt: number; directory?: string; fileName?: string };

const RECENT_PROJECTS_KEY = "danmakucut-recent-projects";
const browserSessions = new Map<string, BrowserProjectFile>();
const desktopSessions = new Map<string, DesktopProjectSession>();
const browserRecoveryDirectories = new Map<string, FileSystemDirectoryHandle>();
const browserDirectories = new Map<string, FileSystemDirectoryHandle>();

async function rememberBrowserDirectory(id: string, directory: FileSystemDirectoryHandle): Promise<void> {
  browserDirectories.set(id, directory);
  if (typeof indexedDB === "undefined") return;
  try { await saveBrowserProjectHandle(id, directory); }
  catch (error) { console.warn("[ProjectStorage] Failed to remember directory handle:", error); }
}

async function accessBrowserDirectory(id: string): Promise<FileSystemDirectoryHandle> {
  const saved = browserSessions.get(id)?.directory ?? browserDirectories.get(id);
  const permission = saved
    ? (saved as FileSystemDirectoryHandle & { requestPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState> })
      .requestPermission?.({ mode: "readwrite" })
    : undefined;
  const directory = saved ?? await pickProjectDirectory();
  if (permission ? await permission !== "granted" : !(await ensureDirectoryPermission(directory, true))) {
    throw new Error("DIRECTORY_PERMISSION_REQUIRED");
  }
  return directory;
}

function parseRecentProjects(raw: string | null): RecentProject[] {
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error("INVALID_RECENT_PROJECTS");
  return value.filter((item): item is RecentProject =>
    item && typeof item.id === "string" && typeof item.name === "string" &&
    typeof item.createdAt === "number" && typeof item.updatedAt === "number" &&
    (item.directory === undefined || typeof item.directory === "string") &&
    (item.fileName === undefined || typeof item.fileName === "string")
  ).map(({ id, name, createdAt, updatedAt, directory, fileName }) => ({
    id, name, createdAt, updatedAt, ...(directory === undefined ? {} : { directory }), ...(fileName === undefined ? {} : { fileName })
  }));
}

function browserRecentProjects(): RecentProject[] {
  return parseRecentProjects(localStorage.getItem(RECENT_PROJECTS_KEY));
}

// Serialize the entire read/modify/write operation, including migration.
let recentQueue: Promise<void> = Promise.resolve();
function withRecentProjects<T>(operation: () => Promise<T>): Promise<T> {
  const result = recentQueue.then(operation);
  recentQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function readDesktopRecentProjects(): Promise<RecentProject[]> {
  const projects = parseRecentProjects(await invoke<string>("read_recent_projects"));
  const legacy = localStorage.getItem(RECENT_PROJECTS_KEY);
  if (legacy === null) return projects;
  const legacyProjects = parseRecentProjects(legacy);
  const ids = new Set(projects.map((project) => project.id));
  const merged = [...projects];
  for (const project of legacyProjects) {
    if (!ids.has(project.id)) {
      merged.push(project);
      ids.add(project.id);
    }
  }
  await invoke("write_recent_projects", { contents: JSON.stringify(merged) });
  if (localStorage.getItem(RECENT_PROJECTS_KEY) === legacy) localStorage.removeItem(RECENT_PROJECTS_KEY);
  return merged;
}

function recentProjects(): Promise<RecentProject[]> {
  return isDesktopApp()
    ? withRecentProjects(readDesktopRecentProjects)
    : Promise.resolve(browserRecentProjects());
}

function updateRecentProjects(update: (projects: RecentProject[]) => RecentProject[]): Promise<void> {
  if (!isDesktopApp()) {
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(update(browserRecentProjects())));
    return Promise.resolve();
  }
  return withRecentProjects(async () => {
    const projects = await readDesktopRecentProjects();
    await invoke("write_recent_projects", { contents: JSON.stringify(update(projects)) });
  });
}

function rememberProject(project: BasProjectData, directory?: string): Promise<void> {
  const entry: RecentProject = {
    id: project.id, name: project.name, createdAt: project.createdAt, updatedAt: project.updatedAt,
    ...(directory === undefined ? {} : { directory }),
    ...(browserSessions.get(project.id)?.fileName ? { fileName: browserSessions.get(project.id)!.fileName } : {})
  };
  return updateRecentProjects((projects) => [entry, ...projects.filter((item) => item.id !== project.id)]);
}

async function recentProject(id: string): Promise<RecentProject | undefined> {
  return (await recentProjects()).find((item) => item.id === id);
}

export function projectSessionDirectory(id: string): string | FileSystemDirectoryHandle | null {
  return desktopSessions.get(id)?.directory ?? browserSessions.get(id)?.assetDirectory ?? null;
}

export function hasDesktopProjectSession(id: string): boolean { return desktopSessions.has(id); }
export function hasBrowserProjectSession(id: string): boolean { return browserSessions.has(id); }

export async function projectHasExternalChanges(id: string): Promise<boolean> {
  const browser = browserSessions.get(id);
  if (browser) {
    const changed = await browserProjectHasChanged(browser);
    return browserSessions.get(id) === browser && changed;
  }
  const desktop = desktopSessions.get(id);
  if (!desktop) return false;
  try {
    const contents = await invoke<string>("read_disk_project", { directory: desktop.directory });
    return desktopSessions.get(id) === desktop && contents !== desktop.contents;
  } catch (error) {
    if (String(error).includes("PROJECT_FILE_NOT_FOUND")) return desktopSessions.get(id) === desktop;
    throw error;
  }
}

export async function listProjects(): Promise<RecentProject[]> {
  const projects = await recentProjects();
  if (!isDesktopApp() && typeof indexedDB !== "undefined") {
    try {
      const saved = await loadBrowserProjectHandles();
      for (const project of projects) {
        const directory = saved.get(project.id);
        if (directory && !browserDirectories.has(project.id)) browserDirectories.set(project.id, directory);
      }
    } catch (error) { console.warn("[ProjectStorage] Failed to restore directory handles:", error); }
  }
  return projects;
}

function newProject(name: string, trackName: string): BasProjectData {
  const now = Date.now();
  return {
    version: PROJECT_VERSION, id: crypto.randomUUID(), name, createdAt: now, updatedAt: now,
    canvas: { width: 800, height: 450 }, timeline: { duration: 0 }, danmus: [], audioMeta: [], assets: [], bins: [],
    tracks: [{ id: "track_1", name: trackName, clips: [], visible: true, muted: false, locked: false }]
  };
}

export async function createFolderProject(name: string, trackName: string, directory: FileSystemDirectoryHandle): Promise<BasProjectData> {
  const project = newProject(name, trackName);
  const opened = await createBrowserProject(directory, projectFileName(name), project);
  browserSessions.set(project.id, opened);
  await rememberBrowserDirectory(project.id, directory);
  await rememberProject(project);
  return project;
}

export async function createDesktopFolderProject(name: string, trackName: string, directory: string): Promise<BasProjectData> {
  const project = newProject(name, trackName);
  const session = await createDesktopProject(directory, project);
  desktopSessions.set(project.id, session);
  await rememberProject(project, session.directory);
  return project;
}

export async function openSelectedProjectDirectory(directory: string | FileSystemDirectoryHandle): Promise<BasProjectData> {
  if (typeof directory === "string") {
    const session = await openDesktopProject(directory);
    if (!session.project.id) throw new Error("INVALID_PROJECT_ID");
    desktopSessions.set(session.project.id, session);
    browserRecoveryDirectories.delete(session.project.id);
    browserSessions.delete(session.project.id);
    await rememberProject(session.project, session.directory);
    return session.project;
  }
  if (!(await ensureDirectoryPermission(directory, true))) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
  const session = await openBrowserProject(directory, await findBrowserProjectFile(directory));
  if (!session.project.id) throw new Error("INVALID_PROJECT_ID");
  browserSessions.set(session.project.id, session);
  await rememberBrowserDirectory(session.project.id, directory);
  browserRecoveryDirectories.delete(session.project.id);
  desktopSessions.delete(session.project.id);
  await rememberProject(session.project);
  return session.project;
}

/** Picker invocation must precede the first await to preserve user activation. */
export async function prepareProjectOpen(id: string): Promise<void> {
  const recent = isDesktopApp() ? await recentProject(id) : browserRecentProjects().find((item) => item.id === id);
  if (!recent) throw new Error("PROJECT_NOT_FOUND");
  if (recent.directory) {
    const session = await openDesktopProject(recent.directory, id);
    desktopSessions.set(id, session);
    await rememberProject(session.project, session.directory);
    return;
  }
  const existing = browserSessions.get(id);
  const directory = await accessBrowserDirectory(id);
  const fileName = existing?.fileName ?? await findBrowserProjectFile(directory, id);
  const opened = await openBrowserProject(directory, fileName);
  if (opened.project.id !== id) throw new Error("PROJECT_ID_MISMATCH");
  browserSessions.set(id, opened);
  await rememberBrowserDirectory(id, directory);
  browserRecoveryDirectories.delete(id);
  await rememberProject(opened.project);
}

export async function getProjectLocationLabel(id: string): Promise<string | null> {
  const desktop = (await recentProject(id))?.directory;
  if (desktop) return /\.basproj$/i.test(desktop) ? desktop : desktop + "/project.basproj";
  const browser = browserSessions.get(id);
  return browser ? browser.directory.name + "/" + browser.fileName : null;
}

export async function deleteProject(id: string, deleteFile = false): Promise<void> {
  if (deleteFile) {
    const desktop = (await recentProject(id))?.directory;
    const browser = browserSessions.get(id);
    if (desktop) await deleteDesktopProjectFile(desktop, id);
    else if (browser) await deleteBrowserProjectFile({ projectId: id, directory: browser.directory, fileName: browser.fileName });
    else throw new Error("PROJECT_NOT_OPEN");
  }
  await updateRecentProjects((projects) => projects.filter((item) => item.id !== id));
  desktopSessions.delete(id);
  browserSessions.delete(id);
  browserDirectories.delete(id);
  if (!isDesktopApp() && typeof indexedDB !== "undefined") {
    try { await deleteBrowserProjectHandle(id); }
    catch (error) { console.warn("[ProjectStorage] Failed to remove directory handle:", error); }
  }
  browserRecoveryDirectories.delete(id);
}

export async function saveProjectDraft(projectData: Omit<BasProjectData, "version" | "updatedAt">): Promise<void> {
  const project: BasProjectData = { ...projectData, version: PROJECT_VERSION, updatedAt: Date.now() };
  const desktop = desktopSessions.get(project.id);
  const browser = browserSessions.get(project.id);
  if (desktop) {
    desktopSessions.set(project.id, await saveDesktopProject(desktop, project));
    await rememberProject(project, desktop.directory);
  } else if (browser) {
    browserSessions.set(project.id, await saveBrowserProject(browser, project));
    await rememberProject(project);
  } else throw new Error("PROJECT_NOT_OPEN");
}

export async function restoreProjectAudio(id: string, asset: Extract<ProjectAsset, { type: "audio-file" }>): Promise<AudioResource | null> {
  const desktop = desktopSessions.get(id);
  const browser = browserSessions.get(id);
  const meta = asset.audio;
  const sourcePath = asset.location?.kind === "external" ? asset.location.path : meta.sourcePath;
  const relativePath = asset.location?.kind === "project" ? asset.location.path : meta.relativePath;
  try {
    const directory = desktop?.directory ?? browser?.assetDirectory;
    const file = sourcePath && desktop ? await readDesktopAudio(sourcePath, meta.type)
      : relativePath && directory ? await readProjectAudio(directory, relativePath, meta.type).catch(async (error) => {
        if (browser) return readProjectAudio(browser.directory, relativePath, meta.type);
        if (desktop && /[\\/]project\.basproj$/i.test(desktop.directory)) {
          return readProjectAudio(desktop.directory.replace(/[\\/][^\\/]+$/, ""), relativePath, meta.type);
        }
        throw error;
      }) : null;
    return file ? {
      id: asset.id, type: "audio-file", name: meta.name, duration: meta.duration,
      coverUrl: meta.coverUrl, file, sourcePath, relativePath, url: URL.createObjectURL(file)
    } : null;
  } catch (error) {
    console.warn(`[ProjectStorage] Failed to restore audio file ${meta.id}:`, error);
    return null;
  }
}

export async function loadProjectDraft(id: string): Promise<{
  project: BasProjectData;
  audioResources: AudioResource[];
} | null> {
  const desktop = desktopSessions.get(id);
  const browser = browserSessions.get(id);
  const project = desktop?.project ?? browser?.project;
  if (!project) {
    if (await recentProject(id)) throw new Error("PROJECT_NOT_OPEN");
    return null;
  }
  const audioResources: AudioResource[] = [];
  for (const asset of project.assets) {
    if (asset.type !== "audio-file") continue;
    const resource = await restoreProjectAudio(id, asset);
    if (resource) audioResources.push(resource);
  }
  return { project, audioResources };
}

export async function clearProjectDraft(id: string): Promise<void> {
  await deleteProject(id);
}

/**
 * 导出工程配置文件为独立 .basproj (JSON) 文件供备份或分享
 */
export async function exportProjectFile(projectData: BasProjectData): Promise<boolean> {
  const fileName = `${projectData.name || "DanmakuProject"}_${new Date().toISOString().slice(0, 10)}.basproj`;
  return saveTextFile({
    fileName,
    content: JSON.stringify(serializeProjectData(projectData), null, 2),
    mimeType: "application/json;charset=utf-8",
    filters: [{ name: "BAS Project", extensions: ["basproj"] }]
  });
}

/**
 * 解析用户上传的 .basproj 工程配置文件
 */
export async function parseProjectFile(file: File): Promise<BasProjectData> {
  const text = await file.text();
  return normalizeProjectData(JSON.parse(text), file.name.replace(/\.[^/.]+$/, ""));
}

/** List backups without changing the current project. */
export async function listProjectBackups(id: string): Promise<string[]> {
  const recent = isDesktopApp() ? await recentProject(id) : browserRecentProjects().find((item) => item.id === id);
  if (!recent) throw new Error("PROJECT_NOT_FOUND");
  if (recent.directory) {
    const names = await invoke<string[]>("list_disk_backups", { directory: recent.directory, projectId: id });
    if (!/\.basproj$/i.test(recent.directory)) {
      const matching: string[] = [];
      for (const name of names) {
        try {
          const contents = await invoke<string>("read_disk_backup", { directory: recent.directory, name });
          if (normalizeProjectData(JSON.parse(contents)).id === id) matching.push(name);
        } catch { /* Ignore unrelated or invalid legacy snapshots. */ }
      }
      return matching;
    }
    if (/[\\/]project\.basproj$/i.test(recent.directory)) {
      const legacyDirectory = recent.directory.replace(/[\\/][^\\/]+$/, "");
      for (const name of await invoke<string[]>("list_disk_backups", { directory: legacyDirectory })) {
        try {
          const contents = await invoke<string>("read_disk_backup", { directory: legacyDirectory, name });
          if (normalizeProjectData(JSON.parse(contents)).id === id && !names.includes(name)) names.push(name);
        } catch { /* Ignore unrelated or invalid legacy snapshots. */ }
      }
    }
    return names.sort().reverse();
  }
  const directory = await accessBrowserDirectory(id);
  let fileName = browserSessions.get(id)?.fileName ?? recent.fileName;
  if (!fileName) {
    try { fileName = await findBrowserProjectFile(directory, id); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== "PROJECT_FILE_NOT_FOUND_OR_AMBIGUOUS") throw error;
      fileName = "project.basproj";
    }
  }
  const support = await browserProjectSupportDirectory(directory, fileName, id);
  const backups = await listBrowserBackups(support);
  for (const name of await listBrowserBackups(directory)) {
    try {
      const legacy = normalizeProjectData(JSON.parse(await readBrowserBackup(directory, name)));
      if (legacy.id === id && !backups.includes(name)) backups.push(name);
    } catch { /* Ignore unrelated or invalid legacy snapshots. */ }
  }
  backups.sort().reverse();
  browserRecoveryDirectories.set(id, directory);
  return backups;
}

/** Validate both project identity and current file before restoring a chosen snapshot. */
export async function restoreProjectBackup(id: string, name: string): Promise<void> {
  const desktop = (await recentProject(id))?.directory;
  const browser = browserSessions.get(id);
  const recoveryDirectory = browserRecoveryDirectories.get(id);
  if (desktop) {
    let backupContents: string;
    try { backupContents = await invoke<string>("read_disk_backup", { directory: desktop, name }); }
    catch (error) {
      if (!/[\\/]project\.basproj$/i.test(desktop)) throw error;
      backupContents = await invoke<string>("read_disk_backup", { directory: desktop.replace(/[\\/][^\\/]+$/, ""), name });
    }
    const backup = normalizeProjectData(JSON.parse(backupContents));
    if (backup.id !== id) throw new Error("PROJECT_ID_MISMATCH");
    let current: string | null;
    try { current = await invoke<string>("read_disk_project", { directory: desktop }); }
    catch (error) { if (String(error).includes("PROJECT_FILE_NOT_FOUND")) current = null; else throw error; }
    const contents = JSON.stringify(serializeProjectData(backup), null, 2);
    if (current === null) {
      await invoke("restore_missing_disk_project", { directory: desktop, contents });
    } else {
      try {
        const raw: unknown = JSON.parse(current);
        if (raw && typeof raw === "object" && "id" in raw && typeof raw.id === "string" && raw.id !== id) throw new Error("PROJECT_ID_MISMATCH");
        if (raw && typeof raw === "object" && "version" in raw && typeof raw.version === "number" && raw.version > PROJECT_VERSION) throw new Error("UNSUPPORTED_PROJECT_VERSION");
      } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      await invoke("save_disk_project", { directory: desktop, expected: current, contents, forceBackup: true });
    }
    const saved: DesktopProjectSession = { directory: desktop, contents, project: backup };
    desktopSessions.set(id, saved);
    await rememberProject(saved.project, desktop);
  } else if (browser || recoveryDirectory) {
    const directory = browser?.directory ?? recoveryDirectory!;
    if (!(await ensureDirectoryPermission(directory, true))) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
    let fileName = browser?.fileName ?? (await recentProject(id))?.fileName;
    if (!fileName) {
      try { fileName = await findBrowserProjectFile(directory, id); }
      catch (error) {
        if (!(error instanceof Error) || error.message !== "PROJECT_FILE_NOT_FOUND_OR_AMBIGUOUS") throw error;
        fileName = "project.basproj";
      }
    }
    const support = await browserProjectSupportDirectory(directory, fileName, id);
    let backupContents: string;
    try { backupContents = await readBrowserBackup(support, name); }
    catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
      backupContents = await readBrowserBackup(directory, name);
    }
    const backup = normalizeProjectData(JSON.parse(backupContents));
    if (backup.id !== id) throw new Error("PROJECT_ID_MISMATCH");
    const saved = await restoreBrowserProjectFile({ projectId: id, directory, fileName }, backup);
    browserSessions.set(id, saved);
    browserRecoveryDirectories.delete(id);
    await rememberProject(saved.project);
  } else throw new Error("BACKUPS_UNAVAILABLE");
}
