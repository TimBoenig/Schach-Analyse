// Static Exchange Evaluation (port of src/backend/analysis/tactics/see.py).

import { type Board, type Color, KING, PAWN, type PieceType, QUEEN, squareRank } from "./board";
import { legalDefenders, pieceValue } from "./board_utils";

/**
 * SEE in centipawns on `square` from the perspective of `attackingColor`:
 * least valuable legal attacker captures first, pinned pieces only along the
 * pin ray, king captures only if undefended, promotions add +800 cp.
 * Never negative (the attacker may stop when unfavourable).
 */
export function staticExchangeEvaluation(board: Board, target: number, attackingColor: Color): number {
  if (!board.pieceAt(target)) return 0;

  const attackers = legalDefenders(board, attackingColor, target);
  if (attackers.length === 0) return 0;

  const enemyColor = !attackingColor;
  const enemyDefenders = legalDefenders(board, enemyColor, target);

  let bestAttacker: number | null = null;
  let minVal = 99999;
  for (const sq of attackers) {
    const p = board.pieceAt(sq);
    if (!p) continue;
    // King cannot capture if defended by enemy
    if (p.type === KING && enemyDefenders.length > 0) continue;
    const val = pieceValue(board, sq);
    if (val < minVal) {
      minVal = val;
      bestAttacker = sq;
    }
  }
  if (bestAttacker === null) return 0;

  let capturedVal = pieceValue(board, target) * 100;
  const copy = board.copy();
  const attackerPiece = board.pieceAt(bestAttacker);
  let promotion: PieceType | null = null;
  if (attackerPiece && attackerPiece.type === PAWN && (squareRank(target) === 0 || squareRank(target) === 7)) {
    promotion = QUEEN;
    capturedVal += 800; // Promotion adds net Queen value over pawn
  }
  copy.push({ from: bestAttacker, to: target, promotion });

  const recaptureGain = staticExchangeEvaluation(copy, target, enemyColor);
  return Math.max(0, capturedVal - recaptureGain);
}

/**
 * True if the piece on `sq` of `color` cannot be captured for free or at a
 * profit by the enemy on their immediate turn.
 */
export function isSafelyPlaced(boardAfter: Board, sq: number, color: Color): boolean {
  const canBeCaptured = boardAfter.legalMoves().some((m) => m.to === sq);
  if (!canBeCaptured) return true;
  if (legalDefenders(boardAfter, color, sq).length === 0) return false;
  return staticExchangeEvaluation(boardAfter, sq, !color) <= 0;
}
