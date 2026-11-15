const DATABASE = "danmakucut-project-handles";
const STORE = "directories";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("PROJECT_HANDLES_DATABASE_BLOCKED"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("PROJECT_HANDLES_TRANSACTION_ABORTED"));
    });
  } finally {
    database.close();
  }
}

export async function loadBrowserProjectHandles(): Promise<Map<string, FileSystemDirectoryHandle>> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readonly");
      const entries = new Map<string, FileSystemDirectoryHandle>();
      const cursor = transaction.objectStore(STORE).openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        if (typeof entry.key === "string" && entry.value?.kind === "directory") entries.set(entry.key, entry.value);
        entry.continue();
      };
      transaction.oncomplete = () => resolve(entries);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("PROJECT_HANDLES_TRANSACTION_ABORTED"));
    });
  } finally {
    database.close();
  }
}

export function saveBrowserProjectHandle(id: string, directory: FileSystemDirectoryHandle): Promise<IDBValidKey> {
  return withStore("readwrite", store => store.put(directory, id));
}

export function deleteBrowserProjectHandle(id: string): Promise<undefined> {
  return withStore("readwrite", store => store.delete(id));
}
