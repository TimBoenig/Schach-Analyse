// Why a tried move fails, as moves on the board instead of a paragraph: the
// tried move followed by the engine's best reply line, cut where the point is
// made (a capture of material, a check sequence ending, or a few plies).

import { Chess } from "chess.js";

export interface LineStep {
  san: string;
  from: string;
  to: string;
  fen: string;
  /** True for the tried move itself, false for the engine's punishing replies. */
  tried: boolean;
}

/** Long enough to show a fork or a lost piece, short enough to follow by eye. */
export const REFUTATION_MAX_REPLIES = 5;

/**
 * Steps from `fenBefore`: the tried move, then up to `maxReplies` plies of the
 * reply PV (UCI). Illegal or missing moves end the line early, so a stale PV
 * never breaks the board.
 */
export function refutationLine(fenBefore: string, triedUci: string, replyPv: string[], maxReplies = REFUTATION_MAX_REPLIES): LineStep[] {
  const board = new Chess(fenBefore);
  const steps: LineStep[] = [];
  const play = (uci: string, tried: boolean): boolean => {
    try {
      const m = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      steps.push({ san: m.san, from: m.from, to: m.to, fen: board.fen(), tried });
      return true;
    } catch {
      return false;
    }
  };
  if (!play(triedUci, true)) return [];
  for (const uci of replyPv.slice(0, maxReplies)) {
    if (!play(uci, false)) break;
    if (board.isGameOver()) break;
  }
  return steps;
}

const SOUND = new Set(["Brilliant", "Great", "Best", "Excellent", "Good", "Book"]);

/** Moves that keep the position healthy; everything from an inaccuracy down gets refuted on the board. */
export function isSoundMove(classification: string): boolean {
  return SOUND.has(classification);
}

export interface PlayOnStats {
  moves: number;
  sound: number;
  brilliant: number;
  errors: number;
}

/** Tally of the player's moves while playing an opening on past the drilled line. */
export function playOnStats(classes: string[]): PlayOnStats {
  return {
    moves: classes.length,
    sound: classes.filter(isSoundMove).length,
    brilliant: classes.filter((c) => c === "Brilliant").length,
    errors: classes.filter((c) => c && !isSoundMove(c)).length,
  };
}
