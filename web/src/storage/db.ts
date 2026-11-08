// Local-first persistence in IndexedDB. Every record carries `updated_at`
// (ms) so the optional cloud sync can merge devices last-writer-wins;
// deletions are soft (`deleted: true`) so they propagate too.
import { parsePlayedAt } from "../domain/profile/features";
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
  resetGameCache();
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

// Other tabs of the app write the same database; they tell this one to drop
// its in-memory copy of the games (see `gameCache`).
const channel: BroadcastChannel | null =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("schach-analyse-data") : null;
if (channel) {
  channel.onmessage = () => {
    resetGameCache();
    notify();
  };
}
function broadcast(): void {
  try {
    channel?.postMessage("changed");
  } catch {
    // A closed channel only costs the other tabs their live refresh.
  }
}

// ---- games ----

/**
 * Newest played game first. `timestamp` is when a game was saved, and imports
 * arrive in archive order, so it only breaks ties (and orders undated games).
 */
export function sortGames(games: StoredGame[]): StoredGame[] {
  const keyed = games.map((g) => ({ g, played: parsePlayedAt(g) }));
  keyed.sort((a, b) => {
    if (a.played !== b.played) {
      if (a.played === null) return 1;
      if (b.played === null) return -1;
      return b.played - a.played;
    }
    return b.g.timestamp - a.g.timestamp;
  });
  return keyed.map((k) => k.g);
}

// Every record of the games store, kept in memory after the first read. With a
// thousand analysed games the store holds tens of megabytes; reading and sorting
// it again on every page change and every finished analysis made the whole app
// sluggish. All writes go through this module, so they update the copy directly.
interface GameCache {
  records: Map<string, StoredGame>;
  /** Sorted live games, rebuilt lazily after a write. */
  live: StoredGame[] | null;
}
let gameCache: GameCache | null = null;
let gameCacheLoad: Promise<GameCache> | null = null;

// Bumped by every write, so a read that started before one is not kept.
let gameCacheGen = 0;

async function loadGameCache(): Promise<GameCache> {
  if (gameCache) return gameCache;
  if (!gameCacheLoad) {
    const gen = gameCacheGen;
    const load = (async () => {
      const db = await openDb();
      const all = (await req(db.transaction("games").objectStore("games").getAll())) as StoredGame[];
      const cache: GameCache = { records: new Map(all.map((g) => [g.id, g])), live: null };
      if (gen === gameCacheGen) gameCache = cache;
      return cache;
    })();
    gameCacheLoad = load;
    load.then(
      () => {
        if (gameCacheLoad === load) gameCacheLoad = null;
      },
      () => {
        if (gameCacheLoad === load) gameCacheLoad = null;
      },
    );
  }
  return gameCacheLoad;
}

function cacheWrite(games: StoredGame[]): void {
  // A read still in flight started before this write: let the next call re-read.
  gameCacheGen += 1;
  gameCacheLoad = null;
  if (!gameCache) return;
  for (const g of games) gameCache.records.set(g.id, g);
  gameCache.live = null;
}

/**
 * All live (not deleted) games, newest played first. The array and the game
 * objects are shared between callers: treat them as read-only and save changes
 * through `putGames`, which hands out fresh objects.
 */
export async function listGames(): Promise<StoredGame[]> {
  const cache = await loadGameCache();
  cache.live ??= sortGames([...cache.records.values()].filter((g) => !g.deleted));
  return cache.live;
}

/** For tests: forget the in-memory copy of the games. */
export function resetGameCache(): void {
  gameCacheGen += 1;
  gameCache = null;
  gameCacheLoad = null;
}

/** Every record including tombstones (sync). */
export async function listAllGameRecords(): Promise<StoredGame[]> {
  return [...(await loadGameCache()).records.values()];
}

export async function getGame(id: string): Promise<StoredGame | undefined> {
  let g: StoredGame | undefined;
  if (gameCache) g = gameCache.records.get(id);
  else {
    const db = await openDb();
    g = (await req(db.transaction("games").objectStore("games").get(id))) as StoredGame | undefined;
  }
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
  const saved = games.map((g) => (touch ? { ...g, updated_at: now } : { ...g }));
  for (const g of saved) store.put(g);
  await done(tx);
  cacheWrite(saved);
  broadcast();
  if (!silent) notify();
}

export async function deleteGame(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("games", "readwrite");
  const store = tx.objectStore("games");
  const g = (await req(store.get(id))) as StoredGame | undefined;
  // Keep only a tombstone: identity + timestamps, no heavy payload.
  const tomb = g ? { ...g, pgn: "", moves_json: [], summary_json: {}, deleted: true, updated_at: Date.now() } : null;
  if (tomb) store.put(tomb);
  await done(tx);
  if (tomb) cacheWrite([tomb]);
  broadcast();
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
  broadcast();
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
