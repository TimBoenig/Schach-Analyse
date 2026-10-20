// Port of src/backend/analysis/local_book.py on top of the precomputed opening
// tree (public/openings/book.json, built by scripts/prepare-assets.mjs from the
// Lichess ECO TSVs the desktop app ships).
import { Chess } from "chess.js";

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
