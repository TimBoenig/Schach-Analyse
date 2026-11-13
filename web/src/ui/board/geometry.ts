// Pure board geometry for the chessboard component: reading the piece placement,
// screen positions, keeping piece identities across positions (so a moved piece
// slides instead of blinking), arrow shapes and arrow snapping.
// No DOM access here, so all of it is unit-tested in Node.

export const FILES = "abcdefgh";

/** Square name -> FEN piece letter ("P" white pawn, "k" black king, ...). */
export type Placement = Map<string, string>;

/** Pieces of the FEN's placement field; tolerates junk instead of throwing. */
export function readPlacement(fen: string): Placement {
  const out: Placement = new Map();
  const rows = (fen.split(" ")[0] ?? "").split("/");
  for (let r = 0; r < 8 && r < rows.length; r++) {
    let file = 0;
    for (const ch of rows[r]) {
      if (file > 7) break;
      if (ch >= "1" && ch <= "8") file += Number(ch);
      else if ("pnbrqkPNBRQK".includes(ch)) {
        out.set(FILES[file] + (8 - r), ch);
        file++;
      } else file++;
    }
  }
  return out;
}

export function isSquare(s: string | null | undefined): s is string {
  return !!s && s.length === 2 && FILES.includes(s[0]) && s[1] >= "1" && s[1] <= "8";
}

/** Column and row on screen (0..7 from the top left) of a square. */
export function screenPos(sq: string, flipped: boolean): [number, number] {
  const file = FILES.indexOf(sq[0]);
  const rank = Number(sq[1]) - 1;
  return flipped ? [7 - file, rank] : [file, 7 - rank];
}

export function squareAtScreen(col: number, row: number, flipped: boolean): string | null {
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  return flipped ? FILES[7 - col] + (row + 1) : FILES[col] + (8 - row);
}

/** Square under a point given in board fractions (0..1 from the top left). */
export function squareAtFraction(fx: number, fy: number, flipped: boolean): string | null {
  if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return null;
  return squareAtScreen(Math.floor(fx * 8), Math.floor(fy * 8), flipped);
}

export function isWhitePiece(letter: string): boolean {
  return letter === letter.toUpperCase();
}

export interface PlacedPiece {
  id: number;
  piece: string;
  square: string;
}

/**
 * Carries piece identities from the previous position to the next one. A piece
 * that stayed keeps its id; a piece that vanished is matched to the nearest new
 * square holding the same piece (that is the move, so it can slide there); the
 * rest are new (captures disappear, promotions appear). Squares in `fresh` always
 * get a new id: a piece the player dropped there by hand must not slide again.
 */
export function carryPieces(prev: PlacedPiece[], next: Placement, newId: () => number, fresh: ReadonlySet<string> = new Set()): PlacedPiece[] {
  const out: PlacedPiece[] = [];
  const leftover: PlacedPiece[] = [];
  const open = new Map(next);
  for (const p of prev) {
    if (open.get(p.square) === p.piece && !fresh.has(p.square)) {
      out.push(p);
      open.delete(p.square);
    } else leftover.push(p);
  }
  // Closest pairs first, so two knights of the same colour each take their own move.
  const pairs: { d: number; from: PlacedPiece; to: string }[] = [];
  for (const [sq, piece] of open) {
    if (fresh.has(sq)) continue;
    for (const p of leftover) {
      if (p.piece !== piece) continue;
      const [x1, y1] = screenPos(p.square, false);
      const [x2, y2] = screenPos(sq, false);
      pairs.push({ d: Math.hypot(x2 - x1, y2 - y1), from: p, to: sq });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const used = new Set<number>();
  for (const { from, to } of pairs) {
    if (used.has(from.id) || !open.has(to)) continue;
    used.add(from.id);
    open.delete(to);
    out.push({ id: from.id, piece: from.piece, square: to });
  }
  for (const [sq, piece] of open) out.push({ id: newId(), piece, square: sq });
  // Stable order keeps the DOM nodes in place, so their slide transitions are not restarted.
  return out.sort((a, b) => a.id - b.id);
}

export function isKnightJump(from: string, to: string): boolean {
  const dx = Math.abs(FILES.indexOf(from[0]) - FILES.indexOf(to[0]));
  const dy = Math.abs(Number(from[1]) - Number(to[1]));
  return (dx === 1 && dy === 2) || (dx === 2 && dy === 1);
}

/**
 * Target of a hand-drawn arrow: the square on a queen line or a knight jump from
 * `from` that lies closest to the pointer (in board squares, fractional). Drawing
 * "roughly towards c4" then lands on a square a piece could actually reach.
 */
export function snapTarget(from: string, px: number, py: number, flipped: boolean): string {
  const [fx, fy] = screenPos(from, flipped);
  let best = from;
  let bestD = Math.hypot(px - (fx + 0.5), py - (fy + 0.5));
  for (let col = 0; col < 8; col++) {
    for (let row = 0; row < 8; row++) {
      const dx = col - fx;
      const dy = row - fy;
      const line = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
      const knight = (Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1);
      if (!line && !knight) continue;
      const d = Math.hypot(px - (col + 0.5), py - (row + 0.5));
      if (d < bestD) {
        bestD = d;
        best = squareAtScreen(col, row, flipped)!;
      }
    }
  }
  return best;
}

export interface ArrowGeometry {
  /** Polyline of the shaft in board squares (screen orientation), ending where the head starts. */
  shaft: [number, number][];
  /** Triangle of the head: tip, then the two base corners. */
  head: [number, number][];
}

/**
 * Shaft and head of an arrow of width `w` (in squares). The shaft stops at the
 * head's base, so a translucent arrow has no darker overlap. Knight moves are
 * drawn as an L (long leg first), which reads better than a line across a square.
 */
export function arrowGeometry(from: string, to: string, flipped: boolean, w: number): ArrowGeometry {
  const [c1, r1] = screenPos(from, flipped);
  const [c2, r2] = screenPos(to, flipped);
  const a: [number, number] = [c1 + 0.5, r1 + 0.5];
  const b: [number, number] = [c2 + 0.5, r2 + 0.5];
  const points: [number, number][] = [a];
  if (isKnightJump(from, to)) {
    const longX = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]);
    points.push(longX ? [b[0], a[1]] : [a[0], b[1]]);
  }
  const last = points[points.length - 1];
  const dx = b[0] - last[0];
  const dy = b[1] - last[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Proportions of the classic analysis-board arrow: the head is 3 widths long and
  // 4 wide, and its tip reaches just about the centre of the target square.
  const tipOut = w * 0.95 - 10 / 64;
  const tip: [number, number] = [b[0] + ux * tipOut, b[1] + uy * tipOut];
  const headLen = w * 3;
  const base: [number, number] = [tip[0] - ux * headLen, tip[1] - uy * headLen];
  const hw = w * 2;
  points.push(base);
  return {
    shaft: points,
    head: [tip, [base[0] - uy * hw, base[1] + ux * hw], [base[0] + uy * hw, base[1] - ux * hw]],
  };
}

/** Square of the king of the side to move, if that king is attacked. */
export function checkedKing(placement: Placement, whiteToMove: boolean): string | null {
  const king = whiteToMove ? "K" : "k";
  let at: string | null = null;
  for (const [sq, p] of placement) if (p === king) at = sq;
  if (!at) return null;
  return attackedBy(placement, at, !whiteToMove) ? at : null;
}

/** Whether `sq` is attacked by a piece of the given colour (pins do not matter for check). */
export function attackedBy(placement: Placement, sq: string, byWhite: boolean): boolean {
  const f = FILES.indexOf(sq[0]);
  const r = Number(sq[1]) - 1;
  const at = (df: number, dr: number): string | undefined => {
    const nf = f + df;
    const nr = r + dr;
    return nf < 0 || nf > 7 || nr < 0 || nr > 7 ? undefined : placement.get(FILES[nf] + (nr + 1));
  };
  const own = (p: string | undefined, kind: string) => !!p && p.toLowerCase() === kind && isWhitePiece(p) === byWhite;
  // Pawns attack diagonally forward: a white pawn on the rank below.
  const pawnDr = byWhite ? -1 : 1;
  if (own(at(-1, pawnDr), "p") || own(at(1, pawnDr), "p")) return true;
  for (const [df, dr] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) if (own(at(df, dr), "n")) return true;
  for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) if ((df || dr) && own(at(df, dr), "k")) return true;
  const rays: [number, number, string][] = [
    [1, 0, "r"], [-1, 0, "r"], [0, 1, "r"], [0, -1, "r"],
    [1, 1, "b"], [1, -1, "b"], [-1, 1, "b"], [-1, -1, "b"],
  ];
  for (const [df, dr, kind] of rays) {
    for (let k = 1; k < 8; k++) {
      const nf = f + df * k;
      const nr = r + dr * k;
      if (nf < 0 || nf > 7 || nr < 0 || nr > 7) break;
      const p = placement.get(FILES[nf] + (nr + 1));
      if (!p) continue;
      if (isWhitePiece(p) === byWhite && (p.toLowerCase() === kind || p.toLowerCase() === "q")) return true;
      break;
    }
  }
  return false;
}
