// Quick login on the device: the token is kept until it expires, a refused
// token is dropped, and a missing connection is not treated as "wrong".
import { beforeEach, describe, expect, it, vi } from "vitest";

import { adminLogin, adminStats, adminVerify, clearAdmin, hasAdminToken } from "../../src/app/adminApi";

const store = new Map<string, string>();
const reply = (status: number, body: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
});

describe("admin session on this device", () => {
  it("keeps the token after login and sends it as bearer, never the password again", async () => {
    vi.stubGlobal("fetch", reply(200, { token: "tok", expiresAt: Date.now() + 1e6 }));
    expect(await adminLogin("pw")).toEqual({ ok: true });
    expect(hasAdminToken()).toBe(true);
    const f = reply(200, { users: {} });
    vi.stubGlobal("fetch", f);
    expect((await adminStats()).ok).toBe(true);
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(String(init.body)).not.toContain("pw");
  });

  it("ignores an expired token and drops one the server refuses", async () => {
    store.set("schach.admin.token", JSON.stringify({ token: "old", expiresAt: Date.now() - 1 }));
    expect(hasAdminToken()).toBe(false);
    expect(await adminVerify()).toBe("invalid");
    store.set("schach.admin.token", JSON.stringify({ token: "t", expiresAt: Date.now() + 1e6 }));
    vi.stubGlobal("fetch", reply(401));
    expect(await adminStats()).toEqual({ ok: false, reason: "unauthorized" });
    expect(hasAdminToken()).toBe(false);
  });

  it("maps server answers, and offline is not invalid", async () => {
    vi.stubGlobal("fetch", reply(401));
    expect(await adminLogin("x")).toEqual({ ok: false, reason: "wrong" });
    vi.stubGlobal("fetch", reply(429, { retryAfter: 120 }));
    expect(await adminLogin("x")).toEqual({ ok: false, reason: "locked", retryAfter: 120 });
    vi.stubGlobal("fetch", reply(503));
    expect(await adminLogin("x")).toEqual({ ok: false, reason: "unconfigured" });
    store.set("schach.admin.token", JSON.stringify({ token: "t", expiresAt: Date.now() + 1e6 }));
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await adminVerify()).toBe("offline");
    vi.stubGlobal("fetch", reply(501));
    expect(await adminStats()).toEqual({ ok: false, reason: "migration" });
    clearAdmin();
    expect(hasAdminToken()).toBe(false);
  });
});
