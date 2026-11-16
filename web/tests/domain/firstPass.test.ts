import { describe, expect, it } from "vitest";

import { DEPTH_PRESETS } from "../../src/domain/analysisDepth";
import { batchProgress, needsDeeperPass, QUICK_SETTINGS } from "../../src/domain/firstPass";

describe("quick first pass", () => {
  it("is shallower than every preset except the quickest, which needs no second pass", () => {
    expect(needsDeeperPass(DEPTH_PRESETS.blitz.settings)).toBe(false);
    for (const p of ["fast", "normal", "deep", "max"] as const) expect(needsDeeperPass(DEPTH_PRESETS[p].settings)).toBe(true);
    expect(QUICK_SETTINGS.multiPv).toBe(2);
  });

  it.each([
    [{ finished: 0, current: null, queued: 0, done: 0, total: 0, deeper: 0 }, { fraction: 0, index: 0, games: 0, idle: true }],
    [{ finished: 0, current: "a", queued: 3, done: 20, total: 40, deeper: 0 }, { fraction: 0.125, index: 1, games: 4, idle: false }],
    [{ finished: 3, current: "d", queued: 0, done: 40, total: 40, deeper: 2 }, { fraction: 1, index: 4, games: 4, idle: false }],
    [{ finished: 2, current: "c", queued: 2, done: 0, total: 0, deeper: 0 }, { fraction: 0.4, index: 3, games: 5, idle: false }],
  ])("counts batch progress in games, the current one by its moves (%#)", (input, want) => {
    expect(batchProgress(input)).toMatchObject(want);
  });
});
