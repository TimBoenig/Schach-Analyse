// Judges a move the player tries on the board (side line, free board, puzzle)
// with the same classifier the game analysis uses, so "Fehler" means the same
// everywhere. Engine scores arrive from the side to move and are converted to
// the White perspective here, once.
import { Chess } from "chess.js";

import { processAnalysisResults } from "./analyzer";
import { classifyMove } from "./classifier";
import { getWinProbability } from "./math";
import { emptyMove, type MoveData, type PvLine, type Side } from "./types";

export interface Score {
  cp: number | null;
  mate: number | null;
}

/** White-perspective score of the position after a move; terminal positions need no engine. */
export function terminalScore(fen: string): Score | null {
  const board = new Chess(fen);
  if (board.isCheckmate()) return { cp: null, mate: board.turn() === "w" ? -1 : 1 };
  if (board.isGameOver()) return { cp: 0, mate: null };
  return null;
}

/** Converts an engine line of the side to move in `fen` into a White-perspective score. */
export function whiteScore(fen: string, line: Pick<PvLine, "cp" | "mate"> | undefined): Score | null {
  if (!line) return null;
  const sign = fen.split(" ")[1] === "b" ? -1 : 1;
  return { cp: line.cp !== null ? sign * line.cp : null, mate: line.mate !== null ? sign * line.mate : null };
}

/**
 * Classifies `uci` played in `fenBefore`. `parentLines` are the engine lines of
 * the position before the move (best first), `after` the White-perspective score
 * after it. Returns null for an illegal move.
 */
export function judgeMove(fenBefore: string, uci: string, parentLines: PvLine[], after: Score): MoveData | null {
  const board = new Chess(fenBefore);
  let san: string;
  try {
    san = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return null;
  }
  const side: Side = fenBefore.split(" ")[1] === "b" ? "black" : "white";
  const parts = fenBefore.split(" ");
  const move = emptyMove({ fen_before: fenBefore, uci, san, move_number: Number(parts[5]) || 1 });
  processAnalysisResults(move, parentLines);
  move.eval_after_cp = after.cp;
  move.eval_after_mate = after.mate;
  move.win_chance_before = getWinProbability(move.eval_before_cp, move.eval_before_mate);
  move.win_chance_after = san.endsWith("#") ? (side === "white" ? 1 : 0) : getWinProbability(after.cp, after.mate);
  // A move matching the engine's first choice is never worse than "best", even if
  // the shorter search after the move scores it a little lower.
  if (move.best_move && move.best_move.slice(0, 4) === uci.slice(0, 4)) {
    const keep = side === "white" ? Math.max : Math.min;
    move.win_chance_after = keep(move.win_chance_after, move.win_chance_before);
  }
  const wpl = Math.max(0, side === "white" ? move.win_chance_before - move.win_chance_after : move.win_chance_after - move.win_chance_before);
  classifyMove(move, wpl, side, move.multi_pvs, null);
  return move;
}

/** Winning chance the mover gave away with a judged move (0..1). */
export function moverLoss(move: MoveData): number {
  const white = move.fen_before.split(" ")[1] === "w";
  return Math.max(0, white ? move.win_chance_before - move.win_chance_after : move.win_chance_after - move.win_chance_before);
}

// A puzzle alternative counts as solved when it keeps nearly all of the best move's
// winning chance; 5 points is where the classifier stops calling a move "good".
export const PUZZLE_ALT_MAX_LOSS = 0.05;

/** True when a move other than the stored solution solves a puzzle just as well. */
export function solvesPuzzle(move: MoveData): boolean {
  return moverLoss(move) <= PUZZLE_ALT_MAX_LOSS;
}
