import { describe, expect, it } from "vitest";

import { type PlanBlock, puzzleLine, sessionParts } from "../../src/domain/training";

describe("puzzleLine", () => {
  it("keeps forcing follow-ups and stops before a quiet own move", () => {
    // Scholar's-mate style: Qxf7# ends the line at once.
    const mate = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1";
    expect(puzzleLine(mate, ["h5f7", "e8f7", "c4f7"])).toEqual(["h5f7"]);
    // Rxd5, then the check Rd7+: forcing, so the second own move is kept. The PV's
    // Kxd7 is illegal (Rd1 covers d7), which ends the line there.
    const forcing = "4k3/8/8/3q4/8/8/3R4/3RK3 w - - 0 1";
    expect(puzzleLine(forcing, ["d2d5", "e8e7", "d5d7", "e7d7", "d1d2"])).toEqual(["d2d5", "e8e7", "d5d7"]);
    // A quiet own follow-up after a quiet reply ends the puzzle after the capture.
    expect(puzzleLine(forcing, ["d2d5", "e8e7", "e1e2"])).toEqual(["d2d5"]);
  });

  it("returns the solution alone for a quiet continuation and nothing for an illegal one", () => {
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    expect(puzzleLine(start, ["e2e4", "e7e5", "g1f3"])).toEqual(["e2e4"]);
    expect(puzzleLine(start, ["e2e5"])).toEqual([]);
  });
});

const block = (key: string, category: PlanBlock["category"], ids: string[]): PlanBlock => ({ key, category, title: key, reason: "", minutes: 5, exercise_ids: ids });

describe("sessionParts", () => {
  it("orders warm-up, main theme, then the rest mixed", () => {
    const parts = sessionParts([block("review", "review", ["r1", "r2"]), block("A", "blunder", ["a1", "a2"]), block("B", "chance", ["b1", "b2"]), block("C", "endgame", ["c1"])]);
    expect(parts.map((p) => p.key)).toEqual(["warmup", "main", "mix"]);
    expect(parts[1].ids).toEqual(["a1", "a2"]);
    expect(parts[2].ids).toEqual(["b1", "c1", "b2"]);
  });

  it("drops finished exercises and empty parts", () => {
    const parts = sessionParts([block("review", "review", ["r1"]), block("A", "blunder", ["a1"])], (id) => id !== "r1");
    expect(parts.map((p) => p.key)).toEqual(["main"]);
  });
});
