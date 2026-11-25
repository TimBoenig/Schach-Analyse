// Pure rules of the position editor on the free board: turning a piece placement plus
// side to move and castling rights into a FEN, and checking that it is a position the
// engine and the rules code can work with. No UI here, so it is unit-tested in Node.
import { Chess } from "chess.js";

/** Square name -> FEN piece letter ("P" white pawn, "k" black king, ...). */
export type Pieces = Map<string, string>;
export type Castling = { K: boolean; Q: boolean; k: boolean; q: boolean };
export type Turn = "w" | "b";

export interface EditorPosition {
  pieces: Pieces;
  turn: Turn;
  castling: Castling;
}

/** Ids only; the UI turns them into (translated) sentences. */
export type PositionProblem =
  | "no-white-king"
  | "no-black-king"
  | "many-white-kings"
  | "many-black-kings"
  | "pawn-on-edge"
  | "too-many-white-pieces"
  | "too-many-black-pieces"
  | "too-many-white-pawns"
  | "too-many-black-pawns"
  | "kings-touch"
  | "opponent-in-check"
  | "invalid";

const FILES = "abcdefgh";
export const EMPTY_CASTLING: Castling = { K: false, Q: false, k: false, q: false };

/** Pieces of the FEN's placement field; tolerates junk instead of throwing. */
export function parsePieces(placement: string): Pieces {
  const out: Pieces = new Map();
  const rows = placement.split("/");
  for (let r = 0; r < 8 && r < rows.length; r++) {
    let file = 0;
    for (const ch of rows[r]) {
      if (file > 7) break;
      if (ch >= "1" && ch <= "8") file += Number(ch);
      else {
        if ("pnbrqkPNBRQK".includes(ch)) out.set(FILES[file] + (8 - r), ch);
        file++;
      }
    }
  }
  return out;
}

export function positionFromFen(fen: string): EditorPosition {
  const [placement = "", turn = "w", rights = "-"] = fen.trim().split(/\s+/);
  return {
    pieces: parsePieces(placement),
    turn: turn === "b" ? "b" : "w",
    castling: { K: rights.includes("K"), Q: rights.includes("Q"), k: rights.includes("k"), q: rights.includes("q") },
  };
}

/** Castling is only possible while king and rook still stand on their home squares. */
export function availableCastling(pieces: Pieces): Castling {
  return {
    K: pieces.get("e1") === "K" && pieces.get("h1") === "R",
    Q: pieces.get("e1") === "K" && pieces.get("a1") === "R",
    k: pieces.get("e8") === "k" && pieces.get("h8") === "r",
    q: pieces.get("e8") === "k" && pieces.get("a8") === "r",
  };
}

/** The rights that may actually be set: those requested and still possible. */
export function effectiveCastling(pos: EditorPosition): Castling {
  const ok = availableCastling(pos.pieces);
  return { K: pos.castling.K && ok.K, Q: pos.castling.Q && ok.Q, k: pos.castling.k && ok.k, q: pos.castling.q && ok.q };
}

export function toFen(pos: EditorPosition): string {
  const rows: string[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = "";
    let gap = 0;
    for (const f of FILES) {
      const p = pos.pieces.get(f + rank);
      if (p) {
        if (gap) row += gap;
        gap = 0;
        row += p;
      } else gap++;
    }
    rows.push(row + (gap || ""));
  }
  const c = effectiveCastling(pos);
  const rights = (c.K ? "K" : "") + (c.Q ? "Q" : "") + (c.k ? "k" : "") + (c.q ? "q" : "") || "-";
  return `${rows.join("/")} ${pos.turn} ${rights} - 0 1`;
}

function count(pieces: Pieces, letter: string): number {
  let n = 0;
  for (const p of pieces.values()) if (p === letter) n++;
  return n;
}

/** Why a position cannot be analysed; empty when it is fine. */
export function checkPosition(pos: EditorPosition): PositionProblem[] {
  const out: PositionProblem[] = [];
  const { pieces } = pos;
  const wk = count(pieces, "K");
  const bk = count(pieces, "k");
  if (wk === 0) out.push("no-white-king");
  if (bk === 0) out.push("no-black-king");
  if (wk > 1) out.push("many-white-kings");
  if (bk > 1) out.push("many-black-kings");
  for (const [sq, p] of pieces) {
    if ((p === "P" || p === "p") && (sq[1] === "1" || sq[1] === "8")) {
      out.push("pawn-on-edge");
      break;
    }
  }
  const total = (white: boolean) => [...pieces.values()].filter((p) => (p === p.toUpperCase()) === white).length;
  if (total(true) > 16) out.push("too-many-white-pieces");
  if (total(false) > 16) out.push("too-many-black-pieces");
  // Eight pawns plus promoted pieces cannot exceed 16 men, but nine pawns are impossible by themselves.
  if (count(pieces, "P") > 8) out.push("too-many-white-pawns");
  if (count(pieces, "p") > 8) out.push("too-many-black-pawns");
  if (wk === 1 && bk === 1) {
    const [a] = [...pieces].find(([, p]) => p === "K")!;
    const [b] = [...pieces].find(([, p]) => p === "k")!;
    if (Math.abs(FILES.indexOf(a[0]) - FILES.indexOf(b[0])) <= 1 && Math.abs(Number(a[1]) - Number(b[1])) <= 1) out.push("kings-touch");
  }
  if (out.length) return out;
  // The side that just moved cannot be left in check: looking at the position with the
  // other side to move shows whether the one waiting is attacked.
  try {
    const other = toFen({ ...pos, turn: pos.turn === "w" ? "b" : "w", castling: EMPTY_CASTLING });
    if (new Chess(other).inCheck()) out.push("opponent-in-check");
    else new Chess(toFen(pos));
  } catch {
    out.push("invalid");
  }
  return out;
}

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/**
 * Reads typed or pasted FEN text for the editor. Stricter than `parsePieces` about the
 * board (eight rows of eight squares), looser about the rest: a bare placement works,
 * move counters are ignored. Null when the text is not a board at all.
 */
export function parseEditorFen(text: string): EditorPosition | null {
  const fields = text.trim().split(/\s+/);
  const rows = (fields[0] ?? "").split("/");
  if (rows.length !== 8) return null;
  for (const row of rows) {
    let width = 0;
    for (const ch of row) {
      if (ch >= "1" && ch <= "8") width += Number(ch);
      else if ("pnbrqkPNBRQK".includes(ch)) width++;
      else return null;
    }
    if (width !== 8) return null;
  }
  const turn = fields[1];
  if (turn !== undefined && turn !== "w" && turn !== "b") return null;
  return positionFromFen(fields.slice(0, 3).join(" "));
}

/** The editor's own pieces: set a piece (kings are unique per side), or clear a square. */
export function setPiece(pieces: Pieces, square: string, letter: string | null): Pieces {
  const next = new Map(pieces);
  if (letter === null) {
    next.delete(square);
    return next;
  }
  if (letter === "K" || letter === "k") for (const [sq, p] of next) if (p === letter) next.delete(sq);
  next.set(square, letter);
  return next;
}
