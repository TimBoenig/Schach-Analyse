// Local-first persistence in IndexedDB. Every record carries `updated_at`
// (ms) so the optional cloud sync can merge devices last-writer-wins;
// deletions are soft (`deleted: true`) so they propagate too.
import { platformGameKey } from "../domain/gameKey";
import { parseFinishedAt } from "../domain/metrics/played";
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
 * Most recently finished game first (a correspondence game counts from its
 * last move, not from the day it started). `timestamp` is when a game was
 * saved, and imports arrive in archive order, so it only breaks ties (and
 * orders undated games).
 */
export function sortGames(games: StoredGame[]): StoredGame[] {
  const keyed = games.map((g) => ({ g, played: parseFinishedAt(g) }));
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
  /** Number of moves of the live game stored under each platform game key, rebuilt lazily. */
  platformKeys: Map<string, number> | null;
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
      const cache: GameCache = { records: new Map(all.map((g) => [g.id, g])), live: null, platformKeys: null };
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
  gameCache.platformKeys = null;
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

/**
 * Whether a game is already stored. With `game` (an import candidate) the
 * platform's own game number counts too: the same Lichess or Chess.com game
 * with a slightly different PGN has another id but is no new game. A copy
 * with more moves than the stored one (a running correspondence game) is new.
 */
export async function gameExists(id: string, game?: { pgn_content: string; metadata: { source: string }; moves: unknown[] }): Promise<boolean> {
  if ((await getGame(id)) !== undefined) return true;
  if (!game) return false;
  const key = platformGameKey({ source: game.metadata.source, pgn: game.pgn_content });
  if (!key) return false;
  const cache = await loadGameCache();
  if (!cache.platformKeys) {
    cache.platformKeys = new Map();
    for (const g of cache.records.values()) {
      if (g.deleted) continue;
      const k = platformGameKey(g);
      if (k) cache.platformKeys.set(k, Math.max(cache.platformKeys.get(k) ?? 0, Array.isArray(g.moves_json) ? g.moves_json.length : 0));
    }
  }
  const stored = cache.platformKeys.get(key);
  return stored !== undefined && stored >= game.moves.length;
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

/**
 * Stores games that arrived from the cloud. `decide` sees each record as it is
 * stored right now, inside the same transaction, and returns what to keep
 * there (null leaves it alone). A sync round decides on a snapshot that can be
 * minutes old; a game that finished analysing in the meantime must not be
 * replaced by the older copy from the cloud. Returns the records written.
 */
export async function mergeGames(
  incoming: StoredGame[],
  decide: (current: StoredGame | undefined, incoming: StoredGame) => StoredGame | null,
): Promise<StoredGame[]> {
  if (!incoming.length) return [];
  const db = await openDb();
  const tx = db.transaction("games", "readwrite");
  const store = tx.objectStore("games");
  const saved: StoredGame[] = [];
  for (const g of incoming) {
    const get = store.get(g.id);
    get.onsuccess = () => {
      const next = decide(get.result as StoredGame | undefined, g);
      if (!next) return;
      store.put(next);
      saved.push(next);
    };
  }
  await done(tx);
  if (saved.length) {
    cacheWrite(saved);
    broadcast();
    notify();
  }
  return saved;
}

export function deleteGame(id: string): Promise<void> {
  return deleteGames([id]);
}

/** Deletes several games in one go (one write, one notification). */
export async function deleteGames(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openDb();
  const tx = db.transaction("games", "readwrite");
  const store = tx.objectStore("games");
  const tombs: StoredGame[] = [];
  const now = Date.now();
  for (const id of ids) {
    const g = (await req(store.get(id))) as StoredGame | undefined;
    if (!g || g.deleted) continue;
    // Keep only a tombstone: identity + timestamps, no heavy payload.
    const tomb: StoredGame = { ...g, pgn: "", moves_json: [], summary_json: {}, deleted: true, updated_at: now };
    store.put(tomb);
    tombs.push(tomb);
  }
  await done(tx);
  if (tombs.length) cacheWrite(tombs);
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

/** Stores incoming settings that are newer than what is stored now (decided inside the transaction, like `mergeGames`). */
export async function mergeSettingRecords(incoming: SettingRecord[]): Promise<number> {
  if (!incoming.length) return 0;
  const db = await openDb();
  const tx = db.transaction("settings", "readwrite");
  const store = tx.objectStore("settings");
  let written = 0;
  for (const r of incoming) {
    const get = store.get(r.key);
    get.onsuccess = () => {
      const current = get.result as SettingRecord | undefined;
      if (current && current.updated_at >= r.updated_at) return;
      store.put(r);
      written += 1;
    };
  }
  await done(tx);
  if (written) {
    broadcast();
    notify();
  }
  return written;
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
