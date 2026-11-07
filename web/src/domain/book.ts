// Port of src/backend/analysis/local_book.py on top of the precomputed opening
// tree (public/openings/book.json, built by scripts/prepare-assets.mjs from the
// Lichess ECO TSVs the desktop app ships).
import { Chess } from "chess.js";

import type { MoveData } from "./types";

/** key -> [eco, most specific opening name, child SANs] */
export type BookData = Record<string, [string, string, string[]]>;

export interface BookResult {
  is_book: boolean;
  current_eco?: string;
  current_opening?: string;
  book_move_count: number;
  book_exit_move?: number | null;
  candidate_moves: string[];
}

/** Position key without counters and en-passant field (must match prepare-assets.mjs). */
export function bookKey(fen: string): string {
  return fen.split(" ").slice(0, 3).join(" ");
}

/** Per-game stateful book detector: once a game leaves the book it stays out. */
export class OpeningBook {
  private count = 0;
  private exited = false;
  private exitMove: number | null = null;

  constructor(private data: BookData) {}

  reset(): void {
    this.count = 0;
    this.exited = false;
    this.exitMove = null;
  }

  processMove(fenBefore: string, uci: string, moveNumber: number): BookResult {
    if (this.exited) {
      return { is_book: false, book_move_count: this.count, book_exit_move: this.exitMove, candidate_moves: [] };
    }
    let fenAfter: string | null = null;
    try {
      const board = new Chess(fenBefore);
      board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      fenAfter = board.fen();
    } catch {
      fenAfter = null;
    }
    const node = fenAfter ? this.data[bookKey(fenAfter)] : undefined;
    if (!node) {
      this.exited = true;
      this.exitMove = moveNumber;
      return { is_book: false, book_move_count: this.count, book_exit_move: this.exitMove, candidate_moves: [] };
    }
    this.count += 1;
    return {
      is_book: true,
      current_eco: node[0],
      current_opening: node[1],
      book_move_count: this.count,
      candidate_moves: node[2],
    };
  }
}

let bookPromise: Promise<BookData> | null = null;

/** Loads the opening tree once; an empty book keeps analysis working offline without it. */
export function loadBookData(url = `${import.meta.env.BASE_URL}openings/book.json`): Promise<BookData> {
  if (!bookPromise) {
    bookPromise = fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<BookData>) : {}))
      .catch(() => ({}));
  }
  return bookPromise;
}

export interface OpeningAt {
  eco: string;
  /** Full book name, e.g. "Italian Game: Giuoco Piano". */
  name: string;
  /** Index in the given positions of the deepest book position. */
  index: number;
}

/**
 * Opening of a game or line: the name of the deepest book position among
 * `fens` (positions in playing order). Once a game leaves the book it keeps the
 * last name, the way players say "a Sicilian" for the whole game.
 */
export function openingOf(data: BookData | null, fens: string[]): OpeningAt | null {
  if (!data) return null;
  for (let k = fens.length - 1; k >= 0; k--) {
    const node = data[bookKey(fens[k])];
    if (node) return { eco: node[0], name: node[1], index: k };
  }
  return null;
}

function fenAfterMove(fen: string, uci: string): string | null {
  try {
    const b = new Chess(fen);
    b.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return b.fen();
  } catch {
    return null;
  }
}

/**
 * Re-reads the names of an analysed game's book moves from `data` (older
 * opening books named in-between positions after far deeper lines). Updates
 * the moves in place; returns the game's opening when anything changed.
 */
export function relabelBookMoves(moves: MoveData[], data: BookData): { eco: string; name: string } | null {
  let changed = false;
  let last: { eco: string; name: string } | null = null;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (!m.is_book_move) continue;
    const fen = moves[i + 1]?.fen_before ?? fenAfterMove(m.fen_before, m.uci);
    const node = fen ? data[bookKey(fen)] : undefined;
    if (!node) continue;
    if (m.eco !== node[0] || m.opening_name !== node[1]) {
      m.eco = node[0];
      m.opening_name = node[1];
      changed = true;
    }
    last = { eco: node[0], name: node[1] };
  }
  return changed ? last : null;
}
