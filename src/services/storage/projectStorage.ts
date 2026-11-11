import { writeProjectAudio, readProjectAudio } from "./projectAssets";
import { invoke } from "@tauri-apps/api/core";
import { listBrowserBackups, readBrowserBackup } from "./browserBackups";
import type { AudioResource } from "@/types/resource";
import type { BasProjectData } from "@/types/storage";
import { idbGet, idbSet, idbDelete, idbGetAllKeys, STORES } from "./indexedDB";
import { createDesktopProject, rememberDesktopProject, findDesktopProjectLocation, forgetDesktopProject, openDesktopProject, saveDesktopProject, readDesktopAudio, deleteDesktopProjectFile, type DesktopProjectSession } from "./desktopProjectFile";
import { mediaStorage } from "./mediaStorage";
import { getBrowserMediaHandle, readBrowserMedia } from "./browserMediaFile";
import { normalizeProjectData, PROJECT_VERSION } from "./projectSchema";
import { saveTextFile } from "@/utils/desktop";
import { createBrowserProject, deleteBrowserProjectFile, ensureDirectoryPermission, findBrowserProjectLocation, forgetBrowserProject, openBrowserProject, rememberBrowserProject, saveBrowserProject, type BrowserProjectFile } from "./browserProjectFile";

const CURRENT_VERSION = PROJECT_VERSION;
const ACTIVE_DRAFT_KEY = "active_draft";
const PROJECT_PREFIX = "project:";
const LEGACY_PROJECT_ID = "legacy-draft";
const projectMediaKey = (projectId: string, mediaId: string) => `${projectId}--${mediaId}`;
const browserSessions = new Map<string, BrowserProjectFile>();
const desktopSessions = new Map<string, DesktopProjectSession>();

export function hasDesktopProjectSession(id: string): boolean { return desktopSessions.has(id); }

export function hasBrowserProjectSession(id: string): boolean {
  return browserSessions.has(id);
}

/** 旧草稿先完整复制，写入成功后才移除原键。媒体仍保留在原位置。 */
export async function migrateLegacyDraft(): Promise<void> {
  const legacy = await idbGet<unknown>(STORES.PROJECTS, ACTIVE_DRAFT_KEY);
  if (!legacy) return;
  const key = PROJECT_PREFIX + LEGACY_PROJECT_ID;
  if (!(await idbGet(STORES.PROJECTS, key))) {
    const project = normalizeProjectData(legacy);
    await idbSet(STORES.PROJECTS, key, { ...project, id: LEGACY_PROJECT_ID });
  }
  await idbDelete(STORES.PROJECTS, ACTIVE_DRAFT_KEY);
}

export async function listProjects(): Promise<BasProjectData[]> {
  await migrateLegacyDraft();
  const keys = (await idbGetAllKeys(STORES.PROJECTS)).filter((key) => key.startsWith(PROJECT_PREFIX));
  const projects = await Promise.all(keys.map(async (key) => {
    const data = await idbGet<unknown>(STORES.PROJECTS, key);
    return data ? normalizeProjectData(data) : null;
  }));
  return projects.filter((project): project is BasProjectData => project !== null);
}

export async function createProject(name: string, trackName: string): Promise<BasProjectData> {
  const now = Date.now();
  const project: BasProjectData = {
    version: CURRENT_VERSION, id: crypto.randomUUID(), name, createdAt: now, updatedAt: now,
    canvas: { width: 800, height: 450 }, timeline: { duration: 0 }, danmus: [], audioMeta: [],
    tracks: [{ id: "track_1", name: trackName, clips: [], visible: true, muted: false, locked: false }]
  };
  await idbSet(STORES.PROJECTS, PROJECT_PREFIX + project.id, project);
  return project;
}

/** 初始化选定的空目录；只有写入并登记完成后才返回项目。 */
export async function createFolderProject(name: string, trackName: string, directory: FileSystemDirectoryHandle): Promise<BasProjectData> {
  const now = Date.now();
  const project: BasProjectData = {
    version: CURRENT_VERSION, id: crypto.randomUUID(), name, createdAt: now, updatedAt: now,
    canvas: { width: 800, height: 450 }, timeline: { duration: 0 }, danmus: [], audioMeta: [],
    tracks: [{ id: "track_1", name: trackName, clips: [], visible: true, muted: false, locked: false }]
  };
  const fileName = "project.basproj";
  const opened = await createBrowserProject(directory, fileName, project);
  await rememberBrowserProject({ projectId: project.id, directory, fileName });
  await idbSet(STORES.PROJECTS, PROJECT_PREFIX + project.id, project);
  browserSessions.set(project.id, opened);
  return project;
}

/** 初始化桌面端用户选择的空目录。 */
export async function createDesktopFolderProject(name: string, trackName: string, directory: string): Promise<BasProjectData> {
  const now = Date.now();
  const project: BasProjectData = {
    version: CURRENT_VERSION, id: crypto.randomUUID(), name, createdAt: now, updatedAt: now,
    canvas: { width: 800, height: 450 }, timeline: { duration: 0 }, danmus: [], audioMeta: [],
    tracks: [{ id: "track_1", name: trackName, clips: [], visible: true, muted: false, locked: false }]
  };
  const session = await createDesktopProject(directory, project);
  await idbSet(STORES.PROJECTS, PROJECT_PREFIX + project.id, project);
  desktopSessions.set(project.id, session);
  return project;
}

/** The user explicitly chose this directory, so it may also repair a moved project. */
export async function openSelectedProjectDirectory(directory: string | FileSystemDirectoryHandle): Promise<BasProjectData> {
  if (typeof directory === "string") {
    const session = await openDesktopProject(directory);
    if (!session.project.id) throw new Error("INVALID_PROJECT_ID");
    await rememberDesktopProject(session.project.id, directory);
    await idbSet(STORES.PROJECTS, PROJECT_PREFIX + session.project.id, session.project);
    desktopSessions.set(session.project.id, session);
    return session.project;
  }
  if (!(await ensureDirectoryPermission(directory, true))) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
  const session = await openBrowserProject(directory, "project.basproj");
  if (!session.project.id) throw new Error("INVALID_PROJECT_ID");
  await rememberBrowserProject({ projectId: session.project.id, directory, fileName: session.fileName });
  await idbSet(STORES.PROJECTS, PROJECT_PREFIX + session.project.id, session.project);
  browserSessions.set(session.project.id, session);
  return session.project;
}

/** Copies a legacy project and all available media into a new user-chosen directory. */
export async function migrateProjectToDirectory(id: string, directory: string | FileSystemDirectoryHandle): Promise<BasProjectData> {
  if (await findDesktopProjectLocation(id) || await findBrowserProjectLocation(id)) throw new Error("ALREADY_A_FOLDER_PROJECT");
  const old = await loadProjectDraft(id);
  if (!old) throw new Error("PROJECT_NOT_FOUND");
  const byId = new Map(old.audioResources.map((resource) => [resource.id, resource]));
  if (old.project.audioMeta.some((meta) => !byId.has(meta.id))) throw new Error("MEDIA_OFFLINE");
  const project: BasProjectData = {
    ...old.project, id: crypto.randomUUID(), createdAt: Date.now(), updatedAt: Date.now(),
    audioMeta: old.project.audioMeta.map((meta) => ({ ...meta, sourcePath: undefined, relativePath: `${crypto.randomUUID()}.audio` }))
  };
  // The old project remains intact even if copying or registration fails.
  const desktop = typeof directory === "string" ? await createDesktopProject(directory, project) : null;
  const browser = typeof directory !== "string" ? await createBrowserProject(directory, "project.basproj", project) : null;
  for (const meta of project.audioMeta) await writeProjectAudio(directory, meta.relativePath!, byId.get(meta.id)!.file);
  if (browser && typeof directory !== "string") {
    await rememberBrowserProject({ projectId: project.id, directory, fileName: "project.basproj" });
    browserSessions.set(project.id, browser);
  }
  if (desktop) desktopSessions.set(project.id, desktop);
  await idbSet(STORES.PROJECTS, PROJECT_PREFIX + project.id, project);
  for (const resource of old.audioResources) URL.revokeObjectURL(resource.url);
  return project;
}

/** 在用户点击打开时恢复权限和文件内容；不允许静默使用过期缓存。 */
export async function prepareProjectOpen(id: string): Promise<void> {
  const desktopDirectory = await findDesktopProjectLocation(id);
  if (desktopDirectory) { desktopSessions.set(id, await openDesktopProject(desktopDirectory, id)); return; }
  const location = await findBrowserProjectLocation(id);
  if (!location) return;
  if (!(await ensureDirectoryPermission(location.directory, true))) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
  const opened = await openBrowserProject(location.directory, location.fileName);
  if (opened.project.id !== id) throw new Error("PROJECT_ID_MISMATCH");
  browserSessions.set(id, opened);
}

/** 媒体可能被其他工程引用，不在删除工程时清空共享媒体。 */
export async function getProjectLocationLabel(id: string): Promise<string | null> {
  const desktop = await findDesktopProjectLocation(id);
  if (desktop) return desktop + "/project.basproj";
  const browser = await findBrowserProjectLocation(id);
  return browser ? browser.directory.name + "/" + browser.fileName : null;
}

export async function deleteProject(id: string, deleteFile = false): Promise<void> {
  if (deleteFile) {
    const desktop = await findDesktopProjectLocation(id);
    const browser = await findBrowserProjectLocation(id);
    if (desktop) await deleteDesktopProjectFile(desktop, id);
    else if (browser) await deleteBrowserProjectFile(browser);
  }
  await forgetBrowserProject(id);
  await forgetDesktopProject(id);
  desktopSessions.delete(id);
  browserSessions.delete(id);
  await idbDelete(STORES.PROJECTS, PROJECT_PREFIX + id);
}

export async function requestStoragePersistence(): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    "storage" in navigator &&
    typeof navigator.storage?.persist === "function"
  ) {
    try {
      const isPersisted = await navigator.storage.persisted();
      if (!isPersisted) {
        return await navigator.storage.persist();
      }
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export async function saveProjectDraft(
  projectData: Omit<BasProjectData, "version" | "updatedAt">,
  audioFiles: Map<string, File>
): Promise<void> {
  // 1. 先保存所有媒体物理文件到 OPFS / IndexedDB
  const mediaSaves: Promise<void>[] = [];
  for (const [id, file] of audioFiles.entries()) {
    const reference = await getBrowserMediaHandle(projectData.id, id);
    if (!reference && !projectData.audioMeta.some((item) => item.id === id && (item.sourcePath || item.relativePath))) mediaSaves.push(mediaStorage.save(projectMediaKey(projectData.id, id), file));
  }
  await Promise.all(mediaSaves);

  // 2. 序列化工程 JSON 数据
  const fullProject: BasProjectData = {
    ...projectData,
    version: CURRENT_VERSION,
    updatedAt: Date.now(),
  };

  const desktopDirectory = await findDesktopProjectLocation(projectData.id);
  if (desktopDirectory) {
    const session = desktopSessions.get(projectData.id);
    if (!session) throw new Error("PROJECT_NOT_OPEN");
    desktopSessions.set(projectData.id, await saveDesktopProject(session, fullProject));
  }

  const location = await findBrowserProjectLocation(projectData.id);
  if (location) {
    const opened = browserSessions.get(projectData.id);
    if (!opened) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
    const next = await saveBrowserProject(opened, fullProject);
    browserSessions.set(projectData.id, next);
  }

  // 3. 写入 IndexedDB
  await idbSet(STORES.PROJECTS, PROJECT_PREFIX + projectData.id, fullProject);
}

export async function loadProjectDraft(id: string): Promise<{
  project: BasProjectData;
  audioResources: AudioResource[];
} | null> {
  const location = await findBrowserProjectLocation(id);
  const session = browserSessions.get(id);
  if (location && !session) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
  const desktopDirectory = await findDesktopProjectLocation(id);
  const desktopSession = desktopSessions.get(id);
  if (desktopDirectory && !desktopSession) throw new Error("PROJECT_NOT_OPEN");
  const storedProject = desktopSession?.project ?? session?.project ?? await idbGet<unknown>(STORES.PROJECTS, PROJECT_PREFIX + id);
  if (!storedProject) return null;
  const project = normalizeProjectData(storedProject);

  // 还原音频资源：从物理存储拉取 File，并重建会话有效的 ObjectURL
  const audioResources: AudioResource[] = [];
  if (Array.isArray(project.audioMeta)) {
    for (const meta of project.audioMeta) {
      try {
        const handle = await getBrowserMediaHandle(id, meta.id);
        const projectDirectory = desktopSession?.directory ?? session?.directory;
        const file = meta.relativePath && projectDirectory ? await readProjectAudio(projectDirectory, meta.relativePath, meta.type) : meta.sourcePath && desktopSession ? await readDesktopAudio(meta.sourcePath, meta.type) : handle ? await readBrowserMedia(handle) : await mediaStorage.get(projectMediaKey(id, meta.id)) ??
          (id === LEGACY_PROJECT_ID ? await mediaStorage.get(meta.id) : null);
        if (file) {
          const url = URL.createObjectURL(file);
          audioResources.push({
            id: meta.id,
            type: "audio-file",
            name: meta.name,
            duration: meta.duration,
            coverUrl: meta.coverUrl,
            file,
            sourcePath: meta.sourcePath,
            relativePath: meta.relativePath,
            url,
          });
        }
      } catch (err) {
        console.warn(`[ProjectStorage] Failed to restore audio file ${meta.id}:`, err);
      }
    }
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
    content: JSON.stringify(projectData, null, 2),
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
  const desktop = await findDesktopProjectLocation(id);
  if (desktop) return invoke<string[]>("list_disk_backups", { directory: desktop });
  const browser = await findBrowserProjectLocation(id);
  if (!browser) return [];
  if (!(await ensureDirectoryPermission(browser.directory, true))) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
  return listBrowserBackups(browser.directory);
}

/** Validate both project identity and current file before restoring a chosen snapshot. */
export async function restoreProjectBackup(id: string, name: string): Promise<void> {
  const desktop = await findDesktopProjectLocation(id);
  const browser = await findBrowserProjectLocation(id);
  if (desktop) {
    const contents = await invoke<string>("read_disk_backup", { directory: desktop, name });
    const backup = normalizeProjectData(JSON.parse(contents));
    if (backup.id !== id) throw new Error("PROJECT_ID_MISMATCH");
    const current = await openDesktopProject(desktop, id);
    const saved = await saveDesktopProject(current, backup);
    desktopSessions.set(id, saved);
    await idbSet(STORES.PROJECTS, PROJECT_PREFIX + id, saved.project);
  } else if (browser) {
    if (!(await ensureDirectoryPermission(browser.directory, true))) throw new Error("DIRECTORY_PERMISSION_REQUIRED");
    const backup = normalizeProjectData(JSON.parse(await readBrowserBackup(browser.directory, name)));
    if (backup.id !== id) throw new Error("PROJECT_ID_MISMATCH");
    const current = await openBrowserProject(browser.directory, browser.fileName);
    if (current.project.id !== id) throw new Error("PROJECT_ID_MISMATCH");
    const saved = await saveBrowserProject(current, backup);
    browserSessions.set(id, saved);
    await idbSet(STORES.PROJECTS, PROJECT_PREFIX + id, saved.project);
  } else throw new Error("BACKUPS_UNAVAILABLE");
}
