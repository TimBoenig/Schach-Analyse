// Server-side core of the admin area (dashboard in Settings and the video
// studio). Runs only in the Vercel function `api/admin.ts`, never in the
// browser. Files starting with "_" are not routed by Vercel.
//
// The password lives in the server environment (ADMIN_PASSWORD). A correct
// password is exchanged for a signed token (HMAC-SHA256, expiry inside the
// signed text); the browser only stores that token. The key is derived from
// the password, so changing ADMIN_PASSWORD signs every device out.
import { createHmac, timingSafeEqual } from "node:crypto";

/** How long a device stays signed in after a correct password. */
export const TOKEN_DAYS = 30;
/** Shorter passwords are refused: the endpoint is public and can be guessed at. */
export const MIN_PASSWORD_LENGTH = 12;
const TOKEN_PREFIX = "v1";

export interface AdminEnv {
  ADMIN_PASSWORD?: string;
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

const hmac = (key: string | Buffer, text: string): Buffer => createHmac("sha256", key).update(text).digest();

/** Constant-time string comparison (hashing first hides the length). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(hmac("cmp", a), hmac("cmp", b));
}

export function passwordConfigured(env: AdminEnv): boolean {
  return (env.ADMIN_PASSWORD ?? "").length >= MIN_PASSWORD_LENGTH;
}

export function checkPassword(env: AdminEnv, given: unknown): boolean {
  if (!passwordConfigured(env) || typeof given !== "string" || given.length === 0 || given.length > 256) return false;
  return safeEqual(given, env.ADMIN_PASSWORD as string);
}

const signingKey = (env: AdminEnv): Buffer => hmac(env.ADMIN_PASSWORD as string, "endgameking-admin-session");

export function issueToken(env: AdminEnv, nowMs = Date.now()): { token: string; expiresAt: number } {
  const expiresAt = Math.floor(nowMs / 1000) + TOKEN_DAYS * 86400;
  const body = `${TOKEN_PREFIX}.${expiresAt}`;
  return { token: `${body}.${hmac(signingKey(env), body).toString("base64url")}`, expiresAt: expiresAt * 1000 };
}

export function verifyToken(env: AdminEnv, token: unknown, nowMs = Date.now()): boolean {
  if (!passwordConfigured(env) || typeof token !== "string" || token.length > 200) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX || !/^\d{1,12}$/.test(parts[1])) return false;
  const body = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(parts[2], hmac(signingKey(env), body).toString("base64url"))) return false;
  return Number(parts[1]) * 1000 > nowMs;
}

export function bearer(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)$/.exec(header ?? "");
  return m ? m[1] : null;
}

/**
 * Throttle for wrong passwords, per client address: MAX_FAILS within the window
 * lock the address out until the window has passed. In memory, so it holds per
 * server instance; together with the fixed delay on every failure and the
 * minimum password length that makes guessing hopeless.
 */
export const MAX_FAILS = 5;
export const FAIL_WINDOW_MS = 15 * 60 * 1000;

export class LoginThrottle {
  private fails = new Map<string, number[]>();

  private recent(key: string, now: number): number[] {
    const list = (this.fails.get(key) ?? []).filter((t) => now - t < FAIL_WINDOW_MS);
    if (list.length) this.fails.set(key, list);
    else this.fails.delete(key);
    return list;
  }

  /** Seconds until the address may try again, 0 when it may. */
  lockedFor(key: string, now = Date.now()): number {
    const list = this.recent(key, now);
    return list.length >= MAX_FAILS ? Math.ceil((list[0] + FAIL_WINDOW_MS - now) / 1000) : 0;
  }

  fail(key: string, now = Date.now()): void {
    // Never grow without bound under a flood of distinct addresses.
    if (this.fails.size > 5000) this.fails.clear();
    this.fails.set(key, [...this.recent(key, now), now]);
  }

  clear(key: string): void {
    this.fails.delete(key);
  }
}

export type StatsResult = { ok: true; stats: unknown } | { ok: false; status: number; error: "not-configured" | "missing-migration" | "failed" };

/** Calls the SQL function admin_stats() with the service-role key (server only). */
export async function fetchStats(env: AdminEnv, fetchImpl: typeof fetch = fetch): Promise<StatsResult> {
  const base = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return { ok: false, status: 503, error: "not-configured" };
  try {
    const r = await fetchImpl(`${base}/rest/v1/rpc/admin_stats`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: "{}",
    });
    // 404 = the function does not exist yet: the migration has not been applied.
    if (r.status === 404) return { ok: false, status: 501, error: "missing-migration" };
    if (!r.ok) return { ok: false, status: 502, error: "failed" };
    return { ok: true, stats: await r.json() };
  } catch {
    return { ok: false, status: 502, error: "failed" };
  }
}
