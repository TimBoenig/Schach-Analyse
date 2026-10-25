// Live judgement of tried moves (free board, side lines, puzzle alternatives).
import { describe, expect, it } from "vitest";

import { judgeMove, moverLoss, solvesPuzzle, terminalScore, whiteScore } from "../../src/domain/live";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const line = (pv: string[], cp: number | null, mate: number | null = null) => ({ pv, cp, mate, depth: 16 });

describe("live move judgement", () => {
  it("converts side-to-move engine scores to White's view and resolves terminal positions", () => {
    expect(whiteScore(AFTER_E4, line([], -40))).toEqual({ cp: 40, mate: null });
    expect(whiteScore(START, line([], null, 3))).toEqual({ cp: null, mate: 3 });
    // Fool's mate: White is mated, Black has won.
    expect(terminalScore("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3")).toEqual({ cp: null, mate: -1 });
    expect(terminalScore(START)).toBeNull();
  });

  it("never scores the engine's first choice below the position before it", () => {
    // A shallower search after the move sees White a little worse; still the best move.
    const m = judgeMove(START, "e2e4", [line(["e2e4", "e7e5"], 40), line(["d2d4"], 35)], { cp: 10, mate: null });
    expect(m).not.toBeNull();
    expect(m!.san).toBe("e4");
    expect(m!.win_chance_after).toBeGreaterThanOrEqual(m!.win_chance_before);
    expect(moverLoss(m!)).toBe(0);
    expect(solvesPuzzle(m!)).toBe(true);
  });

  it("classifies a bad Black move from Black's view and rejects it as a puzzle answer", () => {
    // Engine says Black is fine (-30 for White); after the move White is clearly better.
    const m = judgeMove(AFTER_E4, "g7g5", [line(["e7e5"], 30)], { cp: 350, mate: null });
    expect(m!.eval_before_cp).toBe(-30);
    expect(m!.win_chance_after).toBeGreaterThan(m!.win_chance_before);
    expect(["Mistake", "Blunder"]).toContain(m!.classification);
    expect(solvesPuzzle(m!)).toBe(false);
  });

  it("returns null for an illegal move", () => {
    expect(judgeMove(START, "e2e5", [line(["e2e4"], 30)], { cp: 0, mate: null })).toBeNull();
  });
});
