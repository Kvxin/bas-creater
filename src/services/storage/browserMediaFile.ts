import { idbDelete, idbGet, idbSet, STORES } from "./indexedDB";

type ReadPermissionHandle = FileSystemFileHandle & {
  queryPermission(descriptor: { mode: "read" }): Promise<PermissionState>;
  requestPermission(descriptor: { mode: "read" }): Promise<PermissionState>;
};

type FilePicker = Window & {
  showOpenFilePicker(options?: { multiple?: boolean; types?: { description: string; accept: Record<string, string[]> }[] }): Promise<FileSystemFileHandle[]>;
};

const mediaKey = (projectId: string, mediaId: string): string => `browser-media-handle:${encodeURIComponent(projectId)}:${encodeURIComponent(mediaId)}`;

/** 选择文件须由用户操作直接触发；浏览器不会暴露真实的本机绝对路径。 */
export async function pickBrowserAudio(): Promise<FileSystemFileHandle | null> {
  if (!("showOpenFilePicker" in window)) throw new Error("FILE_PICKER_UNSUPPORTED");
  const [handle] = await (window as FilePicker).showOpenFilePicker({
    multiple: false,
    types: [{ description: "Audio", accept: { "audio/*": [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac"] } }]
  });
  return handle ?? null;
}

/** 授权可能失效；只在用户交互中允许重新请求。 */
export async function ensureBrowserMediaPermission(handle: FileSystemFileHandle, request = false): Promise<boolean> {
  const file = handle as ReadPermissionHandle;
  if (typeof file.queryPermission !== "function") return false;
  if ((await file.queryPermission({ mode: "read" })) === "granted") return true;
  return request && typeof file.requestPermission === "function" &&
    (await file.requestPermission({ mode: "read" })) === "granted";
}

/** 仅保存浏览器授权句柄，不复制、不修改用户的原始媒体文件。 */
export async function rememberBrowserMedia(projectId: string, mediaId: string, handle: FileSystemFileHandle): Promise<void> {
  if (!projectId || !mediaId) throw new Error("INVALID_MEDIA_ID");
  await idbSet(STORES.MEDIA_BLOBS, mediaKey(projectId, mediaId), handle);
}

export async function getBrowserMediaHandle(projectId: string, mediaId: string): Promise<FileSystemFileHandle | null> {
  return idbGet<FileSystemFileHandle>(STORES.MEDIA_BLOBS, mediaKey(projectId, mediaId));
}

export async function readBrowserMedia(handle: FileSystemFileHandle): Promise<File> {
  if (!(await ensureBrowserMediaPermission(handle))) throw new Error("MEDIA_PERMISSION_REQUIRED");
  return handle.getFile();
}

/** 删除索引，不删除原文件。 */
export async function forgetBrowserMedia(projectId: string, mediaId: string): Promise<void> {
  await idbDelete(STORES.MEDIA_BLOBS, mediaKey(projectId, mediaId));
}
