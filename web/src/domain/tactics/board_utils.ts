// Board geometry, ray tracing and piece safety helpers
// (port of src/backend/analysis/tactics/board_utils.py).

import {
  BISHOP,
  type Board,
  type Color,
  type Piece,
  QUEEN,
  ROOK,
  square,
  squareFile,
  squareRank,
} from "./board";
import { PIECE_VALUES } from "./constants";

/** Piece value at `sq` (0 if empty or King). */
export function pieceValue(board: Board, sq: number): number {
  const piece = board.pieceAt(sq);
  return piece ? PIECE_VALUES[piece.type] : 0;
}

/**
 * Friendly pieces defending `square` that are not absolutely pinned away
 * from `square` along a different ray.
 */
export function legalDefenders(board: Board, color: Color, target: number): number[] {
  return board.attackers(color, target).filter((sq) => {
    const pin = board.pin(color, sq);
    return !(pin !== null && !pin.has(target));
  });
}

/** Minimum piece value among pieces of `color` attacking `square`. */
export function minAttackerValue(board: Board, color: Color, target: number, dflt = 99): number {
  const attackers = board.attackers(color, target);
  if (attackers.length === 0) return dflt;
  return Math.min(...attackers.map((sq) => pieceValue(board, sq)));
}

export type RayTarget = [frontSq: number, frontPiece: Piece, rearSq: number, rearPiece: Piece];

/**
 * All aligned pairs of enemy pieces (front, rear) along straight rays
 * extending outwards from `sliderSq`, in physical order along each ray.
 */
export function findSliderRayTargets(board: Board, sliderSq: number, color: Color): RayTarget[] {
  const enemyColor = !color;
  const results: RayTarget[] = [];
  const slider = board.pieceAt(sliderSq);
  if (!slider) return results;

  const directions: [number, number][] = [];
  if (slider.type === BISHOP || slider.type === QUEEN) {
    directions.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
  }
  if (slider.type === ROOK || slider.type === QUEEN) {
    directions.push([1, 0], [-1, 0], [0, 1], [0, -1]);
  }

  for (const [df, dr] of directions) {
    let f = squareFile(sliderSq) + df;
    let r = squareRank(sliderSq) + dr;
    let frontSq: number | null = null;
    let frontPiece: Piece | null = null;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const sq = square(f, r);
      const piece = board.pieceAt(sq);
      if (piece !== null) {
        if (frontSq === null) {
          if (piece.color === enemyColor) {
            frontSq = sq;
            frontPiece = piece;
          } else {
            break; // Friendly piece blocks ray immediately
          }
        } else {
          if (piece.color === enemyColor && frontPiece !== null) {
            results.push([frontSq, frontPiece, sq, piece]);
          }
          break; // Second piece blocks further vision on this ray
        }
      }
      f += df;
      r += dr;
    }
  }
  return results;
}

/** True if square `c` lies strictly between `a` and `b` on a straight ray. */
export function isOnSegment(a: number, b: number, c: number): boolean {
  const df = squareFile(b) - squareFile(a);
  const dr = squareRank(b) - squareRank(a);
  if (df !== 0 && dr !== 0 && Math.abs(df) !== Math.abs(dr)) return false;

  const cdf = squareFile(c) - squareFile(a);
  const cdr = squareRank(c) - squareRank(a);
  if (df === 0) {
    if (cdf !== 0) return false;
    return (0 < cdr && cdr < dr) || (dr < cdr && cdr < 0);
  }
  if (dr === 0) {
    if (cdr !== 0) return false;
    return (0 < cdf && cdf < df) || (df < cdf && cdf < 0);
  }
  if (Math.sign(df) !== Math.sign(cdf) || Math.sign(dr) !== Math.sign(cdr)) return false;
  return Math.abs(cdf) === Math.abs(cdr) && 0 < Math.abs(cdf) && Math.abs(cdf) < Math.abs(df);
}

/** Converts a White-perspective score to user perspective. */
export function toUserCp(cp: number | null | undefined, isUserWhite: boolean): number | null {
  if (cp === null || cp === undefined) return null;
  return isUserWhite ? cp : -cp;
}

/** Converts a White win probability (0..1) to user perspective. */
export function toUserWp(wp: number, isUserWhite: boolean): number {
  return isUserWhite ? wp : 1.0 - wp;
}
