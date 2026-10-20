// Optional cloud sync through Supabase. The app is fully usable without it;
// when signed in, games and settings are merged across devices
// last-writer-wins on `updated_at`. Engine evaluations stay device-local.
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import type { StoredGame } from "../domain/types";
import {
  getSetting,
  listAllGameRecords,
  listSettingRecords,
  putGames,
  putSettingRecords,
  setSetting,
  type SettingRecord,
} from "./db";

type Kind = "game" | "setting";

interface RemoteRow {
  kind: Kind;
  id: string;
  data: unknown;
  updated_at: number;
  deleted: boolean;
  server_seq: number;
}

/** Local settings that describe sync state itself must not sync. */
const LOCAL_ONLY_SETTINGS = new Set(["sync.lastSeq", "sync.lastPushAt", "sync.lastSyncAt"]);
const PAGE = 200;
// Rows committed concurrently can land with a lower sequence number than one
// already pulled; re-reading a small window is harmless because merging is idempotent.
const SEQ_OVERLAP = 50;

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

let client: SupabaseClient | null = null;

export function syncAvailable(): boolean {
  return Boolean(url && key);
}

export function supabase(): SupabaseClient | null {
  if (!syncAvailable()) return null;
  if (!client) client = createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}

export async function currentUser(): Promise<User | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

export interface MergeResult<T> {
  toLocal: T[];
  toRemote: T[];
}

/** Last-writer-wins merge on updated_at; ties keep the local copy. */
export function mergeRecords<T extends { updated_at: number }>(
  local: Map<string, T>,
  remote: Map<string, T>,
  lastPushAt: number,
): MergeResult<T> {
  const toLocal: T[] = [];
  const toRemote: T[] = [];
  for (const [id, r] of remote) {
    const l = local.get(id);
    if (!l || r.updated_at > l.updated_at) toLocal.push(r);
  }
  for (const [id, l] of local) {
    const r = remote.get(id);
    if (r ? l.updated_at > r.updated_at : l.updated_at > lastPushAt) toRemote.push(l);
  }
  return { toLocal, toRemote };
}

async function pullSince(sb: SupabaseClient, sinceSeq: number): Promise<{ rows: RemoteRow[]; maxSeq: number }> {
  const rows: RemoteRow[] = [];
  let cursor = Math.max(0, sinceSeq - SEQ_OVERLAP);
  let maxSeq = sinceSeq;
  for (;;) {
    const { data, error } = await sb
      .from("sync_records")
      .select("kind,id,data,updated_at,deleted,server_seq")
      .gt("server_seq", cursor)
      .order("server_seq", { ascending: true })
      .limit(PAGE);
    if (error) throw error;
    const page = (data ?? []) as RemoteRow[];
    rows.push(...page);
    if (page.length) {
      cursor = page[page.length - 1].server_seq;
      maxSeq = Math.max(maxSeq, cursor);
    }
    if (page.length < PAGE) break;
  }
  return { rows, maxSeq };
}

async function push(
  sb: SupabaseClient,
  userId: string,
  kind: Kind,
  items: { id: string; data: unknown; updated_at: number; deleted: boolean }[],
) {
  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25).map((it) => ({ user_id: userId, kind, ...it }));
    const { error } = await sb.from("sync_records").upsert(batch, { onConflict: "user_id,kind,id" });
    if (error) throw error;
  }
}

export interface SyncReport {
  pulled: number;
  pushed: number;
}

let running: Promise<SyncReport> | null = null;

/** Pull remote changes, merge, push local changes. Concurrent calls share one run. */
export function syncNow(): Promise<SyncReport> {
  if (!running) {
    running = (async () => {
      const sb = supabase();
      const user = await currentUser();
      if (!sb || !user) return { pulled: 0, pushed: 0 };
      return syncWith(sb, user.id);
    })().finally(() => (running = null));
  }
  return running;
}

/** One pull-merge-push round for `userId` (exported for tests with a fake client). */
export async function syncWith(sb: SupabaseClient, userId: string): Promise<SyncReport> {
  const user = { id: userId };

  const owner = await getSetting<string>("sync.owner", "");
  // A different account on this device starts from a full pull/push.
  const lastSeq = owner === user.id ? await getSetting<number>("sync.lastSeq", 0) : 0;
  const lastPushAt = owner === user.id ? await getSetting<number>("sync.lastPushAt", 0) : 0;

  const { rows, maxSeq } = await pullSince(sb, lastSeq);
  const remoteGames = new Map<string, StoredGame>();
  const remoteSettings = new Map<string, SettingRecord>();
  for (const r of rows) {
    if (r.kind === "game") {
      remoteGames.set(r.id, { ...(r.data as StoredGame), id: r.id, updated_at: r.updated_at, deleted: r.deleted });
    } else if (!LOCAL_ONLY_SETTINGS.has(r.id)) {
      remoteSettings.set(r.id, { key: r.id, value: r.data, updated_at: r.updated_at, deleted: r.deleted });
    }
  }

  const localGames = new Map((await listAllGameRecords()).map((g) => [g.id, g]));
  const localSettings = new Map(
    (await listSettingRecords()).filter((s) => !s.key.startsWith("sync.")).map((s) => [s.key, s]),
  );

  const games = mergeRecords(localGames, remoteGames, lastPushAt);
  const settings = mergeRecords(localSettings, remoteSettings, lastPushAt);

  await putGames(games.toLocal, { touch: false });
  if (settings.toLocal.length) await putSettingRecords(settings.toLocal);

  const pushStarted = Date.now();
  await push(
    sb,
    user.id,
    "game",
    games.toRemote.map((g) => {
      const { updated_at, deleted, ...data } = g;
      return { id: g.id, data, updated_at, deleted: Boolean(deleted) };
    }),
  );
  await push(
    sb,
    user.id,
    "setting",
    settings.toRemote.map((s) => ({ id: s.key, data: s.value ?? null, updated_at: s.updated_at, deleted: Boolean(s.deleted) })),
  );

  await putSettingRecords(
    [
      { key: "sync.owner", value: user.id, updated_at: 0 },
      { key: "sync.lastSeq", value: maxSeq, updated_at: 0 },
      { key: "sync.lastPushAt", value: pushStarted, updated_at: 0 },
      { key: "sync.lastSyncAt", value: Date.now(), updated_at: 0 },
    ],
    true,
  );
  return { pulled: games.toLocal.length + settings.toLocal.length, pushed: games.toRemote.length + settings.toRemote.length };
}

export async function signIn(email: string, password: string): Promise<void> {
  const sb = supabase();
  if (!sb) throw new Error("Sync ist nicht eingerichtet.");
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(translateAuthError(error.message));
}

/** Returns true when the account still has to be confirmed by e-mail. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const sb = supabase();
  if (!sb) throw new Error("Sync ist nicht eingerichtet.");
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw new Error(translateAuthError(error.message));
  return !data.session;
}

export async function signOut(): Promise<void> {
  await supabase()?.auth.signOut();
  await setSetting("sync.lastSyncAt", 0);
}

function translateAuthError(msg: string): string {
  if (/invalid login/i.test(msg)) return "E-Mail oder Passwort ist falsch.";
  if (/not confirmed/i.test(msg)) return "Bitte bestätige zuerst deine E-Mail-Adresse über den Link in der Bestätigungsmail.";
  if (/already registered/i.test(msg)) return "Für diese E-Mail gibt es schon ein Konto. Bitte melde dich an.";
  if (/failed to fetch|network/i.test(msg)) return "Keine Verbindung zum Sync-Server. Bitte prüfe deine Internetverbindung.";
  if (/password/i.test(msg)) return "Das Passwort muss mindestens 6 Zeichen lang sein.";
  return msg;
}
