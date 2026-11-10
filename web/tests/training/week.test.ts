import { describe, expect, it } from "vitest";

import {
  buildDailyPlan,
  buildWeekPlan,
  type Exercise,
  type GameErrorPoint,
  interleave,
  isReview,
  logAttempt,
  recordAttempt,
  retention,
  themeOf,
  transferReport,
  weekOutdated,
  weekStart,
  type TrainingLog,
} from "../../src/domain/training";
import type { SkillScore } from "../../src/domain/profile";

type Skill = SkillScore;
const skill = (key: string, score: number): Skill => ({ key, name: key, score, sample: 50, reliable: true, typical: null }) as unknown as Skill;

function puzzle(category: Exercise["category"], i: number, date: string, wp_loss = 0.3): Exercise {
  return {
    id: `${category}-${i}`,
    kind: "puzzle",
    category,
    title: "",
    fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
    solution: "a1a2",
    solution_san: "Ka2",
    accept: ["a1a2"],
    line_san: [],
    prompt: "",
    game_id: "g",
    ply_index: i,
    move_label: "",
    played_san: "",
    classification: "Blunder",
    phase: "middlegame",
    wp_before: 0.5,
    wp_loss,
    opponent: "",
    date,
  };
}

describe("week plan", () => {
  it("rotates the three biggest weaknesses 3/2/1, never twice in a row, Sunday is repetition", () => {
    const week = buildWeekPlan(["blunder", "endgame", "opening", "defense"], "2026-11-12"); // a Thursday
    expect(week.start).toBe("2026-11-09");
    const themes = week.days.map((d) => d.theme);
    expect(themes).toEqual(["blunder", "endgame", "blunder", "opening", "endgame", "blunder", "review"]);
    for (let i = 1; i < 7; i++) expect(themes[i]).not.toBe(themes[i - 1]);
    expect(themeOf(week, "2026-11-12")).toBe("opening");
    expect(weekOutdated(week, "2026-11-15")).toBe(false);
    expect(weekOutdated(week, "2026-11-16")).toBe(true);
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
  });

  it("does not repeat a theme on consecutive days with only two weaknesses", () => {
    const themes = buildWeekPlan(["blunder", "endgame"], "2026-11-10").days.map((d) => d.theme);
    for (let i = 1; i < 7; i++) expect(themes[i]).not.toBe(themes[i - 1]);
  });

  it("puts the day's theme first and prefers fresh positions from recent games", () => {
    const pool = [
      ...Array.from({ length: 10 }, (_, i) => puzzle("blunder", i, i < 5 ? "2026-11-01" : "2025-01-01")),
      ...Array.from({ length: 10 }, (_, i) => puzzle("endgame", i, "2026-11-01")),
    ];
    const skills = [skill("safety", 20), skill("endgame", 60)];
    const input = { skills, patterns: [], pool, progress: {}, prefs: { minutes: 10, focus: "auto" as const }, today: "2026-11-10" };
    const plain = buildDailyPlan(input);
    expect(plain.blocks[0].category).toBe("blunder");
    // Recent games first: the five positions from 2026 games lead, the old ones follow.
    expect(plain.blocks[0].exercise_ids.slice(0, 5).every((id) => Number(id.split("-")[1]) < 5)).toBe(true);
    const themed = buildDailyPlan({ ...input, theme: "endgame" });
    expect(themed.blocks[0]).toMatchObject({ category: "endgame", reason: expect.stringContaining("Wochenplan") });
    expect(themed.theme).toBe("endgame");
  });

  it("interleaves the day's blocks", () => {
    expect(interleave([["a1", "a2", "a3"], ["b1"], ["c1", "c2"]])).toEqual(["a1", "b1", "c1", "a2", "c2", "a3"]);
  });
});

describe("retention", () => {
  it("counts only repetitions from earlier days and needs enough of them", () => {
    let progress = recordAttempt({}, "x", true, "2026-11-01");
    expect(isReview(progress.x, "2026-11-01")).toBe(false);
    expect(isReview(progress.x, "2026-11-02")).toBe(true);
    expect(isReview(undefined, "2026-11-02")).toBe(false);
    let log: TrainingLog = {};
    for (let i = 0; i < 6; i++) log = logAttempt(log, "2026-11-09", "blunder", true, true);
    log = logAttempt(log, "2026-11-09", "blunder", false, false); // a new exercise: not retention
    expect(retention(log, "2026-11-10")).toMatchObject({ done: 6, solved: 6, reliable: false });
    for (let i = 0; i < 4; i++) log = logAttempt(log, "2026-11-10", "blunder", i < 2, true);
    const r = retention(log, "2026-11-10");
    expect(r).toMatchObject({ done: 10, solved: 8, reliable: true });
    expect(r.low).toBeLessThan(80);
    expect(r.high).toBeGreaterThan(80);
    progress = recordAttempt(progress, "x", false, "2026-11-02");
    expect(progress.x.box).toBe(0);
  });
});

describe("transfer to real games", () => {
  const game = (date: string, serious: number, accuracy: number): GameErrorPoint => ({
    date,
    phases: { opening: [10, 1], middlegame: [15, serious], endgame: [5, 1] },
    serious,
    moves: 30,
    accuracy,
  });

  it("reports nothing without data and a clear improvement with enough games", () => {
    expect(transferReport([], null).rows).toEqual([]);
    const before = Array.from({ length: 12 }, (_, i) => game(`2026-09-${String(i + 10).padStart(2, "0")}`, 4, 70 + (i % 3)));
    const fewAfter = Array.from({ length: 4 }, (_, i) => game(`2026-10-1${i}`, 0, 85));
    const thin = transferReport([...before, ...fewAfter], "2026-10-01");
    expect(thin.rows.every((r) => r.verdict === null)).toBe(true);

    const after = Array.from({ length: 12 }, (_, i) => game(`2026-10-${String(i + 10).padStart(2, "0")}`, 1, 80 + (i % 3)));
    const rows = Object.fromEntries(transferReport([...before, ...after], "2026-10-01").rows.map((r) => [r.metric, r]));
    expect(rows.serious).toMatchObject({ verdict: -1, gamesBefore: 12, gamesAfter: 12 });
    expect(rows.serious.before).toBeCloseTo((48 / 360) * 100);
    expect(rows.accuracy.verdict).toBe(-1);
    // 12 × 10 opening moves are below the 150-move minimum: no claim yet.
    expect(rows.opening.verdict).toBeNull();
  });
});
