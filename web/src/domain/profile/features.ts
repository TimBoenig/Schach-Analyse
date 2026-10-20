// Per-game feature extraction for the player profile
// (port of src/backend/analysis/profile/features.py).
//
// Turns a stored game into move-level events from the tracked player's
// perspective: errors with their context (winning/losing, time trouble, right
// after leaving the book), punished or missed opponent errors, and style
// signals (checks, pawn storms, trades, castling).

import { GameRecord, parseMoves, type RawGame } from "../metrics/models";
import {
  BLACK,
  Board,
  KING,
  type Move,
  moveFromUci,
  PAWN,
  QUEEN,
  squareFile,
  squareRank,
  WHITE,
} from "../tactics/board";
import { DEFAULT_TROUBLE_SECONDS, PIECE_VALUES, TROUBLE_SECONDS } from "../tactics/constants";
import { classifyGamePhase } from "../tactics/phase";

export const ERROR_CLASSES: ReadonlySet<string> = new Set([
  "Inaccuracy",
  "Mistake",
  "Blunder",
  "Miss",
]);
export const SERIOUS_ERROR_CLASSES: ReadonlySet<string> = new Set(["Mistake", "Blunder", "Miss"]);
export const GOOD_CLASSES: ReadonlySet<string> = new Set([
  "Brilliant",
  "Great",
  "Best",
  "Excellent",
]);

// A drop of 10 percentage points in winning chances is roughly where chess.com
// starts calling a move a mistake; below that we treat a reply as "kept the gain".
export const PUNISH_KEEP_THRESHOLD = 0.1;
// Opponent moves losing >= 15 points of winning chance count as a chance to punish.
export const OPPONENT_ERROR_THRESHOLD = 0.15;

const HEADER_RE = /\[(\w+)\s+"([^"]*)"\]/g;

/** Convert a White-perspective win probability into the tracked player's perspective. */
export function userWp(whiteWp: number | null | undefined, isWhite: boolean): number {
  const wp = whiteWp === null || whiteWp === undefined ? 0.5 : Number(whiteWp);
  return isWhite ? wp : 1 - wp;
}

function sameMove(a: Move, b: Move): boolean {
  return a.from === b.from && a.to === b.to && (a.promotion ?? null) === (b.promotion ?? null);
}

function isLegal(board: Board, move: Move): boolean {
  return board.legalMoves().some((m) => sameMove(m, move));
}

/** Render an engine UCI move as SAN for display; falls back to the raw UCI. */
export function sanForUci(fen: string, uci: string | null | undefined, _chess960 = false): string {
  if (!uci || !fen) return uci || "";
  try {
    const board = new Board(fen);
    const move = moveFromUci(uci);
    if (!isLegal(board, move)) return uci;
    return board.san(move);
  } catch {
    return uci;
  }
}

export function moveLabel(moveNumber: number, isWhiteMove: boolean, san: string): string {
  return isWhiteMove ? `${moveNumber}. ${san}` : `${moveNumber}... ${san}`;
}

function parseUtc(dateStr: string, timeStr: string | null): number | null {
  const d = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(dateStr);
  if (!d) return null;
  const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])];
  let h = 0;
  let mi = 0;
  let s = 0;
  if (timeStr !== null) {
    const t = /^(\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(timeStr);
    if (!t) return null;
    [h, mi, s] = [Number(t[1]), Number(t[2]), Number(t[3])];
    if (h > 23 || mi > 59 || s > 61) return null;
  }
  const dt = new Date(Date.UTC(y, mo - 1, da, h, mi, s));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== da) return null;
  return dt.getTime() / 1000;
}

/**
 * Best-effort start time of the game as a UTC epoch (seconds).
 *
 * The stored 'timestamp' is the save time, not the play time, so session and
 * trend analysis must use the PGN UTCDate/UTCTime headers instead.
 */
export function parsePlayedAt(game: RawGame): number | null {
  const headers: Record<string, string> = {};
  let count = 0;
  for (const m of (game.pgn || "").matchAll(HEADER_RE)) {
    if (count++ >= 40) break;
    headers[m[1]] = m[2];
  }
  let dateStr = headers.UTCDate || game.date || headers.Date || "";
  const timeStr = headers.UTCTime || headers.StartTime || "12:00:00";
  dateStr = dateStr.replace(/-/g, ".");
  if (!/^\d{4}\.\d{2}\.\d{2}$/.test(dateStr)) return null;
  return parseUtc(dateStr, timeStr.slice(0, 8)) ?? parseUtc(dateStr, null);
}

function intOrZero(val: unknown): number {
  const s = String(val ?? "").trim();
  return /^[+-]?\d+$/.test(s) ? parseInt(s, 10) : 0;
}

/** One analyzed move by the tracked player. */
export class MoveEvent {
  constructor(
    public ply_index: number,
    public move_number: number,
    public san: string,
    public uci: string,
    public fen_before: string,
    public classification: string,
    public phase: string,
    public wp_before: number,
    public wp_after: number,
    public best_move_uci: string | null,
    public time_spent: number | null,
    public time_left: number | null,
    public is_book: boolean,
    public after_opponent_error: boolean,
    public in_time_trouble: boolean,
    public moves_since_book: number, // user moves since leaving theory (0 = first non-book move)
  ) {}

  get wp_drop(): number {
    return Math.max(0, this.wp_before - this.wp_after);
  }
  get is_error(): boolean {
    return ERROR_CLASSES.has(this.classification);
  }
  get is_serious_error(): boolean {
    return SERIOUS_ERROR_CLASSES.has(this.classification);
  }
}

export class GameFeatures {
  plies = 0;
  moves: MoveEvent[] = [];
  checks = 0;
  captures = 0;
  equal_trades = 0;
  pawn_storm_moves = 0;
  castle_side: "kingside" | "queenside" | null = null;
  castle_move: number | null = null;
  early_queen = false;
  queens_off_by_move: number | null = null;
  punish_chances = 0;
  punished = 0;
  reached_endgame = false;
  end_clock_fraction: number | null = null; // clock left at the end / clock at start
  wp_volatility = 0;
  /** True when the PGN carries a real start time (needed for time-of-day and session analysis). */
  time_known = false;
  /** SAN of the first two plies from the standard start position (empty for set-up positions). */
  first_sans: string[] = [];

  constructor(
    public rec: GameRecord,
    public game_id: string,
    public played_at: number | null,
    public date: string,
    public user_rating: number,
    public opp_rating: number,
    public chess960: boolean,
  ) {}

  get analyzed(): boolean {
    return this.rec.game_acc > 0 && this.moves.some((m) => m.classification);
  }
  get user_move_count(): number {
    return this.moves.length;
  }
  /** 1 for a win, 0.5 for a draw, 0 for a loss, null if unfinished. */
  get score(): number | null {
    if (this.rec.is_win) return 1;
    if (this.rec.is_draw) return 0.5;
    if (this.rec.is_loss) return 0;
    return null;
  }
  errors(seriousOnly = false): MoveEvent[] {
    return this.moves.filter((m) => (seriousOnly ? m.is_serious_error : m.is_error));
  }
}

function troubleThreshold(speed: string): number {
  const cat = (speed || "").toLowerCase();
  for (const [key, seconds] of Object.entries(TROUBLE_SECONDS)) {
    if (cat.includes(key)) return seconds;
  }
  return DEFAULT_TROUBLE_SECONDS;
}

const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

/** Build GameFeatures for one stored game from the tracked player's perspective. */
export function extractFeatures(
  game: RawGame,
  userColor: "white" | "black",
  rec?: GameRecord,
): GameFeatures {
  const record = rec ?? GameRecord.fromDict(game, userColor);
  const isWhite = userColor === "white";
  const chess960 = Boolean(game.chess960);

  const feats = new GameFeatures(
    record,
    String(game.id || ""),
    parsePlayedAt(game),
    String(game.date || ""),
    intOrZero(isWhite ? game.white_elo : game.black_elo),
    intOrZero(isWhite ? game.black_elo : game.white_elo),
    chess960,
  );

  feats.time_known = /\[(UTCTime|StartTime)\s+"\d/.test(game.pgn || "");
  const moves = parseMoves(game.moves_json);
  feats.plies = moves.length;
  if (!moves.length) return feats;
  if (!game.starting_fen && !chess960) feats.first_sans = moves.slice(0, 2).map((m) => m.san || "");

  const trouble = troubleThreshold(record.speed);
  let startClock: number | null = null;
  let lastClock: number | null = null;
  let prevOppDrop = 0;
  let userMovesSeen = 0;
  let bookExitUserMove: number | null = null;
  const wpChanges: number[] = [];

  moves.forEach((md, idx) => {
    const fen = md.fen_before || "";
    let board: Board;
    try {
      board = fen ? new Board(fen) : new Board();
    } catch {
      return; // invalid FEN: skip this move
    }

    const moverIsWhite = board.turn === WHITE;
    const wpB = userWp(md.win_chance_before, isWhite);
    const wpA = userWp(md.win_chance_after, isWhite);
    wpChanges.push(Math.abs(wpA - wpB));

    const queensOff = !board.pieces(QUEEN, WHITE).length && !board.pieces(QUEEN, BLACK).length;
    if (feats.queens_off_by_move === null && queensOff) {
      feats.queens_off_by_move = Number(md.move_number) || Math.floor(idx / 2) + 1;
    }

    if (moverIsWhite !== isWhite) {
      // Opponent move: remember how much it cost them (= our chance to punish).
      prevOppDrop = Math.max(0, wpA - wpB);
      return;
    }

    const isBook = Boolean(md.is_book_move);
    const phase = classifyGamePhase(board, idx, isBook);
    if (phase === "endgame") feats.reached_endgame = true;
    if (!isBook && bookExitUserMove === null) bookExitUserMove = userMovesSeen;

    const uci = md.uci || "";
    let moveObj: Move | null = null;
    try {
      moveObj = uci ? moveFromUci(uci) : board.parseSan(md.san || "");
    } catch {
      moveObj = null;
    }
    if (moveObj !== null && isLegal(board, moveObj)) {
      recordStyle(board, moveObj, userMovesSeen, feats, isWhite);
    }

    const timeLeft = numOrNull(md.time_left);
    if (timeLeft !== null) {
      if (startClock === null) startClock = timeLeft + (Number(md.time_spent) || 0);
      lastClock = timeLeft;
    }

    const afterOppError = prevOppDrop >= OPPONENT_ERROR_THRESHOLD;
    const classification = md.classification || "";
    if (afterOppError && classification) {
      feats.punish_chances += 1;
      if (Math.max(0, wpB - wpA) < PUNISH_KEEP_THRESHOLD) feats.punished += 1;
    }

    feats.moves.push(
      new MoveEvent(
        idx,
        Number(md.move_number) || Math.floor(idx / 2) + 1,
        md.san || "",
        uci,
        fen,
        classification,
        phase,
        wpB,
        wpA,
        md.best_move ?? null,
        numOrNull(md.time_spent),
        timeLeft,
        isBook,
        afterOppError,
        timeLeft !== null && timeLeft <= trouble,
        bookExitUserMove === null ? -1 : userMovesSeen - bookExitUserMove,
      ),
    );
    userMovesSeen += 1;
    prevOppDrop = 0;
  });

  if (startClock && lastClock !== null && startClock > 0) {
    feats.end_clock_fraction = Math.max(0, Math.min(1, lastClock / startClock));
  }
  if (wpChanges.length) feats.wp_volatility = wpChanges.reduce((s, v) => s + v, 0) / wpChanges.length;
  return feats;
}

/** Collect cheap style signals for one of the player's moves. */
function recordStyle(
  board: Board,
  move: Move,
  userMoveIndex: number,
  feats: GameFeatures,
  isWhite: boolean,
): void {
  const piece = board.pieceAt(move.from);
  if (piece === null) return;

  if (piece.type === KING && Math.abs(squareFile(move.to) - squareFile(move.from)) === 2) {
    if (feats.castle_side === null) {
      feats.castle_side = squareFile(move.to) > squareFile(move.from) ? "kingside" : "queenside";
      feats.castle_move = userMoveIndex + 1;
    }
    return;
  }

  const after = board.copy();
  after.push(move);
  if (after.isCheck()) feats.checks += 1;

  const isCapture = board.isCapture(move);
  if (isCapture) {
    feats.captures += 1;
    const victim = board.pieceAt(move.to);
    if (victim !== null && PIECE_VALUES[victim.type] === PIECE_VALUES[piece.type]) {
      feats.equal_trades += 1;
    }
  }

  if (piece.type === QUEEN && userMoveIndex < 6 && !isCapture) feats.early_queen = true;

  if (piece.type === PAWN) {
    const enemyKing = board.king(!board.turn);
    if (enemyKing !== null) {
      const toRank = squareRank(move.to);
      const relRank = isWhite ? toRank : 7 - toRank;
      const fileGap = Math.abs(squareFile(move.to) - squareFile(enemyKing));
      // Pawns pushed to the 4th rank or beyond next to the enemy king = pawn storm.
      if (relRank >= 3 && fileGap <= 1 && userMoveIndex >= 5) feats.pawn_storm_moves += 1;
    }
  }
}
