// Classifies moves (Brilliant, Blunder, ...) from Win Probability Loss plus
// special cases. Started as a port of src/backend/analysis/move_classifier.py;
// the loss now comes from judgedLoss() and the tiers follow chess.com.
import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";

import { getWinProbability } from "./math";
import type { MoveData, PvLine, Side } from "./types";

const PIECE_VALUES_CP: Record<PieceSymbol, number> = {
  p: 100,
  n: 300,
  b: 325,
  r: 500,
  q: 900,
  k: 0, // the king cannot be sacrificed or captured
};

function pieceValue(type: PieceSymbol | undefined | null): number {
  return type ? PIECE_VALUES_CP[type] : 0;
}

function parseUci(uci: string): { from: Square; to: Square; promotion?: string } {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: uci.length > 4 ? uci[4] : undefined,
  };
}

function loadBoard(fen: string): Chess | null {
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
}

function findLegalMove(board: Chess, uci: string) {
  const { from, to, promotion } = parseUci(uci);
  return board
    .moves({ verbose: true, square: from })
    .find((m) => m.to === to && (m.promotion ?? undefined) === (promotion ?? undefined));
}

/** Opponent pieces that can *legally* capture on `square` (a pinned attacker cannot). */
function legalAttackers(board: Chess, square: Square): Square[] {
  const seen = new Set<Square>();
  for (const m of board.moves({ verbose: true })) {
    if (m.to === square) seen.add(m.from);
  }
  return [...seen];
}

/**
 * True if the move is a sound, intentional piece sacrifice: a non-pawn piece is
 * placed where a cheaper piece can take it, or where it is under-defended, with
 * a net material deficit of at least 150 cp (covers exchange sacrifices).
 */
export function detectSacrifice(fenBefore: string | null | undefined, uci: string | null | undefined): boolean {
  if (!fenBefore || !uci) return false;
  const board = loadBoard(fenBefore);
  if (!board) return false;
  const move = findLegalMove(board, uci);
  if (!move) return false;
  // Pawn gambits are not piece sacrifices.
  if (move.piece === "p") return false;

  const movingVal = pieceValue(move.piece);
  const capturedVal = move.captured && !move.isEnPassant() ? pieceValue(move.captured) : 0;
  if (move.captured && !move.isEnPassant() && capturedVal >= movingVal) return false;

  board.move(move.san);
  const dest = move.to;
  const attackers = legalAttackers(board, dest);
  if (!attackers.length) return false;

  const cheapest = Math.min(...attackers.map((sq) => pieceValue(board.get(sq)?.type)));
  const netGiven = movingVal - capturedVal;
  if (cheapest < movingVal && netGiven >= 150) return true;

  const friendly: Color = board.turn() === "w" ? "b" : "w";
  const defenders = board.attackers(dest, friendly);
  return attackers.length > defenders.length && netGiven >= 150;
}

/** Recaptures, equal trades and minor-for-minor trades are never "Great". */
function isRecaptureOrRoutineCapture(
  fenBefore: string | null | undefined,
  uci: string | null | undefined,
  prevMove: MoveData | null,
): boolean {
  if (prevMove && uci && uci.length >= 4 && prevMove.uci && prevMove.uci.length >= 4) {
    if (prevMove.uci.slice(2, 4) === uci.slice(2, 4)) return true;
  }
  if (!fenBefore || !uci) return false;
  const board = loadBoard(fenBefore);
  if (!board) return false;
  const move = findLegalMove(board, uci);
  if (!move || !move.captured) return false;
  if (move.isEnPassant()) return true;
  const movingVal = pieceValue(move.piece);
  const capturedVal = pieceValue(move.captured);
  if (capturedVal === movingVal) return true;
  return (move.piece === "n" || move.piece === "b") && (move.captured === "n" || move.captured === "b");
}

/** Mover's win chance of an engine line (lines are relative to the side to move, i.e. the mover). */
function lineWp(line: Pick<PvLine, "cp" | "mate">): number {
  return getWinProbability(line.cp, line.mate);
}

function secondBestPlayerWp(multiPvs: PvLine[] | undefined): number | null {
  if (!multiPvs || multiPvs.length < 2) return null;
  const { cp, mate } = multiPvs[1];
  if ((cp === null || cp === undefined) && (mate === null || mate === undefined)) return null;
  return lineWp(multiPvs[1]);
}

/**
 * A move whose engine line keeps all but this much win chance of the engine's
 * first choice (same search) counts as "Best": two moves the engine rates the
 * same are equally best, as on chess.com. One point is about 10 cp near equality.
 */
export const BEST_EQUIVALENT_LOSS = 0.01;

/**
 * Win chance (0..1) the mover gave away with `move`. `rawLoss` compares the
 * position before with the separate search after the move; two searches at
 * a fixed depth disagree by a few points, which used to turn engine moves
 * into "Good" or worse. When the played move is one of the engine's own lines
 * the loss is read from that one search instead: zero for its first choice,
 * the gap to the first line for an alternative. A move outside the listed
 * lines scored below every one of them, so it loses at least what the weakest
 * listed line loses.
 */
export function judgedLoss(move: Pick<MoveData, "uci" | "best_move" | "multi_pvs">, rawLoss: number): number {
  const lines = move.multi_pvs ?? [];
  if (move.best_move && move.uci === move.best_move) return 0;
  if (!lines.length || !lines[0].pv.length) return rawLoss;
  const best = lineWp(lines[0]);
  const k = lines.findIndex((l) => l.pv[0] === move.uci);
  if (k === 0) return 0;
  if (k > 0) return Math.max(0, best - lineWp(lines[k]));
  return Math.max(rawLoss, best - lineWp(lines[lines.length - 1]));
}

/**
 * Classifies a move in place (classification + German explanation). `wpl` is
 * the mover's win-chance loss, ideally from judgedLoss().
 * Priority: checkmate > missed mate > best move (Brilliant/Great/Best) > miss > blunder > WPL tiers.
 *
 * Thresholds follow chess.com's expected-points scale: Excellent < 2,
 * Good < 5, Inaccuracy < 10, Mistake < 20, Blunder from 20 points lost.
 */
export function classifyMove(
  move: MoveData,
  wpl: number,
  side: Side,
  multiPvs?: PvLine[],
  prevMove: MoveData | null = null,
): void {
  const wcBefore = side === "white" ? move.win_chance_before : 1.0 - move.win_chance_before;
  const wcAfter = side === "white" ? move.win_chance_after : 1.0 - move.win_chance_after;

  if (move.san && move.san.endsWith("#")) {
    move.classification = "Best";
    move.explanation = "Schachmatt gesetzt!";
    return;
  }

  const beforeMate = move.eval_before_mate;
  const afterMate = move.eval_after_mate;
  const playerHadMate =
    beforeMate !== null && ((side === "white" && beforeMate > 0) || (side === "black" && beforeMate < 0));

  if (playerHadMate) {
    const missedMate =
      side === "white" ? afterMate === null || afterMate < 0 : afterMate === null || afterMate > 0;
    if (missedMate) {
      move.classification = "Miss";
      move.explanation = "Erzwungenes Matt verpasst.";
      return;
    }
  }

  const engineFirst = move.uci === move.best_move;
  const playedLine = multiPvs ? multiPvs.findIndex((l) => l.pv[0] === move.uci) : -1;
  // An alternative the engine rates as high as its first choice is just as best.
  const equalAlternative = !engineFirst && playedLine > 0 && wpl <= BEST_EQUIVALENT_LOSS;

  if (engineFirst || equalAlternative) {
    const isSac = detectSacrifice(move.fen_before, move.uci);
    const leadsToMate =
      afterMate !== null && ((side === "white" && afterMate > 0) || (side === "black" && afterMate < 0));

    // A sacrifice is checked even in won positions; everything else there is simply "Best".
    if (wcAfter >= 0.99 && !isSac) {
      move.classification = "Best";
      move.explanation = equalAlternative ? "Gleich stark wie der Engine-Zug." : "Gewinnstellung gehalten.";
      return;
    }

    // In dead-won positions only a forcing sacrifice earns "Brilliant".
    const contextApproved = wcBefore < 0.95 || leadsToMate;
    if (isSac && contextApproved && wcAfter >= 0.4 && wpl <= 0.05) {
      let veto = false;
      // The strongest move the player did not choose.
      const altWp = engineFirst ? secondBestPlayerWp(multiPvs) : multiPvs?.[0] ? lineWp(multiPvs[0]) : null;
      if (altWp !== null) {
        if (altWp > wcAfter + 0.1) veto = true;
        if (wcBefore >= 0.95 && !leadsToMate && wcAfter - altWp < 0.05) veto = true;
      }
      if (!veto) {
        move.classification = "Brilliant";
        move.explanation = "Brillantes Opfer! Material geopfert für einen entscheidenden Vorteil.";
        return;
      }
    }

    if (engineFirst && wcAfter < 0.99) {
      const isRoutine = isRecaptureOrRoutineCapture(move.fen_before, move.uci, prevMove);
      let forcedOrTrivial = false;
      const board = move.fen_before ? loadBoard(move.fen_before) : null;
      if (board) {
        const legalCount = board.moves().length;
        forcedOrTrivial = legalCount <= 1 || (board.inCheck() && legalCount <= 2);
      }
      const sbWp = secondBestPlayerWp(multiPvs);
      if (!isRoutine && !forcedOrTrivial && sbWp !== null && multiPvs) {
        // Both lines come from the same search, so the gap is not search noise.
        const diff = lineWp(multiPvs[0]) - sbWp;
        if (diff >= 0.15) {
          move.classification = "Great";
          move.explanation = `Einziger guter Zug! Alternativen waren ${(diff * 100).toFixed(0)}% schlechter.`;
          return;
        }
      }
    }
    move.classification = "Best";
    move.explanation = equalAlternative ? "Gleich stark wie der Engine-Zug." : "Erste Wahl der Engine.";
    return;
  }

  // Noise guard: still +7 or more after the move is not game-altering.
  const afterCp = move.eval_after_cp;
  const stillCrushing =
    afterCp !== null && ((side === "white" && afterCp >= 700) || (side === "black" && afterCp <= -700));

  // A Miss lets a clearly better position slip back to roughly balanced
  // without actually losing it, so it is not a blunder.
  if (wcBefore >= 0.7 && wpl >= 0.15 && wcAfter >= 0.42 && !stillCrushing) {
    move.classification = "Miss";
    move.explanation = `Chance verpasst (Gewinnchance von ${(wcBefore * 100).toFixed(0)}% auf ${(wcAfter * 100).toFixed(0)}% gefallen).`;
    return;
  }

  if (wpl >= 0.2 && !stillCrushing) {
    move.classification = "Blunder";
    move.explanation = `Patzer! ${(wpl * 100).toFixed(1)}% Gewinnchance verloren.`;
    return;
  }

  if (wpl >= 0.1 && !stillCrushing) {
    move.classification = "Mistake";
    move.explanation = `Fehler (${(wpl * 100).toFixed(1)}% Gewinnchance verloren).`;
  } else if (wpl >= 0.05 && !stillCrushing) {
    move.classification = "Inaccuracy";
    move.explanation = `Ungenauigkeit (${(wpl * 100).toFixed(1)}% Gewinnchance verloren).`;
  } else if (wpl >= 0.02) {
    move.classification = "Good";
    move.explanation = "Solider Zug.";
  } else {
    move.classification = "Excellent";
    move.explanation = "Exzellenter Zug.";
  }
}
