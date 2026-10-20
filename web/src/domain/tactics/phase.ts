// Game phase classification (port of src/backend/analysis/tactics/phase.py).

import { BLACK, type Board, type Color, KING, PAWN, QUEEN, WHITE } from "./board";
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

  const white = nonPawnMaterial(board, WHITE);
  const black = nonPawnMaterial(board, BLACK);
  const total = white + black;
  const hasWhiteQueen = board.pieces(QUEEN, WHITE).length > 0;
  const hasBlackQueen = board.pieces(QUEEN, BLACK).length > 0;

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
