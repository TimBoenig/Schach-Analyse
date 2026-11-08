import type { AiExportInput, AiExportResult } from "../domain/aiExport";
import type { ExportInput, FullExport } from "../domain/export";
import type { PlayerProfile } from "../domain/profile";
import type { StoredGame } from "../domain/types";
import type { ProfileRequest } from "./profile.worker";

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();

// Profile and training both need the same profile; building it costs ~50 ms per
// game, so results are reused until the games or filters change.
const cache = new Map<string, Promise<PlayerProfile>>();
// The friends ranking builds one profile per player, so keep a few more around.
const CACHE_SIZE = 16;

export interface ProfileInput {
  games: StoredGame[];
  usernames: string[];
  format: string;
  date: string;
  color: string;
}

// The game objects the worker already holds, by id. `listGames` hands out the
// same objects until a game is saved again, so identity tells what changed.
const sent = new Map<string, StoredGame>();

function cacheKey(req: ProfileInput): string {
  let newest = 0;
  for (const g of req.games) newest = Math.max(newest, g.updated_at ?? 0);
  return JSON.stringify([req.usernames, req.format, req.date, req.color, req.games.length, newest]);
}

export function buildProfileInWorker(req: ProfileInput): Promise<PlayerProfile> {
  const key = cacheKey(req);
  const hit = cache.get(key);
  if (hit) return hit;
  const { games, ...rest } = req;
  const upserts: StoredGame[] = [];
  for (const g of games) {
    if (sent.get(g.id) !== g) {
      upserts.push(g);
      sent.set(g.id, g);
    }
  }
  const msg: Omit<ProfileRequest, "id"> = { ...rest, gameIds: games.map((g) => g.id), upserts };
  const p = runInWorker<PlayerProfile>(msg);
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return p;
}

/** Full export (profile, reviews, training) built off the main thread. */
export function buildExportInWorker(input: ExportInput): Promise<FullExport> {
  return runInWorker<FullExport>({ kind: "export", input });
}

/** Markdown file for AI chats (profile, per-game evidence) built off the main thread. */
export function buildAiExportInWorker(input: AiExportInput): Promise<AiExportResult> {
  return runInWorker<AiExportResult>({ kind: "ai-export", input });
}

function runInWorker<T>(msg: object): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL("./profile.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.result !== undefined) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error ?? "Profil konnte nicht berechnet werden."));
    };
    // A crashed worker (out of memory, say) loses the games it held: start over.
    worker.onerror = (e) => {
      e.preventDefault();
      worker?.terminate();
      worker = null;
      sent.clear();
      cache.clear();
      for (const p of pending.values()) p.reject(new Error("Profil konnte nicht berechnet werden."));
      pending.clear();
    };
  }
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (r: unknown) => void, reject });
    worker!.postMessage({ ...msg, id });
  });
}
