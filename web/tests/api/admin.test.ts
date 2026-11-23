// Admin endpoint: the password is checked on the server, the data stays behind
// a signed token, and a forged or stale token gets nothing.
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../api/admin";
import { checkPassword, fetchStats, issueToken, LoginThrottle, MAX_FAILS, FAIL_WINDOW_MS, TOKEN_DAYS, verifyToken, type AdminEnv } from "../../api/_admin";

const env: AdminEnv = { ADMIN_PASSWORD: "correct horse battery staple", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key" };

const call = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("https://app.test/api/admin", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));

describe("password and token", () => {
  it("accepts only the exact password, and none when the server has no (or a short) one", () => {
    expect(checkPassword(env, env.ADMIN_PASSWORD)).toBe(true);
    for (const wrong of ["", "correct horse battery stapl", "x".repeat(300), 42, null]) expect(checkPassword(env, wrong)).toBe(false);
    expect(checkPassword({}, "anything")).toBe(false);
    expect(checkPassword({ ADMIN_PASSWORD: "short" }, "short")).toBe(false);
  });

  it("signs tokens that expire and cannot be forged, and a new password signs everyone out", () => {
    const now = 1_800_000_000_000;
    const { token, expiresAt } = issueToken(env, now);
    expect(expiresAt).toBe(now + TOKEN_DAYS * 86_400_000);
    expect(verifyToken(env, token, now + 1000)).toBe(true);
    expect(verifyToken(env, token, expiresAt + 1000)).toBe(false);
    const [v, , sig] = token.split(".");
    expect(verifyToken(env, `${v}.${Math.floor(expiresAt / 1000) + 99999}.${sig}`, now)).toBe(false); // extended expiry
    expect(verifyToken(env, `${v}.${Math.floor(expiresAt / 1000)}.AAAA`, now)).toBe(false);
    expect(verifyToken(env, "", now)).toBe(false);
    expect(verifyToken({ ...env, ADMIN_PASSWORD: "another long password!" }, token, now)).toBe(false);
    expect(verifyToken({}, token, now)).toBe(false);
  });
});

describe("login throttle", () => {
  it("locks an address after repeated failures and frees it after the window", () => {
    const th = new LoginThrottle();
    const t0 = 1_000_000;
    for (let i = 0; i < MAX_FAILS; i++) {
      expect(th.lockedFor("a", t0 + i)).toBe(0);
      th.fail("a", t0 + i);
    }
    expect(th.lockedFor("a", t0 + 10)).toBeGreaterThan(0);
    expect(th.lockedFor("b", t0 + 10)).toBe(0);
    expect(th.lockedFor("a", t0 + FAIL_WINDOW_MS + MAX_FAILS)).toBe(0);
  });
});

describe("fetchStats", () => {
  const reply = (status: number, body: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("calls the SQL function with the service key and reports each failure kind", async () => {
    const ok = reply(200, { users: { total: 3 } });
    expect(await fetchStats(env, ok as unknown as typeof fetch)).toEqual({ ok: true, stats: { users: { total: 3 } } });
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.supabase.co/rest/v1/rpc/admin_stats");
    expect((init.headers as Record<string, string>).apikey).toBe("service-key");
    expect(await fetchStats(env, reply(404) as unknown as typeof fetch)).toMatchObject({ ok: false, error: "missing-migration" });
    expect(await fetchStats(env, reply(500) as unknown as typeof fetch)).toMatchObject({ ok: false, error: "failed" });
    expect(await fetchStats({ ...env, SUPABASE_SERVICE_ROLE_KEY: undefined })).toMatchObject({ ok: false, error: "not-configured" });
  });
});

describe("endpoint", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never returns numbers without a valid token", async () => {
    vi.stubGlobal("process", { env: { ...env } });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await call({ action: "stats" })).status).toBe(401);
    expect((await call({ action: "stats" }, { Authorization: "Bearer v1.9999999999.forged" })).status).toBe(401);
    expect((await call({ action: "verify" })).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled(); // the database is not even asked
  });

  it("refuses everything while the server password is not set", async () => {
    vi.stubGlobal("process", { env: {} });
    expect((await call({ action: "login", password: "x" })).status).toBe(503);
  });

  it("logs in with the right password and then serves the aggregated numbers", async () => {
    vi.stubGlobal("process", { env: { ...env } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ users: { total: 6 } }), { status: 200 })));
    const login = await call({ action: "login", password: env.ADMIN_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.headers.get("cache-control")).toBe("no-store");
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };
    expect((await call({ action: "verify" }, auth)).status).toBe(200);
    const stats = await call({ action: "stats" }, auth);
    expect(await stats.json()).toEqual({ users: { total: 6 } });
  });

  it("answers a wrong password with 401 and no token", async () => {
    vi.stubGlobal("process", { env: { ...env } });
    const r = await call({ action: "login", password: "wrong password here" }, { "x-forwarded-for": "9.9.9.9" });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "wrong-password" });
  });
});
