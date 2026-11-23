import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

// There is no DOM in the test run, so these guard the source of the behaviours
// Tim asked for: they fail if someone brings the old behaviour back.
describe("touch behaviour of the game page", () => {
  it("the page cannot be zoomed on any device", () => {
    const css = read("src/ui/styles.css");
    expect(css).toMatch(/html \{\s*touch-action:\s*pan-x pan-y/);
    expect(read("index.html")).toMatch(/maximum-scale=1, user-scalable=no/);
    // The phone size setting rewrites the viewport and must keep the lock.
    expect(read("src/ui/phoneScale.ts")).toContain("user-scalable=no");
    expect(read("src/main.tsx")).toContain("blockZoom()");
  });

  it("the winning-chance charts are pictures: no tap or drag moves the game", () => {
    const win = read("src/ui/report/WinChart.tsx");
    const analysis = read("src/ui/AnalysisView.tsx");
    const evalGraph = analysis.slice(analysis.indexOf("function EvalGraph("), analysis.indexOf("\n}\n", analysis.indexOf("function EvalGraph(")));
    for (const src of [win, evalGraph]) {
      expect(src).not.toMatch(/onPointer(Down|Move|Up)|setPointerCapture|onPick|onClick/);
    }
  });
});

describe("security headers", () => {
  const cfg = JSON.parse(read("vercel.json")) as { headers: { headers: { key: string; value: string }[] }[] };
  const headers = Object.fromEntries(cfg.headers[0].headers.map((h) => [h.key, h.value]));

  it("sets the baseline headers", () => {
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBeTruthy();
    expect(headers["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
  });

  it("the content security policy allows only the services the app talks to", () => {
    const csp = headers["Content-Security-Policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // The WASM engine needs this, but no inline or eval scripts.
    expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval'(;|$)/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
    const connect = csp.match(/connect-src ([^;]+)/)![1].split(" ");
    expect(connect).toEqual(expect.arrayContaining(["'self'", "https://api.chess.com", "https://lichess.org"]));
  });
});
