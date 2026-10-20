// Tactical motif detection (port of src/backend/analysis/tactics/motifs.py).
// Detects: fork, pin, skewer, discovered attack, sacrifice, back-rank.

import {
  BISHOP,
  BLACK,
  type Board,
  type Color,
  KING,
  KNIGHT,
  type Move,
  PAWN,
  type Piece,
  type PieceType,
  QUEEN,
  ROOK,
  square,
  squareFile,
  squareRank,
} from "./board";
import {
  findSliderRayTargets,
  isOnSegment,
  legalDefenders,
  minAttackerValue,
  pieceValue,
} from "./board_utils";
import { KING_SKEWER_VALUE, MIN_SACRIFICE_DEFICIT_CP, PIECE_VALUES, TacticalTheme } from "./constants";
import { isSafelyPlaced, staticExchangeEvaluation } from "./see";

export interface MotifCtx {
  readonly before: Board;
  readonly after: Board;
  readonly move: Move;
  readonly color: Color;
  readonly piece: Piece;
  readonly enemyColor: Color;
  readonly enemyKingSq: number | null;
  readonly sliders: readonly number[];
}

type Alignment = [sliderSq: number, frontSq: number, frontP: Piece, rearSq: number, rearP: Piece];

/**
 * Aligned (slider, front, rear) tuples that were newly formed by moving the
 * slider or unmasked along the slider's ray.
 */
export function* affectedAlignments(ctx: MotifCtx): Generator<Alignment> {
  for (const sliderSq of ctx.sliders) {
    const isMoved = sliderSq === ctx.move.to;
    for (const [frontSq, frontP, rearSq, rearP] of findSliderRayTargets(ctx.after, sliderSq, ctx.color)) {
      if (isMoved || isOnSegment(sliderSq, frontSq, ctx.move.from)) {
        yield [sliderSq, frontSq, frontP, rearSq, rearP];
      }
    }
  }
}

/** Voluntary piece sacrifice with a net deficit >= 200 cp. */
function isSacrifice(ctx: MotifCtx): boolean {
  if (ctx.piece.type === PAWN || ctx.piece.type === KING) return false;

  const movedVal = pieceValue(ctx.after, ctx.move.to);
  const capturedVal = pieceValue(ctx.before, ctx.move.to);
  // Equal trades or winning captures are not sacrifices
  if (capturedVal >= movedVal) return false;

  // Duress / concession exclusions before the move
  const isPinnedBefore = ctx.before.isPinned(ctx.color, ctx.move.from);
  const attackedByTarget = ctx.before.attackers(ctx.enemyColor, ctx.move.from).includes(ctx.move.to);
  const underAttackByLesser = minAttackerValue(ctx.before, ctx.enemyColor, ctx.move.from) < movedVal;
  if (isPinnedBefore || attackedByTarget || underAttackByLesser) return false;

  const enemyGain = staticExchangeEvaluation(ctx.after, ctx.move.to, ctx.enemyColor);
  return enemyGain - capturedVal * 100 >= MIN_SACRIFICE_DEFICIT_CP;
}

/**
 * Double attack on 2+ targets (king in check, undefended / higher-value /
 * under-defended non-pawn pieces) by a safely placed piece.
 */
function isFork(ctx: MotifCtx): boolean {
  if (ctx.piece.type === KING) return false;
  if (!isSafelyPlaced(ctx.after, ctx.move.to, ctx.color)) return false;

  const attacks = ctx.after.attacks(ctx.move.to);
  let valuableTargets = 0;
  if (ctx.enemyKingSq !== null && attacks.has(ctx.enemyKingSq)) valuableTargets += 1;

  const movedVal = pieceValue(ctx.after, ctx.move.to);
  for (const targetSq of [...attacks].sort((a, b) => a - b)) {
    if (targetSq === ctx.enemyKingSq) continue;
    const target = ctx.after.pieceAt(targetSq);
    if (!target || target.color !== ctx.enemyColor) continue;
    // Fork targets must be pieces, never pawns
    if (target.type === PAWN) continue;
    const targetVal = PIECE_VALUES[target.type];
    const defenders = legalDefenders(ctx.after, ctx.enemyColor, targetSq);
    if (
      defenders.length === 0 ||
      targetVal > movedVal ||
      staticExchangeEvaluation(ctx.after, targetSq, ctx.color) > 0
    ) {
      valuableTargets += 1;
    }
  }
  return valuableTargets >= 2;
}

function isPinAlignment(ctx: MotifCtx, [sliderSq, , frontP, rearSq, rearP]: Alignment): boolean {
  // Absolute pin: rear piece is the enemy king
  if (rearP.type === KING) return true;
  // Relative pin: front is not a pawn; rear is queen, or rook behind a minor
  if (frontP.type !== PAWN) {
    if (rearP.type === QUEEN) return true;
    if (rearP.type === ROOK && (frontP.type === KNIGHT || frontP.type === BISHOP)) {
      const slider = ctx.after.pieceAt(sliderSq);
      const rearDefenders = legalDefenders(ctx.after, ctx.enemyColor, rearSq);
      if (slider?.type === BISHOP || rearDefenders.length === 0) return true;
    }
  }
  return false;
}

function hasPin(ctx: MotifCtx): boolean {
  for (const a of affectedAlignments(ctx)) if (isPinAlignment(ctx, a)) return true;
  return false;
}

/** Discovered attacks / checks unmasked by the moved piece. */
function isDiscovered(ctx: MotifCtx): boolean {
  if (ctx.after.isCheck()) {
    const checkers = ctx.after.checkers();
    if (!checkers.includes(ctx.move.to) && checkers.length > 0) return true;
  }

  for (const sliderSq of ctx.sliders) {
    if (sliderSq === ctx.move.to || !ctx.after.attacks(sliderSq).has(ctx.move.from)) continue;
    const beforeAttacks = ctx.before.attacks(sliderSq);
    const newTargets = [...ctx.after.attacks(sliderSq)]
      .filter((sq) => !beforeAttacks.has(sq))
      .sort((a, b) => a - b);
    const sliderVal = pieceValue(ctx.after, sliderSq);
    for (const ntSq of newTargets) {
      const nt = ctx.after.pieceAt(ntSq);
      if (!nt || nt.color !== ctx.enemyColor) continue;
      const targetVal = PIECE_VALUES[nt.type];
      const defenders = legalDefenders(ctx.after, ctx.enemyColor, ntSq);
      if (
        defenders.length === 0 ||
        targetVal > sliderVal ||
        (nt.type !== PAWN && staticExchangeEvaluation(ctx.after, ntSq, ctx.color) > 0)
      ) {
        return true;
      }
    }
  }
  return false;
}

function isSkewerAlignment(ctx: MotifCtx, [sliderSq, frontSq, frontP, , rearP]: Alignment): boolean {
  if (rearP.type === PAWN) return false;
  const frontVal = frontP.type === KING ? KING_SKEWER_VALUE : PIECE_VALUES[frontP.type];
  const rearVal = PIECE_VALUES[rearP.type];
  // Front piece must be strictly more valuable than the rear piece
  if (frontVal <= rearVal) return false;

  const sliderVal = pieceValue(ctx.after, sliderSq);
  const isUndefended = legalDefenders(ctx.after, ctx.enemyColor, frontSq).length === 0;
  // Front piece must be genuinely compelled to move
  if (frontP.type === KING) return true;
  if (frontP.type === QUEEN) return sliderVal < 9 || isUndefended;
  if (frontP.type === ROOK) return sliderVal < 5 || isUndefended;
  return isUndefended;
}

function isSkewer(ctx: MotifCtx): boolean {
  for (const a of affectedAlignments(ctx)) if (isSkewerAlignment(ctx, a)) return true;
  return false;
}

/** Back-rank weakness exploitation or mate infiltration. */
function isBackRank(ctx: MotifCtx): boolean {
  const backRank = ctx.enemyColor === BLACK ? 7 : 0;
  if (ctx.enemyKingSq === null || squareRank(ctx.enemyKingSq) !== backRank) return false;

  const adjRank = ctx.enemyColor === BLACK ? 6 : 1;
  const kingFile = squareFile(ctx.enemyKingSq);
  // Faithful to the Python original, which calls board.attacks(color): a
  // python-chess Color is a bool, so this looks up the attacks of the piece
  // on square 1 (b1) for White or 0 (a1) for Black.
  const colorSquareAttacks = ctx.after.attacks(ctx.color ? 1 : 0);
  let hasLuft = false;
  for (let f = Math.max(0, kingFile - 1); f < Math.min(8, kingFile + 2); f++) {
    const esq = square(f, adjRank);
    if (ctx.after.pieceAt(esq) === null && !colorSquareAttacks.has(esq)) {
      hasLuft = true;
      break;
    }
  }
  if (hasLuft) return false;

  // Checkmate on the back rank
  if (ctx.after.isCheckmate() && ctx.after.checkers().some((c) => squareRank(c) === backRank)) {
    return true;
  }

  // Infiltration with check by queen or rook
  if (
    (ctx.piece.type === ROOK || ctx.piece.type === QUEEN) &&
    squareRank(ctx.move.to) === backRank &&
    (ctx.after.attacks(ctx.move.to).has(ctx.enemyKingSq) || ctx.after.isCheck())
  ) {
    const canBeCaptured = ctx.after.legalMoves().some((m) => m.to === ctx.move.to);
    if (!canBeCaptured) return true;
    const isUndefended = legalDefenders(ctx.after, ctx.color, ctx.move.to).length === 0;
    const isRecapturableTrade = ctx.before.isCapture(ctx.move);
    if (!(isUndefended || isRecapturableTrade)) {
      if (staticExchangeEvaluation(ctx.after, ctx.move.to, ctx.enemyColor) <= 0) return true;
    }
  }
  return false;
}

export const DETECTORS: ReadonlyArray<[TacticalTheme, (ctx: MotifCtx) => boolean]> = [
  [TacticalTheme.SACRIFICE, isSacrifice],
  [TacticalTheme.FORK, isFork],
  [TacticalTheme.PIN, hasPin],
  [TacticalTheme.DISCOVERED_ATTACK, isDiscovered],
  [TacticalTheme.SKEWER, isSkewer],
  [TacticalTheme.BACK_RANK, isBackRank],
];

/** Tactical motifs executed by `move` (played by `color`). */
export function detectTacticalMotifs(
  boardBefore: Board,
  boardAfter: Board,
  move: Move,
  color: Color,
): TacticalTheme[] {
  const piece = boardAfter.pieceAt(move.to);
  if (!piece) return [];
  const sliders = ([BISHOP, ROOK, QUEEN] as PieceType[])
    .flatMap((t) => boardAfter.pieces(t, color))
    .sort((a, b) => a - b);
  const ctx: MotifCtx = {
    before: boardBefore,
    after: boardAfter,
    move,
    color,
    piece,
    enemyColor: !color,
    enemyKingSq: boardAfter.king(!color),
    sliders,
  };
  return DETECTORS.filter(([, fn]) => fn(ctx)).map(([name]) => name);
}
