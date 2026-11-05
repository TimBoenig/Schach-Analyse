// The deeper re-check of critical moves after the first analysis pass.
import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";

import {
  analyzeGame,
  criticalMoves,
  VERIFY_MAX_POSITIONS,
  verifySettings,
  type AnalysisSettings,
  type PositionEngine,
} from "../../src/domain/analyzer";
import { emptyMetadata, emptyMove, type GameAnalysis, type PvLine } from "../../src/domain/types";

function gameFromSans(sans: string[]): GameAnalysis {
  const board = new Chess();
  const moves = sans.map((san, ply) => {
    const fen = board.fen();
    const m = board.move(san);
    return emptyMove({ move_number: Math.floor(ply / 2) + 1, ply: ply + 1, san: m.san, uci: m.from + m.to + (m.promotion ?? ""), fen_before: fen });
  });
  return { game_id: "t", metadata: emptyMetadata({ result: "*" }), moves, summary: {}, pgn_content: "" };
}

const BASE: AnalysisSettings = { depth: 12, movetimeMs: 400, multiPv: 2 };

/**
 * Scripted engine: every position is level with two engine lines that never
 * include the played move, except where `shallow` gives a misleading score
 * (side-to-move relative) that only the deeper search corrects.
 */
function scriptedEngine(shallow: Map<string, number>): PositionEngine & { deepCalls: string[] } {
  const deepCalls: string[] = [];
  return {
    deepCalls,
    async analyse(fen, limits) {
      const deep = limits.depth > BASE.depth;
      if (deep) deepCalls.push(fen);
      // Lines start with moves nobody plays in these games.
      const [a, b] = ["h2h3", "a2a3"].map((u) => (fen.includes(" b ") ? u.replace("2", "7").replace("3", "6") : u));
      const cp = !deep && shallow.has(fen) ? shallow.get(fen)! : 15;
      const lines: PvLine[] = [
        { pv: [a], cp, mate: null, depth: limits.depth },
        { pv: [b], cp: cp - 10, mate: null, depth: limits.depth },
      ];
      return lines;
    },
  };
}

describe("deeper re-check of critical moves", () => {
  it("corrects a blunder that only the short search saw and leaves quiet moves alone", async () => {
    const game = gameFromSans(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]);
    // After 2.Nf3 the short search wrongly thinks Black (to move) is winning.
    const engine = scriptedEngine(new Map([[game.moves[3].fen_before, 400]]));
    const summary = await analyzeGame(game, engine, { settings: BASE });

    expect(summary.analysis_status).toBe("completed");
    // The wrong score made 2.Nf3 look like it lost and 2...Nc6 like it threw the win away.
    for (const i of [2, 3]) expect(["Inaccuracy", "Mistake", "Blunder", "Miss"]).not.toContain(game.moves[i].classification);
    // Exactly the positions around those two moves were searched again, deeper.
    expect(engine.deepCalls).toEqual([2, 3, 4].map((i) => game.moves[i].fen_before));
    expect(game.moves[0].deep_checked).toBeFalsy();
    expect(summary.deep_checked).toBe(3);
    expect(summary.verify_depth).toBe(verifySettings(BASE)!.depth);
  });

  it("can be switched off", async () => {
    const game = gameFromSans(["e4", "e5", "Nf3", "Nc6"]);
    const engine = scriptedEngine(new Map([[game.moves[3].fen_before, 400]]));
    await analyzeGame(game, engine, { settings: { ...BASE, verify: false } });
    expect(engine.deepCalls).toEqual([]);
    expect(game.moves[2].classification).toBe("Blunder");
  });

  it("keeps the extra searches bounded when every move looks wrong", async () => {
    // 40 plies of quiet, never repeating moves.
    const board = new Chess();
    const sans: string[] = [];
    for (let k = 0; k < 40 && !board.isGameOver(); k++) {
      const moves = board.moves();
      sans.push(board.move(moves[(k * 7) % moves.length]).san);
    }
    const game = gameFromSans(sans);
    // Every short search after a move sees the mover lost: all moves look like errors.
    const engine = scriptedEngine(new Map(game.moves.slice(1).map((m, i) => [m.fen_before, 200 + i * 10])));
    await analyzeGame(game, engine, { settings: BASE });
    expect(engine.deepCalls).toHaveLength(VERIFY_MAX_POSITIONS);
  });

  it("orders errors by size before praise", () => {
    const game = gameFromSans(["e4", "e5", "Nf3"]);
    const set = (i: number, c: "Inaccuracy" | "Blunder" | "Great", before: number, after: number) =>
      Object.assign(game.moves[i], { classification: c, win_chance_before: before, win_chance_after: after });
    set(0, "Great", 0.5, 0.5);
    set(1, "Inaccuracy", 0.5, 0.56); // Black loses 6 points
    set(2, "Blunder", 0.5, 0.2);
    expect(criticalMoves(game)).toEqual([2, 1, 0]);
  });

  it("pauses during the re-check and finishes it on resume without a new first pass", async () => {
    const game = gameFromSans(["e4", "e5", "Nf3", "Nc6"]);
    const engine = scriptedEngine(new Map([[game.moves[3].fen_before, 400]]));
    const ctrl = new AbortController();
    const paused = await analyzeGame(game, engine, {
      settings: BASE,
      signal: ctrl.signal,
      onProgress: (e) => e.phase === "verify" && ctrl.abort(),
    });
    expect(paused.analysis_status).toBe("paused");
    expect(engine.deepCalls).toHaveLength(1);

    const resumed = await analyzeGame(game, engine, { settings: BASE });
    expect(resumed.analysis_status).toBe("completed");
    // Only the two positions still missing; nothing was searched twice.
    expect(engine.deepCalls).toHaveLength(3);
    expect(new Set(engine.deepCalls).size).toBe(3);
    expect(game.moves[2].classification).not.toBe("Blunder");
  });

  it("goes deeper but stays within the device limits", () => {
    expect(verifySettings({ depth: 12, movetimeMs: 400, multiPv: 2 })).toEqual({ depth: 18, movetimeMs: 1200, multiPv: 2, verify: false });
    expect(verifySettings({ depth: 20, movetimeMs: 3000, multiPv: 2 })!.movetimeMs).toBe(6000);
    expect(verifySettings({ depth: 26, movetimeMs: 8000, multiPv: 2 })).toBeNull();
  });
});
