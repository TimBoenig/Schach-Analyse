// Client of the admin endpoint (api/admin.ts). The password is only ever sent
// to the server; this device keeps just the signed token it gets back, valid
// for about 30 days ("quick login"). Whether data may be shown is always
// decided by the server: a token edited here is simply refused there.
import { BRAND_DOMAIN } from "../brand";

const TOKEN_KEY = "schach.admin.token";
const ENDPOINT = "/api/admin";

interface Stored {
  token: string;
  expiresAt: number;
}

function stored(now = Date.now()): Stored | null {
  try {
    const s = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? "null") as Stored | null;
    return s && typeof s.token === "string" && s.expiresAt > now ? s : null;
  } catch {
    return null;
  }
}

/** Whether this device holds a token that has not run out (the server still decides). */
export const hasAdminToken = (): boolean => stored() !== null;

export function clearAdmin(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage blocked: nothing was saved either
  }
}

function save(s: Stored): void {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(s));
  } catch {
    // private mode: the password is asked again next time
  }
}

async function call(body: object, token?: string): Promise<Response> {
  return fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

export type LoginResult = { ok: true } | { ok: false; reason: "wrong" | "locked" | "unconfigured" | "network"; retryAfter?: number };

export async function adminLogin(password: string): Promise<LoginResult> {
  try {
    const r = await call({ action: "login", password });
    if (r.ok) {
      save((await r.json()) as Stored);
      return { ok: true };
    }
    const body = (await r.json().catch(() => ({}))) as { retryAfter?: number };
    if (r.status === 401) return { ok: false, reason: "wrong" };
    if (r.status === 429) return { ok: false, reason: "locked", retryAfter: body.retryAfter };
    if (r.status === 503) return { ok: false, reason: "unconfigured" };
    return { ok: false, reason: "network" };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/**
 * Checks the stored token with the server. "offline" (no connection) is not
 * "invalid": the studio runs offline, so there the unexpired token counts.
 */
export async function adminVerify(): Promise<"valid" | "invalid" | "offline"> {
  const s = stored();
  if (!s) return "invalid";
  try {
    const r = await call({ action: "verify" }, s.token);
    if (r.ok) return "valid";
    if (r.status === 401) {
      clearAdmin();
      return "invalid";
    }
    return "offline";
  } catch {
    return "offline";
  }
}

export interface DayCount {
  day: string;
  n: number;
}

export interface WeekCount {
  week: string;
  n: number;
}

export interface HourCount {
  h: number;
  n: number;
}

/** Aggregated numbers only, as returned by the SQL function admin_stats(). */
export interface AdminStats {
  generatedAt: number;
  users: { total: number; confirmed: number; signups1d: number; signups7d: number; signups30d: number; signupsByDay: DayCount[]; signupsByWeek?: WeekCount[] };
  activity: { active1d: number; active7d: number; active30d: number; oldUsers: number; oldUsersActive7d: number; activeByDay: DayCount[]; byHour?: HourCount[] };
  /** Only present once migration 20261123b_admin_stats_v2.sql is applied. */
  retention?: { cohort: number; back1d: number; back7d: number };
  funnel: { signedUp: number; synced: number; analysed: number; analysedMany: number };
  games: {
    total: number;
    analysed: number;
    perUserAvg: number;
    perUserMedian: number;
    analysedPerUserMedian: number;
    buckets: { label: string; n: number }[];
    syncedByDay: DayCount[];
  };
  storage: { records: number; tableBytes: number; deletedGames: number };
}

export type StatsResult = { ok: true; stats: AdminStats } | { ok: false; reason: "unauthorized" | "unconfigured" | "migration" | "failed"; detail?: string };

export async function adminStats(): Promise<StatsResult> {
  const s = stored();
  if (!s) return { ok: false, reason: "unauthorized" };
  try {
    const r = await call({ action: "stats" }, s.token);
    if (r.ok) return { ok: true, stats: (await r.json()) as AdminStats };
    if (r.status === 401) {
      clearAdmin();
      return { ok: false, reason: "unauthorized" };
    }
    if (r.status === 503) return { ok: false, reason: "unconfigured" };
    if (r.status === 501) return { ok: false, reason: "migration" };
    const body = (await r.json().catch(() => ({}))) as { detail?: string };
    return { ok: false, reason: "failed", detail: body.detail ?? `HTTP ${r.status}` };
  } catch (e) {
    // fetch itself failed: offline, or the request left the app's own address
    // (an old bookmark/installed app on a redirected domain is blocked by CORS).
    const where = location.host === BRAND_DOMAIN ? "" : ` (${location.host})`;
    return { ok: false, reason: "failed", detail: `${e instanceof Error ? e.message : "network"}${where}` };
  }
}
