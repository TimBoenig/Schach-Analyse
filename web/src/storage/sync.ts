// Optional cloud sync through Supabase. The app is fully usable without it;
// when signed in, games and settings are merged across devices
// last-writer-wins on `updated_at`. Games travel in a compact form (see
// compact.ts): metadata, PGN, summary and packed move ratings, never the full
// engine lines. Engine evaluations stay device-local.
//
// A round (`syncWith`) works in small, independent steps so that one slow
// request or one broken record can never hold up the rest:
//   1. read only the headers (id, timestamp, analysis status) of what changed
//      online, a few bytes per record;
//   2. compare them with the local records and download the games that are
//      newer or richer online, a few dozen per request, each batch stored at
//      once;
//   3. upload what is newer or richer here, in size-limited batches that are
//      split on failure until the one bad record is isolated.
// Every few hours (and at sign-in or on request) the headers of *all* records
// are compared, which also repairs anything an earlier round missed.
// supabase-js is loaded on demand so it stays out of the startup bundle.
import type { AuthChangeEvent, EmailOtpType, SupabaseClient, User } from "@supabase/supabase-js";

import type { StoredGame } from "../domain/types";
import {
  getSetting,
  listAllGameRecords,
  listSettingRecords,
  mergeGames,
  mergeSettingRecords,
  putSettingRecords,
  setSetting,
  type SettingRecord,
} from "./db";
import {
  analysisRank,
  COMPACT_VERSION,
  fromCloudGameSafe,
  mergeIncomingGame,
  statusRank,
  toCloudGame,
  type CloudGame,
} from "./compact";
import { t } from "../i18n";

type Kind = "game" | "setting";

/** What the server tells about a record without sending its data. */
interface RemoteHead {
  kind: Kind;
  id: string;
  updated_at: number;
  deleted: boolean;
  server_seq: number;
  /** analysis_status of a game's summary; null for settings and tombstones. */
  status: string | null;
  /** Version of the compact move format; null when the game carries no packed moves. */
  moves_v: string | null;
  /** First move of a full `moves_json` written by an old client; null for compact records. */
  legacy: string | null;
}

interface RemoteRow {
  kind: Kind;
  id: string;
  data: unknown;
  updated_at: number;
  deleted: boolean;
  server_seq: number;
}

/** Local settings that describe sync state itself must not sync. */
const isLocalOnly = (key: string) => key.startsWith("sync.");
// The aliases read single values out of the record's JSON on the server, so the
// data itself never travels just to be compared.
const HEAD_COLUMNS: string =
  "kind,id,updated_at,deleted,server_seq,status:data->summary_json->>analysis_status,moves_v:data->moves_c->>v,legacy:data->moves_json->0->>uci";
const DATA_COLUMNS: string = "kind,id,data,updated_at,deleted,server_seq";

/** Request sizes and pauses; tests shrink them to exercise splitting and retrying quickly. */
export const tuning = {
  /** Headers asked per request. The server may cap this lower: pages are read until one comes back empty. */
  headPage: 1000,
  /** Games downloaded per request (about 9 KB each). */
  fetchChunk: 40,
  /** Records and bytes (of data) per upload request. */
  pushItems: 50,
  pushBytes: 250_000,
  /** Pause before the first retry of a failed request; doubles with each further one. */
  retryDelayMs: 500,
};
const ATTEMPTS = 3;
// Rows committed concurrently can land with a lower sequence number than one
// already read; re-reading a small window is harmless because merging is idempotent.
const SEQ_OVERLAP = 50;
const FULL_EVERY_MS = 6 * 60 * 60 * 1000;
// A local change made while a round runs carries a timestamp from after the round
// began; the margin also covers a clock that is a moment off.
const CLOCK_MARGIN_MS = 2000;

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

let client: Promise<SupabaseClient> | null = null;

export interface AuthCallback {
  /** "signup" (address confirmed), "recovery" (reset link), "email_change", … */
  type: string;
  error: string | null;
}

// Mail links either carry tokens in the "#" part (Supabase's own redirect) or,
// with our templates, a one-time token hash in the query: that link points at
// our own domain, which mail filters trust more than a foreign verify URL. The
// hash is exchanged for a session once the client starts (see supabase()).
interface PendingOtp {
  tokenHash: string;
  type: EmailOtpType;
}
const OTP_TYPES: readonly string[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];
let pendingOtp: PendingOtp | null = null;

// supabase-js reads and then clears the tokens in the URL while it starts, so
// what the e-mail link was for is captured before that.
let authCallback: AuthCallback | null = (() => {
  if (typeof window === "undefined") return null;
  const query = new URLSearchParams(window.location.search);
  const tokenHash = query.get("token_hash");
  const type = query.get("type") ?? "";
  if (tokenHash && OTP_TYPES.includes(type)) {
    pendingOtp = { tokenHash, type: type as EmailOtpType };
    // The token must not stay in the address bar, history or a shared screenshot.
    query.delete("token_hash");
    query.delete("type");
    const rest = query.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    return { type: type === "magiclink" ? "signup" : type, error: null };
  }
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
  if (/expired|invalid/i.test(msg)) return t("Der Link ist abgelaufen oder wurde schon benutzt. Fordere bitte einen neuen an.");
  return msg;
}

export function syncAvailable(): boolean {
  return Boolean(url && key);
}

export function supabase(): Promise<SupabaseClient> | null {
  if (!syncAvailable()) return null;
  if (!client) {
    client = import("@supabase/supabase-js").then(async ({ createClient }) => {
      const sb = createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true } });
      if (pendingOtp) {
        const { tokenHash, type } = pendingOtp;
        pendingOtp = null;
        const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
        if (error && authCallback) authCallback = { ...authCallback, error: translateLinkError(error.message) };
      }
      return sb;
    });
  }
  return client;
}

export async function currentUser(): Promise<User | null> {
  const sb = await supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

// ---- requests ----

/** Thrown when the server cannot be reached at all: there is no point in going on with this round. */
class RoundAbort extends Error {}

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs requests with a few retries. */
class Requests {
  async run(request: () => PromiseLike<{ data: unknown; error: unknown }>, attempts = ATTEMPTS): Promise<unknown[]> {
    for (let attempt = 1; ; attempt++) {
      try {
        const { data, error } = await request();
        if (error) throw error;
        return Array.isArray(data) ? data : [];
      } catch (e) {
        if (attempt >= attempts) throw e;
        await sleep(tuning.retryDelayMs * 2 ** (attempt - 1));
      }
    }
  }

  /**
   * Called when a request failed for good. A server that does not answer a
   * trivial question is out of reach and the round stops; one that does has
   * rejected this particular request, which is then split or given up on.
   */
  async assertReachable(sb: SupabaseClient): Promise<void> {
    try {
      await this.run(() => sb.from("sync_records").select("id").limit(1), 1);
    } catch (e) {
      throw new RoundAbort(messageOf(e));
    }
  }
}

/**
 * Asks for records by id until all that exist have arrived. A server can cap
 * the rows per answer below the number asked for, so a short answer is no
 * sign that the rest is missing; an empty one is.
 */
async function byId<T extends { id: string }>(ids: string[], request: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  let todo = ids;
  while (todo.length) {
    const rows = await request(todo);
    if (!rows.length) break;
    out.push(...rows);
    const got = new Set(rows.map((r) => r.id));
    todo = todo.filter((id) => !got.has(id));
  }
  return out;
}

/** Headers of everything that changed online after `sinceSeq`, newest state per record. */
async function pullHeads(net: Requests, sb: SupabaseClient, sinceSeq: number): Promise<{ heads: Map<string, RemoteHead>; maxSeq: number }> {
  const heads = new Map<string, RemoteHead>();
  let cursor = Math.max(0, sinceSeq - SEQ_OVERLAP);
  let maxSeq = sinceSeq;
  for (;;) {
    const page = (await net.run(() =>
      sb.from("sync_records").select(HEAD_COLUMNS).gt("server_seq", cursor).order("server_seq", { ascending: true }).limit(tuning.headPage),
    )) as RemoteHead[];
    // Only an empty page ends the loop: the server may hand out fewer rows than asked for.
    if (!page.length) break;
    for (const h of page) heads.set(`${h.kind}:${h.id}`, h);
    const next = Math.max(cursor, page[page.length - 1].server_seq);
    if (next === cursor) break; // a page that does not move on would repeat forever
    cursor = next;
    maxSeq = Math.max(maxSeq, cursor);
  }
  return { heads, maxSeq };
}

async function headsFor(net: Requests, sb: SupabaseClient, kind: Kind, ids: string[]): Promise<Map<string, RemoteHead>> {
  const out = new Map<string, RemoteHead>();
  for (const part of chunks(ids, 100)) {
    const rows = await byId(part, async (todo) => (await net.run(() => sb.from("sync_records").select(HEAD_COLUMNS).eq("kind", kind).in("id", todo))) as RemoteHead[]);
    for (const h of rows) out.set(h.id, h);
  }
  return out;
}

/**
 * Downloads records by id. A request that fails is retried and then split in
 * halves, so a record the server cannot deliver ends up alone in `lost`
 * while everything around it still arrives.
 */
async function fetchRows(
  net: Requests,
  sb: SupabaseClient,
  kind: Kind,
  ids: string[],
  attempts = ATTEMPTS,
): Promise<{ rows: RemoteRow[]; lost: string[] }> {
  try {
    const rows = await byId(ids, async (todo) => (await net.run(() => sb.from("sync_records").select(DATA_COLUMNS).eq("kind", kind).in("id", todo), attempts)) as RemoteRow[]);
    return { rows, lost: [] };
  } catch (e) {
    if (e instanceof RoundAbort) throw e;
    await net.assertReachable(sb);
    if (ids.length === 1) return { rows: [], lost: ids };
    // The server answers, so this batch holds a record it chokes on: one try per half is enough.
    const mid = ids.length >> 1;
    const a = await fetchRows(net, sb, kind, ids.slice(0, mid), 1);
    const b = await fetchRows(net, sb, kind, ids.slice(mid), 1);
    return { rows: [...a.rows, ...b.rows], lost: [...a.lost, ...b.lost] };
  }
}

// ---- status ----

export interface SyncReport {
  pulled: number;
  pushed: number;
  /** Records that could not be transferred this time; they are tried again next round. */
  failed: number;
}

export interface SyncOptions {
  /** Compare every record, not only what changed since the last round. */
  full?: boolean;
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
let runningFull = false;

/** Pull remote changes, merge, push local changes. Concurrent calls share one run. */
export function syncNow(opts: SyncOptions = {}): Promise<SyncReport> {
  if (running) {
    // A full comparison asked for during an ordinary round runs right after it.
    if (opts.full && !runningFull) return running.then(() => syncNow(opts), () => syncNow(opts));
    return running;
  }
  runningFull = Boolean(opts.full);
  running = (async () => {
    const sb = await supabase();
    const user = await currentUser();
    if (!sb || !user) {
      setStatus({ phase: sb ? "signed-out" : "off", email: null, error: null });
      return { pulled: 0, pushed: 0, failed: 0 };
    }
    setStatus({ phase: "running", email: user.email ?? null, error: null });
    try {
      const report = await syncWith(sb, user.id, opts);
      if (report.failed) setStatus({ phase: "error", error: describeFailed(report.failed) });
      else setStatus({ phase: "idle", lastAt: Date.now(), error: null });
      return report;
    } catch (e) {
      setStatus({ phase: "error", error: describeSyncError(e) });
      throw e;
    }
  })().finally(() => (running = null));
  return running;
}

function describeFailed(n: number): string {
  return n === 1
    ? t("Ein Eintrag konnte gerade nicht abgeglichen werden. Der nächste Versuch läuft automatisch, nichts geht verloren.")
    : t("{n} Einträge konnten gerade nicht abgeglichen werden. Der nächste Versuch läuft automatisch, nichts geht verloren.", { n });
}

/** German message for a failed round; a paused or unreachable server is the usual cause. */
export function describeSyncError(e: unknown): string {
  const msg = messageOf(e);
  if (typeof navigator !== "undefined" && navigator.onLine === false) return t("Offline. Der Abgleich läuft weiter, sobald du wieder Internet hast.");
  if (/failed to fetch|network|load failed|timeout|503|504|522|540/i.test(msg)) {
    return t("Der Sync-Server antwortet nicht. Deine Daten bleiben sicher auf diesem Gerät und werden später abgeglichen.");
  }
  if (/402|quota|exceed/i.test(msg)) return t("Der Sync-Server hat sein Datenkontingent aufgebraucht. Deine Daten bleiben auf diesem Gerät; der Abgleich läuft später weiter.");
  if (/jwt|token|session/i.test(msg)) return t("Die Anmeldung ist abgelaufen. Bitte melde dich neu an.");
  return t("Abgleich fehlgeschlagen: {msg}", { msg });
}

// ---- one round ----

/** True when the online copy carries analysis the local game lacks. */
function cloudHasMore(head: RemoteHead, local: StoredGame): boolean {
  return !head.deleted && !local.deleted && (statusRank(head.status) ?? 0) > analysisRank(local);
}

/** True when the online record is in an older format than this version writes. */
function needsRecompact(head: RemoteHead): boolean {
  return head.legacy != null || (head.moves_v != null && Number(head.moves_v) < COMPACT_VERSION);
}

interface PushItem {
  id: string;
  data: unknown;
  updated_at: number;
  deleted: boolean;
}

/**
 * One round for `userId` (exported for tests with a fake client).
 *
 * Nothing in it relies on the round being fast or on the network behaving: what
 * was downloaded is stored batch by batch, a record that cannot be transferred
 * is remembered and retried later, and anything changed on this device while the
 * round runs (for example an analysis that just finished) is uploaded by the next one.
 */
export async function syncWith(sb: SupabaseClient, userId: string, opts: SyncOptions = {}): Promise<SyncReport> {
  // Local changes after this moment belong to the next round, however long this one takes.
  const startedAt = Date.now();
  const net = new Requests();

  const owner = await getSetting<string>("sync.owner", "");
  const mine = owner === userId;
  // A different account on this device starts from scratch.
  const lastSeq = mine ? await getSetting<number>("sync.lastSeq", 0) : 0;
  const lastPushAt = mine ? await getSetting<number>("sync.lastPushAt", 0) : 0;
  const lastFullAt = mine ? await getSetting<number>("sync.lastFullAt", 0) : 0;
  const retry = new Set(mine ? await getSetting<string[]>("sync.retry", []) : []);
  const compactDone = mine && (await getSetting<number>("sync.compact", 0)) >= COMPACT_VERSION;
  // A full round compares the headers of every record; it also finds records an
  // earlier round missed (an upload that never happened, a game that could not be read).
  const full = Boolean(opts.full) || !mine || !compactDone || startedAt - lastFullAt > FULL_EVERY_MS;

  const { heads, maxSeq } = await pullHeads(net, sb, full ? 0 : lastSeq);

  const localGames = new Map((await listAllGameRecords()).map((g) => [g.id, g]));
  const localSettings = new Map((await listSettingRecords()).filter((s) => !isLocalOnly(s.key)).map((s) => [s.key, s]));

  // ---- what to download, what to upload ----
  const wantGames = new Set<string>();
  const sendGames = new Set<string>();
  const wantSettings = new Set<string>();
  const sendSettings = new Set<string>();

  for (const h of heads.values()) {
    if (h.kind === "game") {
      const l = localGames.get(h.id);
      if (!l) {
        // A deletion of a game this device never had needs no download.
        if (!h.deleted) wantGames.add(h.id);
        continue;
      }
      const cloudNewer = h.updated_at - l.updated_at;
      // The newer copy wins, but never at the cost of analysis; at equal age only a full
      // round looks again, which retries games whose analysis could not be read before.
      if (cloudNewer > 0 || (cloudHasMore(h, l) && (cloudNewer < 0 || full))) wantGames.add(h.id);
      else if (cloudNewer < 0) sendGames.add(h.id);
    } else if (!isLocalOnly(h.id)) {
      const l = localSettings.get(h.id);
      if (!l || h.updated_at > l.updated_at) wantSettings.add(h.id);
      else if (h.updated_at < l.updated_at) sendSettings.add(h.id);
    }
  }
  // Records the server does not know: new here, or (in a full round) never received.
  for (const l of localGames.values()) {
    if (heads.has(`game:${l.id}`)) continue;
    if (full ? !l.deleted : l.updated_at > lastPushAt) sendGames.add(l.id);
  }
  for (const l of localSettings.values()) {
    if (!heads.has(`setting:${l.key}`) && (full || l.updated_at > lastPushAt)) sendSettings.add(l.key);
  }
  // Records uploaded by an older version carry the full analysis; send them once
  // more in the compact form to shrink the online copy.
  for (const h of heads.values()) {
    const l = h.kind === "game" ? localGames.get(h.id) : undefined;
    if (l && !l.deleted && needsRecompact(h) && !wantGames.has(l.id)) sendGames.add(l.id);
  }
  // What failed to upload last time.
  for (const k of retry) {
    if (k.startsWith("game:") && localGames.has(k.slice(5)) && !wantGames.has(k.slice(5))) sendGames.add(k.slice(5));
    if (k.startsWith("setting:") && localSettings.has(k.slice(8))) sendSettings.add(k.slice(8));
  }

  // ---- download ----
  let pulled = 0;
  const repush = new Set<string>();
  const missed = new Set<string>();

  const downloadGames = async (ids: string[]): Promise<void> => {
    for (const part of chunks(ids, tuning.fetchChunk)) {
      const { rows, lost } = await fetchRows(net, sb, "game", part);
      for (const id of lost) missed.add(id);
      const decoded: StoredGame[] = [];
      for (const r of rows) {
        const g = await fromCloudGameSafe(r.data as CloudGame, { id: r.id, updated_at: r.updated_at, deleted: r.deleted });
        if (g) decoded.push(g);
        else missed.add(r.id);
      }
      // Decided against what is stored at this moment, not against the snapshot above.
      const written = await mergeGames(decoded, (current, incoming) => {
        const merged = mergeIncomingGame(current, incoming);
        if (!merged) return null;
        if (merged.repush) repush.add(incoming.id);
        return merged.game;
      });
      pulled += written.length;
    }
  };

  await downloadGames([...wantGames]);
  for (const part of chunks([...wantSettings], 100)) {
    const { rows, lost } = await fetchRows(net, sb, "setting", part);
    for (const id of lost) missed.add(`setting:${id}`);
    pulled += await mergeSettingRecords(rows.map((r) => ({ key: r.id, value: r.data, updated_at: r.updated_at, deleted: r.deleted })));
  }

  // ---- upload ----
  // Decided late and from fresh records: games finish analysing while a round runs.
  let fresh = new Map((await listAllGameRecords()).map((g) => [g.id, g]));
  let sendIds = [...new Set([...sendGames, ...repush])].filter((id) => fresh.has(id));
  repush.clear();

  // The online copy may have changed since the headers were read (another device is
  // uploading too). Never overwrite a newer or richer one: download it instead.
  const online = await headsFor(net, sb, "game", sendIds);
  // The same version is already there (a record carrying a timestamp from another
  // device's clock looks changed here, for instance).
  sendIds = sendIds.filter((id) => {
    const h = online.get(id);
    const l = fresh.get(id)!;
    return !(h && h.updated_at === l.updated_at && !needsRecompact(h) && (statusRank(h.status) ?? 0) >= analysisRank(l));
  });
  const late = sendIds.filter((id) => {
    const h = online.get(id);
    return h !== undefined && (h.updated_at > fresh.get(id)!.updated_at || cloudHasMore(h, fresh.get(id)!));
  });
  if (late.length) {
    await downloadGames(late);
    const skip = new Set(late);
    fresh = new Map((await listAllGameRecords()).map((g) => [g.id, g]));
    // Games where our analysis outweighed the newer online copy go up again.
    sendIds = [...new Set([...sendIds.filter((id) => !skip.has(id)), ...repush])].filter((id) => fresh.has(id));
  }

  const failed = new Set<string>();
  let pushed = 0;
  const upload = async (kind: Kind, items: PushItem[], attempts = ATTEMPTS): Promise<void> => {
    try {
      await net.run(
        () =>
          sb.from("sync_records").upsert(
            items.map((it) => ({ user_id: userId, kind, ...it })),
            { onConflict: "user_id,kind,id" },
          ),
        attempts,
      );
      pushed += items.length;
    } catch (e) {
      if (e instanceof RoundAbort) throw e;
      await net.assertReachable(sb);
      if (items.length === 1) failed.add(`${kind}:${items[0].id}`);
      else {
        // The server answers, so this batch holds a record it refuses: halve until it
        // stands alone; the others still go up.
        const mid = items.length >> 1;
        await upload(kind, items.slice(0, mid), 1);
        await upload(kind, items.slice(mid), 1);
      }
    }
  };

  let batch: PushItem[] = [];
  let bytes = 0;
  const flush = async (kind: Kind) => {
    if (batch.length) await upload(kind, batch);
    batch = [];
    bytes = 0;
  };
  const add = async (kind: Kind, item: PushItem) => {
    const size = JSON.stringify(item.data ?? null).length;
    if (batch.length && (batch.length >= tuning.pushItems || bytes + size > tuning.pushBytes)) await flush(kind);
    batch.push(item);
    bytes += size;
  };

  for (const id of sendIds) {
    const g = fresh.get(id)!;
    await add("game", { id, data: await toCloudGame(g), updated_at: g.updated_at, deleted: Boolean(g.deleted) });
  }
  await flush("game");
  for (const k of sendSettings) {
    const s = localSettings.get(k);
    if (s) await add("setting", { id: k, data: s.value ?? null, updated_at: s.updated_at, deleted: Boolean(s.deleted) });
  }
  await flush("setting");

  // ---- remember where we are ----
  const complete = missed.size === 0;
  const state: SettingRecord[] = [
    { key: "sync.lastPushAt", value: startedAt - CLOCK_MARGIN_MS, updated_at: 0 },
    { key: "sync.retry", value: [...failed], updated_at: 0 },
  ];
  // The position moves on only when everything announced was downloaded; otherwise
  // the next round reads the same headers again (what arrived is skipped as equal).
  if (complete) {
    state.push(
      { key: "sync.owner", value: userId, updated_at: 0 },
      { key: "sync.lastSeq", value: maxSeq, updated_at: 0 },
      { key: "sync.compact", value: COMPACT_VERSION, updated_at: 0 },
    );
    if (full) state.push({ key: "sync.lastFullAt", value: startedAt, updated_at: 0 });
    if (failed.size === 0) state.push({ key: "sync.lastSyncAt", value: Date.now(), updated_at: 0 });
  }
  await putSettingRecords(state, true);
  return { pulled, pushed, failed: missed.size + failed.size };
}

async function requireClient(): Promise<SupabaseClient> {
  const sb = await supabase();
  if (!sb) throw new Error(t("In dieser Version ist kein Sync-Server hinterlegt."));
  return sb;
}

/** Where links in account e-mails lead back to (the account page of this app). */
function accountUrl(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

export const MIN_PASSWORD = 8;

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD) return t("Das Passwort braucht mindestens {MIN_PASSWORD} Zeichen.", { MIN_PASSWORD });
  if (!/[a-zA-ZäöüÄÖÜß]/.test(password) || !/[^a-zA-ZäöüÄÖÜß]/.test(password)) {
    return t("Nimm Buchstaben und mindestens eine Zahl oder ein Sonderzeichen.");
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
  if (!user) throw new Error(t("Nicht angemeldet."));
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

export interface CloudStats {
  /** Games this account keeps online (not counting deleted ones). */
  games: number;
  /** Of those, the ones with a completed analysis. */
  analysed: number;
}

export async function cloudGameStats(): Promise<CloudStats | null> {
  const sb = await supabase();
  const user = await currentUser();
  if (!sb || !user) return null;
  const live = () =>
    sb.from("sync_records").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("kind", "game").eq("deleted", false);
  const [all, done] = await Promise.all([live(), live().eq("data->summary_json->>analysis_status", "completed")]);
  return all.error || done.error ? null : { games: all.count ?? 0, analysed: done.count ?? 0 };
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
  if (/invalid login/i.test(msg)) return t("E-Mail oder Passwort ist falsch.");
  if (/not confirmed/i.test(msg)) return t("Bitte bestätige zuerst deine E-Mail-Adresse über den Link in der Bestätigungsmail.");
  if (/already registered|already been registered/i.test(msg)) return t("Für diese E-Mail gibt es schon ein Konto. Bitte melde dich an.");
  if (/email rate limit/i.test(msg)) return t("Gerade wurden zu viele E-Mails verschickt. Bitte versuche es in einer Stunde noch einmal oder melde dich mit Passwort an.");
  if (/rate limit|too many|security purposes/i.test(msg)) return t("Zu viele Versuche. Bitte warte kurz und probiere es dann noch einmal.");
  if (/signups not allowed|signup.*disabled/i.test(msg)) return t("Neue Konten sind gerade nicht möglich. Bitte versuche es später noch einmal.");
  if (/invalid.*email|email.*invalid/i.test(msg)) return t("Diese E-Mail-Adresse ist ungültig.");
  if (/same password|different from the old/i.test(msg)) return t("Das neue Passwort muss sich vom alten unterscheiden.");
  if (/failed to fetch|network|load failed/i.test(msg)) return t("Keine Verbindung zum Sync-Server. Bitte prüfe deine Internetverbindung.");
  if (/weak|pwned|leaked/i.test(msg)) return t("Dieses Passwort ist zu unsicher oder schon in Datenlecks aufgetaucht. Bitte wähle ein anderes.");
  if (/password/i.test(msg)) return t("Das Passwort braucht mindestens {MIN_PASSWORD} Zeichen.", { MIN_PASSWORD });
  return msg;
}
