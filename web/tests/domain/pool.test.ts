// Several engines behind one analyse(): parallel searches, live resizing, crash recovery.
import { describe, expect, it } from "vitest";

import { EnginePool } from "../../src/engine/pool";
import type { UciEngine } from "../../src/engine/uci";

interface Fake {
  id: number;
  hash: number[];
  quit: boolean;
  broken: boolean;
}

/** Engines whose searches finish only when the test says so. */
function fakePool() {
  const engines: Fake[] = [];
  const pending: Array<() => void> = [];
  let active = 0;
  let peak = 0;
  const pool = new EnginePool(() => {
    const f: Fake = { id: engines.length, hash: [], quit: false, broken: false };
    engines.push(f);
    return {
      get broken() {
        return f.broken;
      },
      setOption: async (_name: string, value: number) => void f.hash.push(value),
      analyse: () =>
        new Promise((resolve) => {
          active++;
          peak = Math.max(peak, active);
          pending.push(() => {
            active--;
            resolve([{ depth: 1, cp: f.id, mate: null, pv: ["e2e4"] }]);
          });
        }),
      quit: () => void (f.quit = true),
    } as unknown as UciEngine;
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const finishOne = async () => {
    pending.shift()?.();
    await flush();
  };
  return { pool, engines, pending, finishOne, flush, peak: () => peak };
}

const FEN = "8/8/8/8/8/8/8/K6k w - - 0 1";

describe("EnginePool", () => {
  it("runs as many searches at once as it has engines and sets the hash first", async () => {
    const f = fakePool();
    f.pool.configure({ engines: 2, hashMb: 64 });
    const all = Promise.all([1, 2, 3].map(() => f.pool.analyse(FEN, { depth: 1 })));
    await f.flush();
    expect(f.pending).toHaveLength(2);
    while (f.pending.length) await f.finishOne();
    expect((await all).map((l) => l[0].cp).sort()).toEqual([0, 0, 1]);
    expect(f.peak()).toBe(2);
    expect(f.engines.map((e) => e.hash)).toEqual([[64], [64]]);
  });

  it("grows and shrinks while searches run", async () => {
    const f = fakePool();
    f.pool.configure({ engines: 1, hashMb: 16 });
    const all = Promise.all([1, 2, 3, 4].map(() => f.pool.analyse(FEN, { depth: 1 })));
    await f.flush();
    expect(f.pending).toHaveLength(1);
    // More engines: waiting searches start at once.
    f.pool.configure({ engines: 3, hashMb: 32 });
    await f.flush();
    expect(f.pending).toHaveLength(3);
    // Fewer engines: busy ones finish their search, then retire.
    f.pool.configure({ engines: 1, hashMb: 32 });
    await f.finishOne();
    await f.finishOne();
    expect(f.engines.filter((e) => e.quit)).toHaveLength(2);
    while (f.pending.length) await f.finishOne();
    await all;
    expect(f.pool.running).toBe(1);
    expect(f.engines.find((e) => !e.quit)!.hash.at(-1)).toBe(32);
  });

  it("applies a new hash to an idle engine before its next search", async () => {
    const f = fakePool();
    f.pool.configure({ engines: 1, hashMb: 16 });
    const a = f.pool.analyse(FEN, { depth: 1 });
    await f.flush();
    await f.finishOne();
    await a;
    f.pool.configure({ engines: 1, hashMb: 128 });
    const b = f.pool.analyse(FEN, { depth: 1 });
    await f.flush();
    await f.finishOne();
    await b;
    expect(f.engines).toHaveLength(1);
    expect(f.engines[0].hash).toEqual([16, 128]);
  });

  it("replaces a crashed engine with a fresh one", async () => {
    const f = fakePool();
    f.pool.configure({ engines: 1, hashMb: 16 });
    const first = f.pool.analyse(FEN, { depth: 1 });
    await f.flush();
    f.engines[0].broken = true;
    await f.finishOne();
    await first;
    const second = f.pool.analyse(FEN, { depth: 1 });
    await f.flush();
    await f.finishOne();
    expect((await second)[0].cp).toBe(1);
    expect(f.engines[0].quit).toBe(true);
  });
});
