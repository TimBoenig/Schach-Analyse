import { describe, expect, it } from "vitest";

import { buildPlayerProfile, evidence, extractFeatures, settleSkills, type SkillScore } from "../../src/domain/profile";
import { buildStyle } from "../../src/domain/profile/style";
import { buildMoves, gameRow } from "./fixtures";

const { effectiveMoves, ratesDiffer, restOf, scoreDeviation, scoresDiffer, shareAtLeast, shareBelow, wilson } = evidence;

describe("evidence rules", () => {
  it.each([
    // [a games, a %, b games, b %, differ]
    [3, 100, 3, 0, false], // 3:0 against 0:3 is still chance territory per group size
    [10, 80, 10, 30, true],
    [10, 60, 10, 45, false],
    [40, 60, 40, 45, false],
    [200, 60, 200, 45, true],
  ])("score %i×%i %% vs %i×%i %% differ: %s", (na, pa, nb, pb, differ) => {
    expect(scoresDiffer({ games: na, score_pct: pa }, { games: nb, score_pct: pb })).toBe(differ);
  });

  it("compares a line with a baseline only from enough games", () => {
    expect(scoreDeviation({ games: 3, score_pct: 0 }, 50)).toBe(0);
    expect(scoreDeviation({ games: 10, score_pct: 15 }, 50)).toBe(-1);
    expect(scoreDeviation({ games: 10, score_pct: 85 }, 50)).toBe(1);
    expect(scoreDeviation({ games: 10, score_pct: 55 }, 50)).toBe(0);
  });

  it("removes a group from the total before comparing", () => {
    expect(restOf({ games: 20, score_pct: 50 }, { games: 10, score_pct: 30 })).toEqual({ games: 10, score_pct: 70 });
  });

  it("only calls error rates different with enough moves and a clear ratio", () => {
    expect(ratesDiffer(6, 100, 2, 100)).toBe(false); // too few moves
    expect(ratesDiffer(30, 300, 10, 300)).toBe(true);
    expect(ratesDiffer(12, 300, 10, 300)).toBe(false);
  });

  it("bounds shares with the Wilson interval", () => {
    const [lo, hi] = wilson(5, 10);
    expect(lo).toBeGreaterThan(0.2);
    expect(hi).toBeLessThan(0.8);
    expect(shareAtLeast(2, 3, 0.35)).toBe(false); // 2 of 3 is no proof of a 35 % share
    expect(shareAtLeast(20, 30, 0.35)).toBe(true);
    expect(shareBelow(2, 20, 0.5)).toBe(true);
    expect(shareBelow(2, 4, 0.5)).toBe(false);
  });

  it("counts correlated moves of one game as fewer independent ones", () => {
    expect(effectiveMoves(20, 20)).toBe(20); // one move per game: independent
    expect(effectiveMoves(60, 2)).toBeLessThan(15);
    expect(effectiveMoves(600, 20)).toBeGreaterThan(effectiveMoves(600, 5));
  });
});

describe("skill accuracy", () => {
  const phase = (sample: number, games: number): SkillScore => ({
    key: "endgame",
    name: "Endspiel",
    score: 100,
    grade: "",
    detail: "",
    sample,
    games,
    reliable: true,
    typical: 50,
  });

  it("trusts moves spread over many games more than the same moves from two games", () => {
    const [two, many] = settleSkills([phase(80, 2), phase(80, 16)]);
    expect(two.score).toBeLessThan(many.score);
    expect(two.margin as number).toBeGreaterThan(many.margin as number);
    // Two games are never enough to call a phase a strength.
    expect(two.reliable).toBe(false);
  });

  it("does not mark a skill reliable from fewer than five games", () => {
    const moves = buildMoves({});
    const rows = [0, 1, 2].map((i) => gameRow(`g${i}`, moves, { utc: `2026.06.0${i + 1} 18:00:00` }));
    expect(buildPlayerProfile(rows, ["Tim"]).skills.every((s) => !s.reliable)).toBe(true);
  });
});

describe("playing style", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      gameRow(`s${i}`, buildMoves({}), { utc: `2026.06.${String(i + 1).padStart(2, "0")} 18:00:00` }),
    );
  const feats = (n: number) => rows(n).map((r) => extractFeatures(r, "white"));

  it("needs enough games before naming a style", () => {
    expect(buildStyle(feats(5), [])).toBeNull();
    expect(buildStyle(feats(12), [])).not.toBeNull();
  });

  it("pulls axes toward the middle and narrows the margin with more games", () => {
    const few = buildStyle(feats(10), [])!;
    const many = buildStyle(feats(30), [])!;
    for (const key of ["aggression", "trading", "endgame"]) {
      const a = few.axes.find((x) => x.key === key)!;
      const b = many.axes.find((x) => x.key === key)!;
      // Same games repeated: the raw value is identical, more games move it further from 50.
      expect(Math.abs(b.value - 50)).toBeGreaterThanOrEqual(Math.abs(a.value - 50));
      expect(b.margin as number).toBeLessThan(a.margin as number);
    }
  });
});
