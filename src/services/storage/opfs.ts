/**
 * 原生 OPFS (Origin Private File System) 适配器
 * 将大型音频等二进制媒体直接作为物理文件写入浏览器沙盒文件系统，不占 JS 堆内存
 */

const OPFS_MEDIA_DIR = "bas-media-files";

export function isOpfsSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "storage" in navigator &&
    typeof navigator.storage?.getDirectory === "function"
  );
}

async function getMediaDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return await root.getDirectoryHandle(OPFS_MEDIA_DIR, { create: true });
}

export async function opfsSaveFile(fileName: string, file: File): Promise<void> {
  const dir = await getMediaDirectory();
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(file);
  await writable.close();
}

export async function opfsGetFile(fileName: string): Promise<File | null> {
  try {
    const dir = await getMediaDirectory();
    const fileHandle = await dir.getFileHandle(fileName);
    return await fileHandle.getFile();
  } catch (error) {
    if ((error as Error).name === "NotFoundError") {
      return null;
    }
    throw error;
  }
}

export async function opfsDeleteFile(fileName: string): Promise<void> {
  try {
    const dir = await getMediaDirectory();
    await dir.removeEntry(fileName);
  } catch (error) {
    if ((error as Error).name !== "NotFoundError") {
      throw error;
    }
  }
}

export async function opfsClearFiles(): Promise<void> {
  try {
    const dir = await getMediaDirectory();
    for await (const name of (dir as any).keys()) {
      await dir.removeEntry(name);
    }
  } catch (error) {
    console.warn("[OPFS] Failed to clear media files:", error);
  }
}
