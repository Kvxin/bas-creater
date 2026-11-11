const BACKUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_BACKUPS = 10;
const BACKUP_NAME = /^backup-(\d+)-[a-f0-9-]+\.basproj$/;

type IterableDirectory = FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> };

/** Preserve the previous version before replacing it; only manage our own backup names. */
export async function backupBrowserProject(directory: FileSystemDirectoryHandle, contents: string, now = Date.now()): Promise<void> {
  const backups = await directory.getDirectoryHandle(".danmakucut-backups", { create: true });
  const entries: { name: string; time: number }[] = [];
  for await (const entry of (backups as IterableDirectory).values()) {
    const match = entry.kind === "file" ? BACKUP_NAME.exec(entry.name) : null;
    if (match) entries.push({ name: entry.name, time: Number(match[1]) });
  }
  entries.sort((a, b) => b.time - a.time || b.name.localeCompare(a.name));
  if (entries[0] && now - entries[0].time < BACKUP_INTERVAL_MS) return;
  const name = `backup-${now}-${crypto.randomUUID()}.basproj`;
  const handle = await backups.getFileHandle(name, { create: true });
  const writer = await handle.createWritable();
  try { await writer.write(contents); await writer.close(); }
  catch (error) { await writer.abort().catch(() => {}); throw error; }
  // Best effort: a pruning failure must not cause the save to be reported as successful.
  for (const entry of entries.slice(MAX_BACKUPS - 1)) await backups.removeEntry(entry.name);
}

export async function listBrowserBackups(directory: FileSystemDirectoryHandle): Promise<string[]> {
  let backups: FileSystemDirectoryHandle;
  try { backups = await directory.getDirectoryHandle(".danmakucut-backups"); }
  catch (error) { if (error instanceof DOMException && error.name === "NotFoundError") return []; throw error; }
  const names: string[] = [];
  for await (const entry of (backups as IterableDirectory).values()) {
    if (entry.kind === "file" && BACKUP_NAME.test(entry.name)) names.push(entry.name);
  }
  return names.sort().reverse();
}

export async function readBrowserBackup(directory: FileSystemDirectoryHandle, name: string): Promise<string> {
  if (!BACKUP_NAME.test(name)) throw new Error("INVALID_BACKUP_NAME");
  const backups = await directory.getDirectoryHandle(".danmakucut-backups");
  return (await (await backups.getFileHandle(name)).getFile()).text();
}
