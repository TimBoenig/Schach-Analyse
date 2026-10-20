// Port of src/backend/analysis/move_classifier.py: classifies moves
// (Brilliant, Blunder, ...) from Win Probability Loss plus special cases.
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

function secondBestPlayerWp(multiPvs: PvLine[] | undefined, side: Side): number | null {
  if (!multiPvs || multiPvs.length < 2) return null;
  const { cp, mate } = multiPvs[1];
  if ((cp === null || cp === undefined) && (mate === null || mate === undefined)) return null;
  // Multi-PV scores are relative to the side to move.
  const normCp = side === "black" && cp !== null && cp !== undefined ? -cp : cp;
  const normMate = side === "black" && mate !== null && mate !== undefined ? -mate : mate;
  const wp = getWinProbability(normCp, normMate);
  return side === "white" ? wp : 1.0 - wp;
}

/**
 * Classifies a move in place (classification + German explanation).
 * Priority: checkmate > missed mate > winning position > best move > miss > blunder > WPL tiers.
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
  const isBestChoice = move.uci === move.best_move;
  const isSacrificeCandidate = isBestChoice && detectSacrifice(move.fen_before, move.uci);

  if (playerHadMate) {
    const missedMate =
      side === "white" ? afterMate === null || afterMate < 0 : afterMate === null || afterMate > 0;
    if (missedMate) {
      move.classification = "Miss";
      move.explanation = "Erzwungenes Matt verpasst.";
      return;
    }
    if (!(move.uci !== move.best_move && wcAfter >= 0.99) && wcAfter >= 0.99 && !isSacrificeCandidate) {
      move.classification = "Best";
      move.explanation = "Gewinnstellung gehalten.";
      return;
    }
  }

  if (wcAfter >= 0.99 && !isSacrificeCandidate && !(playerHadMate && move.uci !== move.best_move)) {
    move.classification = "Best";
    move.explanation = "Gewinnstellung gehalten.";
    return;
  }

  if (isBestChoice) {
    const isSac = detectSacrifice(move.fen_before, move.uci);
    const competitiveAfter = wcAfter >= 0.4;
    const soundEval = wpl <= 0.05;
    const leadsToMate =
      afterMate !== null && ((side === "white" && afterMate > 0) || (side === "black" && afterMate < 0));
    // In dead-won positions only a forcing sacrifice earns "Brilliant".
    const contextApproved = wcBefore < 0.95 || leadsToMate;

    if (isSac && contextApproved && competitiveAfter && soundEval) {
      let veto = false;
      const sbWp = secondBestPlayerWp(multiPvs, side);
      if (sbWp !== null) {
        if (sbWp > wcAfter + 0.1) veto = true;
        if (wcBefore >= 0.95 && !leadsToMate && wcAfter - sbWp < 0.05) veto = true;
      }
      if (!veto) {
        move.classification = "Brilliant";
        move.explanation = "Brillantes Opfer! Material geopfert für einen entscheidenden Vorteil.";
        return;
      }
    }

    const isRoutine = isRecaptureOrRoutineCapture(move.fen_before, move.uci, prevMove);
    let forcedOrTrivial = false;
    const board = move.fen_before ? loadBoard(move.fen_before) : null;
    if (board) {
      const legalCount = board.moves().length;
      forcedOrTrivial = legalCount <= 1 || (board.inCheck() && legalCount <= 2);
    }
    if (!isRoutine && !forcedOrTrivial) {
      const sbWp = secondBestPlayerWp(multiPvs, side);
      if (sbWp !== null) {
        const diff = wcAfter - sbWp;
        if (diff >= 0.15) {
          move.classification = "Great";
          move.explanation = `Einziger guter Zug! Alternativen waren ${(diff * 100).toFixed(0)}% schlechter.`;
          return;
        }
      }
    }
    move.classification = "Best";
    move.explanation = "Erste Wahl der Engine.";
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

  const isBlunder = ((wpl >= 0.25 && wcAfter < 0.6) || (wpl >= 0.2 && wcAfter < 0.35)) && !stillCrushing;
  if (isBlunder) {
    move.classification = "Blunder";
    move.explanation = `Patzer! ${(wpl * 100).toFixed(1)}% Gewinnchance verloren.`;
    return;
  }

  if (wcBefore >= 0.7 && wcAfter < 0.42 && wpl >= 0.25 && !stillCrushing) {
    move.classification = "Miss";
    move.explanation = `Gewinn verpasst (Gewinnchance von ${(wcBefore * 100).toFixed(0)}% auf ${(wcAfter * 100).toFixed(0)}% gefallen).`;
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
