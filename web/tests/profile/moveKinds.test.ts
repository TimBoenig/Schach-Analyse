import { describe, expect, it } from "vitest";

import { errorExtremes, kindRows, lastMonths, monthlyQuality, phaseQuality, spanQuality, tallySummary } from "../../src/domain/profile";
import { type Counts, emptyCounts, type MoveTally, type TallyBlock, TALLY_CLASSES, totalOf } from "../../src/domain/profile/moves";

const counts = (c: Partial<Counts>): Counts => ({ ...emptyCounts(), ...c });

function block(key: string, c: Partial<Counts>, games = 1): TallyBlock {
  const all = counts(c);
  return { key, label: key, games, moves: totalOf(all), counts: all };
}

/** A tally of `games` games with these counts; only the fields the page rules read are filled. */
function tally(mine: Partial<Counts>, theirs: Partial<Counts> | null, games = 40, extra: Partial<MoveTally> = {}): MoveTally {
  const c = counts(mine);
  const moves = totalOf(c);
  return {
    games,
    moves,
    counts: c,
    classes: TALLY_CLASSES.map((key) => ({ key, count: c[key], per_game: c[key] / games, per_100: (c[key] / moves) * 100, games_with: Math.min(games, c[key]) })),
    opponents: theirs ? { moves: totalOf(counts(theirs)), counts: counts(theirs) } : null,
    phases: [],
    months: [],
    highlights: [],
    top_games: [],
    records: { games_with_brilliant: 0, most_brilliant: 0, blunder_free_games: 0, longest_blunder_free: 0, current_blunder_free: 0 },
    findings: [],
    ...extra,
  };
}

describe("kinds of moves against the opponents", () => {
  // 1,200 moves each. The player finds far more best moves and blunders far
  // less; the mistakes are level, and one great move more proves nothing.
  const t = tally(
    { Great: 4, Best: 640, Excellent: 250, Good: 150, Book: 76, Inaccuracy: 40, Mistake: 25, Blunder: 15 },
    { Great: 3, Best: 520, Excellent: 250, Good: 180, Book: 76, Inaccuracy: 60, Mistake: 26, Blunder: 85 },
  );
  const rows = kindRows(t);
  const row = (key: string) => rows.find((r) => r.key === key)!;

  it("lists every kind best to worst in its group with both rates", () => {
    expect(rows.map((r) => r.key)).toEqual([...TALLY_CLASSES]);
    expect(rows.map((r) => r.group)).toEqual(["shine", "shine", "solid", "solid", "solid", "solid", "error", "error", "error", "error"]);
    expect(row("Best").per_100).toBeCloseTo((640 / 1200) * 100);
    expect(row("Best").opp_per_100).toBeCloseTo((520 / 1200) * 100);
    expect(row("Blunder").per_game).toBeCloseTo(15 / 40);
  });

  it.each([
    ["Best", 1], // more of the good kind
    ["Blunder", 1], // fewer of the bad kind
    ["Mistake", 0], // 25 against 26 is no difference
    ["Great", 0], // 4 against 3 is chance
    ["Miss", 0], // none on either side
  ] as const)("judges %s as %i", (key, verdict) => {
    expect(row(key).verdict).toBe(verdict);
  });

  it("calls a clearly higher error rate worse", () => {
    const worse = kindRows(tally({ Best: 1100, Blunder: 100 }, { Best: 1170, Blunder: 30 }));
    expect(worse.find((r) => r.key === "Blunder")!.verdict).toBe(-1);
    expect(worse.find((r) => r.key === "Best")!.verdict).toBe(0);
  });

  it.each(["Excellent", "Good", "Book"] as const)("never judges %s, whatever the gap", (key) => {
    const lopsided = kindRows(tally({ [key]: 900, Best: 300 }, { [key]: 300, Best: 900 }));
    expect(lopsided.find((r) => r.key === key)!.verdict).toBeNull();
  });

  it("gives no verdict and no opponent rate without the opponents' moves", () => {
    const alone = kindRows(tally({ Best: 900, Blunder: 100 }, null));
    expect(alone.every((r) => r.verdict === null && r.opp_per_100 === null)).toBe(true);
  });

  it("stays silent on too few moves, however large the gap", () => {
    const few = kindRows(tally({ Best: 100, Blunder: 2 }, { Best: 70, Blunder: 32 }, 4));
    expect(few.find((r) => r.key === "Blunder")!.verdict).toBe(0);
  });
});

describe("tally summary", () => {
  it("sums top moves, serious errors and shine moves for both sides", () => {
    const s = tallySummary(tally({ Brilliant: 2, Great: 8, Best: 490, Good: 440, Mistake: 30, Miss: 10, Blunder: 20 }, { Best: 400, Good: 500, Mistake: 60, Blunder: 40 }, 25));
    expect(s.top_pct).toBeCloseTo(50);
    expect(s.serious_per_100).toBeCloseTo(6);
    expect(s.blunders_per_game).toBeCloseTo(0.8);
    expect(s.shine).toBe(10);
    // On 1,000 moves each, 6 against 10 errors per 100 is still within what chance can do.
    expect(s.opponents).toEqual({ top_pct: 40, serious_per_100: 10, top_verdict: 0, serious_verdict: 0 });
  });

  it("judges the two rates against the opponents only when the gap is clear", () => {
    const level = tallySummary(tally({ Best: 500, Good: 440, Mistake: 60 }, { Best: 490, Good: 455, Mistake: 55 }));
    expect(level.opponents).toMatchObject({ top_verdict: 0, serious_verdict: 0 });
    const ahead = tallySummary(tally({ Best: 1200, Good: 720, Mistake: 80 }, { Best: 900, Good: 900, Mistake: 200 }));
    expect(ahead.opponents).toMatchObject({ top_verdict: 1, serious_verdict: 1 });
    const behind = tallySummary(tally({ Best: 350, Good: 530, Blunder: 120 }, { Best: 520, Good: 440, Blunder: 40 }));
    expect(behind.opponents).toMatchObject({ top_verdict: -1, serious_verdict: -1 });
  });

  it("has no opponent values without their moves and survives an empty tally", () => {
    const s = tallySummary(tally({}, null, 0));
    expect(s).toEqual({ top_pct: 0, serious_per_100: 0, blunders_per_game: 0, shine: 0, opponents: null });
  });
});

describe("phases and months", () => {
  it("leaves out phases without a move and marks thin ones", () => {
    const t = tally({ Best: 10 }, null, 5, {
      phases: [block("opening", { Book: 150, Best: 40, Mistake: 10 }), block("middlegame", { Brilliant: 1, Best: 59, Blunder: 20 }), block("endgame", {})],
    });
    const rows = phaseQuality(t);
    expect(rows.map((p) => [p.key, p.moves, p.thin, p.shine])).toEqual([
      ["opening", 200, false, 0],
      ["middlegame", 80, true, 1],
    ]);
    expect(rows[0].top_pct).toBeCloseTo(20);
    expect(rows[0].serious_per_100).toBeCloseTo(5);
    expect(rows[1].serious_per_100).toBeCloseTo(25);
  });

  it("keeps only months with enough moves, in order", () => {
    const months = [block("2026-03", { Best: 60, Good: 60 }, 4), block("2026-04", { Best: 30 }, 1), block("2026-05", { Best: 90, Good: 100, Blunder: 10 }, 7)];
    expect(monthlyQuality(months)).toEqual([
      { key: "2026-03", games: 4, moves: 120, top_pct: 50, serious_per_100: 0 },
      { key: "2026-05", games: 7, moves: 200, top_pct: 45, serious_per_100: 5 },
    ]);
    expect(monthlyQuality(months, 20).map((m) => m.key)).toEqual(["2026-03", "2026-04", "2026-05"]);
  });
});

describe("a span of months", () => {
  const months = monthlyQuality([
    block("2025-11", { Best: 100, Good: 90, Blunder: 10 }, 5),
    block("2026-01", { Best: 240, Good: 152, Blunder: 8 }, 9),
    block("2026-02", { Best: 60, Good: 132, Blunder: 8 }, 4),
    block("2026-03", { Best: 90, Good: 104, Blunder: 6 }, 5),
  ]);

  it.each([
    [null, ["2025-11", "2026-01", "2026-02", "2026-03"]],
    [92, ["2026-01", "2026-02", "2026-03"]], // three calendar months back from March
    [183, ["2025-11", "2026-01", "2026-02", "2026-03"]], // the gap in December takes no room
    [31, ["2026-03"]],
  ] as const)("cuts to the last %s days across the turn of the year", (days, keys) => {
    expect(lastMonths(months, days).map((m) => m.key)).toEqual(keys);
  });

  it("pools the rates by moves and names the best months", () => {
    const s = spanQuality(lastMonths(months, 92))!;
    expect(s).toMatchObject({ months: 3, games: 18, moves: 800 });
    // 390 top moves and 22 serious errors in 800 moves, not the mean of the three monthly rates.
    expect(s.top_pct).toBeCloseTo(48.75);
    expect(s.serious_per_100).toBeCloseTo(2.75);
    expect(s.best_top?.key).toBe("2026-01");
    expect(s.fewest_errors?.key).toBe("2026-01");
  });

  it("names no best month for a single month and is null without moves", () => {
    expect(spanQuality(lastMonths(months, 31))).toMatchObject({ months: 1, best_top: null, fewest_errors: null });
    expect(spanQuality([])).toBeNull();
  });
});

describe("where the errors pile up", () => {
  const b = (label: string, moves: number, errors: number) => ({ label, moves, errors });

  it("names the slice clearly above the rest and the one clearly below", () => {
    const { high, low } = errorExtremes([b("1-10", 800, 8), b("11-20", 800, 40), b("21-30", 600, 75), b("31+", 400, 22)]);
    expect(high?.bucket.label).toBe("21-30");
    expect(high?.per_100).toBeCloseTo(12.5);
    expect(high?.rest_per_100).toBeCloseTo(3.5);
    expect(low?.bucket.label).toBe("1-10");
    expect(low?.rest_per_100).toBeCloseTo((137 / 1800) * 100);
  });

  it("names nothing when the rates are about level", () => {
    expect(errorExtremes([b("a", 600, 30), b("b", 600, 33), b("c", 600, 28)])).toEqual({ high: null, low: null });
  });

  it("ignores a striking rate that rests on a handful of moves", () => {
    const { high } = errorExtremes([b("Dame", 40, 12), b("Springer", 900, 40), b("Turm", 900, 42)]);
    expect(high).toBeNull();
  });

  it("returns nothing for no slices", () => {
    expect(errorExtremes([])).toEqual({ high: null, low: null });
  });
});
