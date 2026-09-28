import type { AudioResource } from "@/types/resource";
import type { BasProjectData } from "@/types/storage";
import { idbGet, idbSet, idbDelete, STORES } from "./indexedDB";
import { mediaStorage } from "./mediaStorage";

const CURRENT_VERSION = 1;
const ACTIVE_DRAFT_KEY = "active_draft";

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
    mediaSaves.push(mediaStorage.save(id, file));
  }
  await Promise.all(mediaSaves);

  // 2. 序列化工程 JSON 数据
  const fullProject: BasProjectData = {
    ...projectData,
    version: CURRENT_VERSION,
    updatedAt: Date.now(),
  };

  // 3. 写入 IndexedDB
  await idbSet(STORES.PROJECTS, ACTIVE_DRAFT_KEY, fullProject);
}

export async function loadProjectDraft(): Promise<{
  project: BasProjectData;
  audioResources: AudioResource[];
} | null> {
  const project = await idbGet<BasProjectData>(STORES.PROJECTS, ACTIVE_DRAFT_KEY);
  if (!project) return null;

  // 还原音频资源：从物理存储拉取 File，并重建会话有效的 ObjectURL
  const audioResources: AudioResource[] = [];
  if (Array.isArray(project.audioMeta)) {
    for (const meta of project.audioMeta) {
      try {
        const file = await mediaStorage.get(meta.id);
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

export async function clearProjectDraft(): Promise<void> {
  await idbDelete(STORES.PROJECTS, ACTIVE_DRAFT_KEY);
  await mediaStorage.clear();
}

/**
 * 导出工程配置文件为独立 .basproj (JSON) 文件供备份或分享
 */
export function exportProjectFile(projectData: BasProjectData): void {
  const jsonStr = JSON.stringify(projectData, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  const fileName = `${projectData.name || "DanmakuProject"}_${new Date().toISOString().slice(0, 10)}.basproj`;
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 解析用户上传的 .basproj 工程配置文件
 */
export async function parseProjectFile(file: File): Promise<BasProjectData> {
  const text = await file.text();
  const data = JSON.parse(text) as Partial<BasProjectData>;

  if (!data || typeof data !== "object") {
    throw new Error("Invalid project file structure");
  }

  if (!Array.isArray(data.danmus) || !Array.isArray(data.tracks)) {
    throw new Error("Missing danmaku or tracks definition in project file");
  }

  return {
    version: data.version ?? CURRENT_VERSION,
    id: data.id ?? Math.random().toString(36).slice(2),
    name: data.name ?? file.name.replace(/\.[^/.]+$/, ""),
    createdAt: data.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    canvas: data.canvas ?? { width: 800, height: 450 },
    timeline: data.timeline ?? { duration: 0 },
    danmus: data.danmus,
    tracks: data.tracks,
    audioMeta: data.audioMeta ?? [],
  };
}
