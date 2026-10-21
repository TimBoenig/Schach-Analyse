import { describe, expect, it } from "vitest";

import { buildPlayerProfile, extractFeatures, MoveEvent, type SkillScore } from "../../src/domain/profile";
import { equivalentMoves } from "../../src/domain/profile/features";
import {
  BASIC_ENDGAMES,
  buildDailyPlan,
  categoryNeeds,
  type Exercise,
  judgePlayout,
  migrateSolved,
  type PlayoutState,
  type ProgressMap,
  puzzleCategory,
  recordAttempt,
  repertoireDrill,
  streak,
  summarizeTraining,
  logAttempt,
  type TrainingLog,
} from "../../src/domain/training";
import { buildMoves, gameRow, profileGames, PUNISHED } from "../profile/fixtures";

const TODAY = "2026-10-21";

function event(over: Partial<MoveEvent>): MoveEvent {
  const m = new MoveEvent(20, 11, "Nf3", "g1f3", "8/8/8/8/8/8/8/K6k w - - 0 1", "Blunder", "middlegame", 0.5, 0.1, "e2e4", 5, 100, false, false, false, 3);
  return Object.assign(m, over);
}

function skill(key: string, score: number, typical: number | null = null): SkillScore {
  return { key, name: key, score, grade: "", detail: "", sample: 20, reliable: true, typical };
}

describe("exercise pool", () => {
  it.each([
    [{ after_opponent_error: true, wp_before: 0.9 }, "chance"],
    [{ classification: "Miss" }, "chance"],
    [{ phase: "endgame", wp_before: 0.9 }, "endgame"],
    [{ phase: "opening" }, "opening"],
    [{ wp_before: 0.8 }, "conversion"],
    [{ wp_before: 0.2 }, "defense"],
    [{}, "blunder"],
  ] as const)("files an error by the situation it happened in (%o)", (over, category) => {
    expect(puzzleCategory(event(over as Partial<MoveEvent>))).toBe(category);
  });

  it("accepts second engine lines that are practically as good as the best", () => {
    expect(
      equivalentMoves([
        { pv: ["e2e4"], cp: 60, mate: null, depth: 16 },
        { pv: ["d2d4"], cp: 35, mate: null, depth: 16 },
      ]),
    ).toEqual(["d2d4"]);
    expect(equivalentMoves([{ pv: ["e2e4"], cp: 300, mate: null, depth: 16 }, { pv: ["d2d4"], cp: 100, mate: null, depth: 16 }])).toEqual([]);
    expect(equivalentMoves([{ pv: ["h5f7"], cp: null, mate: 2, depth: 16 }, { pv: ["h5e8"], cp: null, mate: 4, depth: 16 }])).toEqual(["h5e8"]);
  });

  it("replays the player's main line and corrects the move they usually get wrong", () => {
    // 9 games throw the advantage away with 9. d5, 3 games play the best move there.
    const feats = profileGames(9, 3).map((g) => extractFeatures(g, "white"));
    const drill = repertoireDrill("white", "Italian Game", feats);
    expect(drill).not.toBeNull();
    expect(drill!.moves.slice(0, 4)).toEqual(["e4", "e5", "Nf3", "Nc6"]);
    expect(drill!.correction).toMatchObject({ ply: 16, played_san: "d5", games: 9 });
    expect(drill!.moves).toHaveLength(17);
    expect(drill!.moves[16]).toBe(drill!.correction!.best_san);
    expect(drill!.moves[16]).not.toBe("d5");
  });

  it("needs at least two games per line and three moves of the player", () => {
    const one = [extractFeatures(gameRow("x", buildMoves(PUNISHED)), "white")];
    expect(repertoireDrill("white", "Italian Game", one)).toBeNull();
  });

  it("builds drills and basics even before any game is analyzed", () => {
    const rows = profileGames(0, 3).map((r) => ({ ...r, summary_json: null }));
    const profile = buildPlayerProfile(rows, ["tim"]);
    expect(profile.is_empty).toBe(true);
    const kinds = new Set(profile.exercises.map((e) => e.category));
    expect(kinds).toEqual(new Set(["repertoire", "basics"]));
    expect(profile.exercises.filter((e) => e.category === "basics")).toHaveLength(BASIC_ENDGAMES.length);
  });

  it("keeps exercise ids stable between profile builds", () => {
    const ids = () => buildPlayerProfile(profileGames(4, 2), ["tim"]).exercises.map((e) => e.id);
    expect(ids()).toEqual(ids());
    expect(ids()).toContain("p:t0:16");
  });
});

describe("spaced repetition", () => {
  it("moves a solved exercise up a box and a missed one back to tomorrow", () => {
    let p: ProgressMap = {};
    p = recordAttempt(p, "x", true, TODAY);
    expect(p.x).toEqual({ box: 1, due: "2026-10-22", attempts: 1, solved: 1, last: TODAY });
    p = recordAttempt(p, "x", true, "2026-10-22");
    expect(p.x.due).toBe("2026-10-25");
    p = recordAttempt(p, "x", false, "2026-10-25");
    expect(p.x).toMatchObject({ box: 0, due: "2026-10-26", attempts: 3, solved: 2 });
  });

  it("counts a streak until the first day without training", () => {
    let log: TrainingLog = {};
    for (const d of ["2026-10-17", "2026-10-19", "2026-10-20"]) log = logAttempt(log, d, "blunder", true);
    // Today is still open, so the streak counts from yesterday.
    expect(streak(log, TODAY)).toBe(2);
    log = logAttempt(log, TODAY, "chance", false);
    expect(streak(log, TODAY)).toBe(3);
    expect(log[TODAY].by_category).toEqual({ chance: [1, 0] });
  });

  it("carries over puzzles solved with the old training page", () => {
    const p = migrateSolved({ "g1:12": true, "g2:4": false }, {}, TODAY);
    expect(Object.keys(p)).toEqual(["p:g1:12"]);
    expect(p["p:g1:12"].box).toBe(1);
  });

  it("summarises the last seven days for the coach", () => {
    let log: TrainingLog = {};
    log = logAttempt(log, "2026-10-14", "blunder", true); // 8 days ago: outside the week
    log = logAttempt(log, "2026-10-15", "blunder", true);
    log = logAttempt(log, TODAY, "blunder", false);
    const s = summarizeTraining([], {}, log, TODAY);
    expect(s.week).toEqual({ done: 2, correct: 1 });
  });
});

function pool(): Exercise[] {
  const puzzles = (cat: Exercise["category"], n: number): Exercise[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `${cat}-${i}`,
      kind: "puzzle",
      category: cat,
      title: "",
      fen: "",
      solution: "e2e4",
      solution_san: "e4",
      accept: ["e2e4"],
      line_san: [],
      prompt: "",
      game_id: "g",
      ply_index: i,
      move_label: "",
      played_san: "",
      classification: "Blunder",
      phase: "middlegame",
      wp_before: 0.5,
      wp_loss: 0.3,
      opponent: "",
      date: "",
    }));
  return [...puzzles("blunder", 30), ...puzzles("chance", 30), ...puzzles("endgame", 30), ...puzzles("defense", 30)];
}

const SKILLS = [skill("safety", 25, 55), skill("tactics", 60, 55), skill("endgame", 45, 50), skill("defense", 85, 50)];

describe("daily plan", () => {
  it("spends most of the time on the weakest area and keeps a strength sharp", () => {
    const plan = buildDailyPlan({ skills: SKILLS, patterns: [], pool: pool(), progress: {}, prefs: { minutes: 30, focus: "auto" }, today: TODAY });
    expect(plan.blocks.map((b) => b.category)).toEqual(["blunder", "endgame", "defense"]);
    expect(plan.blocks[0].minutes).toBeGreaterThan(plan.blocks[1].minutes);
    expect(plan.blocks[2].title).toBe("Stärke halten: Zähe Verteidigung");
    const minutes = plan.blocks.reduce((s, b) => s + b.minutes, 0);
    expect(minutes).toBeGreaterThanOrEqual(27);
    expect(minutes).toBeLessThanOrEqual(33);
    expect(plan.headline).toBe("Heute im Fokus: Blunder-Check und Endspiel-Aufgaben");
  });

  it("puts due repetitions first and never repeats an exercise within the day", () => {
    let progress: ProgressMap = {};
    progress = recordAttempt(progress, "chance-3", false, "2026-10-20");
    const plan = buildDailyPlan({ skills: SKILLS, patterns: [], pool: pool(), progress, prefs: { minutes: 20, focus: "auto" }, today: TODAY });
    expect(plan.blocks[0]).toMatchObject({ category: "review", exercise_ids: ["chance-3"] });
    const ids = plan.blocks.flatMap((b) => b.exercise_ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("follows a chosen focus and urgent patterns", () => {
    const needs = categoryNeeds(SKILLS, [], "chance");
    expect(needs[0]).toMatchObject({ category: "chance", reason: expect.stringContaining("Schwerpunkt") });
    const pattern = { key: "errors_under_pressure", title: "Fehler unter Druck", text: "", severity: "hoch" as const, value: 0, examples: [] };
    const withPattern = categoryNeeds(SKILLS, [pattern], "auto").find((n) => n.category === "defense")!;
    const without = categoryNeeds(SKILLS, [], "auto").find((n) => n.category === "defense")!;
    expect(withPattern.need).toBeGreaterThan(without.need);
  });

  it("is the same plan all day and a different selection tomorrow", () => {
    const input = { skills: SKILLS, patterns: [], pool: pool(), progress: {}, prefs: { minutes: 20, focus: "auto" as const } };
    const a = buildDailyPlan({ ...input, today: TODAY });
    expect(buildDailyPlan({ ...input, today: TODAY })).toEqual(a);
    expect(buildDailyPlan({ ...input, today: "2026-10-22" }).blocks[0].exercise_ids).not.toEqual(a.blocks[0].exercise_ids);
  });

  it("leaves mastered exercises out of the rotation", () => {
    let progress: ProgressMap = {};
    for (let i = 0; i < 30; i++) {
      for (const day of ["2026-09-01", "2026-09-02", "2026-09-05"]) progress = recordAttempt(progress, `blunder-${i}`, true, day);
    }
    // Box 3 is due again on 2026-09-12, so make them not due by solving once more recently.
    for (let i = 0; i < 30; i++) progress = recordAttempt(progress, `blunder-${i}`, true, "2026-10-20");
    const plan = buildDailyPlan({ skills: SKILLS, patterns: [], pool: pool(), progress, prefs: { minutes: 20, focus: "auto" }, today: TODAY });
    expect(plan.blocks.some((b) => b.category === "blunder")).toBe(false);
  });
});

describe("play-out judging", () => {
  const s = (over: Partial<PlayoutState>): PlayoutState => ({ userMoves: 3, maxMoves: 12, score: { cp: 400, mate: null }, over: null, promoted: false, ...over });
  it.each([
    ["mate", { over: "won" }, true],
    ["mate", { over: "draw" }, false],
    ["hold", { over: "draw" }, true],
    ["win", { score: { cp: 60, mate: null } }, false],
    ["win", { userMoves: 12, score: { cp: 320, mate: null } }, true],
    ["win", { userMoves: 12, score: { cp: 180, mate: null } }, false],
    ["mate", { userMoves: 12 }, false],
    ["promote", { promoted: true, score: { cp: 900, mate: null } }, true],
    ["hold", { score: { cp: -900, mate: null } }, false],
    ["hold", { userMoves: 12, score: { cp: -20, mate: null } }, true],
    ["hold", { score: { cp: null, mate: -3 } }, false],
  ] as const)("%s with %o succeeds: %s", (goal, over, success) => {
    const v = judgePlayout(goal, s(over as Partial<PlayoutState>));
    expect(v.done).toBe(true);
    expect(v.done && v.success).toBe(success);
  });

  it("keeps going while the goal is still open", () => {
    expect(judgePlayout("mate", s({}))).toEqual({ done: false });
    expect(judgePlayout("hold", s({ score: { cp: -100, mate: null } }))).toEqual({ done: false });
  });
});

describe("profile wiring", () => {
  it("lists the newest games with the player's costliest move for the coach", () => {
    const profile = buildPlayerProfile(profileGames(9, 3), ["tim"]);
    expect(profile.recent_games[0].game_id).toBe("c2");
    expect(profile.recent_games.find((g) => g.game_id === "t8")?.worst[0]).toMatchObject({ move: "9. d5", wp_before: 85, wp_after: 25 });
  });
});
