// Vercel function behind the admin area: POST /api/admin
//   {action:"login", password}  → {token, expiresAt}
//   {action:"verify"}           → {ok:true}            (Authorization: Bearer <token>)
//   {action:"stats"}            → aggregated numbers   (Authorization: Bearer <token>)
// No CORS headers are sent, so only the app's own origin can read answers.
import { bearer, checkPassword, fetchStats, issueToken, LoginThrottle, passwordConfigured, verifyToken, type AdminEnv } from "./_admin.js";

const throttle = new LoginThrottle();
const FAIL_DELAY_MS = 700;

const json = (status: number, body: unknown, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });

const clientKey = (req: Request): string => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";

export async function POST(req: Request): Promise<Response> {
  const env = process.env as AdminEnv;
  if (!passwordConfigured(env)) return json(503, { error: "not-configured" });
  let body: { action?: unknown; password?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json(400, { error: "bad-request" });
  }

  if (body.action === "login") {
    const who = clientKey(req);
    const wait = throttle.lockedFor(who);
    if (wait > 0) return json(429, { error: "locked", retryAfter: wait }, { "Retry-After": String(wait) });
    if (!checkPassword(env, body.password)) {
      throttle.fail(who);
      await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
      return json(401, { error: "wrong-password" });
    }
    throttle.clear(who);
    return json(200, issueToken(env));
  }

  if (!verifyToken(env, bearer(req.headers.get("authorization")))) return json(401, { error: "unauthorized" });
  if (body.action === "verify") return json(200, { ok: true });
  if (body.action === "stats") {
    const r = await fetchStats(env);
    return r.ok ? json(200, r.stats) : json(r.status, { error: r.error, detail: r.detail });
  }
  return json(400, { error: "bad-request" });
}
