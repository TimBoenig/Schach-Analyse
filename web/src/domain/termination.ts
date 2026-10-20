// Port of src/backend/storage/termination_detector.py: detects how a game
// ended and produces the same German descriptions as the desktop app.
//
// chess.js has no notion of "claimable" draws or python-chess' transposition
// history, so ReplayBoard re-implements exactly the python-chess rules the
// detector relies on (repetition window, fifty-move claims, insufficient
// material).

import { Chess, type Move, type Square } from "chess.js";

import type { MoveData } from "./types";

export const STANDARD_START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** python-chess Board.push(Move.null()): pass the turn, forfeit en passant. */
export function applyNullMove(fen: string): string {
  const parts = fen.split(" ");
  const black = parts[1] === "b";
  parts[1] = black ? "w" : "b";
  parts[3] = "-";
  parts[4] = String(Number(parts[4] ?? "0") + 1);
  if (black) parts[5] = String(Number(parts[5] ?? "1") + 1);
  return parts.join(" ");
}

/** Board + side to move + castling + legal en passant (chess.js only prints legal ep squares). */
export function positionKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

export function loadChess(fen: string): Chess {
  // skipValidation keeps parity with python-chess, which accepts any
  // parseable FEN (e.g. positions reached via a null move while in check).
  return new Chess(fen, { skipValidation: true });
}

interface HistoryEntry {
  key: string;
  irreversible: boolean; // whether the move *leading to* the next entry was irreversible
}

/** Replays UCI moves and answers the python-chess game-end questions. */
export class ReplayBoard {
  private chess: Chess;
  private history: HistoryEntry[] = [];

  constructor(fen: string = STANDARD_START_FEN) {
    this.chess = loadChess(fen);
  }

  fen(): string {
    return this.chess.fen();
  }

  /** Pushes a UCI move ("e2e4", "e7e8q", "0000"). Throws on illegal moves. */
  pushUci(uci: string): void {
    const before = this.chess.fen();
    if (uci === "0000") {
      this.history.push({ key: positionKey(before), irreversible: isIrreversible(before, null) });
      this.chess = loadChess(applyNullMove(before));
      return;
    }
    if (!/^[a-h][1-8][a-h][1-8][nbrqk]?$/.test(uci)) throw new Error(`invalid uci: ${uci}`);
    const promotion = uci.slice(4) || undefined;
    let move: Move;
    try {
      move = this.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion });
    } catch {
      throw new Error(`illegal uci: ${uci} in ${before}`);
    }
    // chess.js ignores a stray promotion suffix on ordinary moves; python-chess rejects it.
    if ((move.promotion ?? undefined) !== promotion) {
      this.chess.undo();
      throw new Error(`illegal uci: ${uci} in ${before}`);
    }
    this.history.push({ key: positionKey(before), irreversible: isIrreversible(before, move) });
  }

  isCheckmate(): boolean {
    return this.chess.isCheckmate();
  }

  isStalemate(): boolean {
    return this.chess.isStalemate();
  }

  isInsufficientMaterial(): boolean {
    return hasInsufficientMaterial(this.chess, "w") && hasInsufficientMaterial(this.chess, "b");
  }

  /** Keys of the positions in the current reversible window (oldest first, excluding current). */
  private windowKeys(): string[] {
    const keys: string[] = [];
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].irreversible) break;
      keys.push(this.history[i].key);
    }
    return keys;
  }

  /** python-chess Board.is_repetition(count). */
  isRepetition(count = 3): boolean {
    const key = positionKey(this.chess.fen());
    const occurrences = 1 + this.windowKeys().filter((k) => k === key).length;
    return occurrences >= count;
  }

  isFivefoldRepetition(): boolean {
    return this.isRepetition(5);
  }

  /** python-chess Board.can_claim_threefold_repetition(). */
  canClaimThreefoldRepetition(): boolean {
    const counts = new Map<string, number>();
    const current = positionKey(this.chess.fen());
    for (const k of [current, ...this.windowKeys()]) counts.set(k, (counts.get(k) ?? 0) + 1);
    if ((counts.get(current) ?? 0) >= 3) return true;
    for (const m of this.chess.moves({ verbose: true })) {
      if ((counts.get(positionKey(m.after)) ?? 0) >= 2) return true;
    }
    return false;
  }

  private halfmoveClock(): number {
    return Number(this.chess.fen().split(" ")[4] ?? "0");
  }

  private isHalfmoves(n: number): boolean {
    return this.halfmoveClock() >= n && this.chess.moves().length > 0;
  }

  isFiftyMoves(): boolean {
    return this.isHalfmoves(100);
  }

  isSeventyfiveMoves(): boolean {
    return this.isHalfmoves(150);
  }

  canClaimFiftyMoves(): boolean {
    if (this.isFiftyMoves()) return true;
    if (this.halfmoveClock() >= 99) {
      for (const m of this.chess.moves({ verbose: true })) {
        if (isZeroing(m)) continue;
        const after = loadChess(m.after);
        if (Number(m.after.split(" ")[4]) >= 100 && after.moves().length > 0) return true;
      }
    }
    return false;
  }
}

function isZeroing(m: Move): boolean {
  return m.piece === "p" || m.captured !== undefined;
}

/** python-chess Board.is_irreversible(): zeroing, castling-rights loss, or ceding a legal en passant. */
function isIrreversible(fenBefore: string, move: Move | null): boolean {
  const parts = fenBefore.split(" ");
  if (parts[3] !== "-") return true;
  if (move === null) return false;
  if (isZeroing(move)) return true;
  return move.after.split(" ")[2] !== parts[2];
}

const DARK = (sq: Square): boolean => {
  const file = sq.charCodeAt(0) - 97;
  const rank = Number(sq[1]) - 1;
  return (file + rank) % 2 === 0;
};

/** python-chess Board.has_insufficient_material(color). */
function hasInsufficientMaterial(chess: Chess, color: "w" | "b"): boolean {
  const pieces = chess.board().flat().filter((p) => p !== null);
  const own = pieces.filter((p) => p.color === color);
  const opp = pieces.filter((p) => p.color !== color);
  if (own.some((p) => p.type === "p" || p.type === "r" || p.type === "q")) return false;
  if (own.some((p) => p.type === "n")) {
    return own.length <= 2 && !opp.some((p) => p.type !== "k" && p.type !== "q");
  }
  if (own.some((p) => p.type === "b")) {
    const bishops = pieces.filter((p) => p.type === "b");
    const sameColor = bishops.every((b) => DARK(b.square)) || bishops.every((b) => !DARK(b.square));
    return sameColor && !pieces.some((p) => p.type === "p" || p.type === "n");
  }
  return true;
}

export type TerminationMoves = Pick<MoveData, "uci" | "ply" | "time_left">[];

/** Returns [termination_mode, termination_description]. */
export function detectTermination(
  headers: Record<string, string>,
  moves: TerminationMoves,
  startingFen: string | null = null,
  chess960 = false,
): [string, string] {
  // Chess960 games are rejected at PGN import; the flag is kept for API parity.
  void chess960;
  const result = (headers.Result ?? "*").trim();
  const termLower = (headers.Termination ?? "").trim().toLowerCase();
  const white = headers.White ?? "Weiß";
  const black = headers.Black ?? "Schwarz";

  const board = new ReplayBoard(startingFen || STANDARD_START_FEN);
  for (const m of moves) {
    try {
      board.pushUci(m.uci);
    } catch {
      break;
    }
  }

  let winnerName: string | null = null;
  if (result === "1-0") winnerName = white;
  else if (result === "0-1") winnerName = black;

  // 1. Authoritative board states
  if (board.isCheckmate()) {
    if (result === "1-0") return ["checkmate", `${white} gewinnt durch Schachmatt`];
    if (result === "0-1") return ["checkmate", `${black} gewinnt durch Schachmatt`];
    return ["checkmate", "Partie durch Schachmatt entschieden"];
  }
  if (board.isStalemate()) return ["stalemate", "Remis durch Patt"];
  if (board.isInsufficientMaterial()) {
    return ["insufficient_material", "Remis durch ungenügendes Material"];
  }
  if (
    board.isFivefoldRepetition() ||
    board.canClaimThreefoldRepetition() ||
    board.isRepetition(3)
  ) {
    return ["threefold_repetition", "Remis durch Stellungswiederholung"];
  }
  if (board.isSeventyfiveMoves() || board.canClaimFiftyMoves() || board.isFiftyMoves()) {
    return ["fifty_moves", "Remis durch 50-Züge-Regel"];
  }

  // 2. Explicit PGN headers (Chess.com / Lichess strings, or stored German descriptions)
  const has = (...kws: string[]) => kws.some((kw) => termLower.includes(kw));
  if (has("resign", "aufgabe")) {
    if (winnerName) return ["resignation", `${winnerName} gewinnt durch Aufgabe`];
    return ["resignation", "Partie durch Aufgabe entschieden"];
  }
  if (has("time", "clock", "timeout", "flag", "forfeit", "zeit")) {
    if (result === "1/2-1/2" || result === "Draw") {
      return ["timeout_insufficient", "Remis durch Zeitüberschreitung (ungenügendes Material)"];
    }
    if (winnerName) return ["timeout", `${winnerName} gewinnt durch Zeitüberschreitung`];
    return ["timeout", "Partie durch Zeitüberschreitung entschieden"];
  }
  if (has("abandoned", "disconnected", "left the game", "abgebrochen")) {
    if (winnerName) return ["abandonment", `${winnerName} gewinnt – Partie abgebrochen`];
    return ["abandonment", "Partie abgebrochen"];
  }
  if (has("rules", "cheat", "disqualif", "regelverstoß")) {
    if (winnerName) return ["rules_violation", `${winnerName} gewinnt durch Regelverstoß`];
    return ["rules_violation", "Partie durch Regelverstoß entschieden"];
  }
  if (has("repetition", "wiederholung")) {
    return ["threefold_repetition", "Remis durch Stellungswiederholung"];
  }
  if (has("50-move", "fifty-move", "50-züge")) return ["fifty_moves", "Remis durch 50-Züge-Regel"];
  if (has("insufficient", "ungenügend")) {
    return ["insufficient_material", "Remis durch ungenügendes Material"];
  }
  if (has("agreed", "agreement", "mutual", "einigung")) {
    return ["agreed_draw", "Remis durch Einigung"];
  }

  // 3. Fallback: a losing side whose last clock reads zero lost on time.
  // The ply parity mirrors the desktop app exactly (even ply = White's move),
  // so both apps classify the same stored game identically.
  if (moves.length) {
    const lastClock = (parity: number): number | null | undefined => {
      const clocks = moves.filter((m) => m.ply % 2 === parity && m.time_left != null);
      return clocks.length ? clocks[clocks.length - 1].time_left : undefined;
    };
    if (result === "1-0" && lastClock(0) === 0) {
      return ["timeout", `${white} gewinnt durch Zeitüberschreitung`];
    }
    if (result === "0-1" && lastClock(1) === 0) {
      return ["timeout", `${black} gewinnt durch Zeitüberschreitung`];
    }
  }

  if (result === "1-0") return ["resignation", `${white} gewinnt durch Aufgabe`];
  if (result === "0-1") return ["resignation", `${black} gewinnt durch Aufgabe`];
  if (result === "1/2-1/2" || result === "Draw") return ["agreed_draw", "Remis durch Einigung"];
  return ["unterminated", "Partie nicht beendet"];
}
