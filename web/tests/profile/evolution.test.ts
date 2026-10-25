// Development over time, game types, precision statistics and the form summary.
import { describe, expect, it } from "vitest";

import { buildEvolution, buildPrecision, extractFeatures, formSummary, gameTypes, personalFeedback, wilsonMargin } from "../../src/domain/profile";
import { profileGames } from "./fixtures";

// Four lost games where Tim throws a won position away, then six clean wins.
const FEATS = profileGames(4, 6).map((r) => extractFeatures(r, "white"));

describe("evolution and feedback", () => {
  it("calls a clear before/after change significant and names it in the feedback", () => {
    const evo = buildEvolution(FEATS);
    expect(evo.half).toBe(5);
    expect(evo.blocks).toHaveLength(2);
    expect(evo.blocks.map((b) => b.games)).toEqual([5, 5]);
    const score = evo.changes.find((c) => c.key === "score")!;
    expect(score.earlier).toBe(20);
    expect(score.recent).toBe(100);
    expect(score.significant && score.improved).toBe(true);
    const blunders = evo.changes.find((c) => c.key === "blunders")!;
    expect(blunders.improved).toBe(true);

    const fb = personalFeedback(evo, gameTypes(FEATS), [], buildPrecision(FEATS));
    expect(fb[0].title).toBe("Fortschritt");
    expect(fb[0].tone).toBe("good");
  });

  it("has no before/after comparison below five games per half", () => {
    const evo = buildEvolution(profileGames(2, 3).map((r) => extractFeatures(r, "white")));
    expect(evo.changes).toEqual([]);
  });
});

describe("precision", () => {
  it("uses a Wilson interval that shrinks with more games", () => {
    expect(wilsonMargin(0.5, 1)).toBeNull();
    expect(wilsonMargin(0.5, 100)).toBe(9.6);
    expect(wilsonMargin(0.5, 10)!).toBeGreaterThan(wilsonMargin(0.5, 100)!);
    // Even at 100 % the interval stays open towards lower scores.
    expect(wilsonMargin(1, 10)!).toBeGreaterThan(0);
  });

  it("counts converted and thrown-away winning positions", () => {
    const p = buildPrecision(FEATS);
    expect(p.overall.games).toBe(10);
    expect(p.overall.score_pct).toBe(60);
    expect(p.turnarounds).toMatchObject({ winning: 10, converted: 6, lost_from_winning: 4, losing: 4, saved: 0 });
    expect(p.by_color.find((c) => c.key === "white")?.games).toBe(10);
  });
});

describe("form summary", () => {
  it("compares the last four weeks with the weeks before and reports the slope per four weeks", () => {
    // One accuracy point more every week, with a week off in between.
    const weeks = ["2026-05-04", "2026-05-11", "2026-05-18", "2026-05-25", "2026-06-08", "2026-06-15"];
    const weekly = weeks.map((week) => ({ week, avg_accuracy: 70 + (Date.parse(week) - Date.parse(weeks[0])) / (7 * 86400000) }));
    weekly.splice(4, 0, { week: "2026-06-01", avg_accuracy: null as unknown as number });
    const f = formSummary(weekly);
    expect(f.weeks).toBe(6);
    expect(f.trend_per_month).toBe(4);
    expect(f.best).toEqual({ week: "2026-06-15", accuracy: 76 });
    expect(f.recent).toBe(74); // 72, 73, 75, 76
    expect(f.previous).toBe(70.5);
  });
});
