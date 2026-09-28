import {
  isOpfsSupported,
  opfsSaveFile,
  opfsGetFile,
  opfsDeleteFile,
  opfsClearFiles,
} from "./opfs";
import { idbGet, idbSet, idbDelete, idbClear, STORES } from "./indexedDB";

/**
 * 统一多媒体底层存储适配器
 * 优先使用高性能的浏览器私有文件系统 (OPFS)，在不支持的环境下无缝平替为 IndexedDB Blob 存储
 */
class MediaStorageManager {
  private useOpfs: boolean;

  constructor() {
    this.useOpfs = isOpfsSupported();
  }

  async save(mediaId: string, file: File): Promise<void> {
    if (this.useOpfs) {
      try {
        await opfsSaveFile(mediaId, file);
        return;
      } catch (err) {
        console.warn("[MediaStorage] OPFS save failed, falling back to IndexedDB:", err);
      }
    }

    // Fallback 到 IndexedDB
    await idbSet(STORES.MEDIA_BLOBS, mediaId, file);
  }

  async get(mediaId: string): Promise<File | null> {
    if (this.useOpfs) {
      try {
        const file = await opfsGetFile(mediaId);
        if (file) return file;
      } catch (err) {
        console.warn("[MediaStorage] OPFS get failed, trying IndexedDB:", err);
      }
    }

    // 从 IndexedDB 中检索
    const result = await idbGet<File | Blob>(STORES.MEDIA_BLOBS, mediaId);
    if (!result) return null;

    if (result instanceof File) {
      return result;
    }

    // 如果还原回来的是纯 Blob，包装成标准 File 对象
    return new File([result], mediaId, { type: result.type });
  }

  async remove(mediaId: string): Promise<void> {
    const promises: Promise<unknown>[] = [idbDelete(STORES.MEDIA_BLOBS, mediaId)];
    if (this.useOpfs) {
      promises.push(opfsDeleteFile(mediaId).catch(() => {}));
    }
    await Promise.all(promises);
  }

  async clear(): Promise<void> {
    const promises: Promise<unknown>[] = [idbClear(STORES.MEDIA_BLOBS)];
    if (this.useOpfs) {
      promises.push(opfsClearFiles().catch(() => {}));
    }
    await Promise.all(promises);
  }
}

export const mediaStorage = new MediaStorageManager();
