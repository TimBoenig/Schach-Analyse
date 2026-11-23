import { describe, expect, it } from "vitest";

import { callOf, duelOverview, type StrengthEstimate } from "../../src/domain/players";

// Only value (Lichess blitz scale) and se matter for the call; the rest is the shape the type asks for.
const est = (value: number, se = 40): StrengthEstimate => ({ value, se, columns: {}, elo: Math.round(value), elo_low: Math.round(value - 80), elo_high: Math.round(value + 80), extrapolated: false }) as unknown as StrengthEstimate;

describe("duel call", () => {
  it("sorts a forecast into even, slight and clear favourite for either side", () => {
    expect(callOf(0.5)).toBe("even");
    expect(callOf(0.54)).toBe("even");
    expect(callOf(0.46)).toBe("even");
    expect(callOf(0.62)).toBe("slight-a");
    expect(callOf(0.38)).toBe("slight-b");
    expect(callOf(0.8)).toBe("clear-a");
    expect(callOf(0.2)).toBe("clear-b");
  });

  it("is the mirror image from the other side and needs both strengths", () => {
    const strong = est(1900);
    const weak = est(1500);
    const ab = duelOverview(strong, weak, null)!;
    const ba = duelOverview(weak, strong, null)!;
    expect(ab.call).toBe("clear-a");
    expect(ba.call).toBe("clear-b");
    expect(ab.score_a + ba.score_a).toBeCloseTo(100, 3);
    expect(ab.elo_gap).toBe(-ba.elo_gap);
    expect(ab.elo_gap).toBeGreaterThan(0);
    expect(duelOverview(strong, null, null)).toBeNull();
  });

  it("keeps the direct games as a plain record and lets them nudge an even duel", () => {
    const even = duelOverview(est(1600), est(1600), null)!;
    expect(even.call).toBe("even");
    expect(even.record).toBeNull();
    const rival = duelOverview(est(1600), est(1600), { games: 30, wins: 24, draws: 2, losses: 4, score_pct: 83, recent: [] })!;
    expect(rival.record).toEqual({ games: 30, wins: 24, draws: 2, losses: 4 });
    expect(rival.score_a).toBeGreaterThan(even.score_a);
  });
});
