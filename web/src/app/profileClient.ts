import type { PlayerProfile } from "../domain/profile";
import type { ProfileRequest } from "./profile.worker";

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (p: PlayerProfile) => void; reject: (e: Error) => void }>();

export function buildProfileInWorker(req: Omit<ProfileRequest, "id">): Promise<PlayerProfile> {
  if (!worker) {
    worker = new Worker(new URL("./profile.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; profile?: PlayerProfile; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.profile) p.resolve(e.data.profile);
      else p.reject(new Error(e.data.error ?? "Profil konnte nicht berechnet werden."));
    };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ ...req, id });
  });
}
