// Port of tests/backend/test_player_profile.py.

import { describe, expect, it } from "vitest";
import {
  buildGameReview,
  buildPlayerProfile,
  extractFeatures,
  SKILL_NAMES,
  schoolGrade,
} from "../../src/domain/profile";
import { Board, moveFromUci } from "../../src/domain/tactics/board";
import type { PuzzleExercise } from "../../src/domain/training";
import { buildMoves, gameAnalysis, gameRow, profileGames, PUNISHED, THROWN_WIN } from "./fixtures";

const games = profileGames;

describe("player profile", () => {
  it("measures a Black error as a drop in Black's winning chance", () => {
    const moves = buildMoves({ 17: ["Blunder", 0.9] }); // Black's 9th move hands White the game
    const feats = extractFeatures(gameRow("b", moves, { userWhite: false, result: "1-0" }), "black");
    const err = feats.moves.find((m) => m.classification === "Blunder");
    expect(err?.ply_index).toBe(17);
    expect(err?.wp_before).toBeCloseTo(0.5);
    expect(err?.wp_after).toBeCloseTo(0.1);
    expect(feats.moves.every((m) => m.ply_index % 2 === 1)).toBe(true);
  });

  it("distinguishes kept and thrown advantages after an opponent error", () => {
    const kept = extractFeatures(gameRow("k", buildMoves(PUNISHED)), "white");
    const thrown = extractFeatures(gameRow("t", buildMoves(THROWN_WIN)), "white");
    expect([kept.punish_chances, kept.punished]).toEqual([1, 1]);
    expect([thrown.punish_chances, thrown.punished]).toEqual([1, 0]);
    expect(thrown.moves[8].after_opponent_error).toBe(true); // ply 16 is White's 9th move
  });

  it("detects skills, patterns, puzzles, training plan and trends", () => {
    const profile = buildPlayerProfile(games(18, 6), ["tim"]);

    expect(profile.total_games).toBe(24);
    expect(profile.analyzed_games).toBe(24);
    expect(new Set(profile.skills.map((s) => s.key))).toEqual(new Set(Object.keys(SKILL_NAMES)));
    expect(profile.skills.every((s) => s.score >= 0 && s.score <= 100)).toBe(true);
    const strengthKeys = new Set(profile.strengths.map((i) => i.key));
    expect(profile.weaknesses.some((i) => strengthKeys.has(i.key))).toBe(false);

    const keys = new Set(profile.patterns.map((p) => p.key));
    expect(keys.has("errors_when_winning")).toBe(true);
    expect(keys.has("missed_punish")).toBe(true);
    const winning = profile.patterns.find((p) => p.key === "errors_when_winning");
    expect(winning?.examples[0]?.ply_index).toBe(16);

    // Every thrown game yields a puzzle whose solution is legal in its position;
    // the error came right after the opponent's blunder, so it trains punishing.
    const puzzles = profile.exercises.filter((e): e is PuzzleExercise => e.kind === "puzzle");
    expect(puzzles).toHaveLength(18);
    for (const pz of puzzles) {
      const board = new Board(pz.fen);
      const mv = moveFromUci(pz.solution);
      expect(board.legalMoves().some((m) => m.from === mv.from && m.to === mv.to)).toBe(true);
      expect(pz.solution_san).toBe(board.san(mv));
      expect(pz.category).toBe("chance");
    }

    expect(profile.training_plan.length).toBeGreaterThan(0);
    expect(profile.training_plan.map((t) => t.priority)).toEqual(
      profile.training_plan.map((_, i) => i + 1),
    );
    expect(profile.trends.monthly.map((m: { month: string }) => m.month)).toEqual([
      "2026-05",
      "2026-06",
    ]);
  });

  it("gives no advice from a handful of games", () => {
    // Three thrown wins look like a clear pattern, but three games prove nothing yet.
    const profile = buildPlayerProfile(games(3, 1), ["tim"]);
    expect(profile.analyzed_games).toBe(4);
    expect(profile.patterns).toEqual([]);
    expect(profile.strengths).toEqual([]);
    expect(profile.weaknesses).toEqual([]);
    expect(profile.style).toBeNull();
    expect(profile.openings_best).toEqual([]);
    expect(profile.openings_worst).toEqual([]);
    expect(profile.deep?.facts).toEqual([]);
    expect(profile.skills.every((s) => !s.reliable)).toBe(true);
  });

  it("has no skills when nothing is analyzed", () => {
    const row = gameRow("u", buildMoves());
    row.summary_json = null;
    row.moves_json = null;
    const profile = buildPlayerProfile([row], ["Tim"]);
    expect(profile.total_games).toBe(1);
    expect(profile.is_empty).toBe(true);
    expect(profile.skills).toEqual([]);
    expect(profile.training_plan).toEqual([]);
  });

  it("ignores games of other players", () => {
    expect(buildPlayerProfile(games(2, 2), ["someone-else"]).total_games).toBe(0);
  });
});

describe("game review", () => {
  it("finds key moments, the turning point and lessons", () => {
    const review = buildGameReview(gameAnalysis(buildMoves(THROWN_WIN), "0-1"), "white");
    expect(review).not.toBeNull();
    if (!review) return;
    expect(review.result_text).toBe("Niederlage gegen Gegner");
    const plies = review.key_moments.map((k) => k.ply_index);
    expect(plies).toEqual([...plies].sort((a, b) => a - b));
    expect(plies).toEqual(expect.arrayContaining([15, 16]));
    const userErr = review.key_moments.find((k) => k.ply_index === 16);
    expect(userErr?.by_user).toBe(true);
    expect(userErr?.text).toContain("Besser war");
    expect(review.turning_point?.ply_index).toBe(16);
    expect(review.lessons.some((l) => l.includes("Wendepunkt"))).toBe(true);
    expect(review.move_counts.Blunder).toBe(1);
  });

  it("accepts a stored game row as well", () => {
    const row = gameRow("r", buildMoves(THROWN_WIN), { result: "0-1" });
    const review = buildGameReview(row, "white");
    expect(review?.game_id).toBe("r");
    expect(review?.turning_point?.ply_index).toBe(16);
  });

  it("requires analysis", () => {
    const game = gameAnalysis(buildMoves());
    for (const m of game.moves) m.classification = "";
    expect(buildGameReview(game, "white")).toBeNull();
  });

  it.each([
    [97, "1,0 (sehr gut)"],
    [87, "2,0 (gut)"],
    [60, "5,5 (mangelhaft)"],
    [0, "–"],
  ])("school grade for %d%% is %s", (accuracy, expected) => {
    expect(schoolGrade(accuracy)).toBe(expected);
  });
});
