// Port of src/backend/api/base_api.py: shared GET helper with timeout,
// error logging and JSON safety. Browsers forbid setting User-Agent, so the
// desktop app's default header is dropped; both APIs send CORS headers.

export const DEFAULT_TIMEOUT_MS = 30_000;

/** Minimum spacing between requests to the same host (sequential, polite crawling). */
const MIN_INTERVAL_MS: Record<string, number> = {
  "api.chess.com": 250,
  "lichess.org": 250,
};

const nextSlot = new Map<string, number>();

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function throttle(url: string, signal?: AbortSignal): Promise<void> {
  const host = new URL(url).host;
  const interval = MIN_INTERVAL_MS[host] ?? 0;
  if (!interval) return;
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, slot + interval);
  if (slot > now) await sleep(slot - now, signal);
}

/** Test hook: forget throttle state so tests do not wait on each other. */
export function resetThrottle(): void {
  nextSlot.clear();
}

export interface RequestOptions {
  headers?: Record<string, string>;
  params?: Record<string, string | number>;
  timeoutMs?: number;
  /** Cancels the request (e.g. the user stops a bulk import). */
  signal?: AbortSignal;
}

export function withParams(url: string, params?: Record<string, string | number>): string {
  if (!params) return url;
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return `${url}${url.includes("?") ? "&" : "?"}${query.toString()}`;
}

/**
 * GET with timeout. Returns the response, or null on network errors,
 * timeouts and non-2xx statuses (logged). Re-throws only when the caller's
 * own signal aborted, so cancellation is never mistaken for "no data".
 */
export async function makeRequest(url: string, options: RequestOptions = {}): Promise<Response | null> {
  const { headers, params, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options;
  const fullUrl = withParams(url, params);
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);
  try {
    await throttle(fullUrl, signal);
    signal?.throwIfAborted();
    const response = await fetch(fullUrl, { headers, signal: controller.signal });
    if (!response.ok) {
      console.error(`Request failed for ${fullUrl}: HTTP ${response.status}`);
      return null;
    }
    return response;
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? err;
    if (controller.signal.aborted) console.error(`Request timeout: ${fullUrl}`);
    else console.error(`Request failed for ${fullUrl}: ${String(err)}`);
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Parses JSON, returning null (logged) on malformed bodies. */
export async function safeJson<T = Record<string, unknown>>(response: Response | null): Promise<T | null> {
  if (!response) return null;
  try {
    return (await response.json()) as T;
  } catch {
    console.error("Failed to parse JSON response");
    return null;
  }
}

export function logApiError(platform: string, operation: string, error: unknown): void {
  console.error(`[${platform}] ${operation} failed: ${String(error)}`);
}

/** Minimal shape check for untrusted JSON objects. */
export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
