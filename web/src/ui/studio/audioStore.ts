// Voice recordings and own music files are too big for localStorage, so they
// live in IndexedDB, one record per project and kind. They stay in this browser.
const DB = "schach.studio.audio";
const STORE = "clips";

export type ClipKind = "music" | "voice";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const key = (projectId: string, kind: ClipKind) => `${projectId}:${kind}`;

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveClip(projectId: string, kind: ClipKind, blob: Blob): Promise<void> {
  await run("readwrite", (s) => s.put(blob, key(projectId, kind)));
}

export async function loadClip(projectId: string, kind: ClipKind): Promise<Blob | null> {
  try {
    return ((await run<Blob | undefined>("readonly", (s) => s.get(key(projectId, kind)))) ?? null) as Blob | null;
  } catch {
    return null;
  }
}

export async function deleteClip(projectId: string, kind: ClipKind): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(key(projectId, kind)));
  } catch {
    // nothing stored
  }
}
