import type { ExportInput, FullExport } from "../domain/export";
import type { PlayerProfile } from "../domain/profile";
import type { ProfileRequest } from "./profile.worker";

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();

// Profile and training both need the same profile; building it costs ~50 ms per
// game, so results are reused until the games or filters change.
const cache = new Map<string, Promise<PlayerProfile>>();
const CACHE_SIZE = 8;

function cacheKey(req: Omit<ProfileRequest, "id">): string {
  let newest = 0;
  for (const g of req.games) newest = Math.max(newest, g.updated_at ?? 0);
  return JSON.stringify([req.usernames, req.format, req.date, req.color, req.games.length, newest]);
}

export function buildProfileInWorker(req: Omit<ProfileRequest, "id">): Promise<PlayerProfile> {
  const key = cacheKey(req);
  const hit = cache.get(key);
  if (hit) return hit;
  const p = runInWorker<PlayerProfile>(req);
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return p;
}

/** Full export (profile, reviews, training, coach answers) built off the main thread. */
export function buildExportInWorker(input: ExportInput): Promise<FullExport> {
  return runInWorker<FullExport>({ kind: "export", input });
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
  }
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (r: unknown) => void, reject });
    worker!.postMessage({ ...msg, id });
  });
}
