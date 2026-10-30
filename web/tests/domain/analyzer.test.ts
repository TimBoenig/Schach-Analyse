// End-to-end analysis against the real Stockfish WASM build (run in Node),
// plus the scoring invariants the desktop app guards.
import { existsSync } from "node:fs";

import { Chess } from "chess.js";
import { afterAll, describe, expect, it } from "vitest";

import { analyzeGame, classifyAndSummarize, processAnalysisResults } from "../../src/domain/analyzer";
import { gameAccuracy, MIN_MOVE_ACCURACY } from "../../src/domain/math";
import { emptyMetadata, emptyMove, type GameAnalysis } from "../../src/domain/types";
import { UciEngine, parseInfoLine } from "../../src/engine/uci";
import { ENGINE_JS, nodeTransport } from "../engine";

function gameFromSans(sans: string[]): GameAnalysis {
  const board = new Chess();
  const moves = sans.map((san, ply) => {
    const fen = board.fen();
    const m = board.move(san);
    return emptyMove({ move_number: Math.floor(ply / 2) + 1, ply: ply + 1, san: m.san, uci: m.from + m.to + (m.promotion ?? ""), fen_before: fen });
  });
  return { game_id: "t", metadata: emptyMetadata({ result: "1-0" }), moves, summary: {}, pgn_content: "" };
}

describe("UCI parsing", () => {
  it("parses multipv score lines and skips bounds", () => {
    expect(parseInfoLine("info depth 12 seldepth 18 multipv 2 score cp -35 nodes 1 nps 1 time 1 pv e7e5 g1f3")).toEqual({
      multipv: 2, depth: 12, cp: -35, mate: null, pv: ["e7e5", "g1f3"],
    });
    expect(parseInfoLine("info depth 9 multipv 1 score mate -3 pv h7h6")?.mate).toBe(-3);
    expect(parseInfoLine("info depth 9 multipv 1 score cp 20 lowerbound pv e2e4")).toBeNull();
    expect(parseInfoLine("info string NNUE evaluation")).toBeNull();
  });
});

describe("White-perspective scores", () => {
  it("flips side-to-move scores for Black exactly once at ingestion", () => {
    const game = gameFromSans(["e4"]);
    const black = emptyMove({ fen_before: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1" });
    processAnalysisResults(black, [{ pv: ["e7e5"], cp: -40, mate: null, depth: 10 }]);
    expect(black.eval_before_cp).toBe(40);
    processAnalysisResults(game.moves[0], [{ pv: ["e2e4"], cp: 30, mate: null, depth: 10 }]);
    expect(game.moves[0].eval_before_cp).toBe(30);
    processAnalysisResults(black, [{ pv: ["d8h4"], cp: null, mate: 2, depth: 10 }]);
    expect(black.eval_before_mate).toBe(-2);
  });
});

describe("engine moves and search noise", () => {
  it("keeps distinct engine lines and rates the engine's move Best with full accuracy", () => {
    const game = gameFromSans(["e4", "e5"]);
    // A stopped search can repeat the first line's move in a stale second line.
    processAnalysisResults(game.moves[0], [
      { pv: ["e2e4", "e7e5"], cp: 40, mate: null, depth: 16 },
      { pv: ["e2e4"], cp: 30, mate: null, depth: 15 },
      { pv: ["d2d4"], cp: 35, mate: null, depth: 15 },
    ]);
    expect(game.moves[0].multi_pvs.map((l) => l.pv[0])).toEqual(["e2e4", "d2d4"]);
    // The search after 1.e4 sees White 35 cp lower than the search before it.
    processAnalysisResults(game.moves[1], [{ pv: ["e7e5"], cp: -5, mate: null, depth: 16 }]);
    const summary = classifyAndSummarize(game, { cp: 5, mate: null }, undefined);
    expect(game.moves[0].classification).toBe("Best");
    expect(summary.white!.accuracies[0]).toBe(100);
  });
});

describe("accuracy floor", () => {
  it("keeps one blunder from collapsing game accuracy", () => {
    const accs = [100, 100, 100, 100, 0, 100, 100, 100];
    const acc = gameAccuracy(accs, accs.map(() => 0.5));
    expect(acc).toBeGreaterThan(40);
    // Fool's mate: every White move is recorded with at least the floor.
    const game = gameFromSans(["f3", "e5", "g4", "Qh4#"]);
    const evals: [number | null, number | null][] = [[20, null], [-40, null], [-150, null], [null, -1]];
    game.moves.forEach((m, i) => {
      m.eval_before_cp = evals[i][0];
      m.eval_before_mate = evals[i][1];
    });
    const summary = classifyAndSummarize(game, { cp: null, mate: -1 }, undefined);
    expect(Math.min(...summary.white!.accuracies)).toBeGreaterThanOrEqual(MIN_MOVE_ACCURACY);
    expect(game.moves[2].classification).toBe("Blunder");
    expect(game.moves[3].classification).toBe("Best");
  });
});

describe.skipIf(!existsSync(ENGINE_JS))("analyzeGame with Stockfish", () => {
  const engine = new UciEngine(nodeTransport());
  afterAll(() => engine.quit());

  it("analyses Fool's mate and finds the blunder", async () => {
    const game = gameFromSans(["f3", "e5", "g4", "Qh4#"]);
    const progress: number[] = [];
    const summary = await analyzeGame(game, engine, {
      settings: { depth: 8, movetimeMs: 200, multiPv: 2 },
      onProgress: (e) => progress.push(e.done),
    });
    expect(summary.analysis_status).toBe("completed");
    expect(game.moves[2].classification).toBe("Blunder");
    expect(game.moves[2].best_move).not.toBe("g2g4");
    expect(game.moves[3].classification).toBe("Best");
    expect(summary.black!.accuracy).toBeGreaterThan(summary.white!.accuracy);
    expect(progress.at(-1)).toBe(4);
  }, 20000);

  it("pauses on abort and resumes where it stopped", async () => {
    const game = gameFromSans(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"]);
    const ctrl = new AbortController();
    const settings = { depth: 6, movetimeMs: 100, multiPv: 1 };
    const paused = await analyzeGame(game, engine, {
      settings,
      signal: ctrl.signal,
      onProgress: (e) => e.done >= 2 && ctrl.abort(),
    });
    expect(paused.analysis_status).toBe("paused");
    const done = await analyzeGame(game, engine, { settings });
    expect(done.analysis_status).toBe("completed");
    expect(game.moves.every((m) => m.classification)).toBe(true);
  }, 20000);
});
