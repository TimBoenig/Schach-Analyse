// Local-first persistence in IndexedDB. Every record carries `updated_at`
// (ms) so the optional cloud sync can merge devices last-writer-wins;
// deletions are soft (`deleted: true`) so they propagate too.
import type { PvLine, StoredGame } from "../domain/types";

const DB_NAME = "schach-analyse";
const DB_VERSION = 1;

export interface SettingRecord {
  key: string;
  value: unknown;
  updated_at: number;
  deleted?: boolean;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("games")) db.createObjectStore("games", { keyPath: "id" });
        if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
        if (!db.objectStoreNames.contains("evals")) db.createObjectStore("evals");
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }
  return dbPromise;
}

/** For tests: close and forget the cached connection. */
export async function resetDbConnection(): Promise<void> {
  const p = dbPromise;
  dbPromise = null;
  if (p) (await p).close();
}

type Listener = () => void;
const listeners = new Set<Listener>();
export function onDataChanged(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function notify(): void {
  for (const l of listeners) l();
}

// ---- games ----

/** All live (not deleted) games, newest first. */
export async function listGames(): Promise<StoredGame[]> {
  const db = await openDb();
  const all = (await req(db.transaction("games").objectStore("games").getAll())) as StoredGame[];
  return all.filter((g) => !g.deleted).sort((a, b) => b.timestamp - a.timestamp);
}

/** Every record including tombstones (sync). */
export async function listAllGameRecords(): Promise<StoredGame[]> {
  const db = await openDb();
  return (await req(db.transaction("games").objectStore("games").getAll())) as StoredGame[];
}

export async function getGame(id: string): Promise<StoredGame | undefined> {
  const db = await openDb();
  const g = (await req(db.transaction("games").objectStore("games").get(id))) as StoredGame | undefined;
  return g && !g.deleted ? g : undefined;
}

export async function gameExists(id: string): Promise<boolean> {
  return (await getGame(id)) !== undefined;
}

/** Saves games and stamps them as locally changed now. */
export async function putGames(games: StoredGame[], { touch = true, silent = false } = {}): Promise<void> {
  if (!games.length) return;
  const db = await openDb();
  const tx = db.transaction("games", "readwrite");
  const store = tx.objectStore("games");
  const now = Date.now();
  for (const g of games) store.put(touch ? { ...g, updated_at: now } : g);
  await done(tx);
  if (!silent) notify();
}

export async function deleteGame(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("games", "readwrite");
  const store = tx.objectStore("games");
  const g = (await req(store.get(id))) as StoredGame | undefined;
  if (g) {
    // Keep only a tombstone: identity + timestamps, no heavy payload.
    store.put({ ...g, pgn: "", moves_json: [], summary_json: {}, deleted: true, updated_at: Date.now() });
  }
  await done(tx);
  notify();
}

// ---- settings ----

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const db = await openDb();
  const r = (await req(db.transaction("settings").objectStore("settings").get(key))) as SettingRecord | undefined;
  return r && !r.deleted ? (r.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await putSettingRecords([{ key, value, updated_at: Date.now() }]);
}

export async function putSettingRecords(records: SettingRecord[], silent = false): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("settings", "readwrite");
  for (const r of records) tx.objectStore("settings").put(r);
  await done(tx);
  if (!silent) notify();
}

export async function listSettingRecords(): Promise<SettingRecord[]> {
  const db = await openDb();
  return (await req(db.transaction("settings").objectStore("settings").getAll())) as SettingRecord[];
}

// ---- device-local engine evaluation cache (never synced) ----

export const evalCache = {
  async get(key: string): Promise<PvLine[] | undefined> {
    const db = await openDb();
    return (await req(db.transaction("evals").objectStore("evals").get(key))) as PvLine[] | undefined;
  },
  async set(key: string, lines: PvLine[]): Promise<void> {
    const db = await openDb();
    const tx = db.transaction("evals", "readwrite");
    tx.objectStore("evals").put(lines, key);
    await done(tx);
  },
};
