// Deterministic hanging piece detection
// (port of src/backend/analysis/tactics/hanging.py).

import {
  type Board,
  type Color,
  KING,
  type Move,
  type PieceType,
  square,
  squareFile,
  squareName,
  squareRank,
} from "./board";
import { legalDefenders, minAttackerValue, pieceValue } from "./board_utils";
import { PIECE_NAMES, PIECE_VALUES } from "./constants";
import { staticExchangeEvaluation } from "./see";

export interface HangingPiece {
  square: string;
  square_index: number;
  piece_name: string;
  piece_type: PieceType;
  is_undefended: boolean;
  attacked_by_lesser: boolean;
  attacker_count: number;
  defender_count: number;
  enemy_see_gain: number;
}

/**
 * A non-king piece of `color` is hanging when attacked and either
 * undefended, attacked by a lesser piece, or under-defended (enemy SEE > 0),
 * excluding equal/winning recaptures on `lastMove`.
 */
export function isPieceHanging(
  board: Board,
  sq: number,
  color: Color,
  lastMove: Move | null = null,
  boardBefore: Board | null = null,
): boolean {
  const piece = board.pieceAt(sq);
  if (!piece || piece.color !== color || piece.type === KING) return false;

  const enemyColor = !color;
  if (board.attackers(enemyColor, sq).length === 0) return false;

  const pVal = pieceValue(board, sq);
  const isUndefended = legalDefenders(board, color, sq).length === 0;
  const attackedByLesser = minAttackerValue(board, enemyColor, sq) < pVal;
  const isUnderdefended = staticExchangeEvaluation(board, sq, enemyColor) > 0;

  if (!(isUndefended || attackedByLesser || isUnderdefended)) return false;

  // Recapture / equal trade exclusion
  if (lastMove && boardBefore !== null && lastMove.to === sq) {
    let captured = boardBefore.pieceAt(sq);
    if (captured === null && boardBefore.isEnPassant(lastMove)) {
      captured = boardBefore.pieceAt(square(squareFile(lastMove.to), squareRank(lastMove.from)));
    }
    if (captured && PIECE_VALUES[captured.type] >= pVal) return false;
  }
  return true;
}

/** All hanging pieces of `color`, in python-chess piece_map() order. */
export function getHangingPieces(
  board: Board,
  color: Color,
  lastMove: Move | null = null,
  boardBefore: Board | null = null,
): HangingPiece[] {
  const hanging: HangingPiece[] = [];
  const enemyColor = !color;
  for (const [sq, piece] of board.pieceMap()) {
    if (piece.color !== color || !isPieceHanging(board, sq, color, lastMove, boardBefore)) continue;
    const pVal = pieceValue(board, sq);
    const defenders = legalDefenders(board, color, sq);
    hanging.push({
      square: squareName(sq),
      square_index: sq,
      piece_name: PIECE_NAMES[piece.type] ?? "piece",
      piece_type: piece.type,
      is_undefended: defenders.length === 0,
      attacked_by_lesser: minAttackerValue(board, enemyColor, sq) < pVal,
      attacker_count: board.attackers(enemyColor, sq).length,
      defender_count: defenders.length,
      enemy_see_gain: staticExchangeEvaluation(board, sq, enemyColor),
    });
  }
  return hanging;
}
