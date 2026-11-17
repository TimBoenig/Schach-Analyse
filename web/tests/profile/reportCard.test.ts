import { describe, expect, it } from "vitest";

import { buildGameReview, ownStanding, parseGrade, reportMoments, sameSpeedAccuracies, winCurve } from "../../src/domain/profile";
import type { KeyMoment } from "../../src/domain/profile/models";
import { buildMoves, gameRow } from "./fixtures";

describe("grade", () => {
  it.each([
    ["2,5 (gut)", { value: 2.5, text: "2,5", word: "gut" }],
    ["1,0 (sehr gut)", { value: 1, text: "1,0", word: "sehr gut" }],
    ["6,0 (ungenügend)", { value: 6, text: "6,0", word: "ungenügend" }],
    ["–", { value: null, text: "–", word: "" }],
  ])("takes %s apart", (grade, parts) => {
    expect(parseGrade(grade)).toEqual(parts);
  });
});

describe("winning chance through the game", () => {
  it("starts at the first position and follows every analysed move from the player's side", () => {
    const moves = buildMoves({ 4: ["Blunder", 0.2] });
    const white = winCurve(moves, true);
    const black = winCurve(moves, false);
    expect(white).toHaveLength(moves.length + 1);
    expect(white[0]).toEqual({ ply: 0, wp: moves[0].win_chance_before });
    expect(white[5]).toEqual({ ply: 5, wp: 0.2 });
    // Black sees the mirror image.
    expect(black[5].wp).toBeCloseTo(0.8);
  });

  it("skips moves without analysis", () => {
    const moves = buildMoves();
    moves[3] = { ...moves[3], classification: "" };
    expect(winCurve(moves, true).map((p) => p.ply)).not.toContain(4);
  });
});

describe("standing among the player's own games", () => {
  const others = [60, 65, 70, 70, 75, 80, 82, 85, 88, 90];

  it("counts the share of games played less accurately, ties half", () => {
    expect(ownStanding(80, others)).toEqual({ games: 10, better_than: 55, average: 76.5 });
    expect(ownStanding(95, others)?.better_than).toBe(100);
    expect(ownStanding(50, others)?.better_than).toBe(0);
  });

  it("says nothing on too few games or without an accuracy", () => {
    expect(ownStanding(80, others.slice(0, 9))).toBeNull();
    expect(ownStanding(0, others)).toBeNull();
  });

  it("reads the player's side of analysed games of the same time control only", () => {
    const row = (id: string, white: string, black: string, speed: string, acc: [number, number], status = "completed") => ({
      ...gameRow(id, buildMoves()),
      white,
      black,
      speed_category: speed,
      summary_json: JSON.stringify({ analysis_status: status, white: { accuracy: acc[0] }, black: { accuracy: acc[1] } }),
    });
    const rows = [
      row("this", "Tim", "a", "blitz", [90, 50]),
      row("w", "Tim", "b", "blitz", [81, 40]),
      row("b", "c", "tim", "blitz", [30, 72]),
      row("rapid", "Tim", "d", "rapid", [99, 10]),
      row("open", "Tim", "e", "blitz", [77, 60], "paused"),
      row("friends", "x", "y", "blitz", [64, 66]),
    ];
    expect(sameSpeedAccuracies(rows, ["Tim"], "blitz", "this")).toEqual([81, 72]);
  });
});

describe("best and most expensive moment", () => {
  const km = (ply: number, classification: string, before: number, after: number, by_user = true): KeyMoment => ({
    ply_index: ply,
    move_label: String(ply),
    by_user,
    classification,
    title: "",
    text: "",
    wp_before: before,
    wp_after: after,
    best_move_san: "",
  });
  const review = (moments: KeyMoment[]) => ({ key_moments: moments }) as Parameters<typeof reportMoments>[0];

  it("prefers a brilliant move over a bigger gain and picks the costliest own error", () => {
    const { best, worst } = reportMoments(
      review([km(10, "Best", 0.4, 0.8), km(20, "Brilliant", 0.6, 0.7), km(30, "Mistake", 0.7, 0.5), km(40, "Blunder", 0.6, 0.2), km(50, "Blunder", 0.9, 0.1, false)]),
    );
    expect(best?.ply_index).toBe(20);
    expect(worst?.ply_index).toBe(40);
  });

  it("takes the largest gain without a shine move and finds nothing in a clean game", () => {
    expect(reportMoments(review([km(10, "Best", 0.4, 0.8), km(12, "Excellent", 0.5, 0.65)])).best?.ply_index).toBe(10);
    expect(reportMoments(review([km(10, "Best", 0.5, 0.45)]))).toEqual({ best: null, worst: null });
  });

  it("works on a real review", () => {
    const r = buildGameReview(gameRow("g", buildMoves({ 8: ["Blunder", 0.15] })), "white")!;
    expect(reportMoments(r).worst?.classification).toBe("Blunder");
  });
});
