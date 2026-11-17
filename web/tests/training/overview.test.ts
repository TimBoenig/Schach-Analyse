import { describe, expect, it } from "vitest";

import {
  activity,
  buildWeekPlan,
  categoryOverview,
  dueExercises,
  estimateMinutes,
  type Exercise,
  type ExerciseProgress,
  exerciseState,
  logTotals,
  pickSession,
  poolTotals,
  type ProgressMap,
  sessionResult,
  startCategory,
  type TrainingLog,
  weekView,
} from "../../src/domain/training";

const TODAY = "2026-11-17"; // a Tuesday

const ex = (id: string, category: Exercise["category"] = "blunder", kind: Exercise["kind"] = "puzzle"): Exercise => ({ id, category, kind, title: id }) as unknown as Exercise;
const prog = (box: number, due: string, attempts = 1, solved = attempts): ExerciseProgress => ({ box, due, attempts, solved, last: "2026-11-10" });
const day = (done: number, correct: number): TrainingLog[string] => ({ done, correct, by_category: {} });

describe("exerciseState", () => {
  it.each([
    ["never tried", undefined, "new"],
    ["a stored entry without attempts", prog(0, TODAY, 0), "new"],
    ["a miss that comes back tomorrow", prog(0, "2026-11-18", 2, 1), "retry"],
    ["a miss that is due today", prog(0, TODAY, 2, 1), "due"],
    ["solved once, not due yet", prog(1, "2026-11-19"), "learning"],
    ["solved twice and due again", prog(2, "2026-11-15", 2), "due"],
    // A safe exercise stays safe on the day its long interval runs out.
    ["safe and due", prog(3, "2026-11-16", 3), "mastered"],
  ] as const)("%s", (_name, p, state) => {
    expect(exerciseState(p, TODAY)).toBe(state);
  });
});

describe("category overview", () => {
  const pool = [ex("a1"), ex("a2"), ex("a3"), ex("a4"), ex("c1", "chance"), ex("o1", "repertoire", "repertoire")];
  const progress: ProgressMap = {
    a1: prog(3, "2026-11-16", 3), // safe, interval ran out
    a2: prog(1, "2026-11-15"), // due
    a3: prog(0, "2026-11-18", 1, 0), // missed, tomorrow
    c1: prog(2, "2026-11-30", 2),
  };
  const rows = categoryOverview(pool, progress, TODAY);
  const blunder = rows.find((r) => r.category === "blunder")!;

  it("splits an area into new, in progress and safe, and counts due work on top", () => {
    expect(blunder).toMatchObject({ total: 4, fresh: 1, learning: 2, mastered: 1, due: 2 });
    expect(blunder.fresh + blunder.learning + blunder.mastered).toBe(blunder.total);
    expect(rows.find((r) => r.category === "defense")).toMatchObject({ total: 0, fresh: 0, learning: 0, mastered: 0, due: 0 });
  });

  it("adds the areas up to the pool", () => {
    expect(poolTotals(rows)).toEqual({ total: 6, fresh: 2, learning: 3, mastered: 1, due: 2 });
  });

  it("asks due repetitions first, then new, then running, safe last", () => {
    const items = pool.filter((e) => e.category === "blunder");
    expect(pickSession(items, progress, TODAY)).toEqual(["a1", "a2", "a4", "a3"]);
    expect(pickSession(items, { ...progress, a1: prog(4, "2026-12-20", 4) }, TODAY)).toEqual(["a2", "a4", "a3", "a1"]);
    expect(pickSession(items, progress, TODAY, 2)).toEqual(["a1", "a2"]);
  });

  it("lists due exercises oldest first", () => {
    expect(dueExercises(pool, progress, TODAY)).toEqual(["a2", "a1"]);
  });

  it("opens the library on the asked area, else on due work, else on the first filled area", () => {
    expect(startCategory(rows, "chance")).toBe("chance");
    expect(startCategory(rows, "nonsense")).toBe("blunder");
    expect(startCategory(categoryOverview(pool, {}, TODAY))).toBe("blunder");
    expect(startCategory(categoryOverview([ex("o1", "repertoire", "repertoire")], {}, TODAY))).toBe("repertoire");
    expect(startCategory(categoryOverview([ex("x"), ex("c1", "chance")], { c1: prog(1, TODAY) }, TODAY))).toBe("chance");
  });
});

describe("estimateMinutes", () => {
  const byId = new Map([ex("p1"), ex("p2"), ex("r1", "repertoire", "repertoire"), ex("y1", "basics", "playout")].map((e) => [e.id, e]));

  it.each([
    [[], 0],
    [["p1"], 2], // 1.5 rounds up, never "0 minutes" for real work
    [["p1", "p2", "r1"], 6],
    [["y1", "p1"], 8],
    [["gone"], 2], // an id the pool no longer holds counts like a puzzle
  ] as const)("%j takes about %i minutes", (ids, minutes) => {
    expect(estimateMinutes([...ids], byId)).toBe(minutes);
  });
});

describe("weekView", () => {
  const week = buildWeekPlan(["blunder", "endgame", "opening"], TODAY);

  it("marks trained, missed and open days and says whether the target is still in reach", () => {
    const v = weekView(week, { "2026-11-16": day(8, 6) }, TODAY);
    expect(v.days.map((d) => d.state)).toEqual(["done", "open", "open", "open", "open", "open", "open"]);
    expect(v.days[1]).toMatchObject({ isToday: true, done: 0 });
    expect(v.days[0]).toMatchObject({ done: 8, correct: 6, isToday: false });
    expect(v).toMatchObject({ trained: 1, target: 5, missing: 4, reachable: true });
  });

  it("says so when the days left no longer reach the target", () => {
    const v = weekView(week, {}, "2026-11-20"); // Friday, nothing trained: three days left for five
    expect(v.days.map((d) => d.state)).toEqual(["missed", "missed", "missed", "missed", "open", "open", "open"]);
    expect(v).toMatchObject({ trained: 0, missing: 5, reachable: false });
  });

  it("counts today as trained once an exercise is logged", () => {
    const v = weekView(week, { [TODAY]: day(3, 3) }, TODAY);
    expect(v.days[1]).toMatchObject({ isToday: true, state: "done" });
    expect(v.missing).toBe(4);
  });
});

describe("activity", () => {
  const log: TrainingLog = { "2026-11-17": day(12, 9), "2026-11-10": day(3, 3), "2026-11-02": day(6, 2), "2026-08-01": day(40, 40), "2026-11-19": day(5, 5) };
  const a = activity(log, TODAY, 3);

  it("lays the days out in whole weeks from Monday, the current week last", () => {
    expect(a.weeks).toHaveLength(3);
    expect(a.weeks.every((w) => w.length === 7)).toBe(true);
    expect(a.weeks[0][0].date).toBe("2026-11-02");
    expect(a.weeks[2][1]).toMatchObject({ date: TODAY, done: 12, level: 4, future: false });
    expect(a.weeks[2][6]).toMatchObject({ date: "2026-11-22", future: true, done: 0, level: 0 });
  });

  it("grades a day against the busiest one and ignores days outside the window or after today", () => {
    expect(a.weeks[1][1]).toMatchObject({ date: "2026-11-10", level: 1 });
    expect(a.weeks[0][0]).toMatchObject({ level: 2 });
    expect(a.weeks[2][3]).toMatchObject({ date: "2026-11-19", done: 0, future: true });
    expect(a).toMatchObject({ activeDays: 3, done: 21, correct: 14 });
    expect(a.best?.date).toBe(TODAY);
  });

  it("is empty without a log", () => {
    const none = activity({}, TODAY, 2);
    expect(none).toMatchObject({ activeDays: 0, done: 0, best: null });
    expect(none.weeks.flat().every((d) => d.level === 0)).toBe(true);
  });
});

describe("logTotals", () => {
  it("adds up every training day and finds the longest run", () => {
    const log: TrainingLog = { "2026-11-01": day(4, 2), "2026-11-02": day(6, 6), "2026-11-03": day(2, 1), "2026-11-05": day(8, 5), "2026-11-06": day(0, 0) };
    expect(logTotals(log)).toEqual({ days: 4, done: 20, correct: 14, rate: 70, longest: 3 });
  });

  it("has no rate before the first exercise", () => {
    expect(logTotals({})).toEqual({ days: 0, done: 0, correct: 0, rate: null, longest: 0 });
  });
});

describe("sessionResult", () => {
  const parts = [
    { key: "warmup", title: "Aufwärmen", sub: "", ids: ["w1", "w2"] },
    { key: "main", title: "Blunder-Check", sub: "", ids: ["m1", "m2", "m3"] },
    { key: "mix", title: "Gemischt", sub: "", ids: ["x1"] },
  ];

  it("sums up each part and keeps the misses in asking order", () => {
    const r = sessionResult(parts, { w1: true, w2: false, m1: true, m2: true, m3: false });
    expect(r).toMatchObject({ done: 5, solved: 3, missed: ["w2", "m3"], verdict: "mixed" });
    // A part nobody reached is left out instead of showing "0 of 0".
    expect(r.parts.map((p) => [p.key, p.solved, p.done])).toEqual([
      ["warmup", 1, 2],
      ["main", 2, 3],
    ]);
  });

  it.each([
    [{}, "none"],
    [{ w1: true, w2: true }, "perfect"],
    [{ w1: true, w2: true, m1: true, m2: false }, "good"],
    [{ w1: true, w2: false, m1: false }, "mixed"],
  ] as const)("judges %j as %s", (results, verdict) => {
    expect(sessionResult(parts, results).verdict).toBe(verdict);
  });
});
