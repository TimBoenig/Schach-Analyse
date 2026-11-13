// The app's own WebAssembly build of Caissa (web/engine/caissa), run in Node.
// These are the behaviours the analysis relies on and that the browser build
// adds to the engine: a time limit that never drops the evaluation, and a
// search that can be stopped although the engine has only one thread.
import { existsSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";

import { UciEngine } from "../../src/engine/uci";
import { ENGINE_JS, nodeTransport } from "../engine";

const MIDDLEGAME = "r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2QK2R w KQ - 4 8";

describe.skipIf(!existsSync(ENGINE_JS))("Caissa WebAssembly build", () => {
  const engine = new UciEngine(nodeTransport());
  afterAll(() => engine.quit());

  it("reports two lines, best first, with legal first moves", async () => {
    const lines = await engine.analyse(MIDDLEGAME, { depth: 8, movetimeMs: 2000, multiPv: 2 });
    expect(lines).toHaveLength(2);
    expect(lines[0].depth).toBe(8);
    expect(lines[0].cp).not.toBeNull();
    expect(lines[0].cp!).toBeGreaterThanOrEqual(lines[1].cp!);
    expect(lines[0].pv[0]).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
    expect(lines[0].pv[0]).not.toBe(lines[1].pv[0]);
  }, 20000);

  it("ends a search at the time limit and still returns its lines", async () => {
    const started = Date.now();
    const lines = await engine.analyse(MIDDLEGAME, { depth: 60, movetimeMs: 300, multiPv: 2 });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(lines).toHaveLength(2);
    expect(lines[0].depth).toBeGreaterThan(5);
  }, 20000);

  it("evaluates a position with a single legal move under a time limit", async () => {
    // Engines tuned for play answer a forced move at once, without a score; the analysis needs the score.
    const lines = await engine.analyse("4k3/8/8/8/8/5q2/7P/7K w - - 0 1", { depth: 10, movetimeMs: 1000, multiPv: 2 });
    expect(lines).toHaveLength(1);
    expect(lines[0].pv[0]).toBe("h1g1");
    expect(lines[0].cp ?? -lines[0].mate! * 10000).toBeLessThan(-500);
  }, 20000);

  it("finds mate scores and returns nothing for a finished game", async () => {
    const [mate] = await engine.analyse("6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", { depth: 8, movetimeMs: 1000, multiPv: 1 });
    expect(mate).toMatchObject({ mate: 1, cp: null });
    expect(mate.pv[0]).toBe("d1d8");
    expect(await engine.analyse("3R2k1/5ppp/8/8/8/8/5PPP/6K1 b - - 1 1", { depth: 8, movetimeMs: 1000, multiPv: 1 })).toEqual([]);
  }, 20000);

  it("stops a running search on request", async () => {
    const started = Date.now();
    const search = engine.analyse(MIDDLEGAME, { depth: 60, multiPv: 1 });
    setTimeout(() => engine.stop(), 300);
    const lines = await search;
    expect(Date.now() - started).toBeLessThan(3000);
    expect(lines).toHaveLength(1);
  }, 20000);
});
