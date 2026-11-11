import type { AudioResource } from "@/types/resource";
import type { BasProjectData } from "@/types/storage";
import { idbGet, idbSet, idbDelete, idbGetAllKeys, STORES } from "./indexedDB";
import { mediaStorage } from "./mediaStorage";
import { normalizeProjectData, PROJECT_VERSION } from "./projectSchema";
import { saveTextFile } from "@/utils/desktop";

const CURRENT_VERSION = PROJECT_VERSION;
const ACTIVE_DRAFT_KEY = "active_draft";
const PROJECT_PREFIX = "project:";
const LEGACY_PROJECT_ID = "legacy-draft";
const projectMediaKey = (projectId: string, mediaId: string) => `${projectId}--${mediaId}`;

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

/** 媒体可能被其他工程引用，不在删除工程时清空共享媒体。 */
export async function deleteProject(id: string): Promise<void> {
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
    mediaSaves.push(mediaStorage.save(projectMediaKey(projectData.id, id), file));
  }
  await Promise.all(mediaSaves);

  // 2. 序列化工程 JSON 数据
  const fullProject: BasProjectData = {
    ...projectData,
    version: CURRENT_VERSION,
    updatedAt: Date.now(),
  };

  // 3. 写入 IndexedDB
  await idbSet(STORES.PROJECTS, PROJECT_PREFIX + projectData.id, fullProject);
}

export async function loadProjectDraft(id: string): Promise<{
  project: BasProjectData;
  audioResources: AudioResource[];
} | null> {
  const storedProject = await idbGet<unknown>(STORES.PROJECTS, PROJECT_PREFIX + id);
  if (!storedProject) return null;
  const project = normalizeProjectData(storedProject);

  // 还原音频资源：从物理存储拉取 File，并重建会话有效的 ObjectURL
  const audioResources: AudioResource[] = [];
  if (Array.isArray(project.audioMeta)) {
    for (const meta of project.audioMeta) {
      try {
        const file = await mediaStorage.get(projectMediaKey(id, meta.id)) ??
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
