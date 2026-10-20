import { vi } from "vitest";

export type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;

/** Stubs global fetch with a router; returns the recorded calls. */
export function mockFetch(route: Route) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      calls.push({ url, init });
      return route(url, init);
    }),
  );
  return calls;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
