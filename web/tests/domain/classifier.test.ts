// Ported from tests/backend/test_move_classifier.py.
import { describe, expect, it } from "vitest";

import { BEST_EQUIVALENT_LOSS, classifyMove, judgedLoss } from "../../src/domain/classifier";
import { calculateMoveAccuracy, getWinProbability } from "../../src/domain/math";
import { emptyMove, type MoveData, type PvLine } from "../../src/domain/types";

const GREEK_GIFT = "r1bq1rk1/pppn1ppp/4p3/3p4/2PP4/2NBPN2/PP3PPP/R1BQK2R w KQ - 0 8";
const QUEENS_FACING = "r2q1rk1/ppp2ppp/8/8/8/8/PPP2PPP/R2Q1RK1 w - - 0 1";

function mv(p: Partial<MoveData>): MoveData {
  return emptyMove({ fen_before: "start", ...p });
}
function pvs(...cps: number[]): PvLine[] {
  return cps.map((cp) => ({ pv: [], cp, mate: null, depth: 10 }));
}

describe("win probability and move accuracy", () => {
  it("maps centipawns and mates to 0..1", () => {
    expect(getWinProbability(0, null)).toBeCloseTo(0.5, 2);
    expect(getWinProbability(500, null)).toBeGreaterThan(0.85);
    expect(getWinProbability(-500, null)).toBeLessThan(0.15);
    expect(getWinProbability(null, 1)).toBe(1.0);
    expect(getWinProbability(null, -1)).toBe(0.0);
    expect(getWinProbability(null, null)).toBe(0.5);
  });

  it("bounds move accuracy between 0 and 100", () => {
    expect(calculateMoveAccuracy(0.5, 0.5)).toBe(100.0);
    expect(calculateMoveAccuracy(0.5, 0.6)).toBe(100.0);
    const minor = calculateMoveAccuracy(0.6, 0.58);
    expect(minor).toBeGreaterThan(85);
    expect(minor).toBeLessThanOrEqual(100);
    expect(calculateMoveAccuracy(0.8, 0.2)).toBeLessThan(20);
  });
});

describe("classifyMove", () => {
  const cases: [string, MoveData, number, PvLine[] | undefined, MoveData | null, string][] = [
    ["checkmate is Best", mv({ san: "Qxf7#", uci: "d1f7", win_chance_before: 0.99, win_chance_after: 1 }), 0, undefined, null, "Best"],
    ["missed forced mate is Miss", mv({ san: "Be3", uci: "c1e3", win_chance_before: 1, win_chance_after: 0.7, eval_before_mate: 2, best_move: "d1h5" }), 0.3, undefined, null, "Miss"],
    ["sound bishop sacrifice is Brilliant", mv({ san: "Bxh7+", uci: "d3h7", fen_before: GREEK_GIFT, win_chance_before: 0.58, win_chance_after: 0.75, best_move: "d3h7", eval_before_cp: 50, eval_after_cp: 180 }), 0, undefined, null, "Brilliant"],
    ["rook sacrifice is Brilliant", mv({ san: "Rxe6", uci: "e3e6", fen_before: "r2q1rk1/ppp2ppp/4b3/8/8/4R3/PPP2PPP/4R1K1 w - - 0 1", win_chance_before: 0.55, win_chance_after: 0.72, best_move: "e3e6", eval_before_cp: 40, eval_after_cp: 150 }), 0, undefined, null, "Brilliant"],
    ["sacrifice into forced mate when winning is Brilliant", mv({ san: "Bxh7+", uci: "d3h7", fen_before: GREEK_GIFT, win_chance_before: 0.96, win_chance_after: 1, best_move: "d3h7", eval_before_cp: 700, eval_after_mate: 3 }), 0, undefined, null, "Brilliant"],
    ["sacrifice during forced mate sequence is Brilliant", mv({ san: "Rxh6+", uci: "h1h6", fen_before: "r1b2rk1/2p2pp1/2n4p/1pbpN3/p3P3/1B1P2P1/PPPQN1q1/2KR3R w - - 0 17", win_chance_before: 1, win_chance_after: 1, best_move: "h1h6", eval_before_mate: 4, eval_after_mate: 3, eval_before_cp: 99996, eval_after_cp: 99997 }), 0, undefined, null, "Brilliant"],
    ["free sacrifice in a won position is Best", mv({ san: "Bxh7+", uci: "d3h7", fen_before: GREEK_GIFT, win_chance_before: 0.96, win_chance_after: 0.98, best_move: "d3h7", eval_before_cp: 600, eval_after_cp: 900 }), 0, pvs(900, 890), null, "Best"],
    ["capture only a pinned piece could answer is Best", mv({ san: "Rxg6+", uci: "f6g6", fen_before: "r1b2rk1/2p2p2/5Rn1/ppb1p1Q1/4P3/1B1P2P1/PPP1N1q1/2KR4 w - - 3 21", win_chance_before: 1, win_chance_after: 1, best_move: "f6g6", eval_before_mate: 2, eval_after_mate: 1 }), 0, undefined, null, "Best"],
    ["equal queen trade is Best", mv({ san: "Qxd8", uci: "d1d8", fen_before: QUEENS_FACING, win_chance_before: 0.52, win_chance_after: 0.52, best_move: "d1d8", eval_before_cp: 10, eval_after_cp: 10 }), 0, undefined, null, "Best"],
    ["unsound sacrifice is Blunder", mv({ san: "Bxh7+??", uci: "d3h7", fen_before: GREEK_GIFT, win_chance_before: 0.55, win_chance_after: 0.15, best_move: "e1g1", eval_before_cp: 30, eval_after_cp: -350 }), 0.4, undefined, null, "Blunder"],
    ["large loss is Blunder", mv({ san: "Qxa8??", uci: "d1a8", win_chance_before: 0.6, win_chance_after: 0.2, eval_before_cp: 50, eval_after_cp: -250, best_move: "e1g1" }), 0.4, undefined, null, "Blunder"],
    ["20% loss is Blunder (chess.com scale)", mv({ san: "Nd4", uci: "c2d4", win_chance_before: 0.6, win_chance_after: 0.39, eval_before_cp: 110, eval_after_cp: -50, best_move: "e1g1" }), 0.21, undefined, null, "Blunder"],
    ["non-engine move that keeps a won game is Excellent, not Best", mv({ san: "Kh1", uci: "g1h1", win_chance_before: 1, win_chance_after: 0.995, eval_before_cp: 1500, eval_after_cp: 1400, best_move: "d1d8" }), 0.005, undefined, null, "Excellent"],
    ["10-20% loss is Mistake", mv({ san: "Nd4", uci: "c2d4", win_chance_before: 0.55, win_chance_after: 0.42, eval_before_cp: 35, eval_after_cp: -60, best_move: "e1g1" }), 0.13, undefined, null, "Mistake"],
    ["5-10% loss is Inaccuracy", mv({ san: "h3", uci: "h2h3", win_chance_before: 0.52, win_chance_after: 0.45, eval_before_cp: 15, eval_after_cp: -35, best_move: "c1e3" }), 0.07, undefined, null, "Inaccuracy"],
    ["blowing a winning position is Miss", mv({ san: "Kh1", uci: "g1h1", win_chance_before: 0.78, win_chance_after: 0.45, eval_before_cp: 240, eval_after_cp: -40, best_move: "f3f7" }), 0.33, undefined, null, "Miss"],
    ["recapture is Best, not Great", mv({ san: "Nxd4", uci: "f3d4", fen_before: "r1bqk2r/pp2bppp/2n5/3p4/3n4/2N2N2/PPP1BPPP/R1BQK2R w KQkq - 0 10", win_chance_before: 0.52, win_chance_after: 0.52, best_move: "f3d4" }), 0, pvs(15, -320), mv({ san: "Nxd4", uci: "c6d4", fen_before: "" }), "Best"],
    ["equal trade as only move is Best", mv({ san: "Qxd8", uci: "d1d8", fen_before: QUEENS_FACING, win_chance_before: 0.5, win_chance_after: 0.5, best_move: "d1d8" }), 0, pvs(0, -800), null, "Best"],
    ["taking a hanging queen is Great", mv({ san: "cxd5", uci: "c4d5", fen_before: "r1b1kbnr/ppp1pppp/8/3q4/2P5/8/PP1P1PPP/RNBQKBNR w KQkq - 0 4", win_chance_before: 0.55, win_chance_after: 0.9, best_move: "c4d5" }), 0, pvs(700, 20), null, "Great"],
    ["only good move is Great", mv({ san: "h3", uci: "h2h3", fen_before: GREEK_GIFT, win_chance_before: 0.6, win_chance_after: 0.65, best_move: "h2h3" }), 0, pvs(80, -150), null, "Great"],
    ["critical quiet defence is Great", mv({ san: "Qe2", uci: "d1e2", fen_before: "r1b1kb1r/pppp1ppp/8/4p3/7q/3P4/PPP2PPP/RNBQK2R w KQkq - 0 8", win_chance_before: 0.52, win_chance_after: 0.54, best_move: "d1e2" }), 0, pvs(20, -300), null, "Great"],
  ];

  it.each(cases)("%s", (_name, move, wpl, multi, prev, expected) => {
    classifyMove(move, wpl, "white", multi, prev);
    expect(move.classification).toBe(expected);
    expect(move.explanation).not.toBe("");
  });
});

describe("judgedLoss", () => {
  const withLines = (uci: string, ...lines: [string, number][]) =>
    mv({ uci, best_move: lines[0][0], multi_pvs: lines.map(([m, cp]) => ({ pv: [m], cp, mate: null, depth: 16 })) });

  it("reads the loss from one search instead of two noisy ones", () => {
    // The search after the engine's own move scores it 4 points lower: still no loss.
    expect(judgedLoss(withLines("e2e4", ["e2e4", 40], ["d2d4", 35]), 0.04)).toBe(0);
    // An alternative loses exactly its gap to the first line.
    const gap = getWinProbability(40, null) - getWinProbability(-60, null);
    expect(judgedLoss(withLines("d2d4", ["e2e4", 40], ["d2d4", -60]), 0)).toBeCloseTo(gap, 6);
    // A move below every listed line loses at least what the weakest line loses.
    expect(judgedLoss(withLines("h2h4", ["e2e4", 40], ["d2d4", -60]), 0.01)).toBeCloseTo(gap, 6);
    expect(judgedLoss(withLines("h2h4", ["e2e4", 40], ["d2d4", -60]), 0.3)).toBe(0.3);
    // Without engine lines the raw loss is all there is.
    expect(judgedLoss(mv({ uci: "h2h4", best_move: "e2e4" }), 0.07)).toBe(0.07);
  });

  it("calls the engine's first choice Best even when the next search scores it lower", () => {
    const m = withLines("e2e4", ["e2e4", 40], ["d2d4", 35]);
    Object.assign(m, { san: "e4", fen_before: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", win_chance_before: 0.54, win_chance_after: 0.5 });
    classifyMove(m, judgedLoss(m, 0.04), "white", m.multi_pvs);
    expect(m.classification).toBe("Best");
  });

  it("calls an alternative as strong as the engine's choice Best, a slightly weaker one Excellent", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const equal = withLines("d2d4", ["e2e4", 40], ["d2d4", 36]);
    Object.assign(equal, { san: "d4", fen_before: fen, win_chance_before: 0.54, win_chance_after: 0.5 });
    const wpl = judgedLoss(equal, 0.04);
    expect(wpl).toBeLessThanOrEqual(BEST_EQUIVALENT_LOSS);
    classifyMove(equal, wpl, "white", equal.multi_pvs);
    expect(equal.classification).toBe("Best");

    const weaker = withLines("d2d4", ["e2e4", 40], ["d2d4", 20]);
    Object.assign(weaker, { san: "d4", fen_before: fen, win_chance_before: 0.54, win_chance_after: 0.5 });
    classifyMove(weaker, judgedLoss(weaker, 0.04), "white", weaker.multi_pvs);
    expect(weaker.classification).toBe("Excellent");
  });
});
