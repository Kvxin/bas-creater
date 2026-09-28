/**
 * 轻量且安全的 IndexedDB 包装器
 * 用于持久化存储项目配置、关键帧、轨道数据以及备用大型媒体 Blob
 */

const DB_NAME = "bas_creator_db";
const DB_VERSION = 1;

export const STORES = {
  PROJECTS: "projects",
  MEDIA_BLOBS: "media_blobs",
} as const;

type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBDatabase> | null = null;

function getDatabase(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB is not supported in this environment"));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error("Failed to open IndexedDB"));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 工程结构表（以项目 ID / 标识为 key）
      if (!db.objectStoreNames.contains(STORES.PROJECTS)) {
        db.createObjectStore(STORES.PROJECTS);
      }

      // 媒体文件表（以 mediaId 为 key，value 为 File / Blob 对象）
      if (!db.objectStoreNames.contains(STORES.MEDIA_BLOBS)) {
        db.createObjectStore(STORES.MEDIA_BLOBS);
      }
    };
  });

  return dbPromise;
}

export async function idbGet<T>(storeName: StoreName, key: string): Promise<T | null> {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.get(key);

    request.onsuccess = () => resolve((request.result as T) ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function idbSet<T>(storeName: StoreName, key: string, value: T): Promise<void> {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.put(value, key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function idbDelete(storeName: StoreName, key: string): Promise<void> {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function idbClear(storeName: StoreName): Promise<void> {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function idbGetAllKeys(storeName: StoreName): Promise<string[]> {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.getAllKeys();

    request.onsuccess = () => resolve((request.result as string[]) ?? []);
    request.onerror = () => reject(request.error);
  });
}
