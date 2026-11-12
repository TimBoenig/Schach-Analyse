// Optional cloud sync through Supabase. The app is fully usable without it;
// when signed in, games and settings are merged across devices
// last-writer-wins on `updated_at`. Games travel in a compact form (see
// compact.ts): metadata, PGN, summary and packed move ratings, never the full
// engine lines. Engine evaluations stay device-local.
// supabase-js is loaded on demand so it stays out of the startup bundle.
import type { AuthChangeEvent, SupabaseClient, User } from "@supabase/supabase-js";

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
import { COMPACT_VERSION, fromCloudGame, keepRicherMoves, toCloudGame, type CloudGame } from "./compact";

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
const LOCAL_ONLY_SETTINGS = new Set(["sync.lastSeq", "sync.lastPushAt", "sync.lastSyncAt", "sync.compact"]);
const PAGE = 200;
// Rows committed concurrently can land with a lower sequence number than one
// already pulled; re-reading a small window is harmless because merging is idempotent.
const SEQ_OVERLAP = 50;

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

let client: Promise<SupabaseClient> | null = null;

export interface AuthCallback {
  /** "signup" (address confirmed), "recovery" (reset link), "email_change", … */
  type: string;
  error: string | null;
}

// supabase-js reads and then clears the tokens in the URL while it starts, so
// what the e-mail link was for is captured before that.
let authCallback: AuthCallback | null = (() => {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (!params.has("access_token") && !params.has("error")) return null;
  const error = params.get("error_description") || params.get("error");
  return { type: params.get("type") ?? "signup", error: error ? translateLinkError(error) : null };
})();

/** The e-mail link this page was opened from (kept until handled). */
export function getAuthCallback(): AuthCallback | null {
  return authCallback;
}

export function clearAuthCallback(): void {
  authCallback = null;
}

export function hasAuthCallback(): boolean {
  return authCallback !== null;
}

function translateLinkError(msg: string): string {
  if (/expired|invalid/i.test(msg)) return "Der Link ist abgelaufen oder wurde schon benutzt. Fordere bitte einen neuen an.";
  return msg;
}

export function syncAvailable(): boolean {
  return Boolean(url && key);
}

export function supabase(): Promise<SupabaseClient> | null {
  if (!syncAvailable()) return null;
  if (!client) {
    client = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true } }),
    );
  }
  return client;
}

export async function currentUser(): Promise<User | null> {
  const sb = await supabase();
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

export type SyncPhase = "off" | "signed-out" | "idle" | "running" | "error";

export interface SyncStatus {
  phase: SyncPhase;
  email: string | null;
  /** ms since epoch of the last successful round on this device. */
  lastAt: number;
  error: string | null;
}

let status: SyncStatus = { phase: syncAvailable() ? "signed-out" : "off", email: null, lastAt: 0, error: null };
const statusListeners = new Set<(s: SyncStatus) => void>();

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const l of statusListeners) l(status);
}

/** Live sync state for the account chip and the account page. */
export function subscribeSyncStatus(cb: (s: SyncStatus) => void): () => void {
  statusListeners.add(cb);
  cb(status);
  return () => statusListeners.delete(cb);
}

/** Reads the stored session (no network) so the UI knows who is signed in. */
export async function refreshSyncStatus(): Promise<SyncStatus> {
  if (!syncAvailable()) return status;
  const user = await currentUser().catch(() => null);
  if (!user) setStatus({ phase: "signed-out", email: null });
  else {
    const lastAt = await getSetting<number>("sync.lastSyncAt", 0);
    setStatus({ email: user.email ?? null, lastAt, phase: status.phase === "signed-out" || status.phase === "off" ? "idle" : status.phase });
  }
  return status;
}

let running: Promise<SyncReport> | null = null;

/** Pull remote changes, merge, push local changes. Concurrent calls share one run. */
export function syncNow(): Promise<SyncReport> {
  if (!running) {
    running = (async () => {
      const sb = await supabase();
      const user = await currentUser();
      if (!sb || !user) {
        setStatus({ phase: sb ? "signed-out" : "off", email: null, error: null });
        return { pulled: 0, pushed: 0 };
      }
      setStatus({ phase: "running", email: user.email ?? null, error: null });
      try {
        const report = await syncWith(sb, user.id);
        setStatus({ phase: "idle", lastAt: Date.now() });
        return report;
      } catch (e) {
        setStatus({ phase: "error", error: describeSyncError(e) });
        throw e;
      }
    })().finally(() => (running = null));
  }
  return running;
}

/** German message for a failed round; a paused or unreachable server is the usual cause. */
export function describeSyncError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "Offline. Der Abgleich läuft weiter, sobald du wieder Internet hast.";
  if (/failed to fetch|network|load failed|timeout|503|504|522|540/i.test(msg)) {
    return "Der Sync-Server antwortet nicht. Deine Daten bleiben sicher auf diesem Gerät und werden später abgeglichen.";
  }
  if (/jwt|token|session/i.test(msg)) return "Die Anmeldung ist abgelaufen. Bitte melde dich neu an.";
  return `Abgleich fehlgeschlagen: ${msg}`;
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

  // Only games that win the merge are unpacked (rebuilding moves from the PGN costs time).
  const incoming: StoredGame[] = [];
  for (const g of games.toLocal) {
    const { id, updated_at, deleted, ...data } = g;
    const decoded = await fromCloudGame(data as unknown as CloudGame, { id, updated_at, deleted: Boolean(deleted) });
    const { game, repush } = keepRicherMoves(localGames.get(id), decoded);
    incoming.push(game);
    if (repush) games.toRemote.push(game);
  }
  await putGames(incoming, { touch: false });
  if (settings.toLocal.length) await putSettingRecords(settings.toLocal);

  // Records uploaded by an older version carry the full analysis; re-upload
  // everything once in the compact form to shrink the online copy.
  const compactDone = owner === user.id && (await getSetting<number>("sync.compact", 0)) >= COMPACT_VERSION;
  if (!compactDone) {
    const skip = new Set([...games.toRemote, ...games.toLocal].map((g) => g.id));
    for (const g of localGames.values()) if (!skip.has(g.id)) games.toRemote.push(g);
  }

  const pushStarted = Date.now();
  const gameItems = [];
  for (const g of games.toRemote) {
    gameItems.push({ id: g.id, data: await toCloudGame(g), updated_at: g.updated_at, deleted: Boolean(g.deleted) });
  }
  await push(sb, user.id, "game", gameItems);
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
      { key: "sync.compact", value: COMPACT_VERSION, updated_at: 0 },
    ],
    true,
  );
  return { pulled: games.toLocal.length + settings.toLocal.length, pushed: games.toRemote.length + settings.toRemote.length };
}

async function requireClient(): Promise<SupabaseClient> {
  const sb = await supabase();
  if (!sb) throw new Error("In dieser Version ist kein Sync-Server hinterlegt.");
  return sb;
}

/** Where links in account e-mails lead back to (the account page of this app). */
function accountUrl(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

export const MIN_PASSWORD = 8;

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`;
  if (!/[a-zA-ZäöüÄÖÜß]/.test(password) || !/[^a-zA-ZäöüÄÖÜß]/.test(password)) {
    return "Nimm Buchstaben und mindestens eine Zahl oder ein Sonderzeichen.";
  }
  return null;
}

export async function signIn(email: string, password: string): Promise<void> {
  const { data, error } = await (await requireClient()).auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(translateAuthError(error.message));
  setStatus({ phase: "idle", email: data.user?.email ?? email.trim(), error: null });
}

/** Returns true when the account still has to be confirmed by e-mail. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const { data, error } = await (await requireClient()).auth.signUp({
    email: email.trim(),
    password,
    options: { emailRedirectTo: accountUrl() },
  });
  if (error) throw new Error(translateAuthError(error.message));
  return !data.session;
}

/** Sends a reset link; the link signs the user in and the app asks for a new password. */
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await (await requireClient()).auth.resetPasswordForEmail(email.trim(), { redirectTo: accountUrl() });
  if (error) throw new Error(translateAuthError(error.message));
}

export async function changePassword(password: string): Promise<void> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const { error } = await (await requireClient()).auth.updateUser({ password });
  if (error) throw new Error(translateAuthError(error.message));
}

export async function signOut(): Promise<void> {
  await (await supabase())?.auth.signOut();
  await setSetting("sync.lastSyncAt", 0);
  setStatus({ phase: "signed-out", email: null, error: null, lastAt: 0 });
}

/**
 * Deletes everything this account stored online. Local data on this device
 * stays; the next sync would upload it again, so the user is signed out.
 */
export async function deleteCloudData(): Promise<void> {
  const sb = await requireClient();
  const user = await currentUser();
  if (!user) throw new Error("Nicht angemeldet.");
  const { error } = await sb.from("sync_records").delete().eq("user_id", user.id);
  if (error) throw new Error(describeSyncError(error));
  await putSettingRecords(
    [
      { key: "sync.owner", value: "", updated_at: 0 },
      { key: "sync.lastSeq", value: 0, updated_at: 0 },
    ],
    true,
  );
  await signOut();
}

/**
 * Passwordless sign-in: mails a one-click link. Creates the account on first
 * use, so it doubles as the quickest way to register.
 */
export async function signInWithLink(email: string): Promise<void> {
  const { error } = await (await requireClient()).auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: accountUrl(), shouldCreateUser: true },
  });
  if (error) throw new Error(translateAuthError(error.message));
}

/** Sends the confirmation mail of a fresh registration again. */
export async function resendConfirmation(email: string): Promise<void> {
  const { error } = await (await requireClient()).auth.resend({
    type: "signup",
    email: email.trim(),
    options: { emailRedirectTo: accountUrl() },
  });
  if (error) throw new Error(translateAuthError(error.message));
}

export interface AccountInfo {
  email: string;
  displayName: string;
  createdAt: number;
}

export async function accountInfo(): Promise<AccountInfo | null> {
  const user = await currentUser();
  if (!user) return null;
  const meta = (user.user_metadata ?? {}) as { display_name?: string };
  return {
    email: user.email ?? "",
    displayName: meta.display_name ?? "",
    createdAt: user.created_at ? Date.parse(user.created_at) : 0,
  };
}

export async function setDisplayName(name: string): Promise<void> {
  const { error } = await (await requireClient()).auth.updateUser({ data: { display_name: name.trim().slice(0, 40) } });
  if (error) throw new Error(translateAuthError(error.message));
}

/** Number of games this account keeps online (not counting deleted ones). */
export async function cloudGameCount(): Promise<number | null> {
  const sb = await supabase();
  const user = await currentUser();
  if (!sb || !user) return null;
  const { count, error } = await sb
    .from("sync_records")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("kind", "game")
    .eq("deleted", false);
  return error ? null : (count ?? 0);
}

/**
 * Deletes the account itself together with its online data. Returns false
 * when the server has no delete function yet; then only the online data is
 * removed (the login stays until the operator deletes it).
 */
export async function deleteAccount(): Promise<boolean> {
  const sb = await requireClient();
  const { error } = await sb.rpc("delete_account");
  if (error) {
    if (/could not find|does not exist|PGRST202/i.test(`${error.code} ${error.message}`)) {
      await deleteCloudData();
      return false;
    }
    throw new Error(describeSyncError(error));
  }
  await putSettingRecords(
    [
      { key: "sync.owner", value: "", updated_at: 0 },
      { key: "sync.lastSeq", value: 0, updated_at: 0 },
    ],
    true,
  );
  await signOut().catch(() => undefined);
  return true;
}

/** Calls `cb` on sign-in, sign-out and when a password-reset link was opened. */
export async function onAuthEvent(cb: (event: AuthChangeEvent) => void): Promise<() => void> {
  const sb = await supabase();
  if (!sb) return () => undefined;
  const sub = sb.auth.onAuthStateChange((event, session) => {
    if (session?.user) setStatus({ email: session.user.email ?? null, phase: status.phase === "running" ? "running" : "idle" });
    else if (event === "SIGNED_OUT") setStatus({ phase: "signed-out", email: null });
    cb(event);
  });
  return () => sub.data.subscription.unsubscribe();
}

function translateAuthError(msg: string): string {
  if (/invalid login/i.test(msg)) return "E-Mail oder Passwort ist falsch.";
  if (/not confirmed/i.test(msg)) return "Bitte bestätige zuerst deine E-Mail-Adresse über den Link in der Bestätigungsmail.";
  if (/already registered|already been registered/i.test(msg)) return "Für diese E-Mail gibt es schon ein Konto. Bitte melde dich an.";
  if (/email rate limit/i.test(msg)) return "Gerade wurden zu viele E-Mails verschickt. Bitte versuche es in einer Stunde noch einmal oder melde dich mit Passwort an.";
  if (/rate limit|too many|security purposes/i.test(msg)) return "Zu viele Versuche. Bitte warte kurz und probiere es dann noch einmal.";
  if (/signups not allowed|signup.*disabled/i.test(msg)) return "Neue Konten sind gerade nicht möglich. Bitte versuche es später noch einmal.";
  if (/invalid.*email|email.*invalid/i.test(msg)) return "Diese E-Mail-Adresse ist ungültig.";
  if (/same password|different from the old/i.test(msg)) return "Das neue Passwort muss sich vom alten unterscheiden.";
  if (/failed to fetch|network|load failed/i.test(msg)) return "Keine Verbindung zum Sync-Server. Bitte prüfe deine Internetverbindung.";
  if (/weak|pwned|leaked/i.test(msg)) return "Dieses Passwort ist zu unsicher oder schon in Datenlecks aufgetaucht. Bitte wähle ein anderes.";
  if (/password/i.test(msg)) return `Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`;
  return msg;
}
