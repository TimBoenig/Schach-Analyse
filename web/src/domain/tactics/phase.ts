// Game phase classification (port of src/backend/analysis/tactics/phase.py).

import { BISHOP, BLACK, type Board, type Color, KING, KNIGHT, PAWN, QUEEN, ROOK, WHITE } from "./board";
import {
  ENDGAME_LOW_TOTAL_NON_PAWN,
  ENDGAME_NO_QUEEN_TOTAL_MAX,
  ENDGAME_SOLO_PIECE_MAX,
  GamePhase,
  OPENING_MAX_PLY,
  OPENING_MIN_NON_PAWN,
  PIECE_VALUES,
} from "./constants";

/** Total non-pawn, non-king material value for a color. */
export function nonPawnMaterial(board: Board, color: Color): number {
  let total = 0;
  for (const [, p] of board.pieceMap()) {
    if (p.color === color && p.type !== KING && p.type !== PAWN) total += PIECE_VALUES[p.type];
  }
  return total;
}

/**
 * Classifies a position into 'opening', 'middlegame' or 'endgame'.
 * - Opening: in book OR ply <= 16 with >= 20 non-pawn material per side.
 * - Endgame: no queens and total non-pawn <= 26, OR total <= 18, OR either
 *   side <= 6.
 * - Middlegame: everything in between.
 */
export function classifyGamePhase(board: Board, ply: number, isBookMove = false): GamePhase {
  if (isBookMove) return GamePhase.OPENING;
  return phaseOf(nonPawnMaterial(board, WHITE), nonPawnMaterial(board, BLACK), board.pieces(QUEEN, WHITE).length > 0, board.pieces(QUEEN, BLACK).length > 0, ply);
}

const FEN_VALUES: Record<string, number> = { n: PIECE_VALUES[KNIGHT], b: PIECE_VALUES[BISHOP], r: PIECE_VALUES[ROOK], q: PIECE_VALUES[QUEEN] };

/**
 * classifyGamePhase straight from a FEN's piece field, without building a
 * board: the same rule, fast enough to run over thousands of positions.
 */
export function classifyFenPhase(fen: string, ply: number): GamePhase {
  let white = 0;
  let black = 0;
  let wq = false;
  let bq = false;
  const placement = fen.split(" ")[0] ?? "";
  for (const ch of placement) {
    const v = FEN_VALUES[ch.toLowerCase()];
    if (!v) continue;
    if (ch === ch.toUpperCase()) {
      white += v;
      if (ch === "Q") wq = true;
    } else {
      black += v;
      if (ch === "q") bq = true;
    }
  }
  return phaseOf(white, black, wq, bq, ply);
}

function phaseOf(white: number, black: number, hasWhiteQueen: boolean, hasBlackQueen: boolean, ply: number): GamePhase {
  const total = white + black;
  if (
    (!hasWhiteQueen && !hasBlackQueen && total <= ENDGAME_NO_QUEEN_TOTAL_MAX) ||
    total <= ENDGAME_LOW_TOTAL_NON_PAWN ||
    white <= ENDGAME_SOLO_PIECE_MAX ||
    black <= ENDGAME_SOLO_PIECE_MAX
  ) {
    return GamePhase.ENDGAME;
  }

  if (ply <= OPENING_MAX_PLY && white >= OPENING_MIN_NON_PAWN && black >= OPENING_MIN_NON_PAWN) {
    return GamePhase.OPENING;
  }
  return GamePhase.MIDDLEGAME;
}
