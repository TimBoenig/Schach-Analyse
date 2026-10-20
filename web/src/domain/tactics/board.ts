// Minimal python-chess compatible board for the tactics port.
//
// chess.js rejects positions without both kings and has no pin/attacker-set
// API, while the tactics heuristics were written against python-chess
// semantics (pseudo-legal attackers, pin rays, kingless test positions,
// "legal" en-passant FEN output). This class mirrors exactly the subset of
// python-chess the tactics package relies on. Square indices follow
// python-chess: a1 = 0, h1 = 7, a8 = 56. Standard chess only (no Chess960).

export type Color = boolean;
export const WHITE: Color = true;
export const BLACK: Color = false;

export type PieceType = 1 | 2 | 3 | 4 | 5 | 6;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export interface Piece {
  type: PieceType;
  color: Color;
}

export interface Move {
  from: number;
  to: number;
  promotion?: PieceType | null;
}

export const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const FILE_NAMES = "abcdefgh";
const SYMBOLS = ".pnbrqk";

export function squareFile(sq: number): number {
  return sq & 7;
}

export function squareRank(sq: number): number {
  return sq >> 3;
}

export function square(file: number, rank: number): number {
  return rank * 8 + file;
}

export function squareName(sq: number): string {
  return FILE_NAMES[squareFile(sq)] + String(squareRank(sq) + 1);
}

export function parseSquare(name: string): number {
  const f = FILE_NAMES.indexOf(name[0]);
  const r = Number(name[1]) - 1;
  if (name.length !== 2 || f < 0 || !(r >= 0 && r < 8)) {
    throw new Error(`invalid square: ${name}`);
  }
  return square(f, r);
}

export function moveFromUci(uci: string): Move {
  if (uci.length !== 4 && uci.length !== 5) {
    throw new Error(`invalid uci: ${uci}`);
  }
  const from = parseSquare(uci.slice(0, 2));
  const to = parseSquare(uci.slice(2, 4));
  let promotion: PieceType | null = null;
  if (uci.length === 5) {
    const idx = SYMBOLS.indexOf(uci[4]);
    if (idx < 2 || idx > 5) throw new Error(`invalid promotion: ${uci}`);
    promotion = idx as PieceType;
  }
  if (from === to) throw new Error(`invalid uci: ${uci}`);
  return { from, to, promotion };
}

export function moveToUci(m: Move): string {
  return squareName(m.from) + squareName(m.to) + (m.promotion ? SYMBOLS[m.promotion] : "");
}

const KNIGHT_DELTAS: [number, number][] = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING_DELTAS: [number, number][] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
const DIAG_DIRS: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTHO_DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function onBoard(f: number, r: number): boolean {
  return f >= 0 && f < 8 && r >= 0 && r < 8;
}

/** All squares on the full line through a and b (empty if not aligned). */
function fullLine(a: number, b: number): Set<number> {
  const df = squareFile(b) - squareFile(a);
  const dr = squareRank(b) - squareRank(a);
  const out = new Set<number>();
  if (a === b || (df !== 0 && dr !== 0 && Math.abs(df) !== Math.abs(dr))) return out;
  const sf = Math.sign(df);
  const sr = Math.sign(dr);
  let f = squareFile(a);
  let r = squareRank(a);
  while (onBoard(f - sf, r - sr)) {
    f -= sf;
    r -= sr;
  }
  while (onBoard(f, r)) {
    out.add(square(f, r));
    f += sf;
    r += sr;
  }
  return out;
}

/** Squares strictly between a and b on a line (empty if not aligned). */
function between(a: number, b: number): number[] {
  const df = squareFile(b) - squareFile(a);
  const dr = squareRank(b) - squareRank(a);
  if (df !== 0 && dr !== 0 && Math.abs(df) !== Math.abs(dr)) return [];
  const sf = Math.sign(df);
  const sr = Math.sign(dr);
  const out: number[] = [];
  let f = squareFile(a) + sf;
  let r = squareRank(a) + sr;
  while (square(f, r) !== b && onBoard(f, r)) {
    out.push(square(f, r));
    f += sf;
    r += sr;
  }
  return out;
}

export class Board {
  squares: (Piece | null)[] = new Array(64).fill(null);
  turn: Color = WHITE;
  castling = { K: false, Q: false, k: false, q: false };
  epSquare: number | null = null;
  halfmove = 0;
  fullmove = 1;

  constructor(fen: string = STARTING_FEN) {
    const parts = fen.trim().split(/\s+/);
    const rows = parts[0]?.split("/") ?? [];
    if (rows.length !== 8) throw new Error(`invalid fen: ${fen}`);
    for (let i = 0; i < 8; i++) {
      const rank = 7 - i;
      let file = 0;
      for (const ch of rows[i]) {
        if (ch >= "1" && ch <= "8") {
          file += Number(ch);
          continue;
        }
        const idx = SYMBOLS.indexOf(ch.toLowerCase());
        if (idx < 1 || file > 7) throw new Error(`invalid fen: ${fen}`);
        this.squares[square(file, rank)] = {
          type: idx as PieceType,
          color: ch !== ch.toLowerCase(),
        };
        file += 1;
      }
      if (file !== 8) throw new Error(`invalid fen: ${fen}`);
    }
    const turn = parts[1] ?? "w";
    if (turn !== "w" && turn !== "b") throw new Error(`invalid fen: ${fen}`);
    this.turn = turn === "w";
    const castling = parts[2] ?? "-";
    if (castling !== "-") {
      for (const ch of castling) {
        if (!"KQkq".includes(ch)) throw new Error(`invalid fen: ${fen}`);
        this.castling[ch as "K" | "Q" | "k" | "q"] = true;
      }
    }
    const ep = parts[3] ?? "-";
    this.epSquare = ep === "-" ? null : parseSquare(ep);
    this.halfmove = parts[4] !== undefined ? Number(parts[4]) : 0;
    this.fullmove = parts[5] !== undefined ? Number(parts[5]) : 1;
    if (!Number.isInteger(this.halfmove) || !Number.isInteger(this.fullmove)) {
      throw new Error(`invalid fen: ${fen}`);
    }
  }

  copy(): Board {
    const b = Object.create(Board.prototype) as Board;
    b.squares = this.squares.slice();
    b.turn = this.turn;
    b.castling = { ...this.castling };
    b.epSquare = this.epSquare;
    b.halfmove = this.halfmove;
    b.fullmove = this.fullmove;
    return b;
  }

  pieceAt(sq: number): Piece | null {
    return this.squares[sq];
  }

  /** Occupied squares in python-chess piece_map() order (descending index). */
  pieceMap(): [number, Piece][] {
    const out: [number, Piece][] = [];
    for (let sq = 63; sq >= 0; sq--) {
      const p = this.squares[sq];
      if (p) out.push([sq, p]);
    }
    return out;
  }

  pieces(type: PieceType, color: Color): number[] {
    const out: number[] = [];
    for (let sq = 0; sq < 64; sq++) {
      const p = this.squares[sq];
      if (p && p.type === type && p.color === color) out.push(sq);
    }
    return out;
  }

  king(color: Color): number | null {
    for (let sq = 0; sq < 64; sq++) {
      const p = this.squares[sq];
      if (p && p.type === KING && p.color === color) return sq;
    }
    return null;
  }

  private rayAttacks(sq: number, dirs: [number, number][], out: Set<number>): void {
    for (const [df, dr] of dirs) {
      let f = squareFile(sq) + df;
      let r = squareRank(sq) + dr;
      while (onBoard(f, r)) {
        const t = square(f, r);
        out.add(t);
        if (this.squares[t]) break;
        f += df;
        r += dr;
      }
    }
  }

  /** Squares attacked by the piece on `sq` (python-chess Board.attacks). */
  attacks(sq: number): Set<number> {
    const out = new Set<number>();
    const p = this.squares[sq];
    if (!p) return out;
    const f0 = squareFile(sq);
    const r0 = squareRank(sq);
    const step = (deltas: [number, number][]) => {
      for (const [df, dr] of deltas) {
        if (onBoard(f0 + df, r0 + dr)) out.add(square(f0 + df, r0 + dr));
      }
    };
    switch (p.type) {
      case PAWN: {
        const dr = p.color ? 1 : -1;
        step([[1, dr], [-1, dr]]);
        break;
      }
      case KNIGHT:
        step(KNIGHT_DELTAS);
        break;
      case KING:
        step(KING_DELTAS);
        break;
      case BISHOP:
        this.rayAttacks(sq, DIAG_DIRS, out);
        break;
      case ROOK:
        this.rayAttacks(sq, ORTHO_DIRS, out);
        break;
      case QUEEN:
        this.rayAttacks(sq, DIAG_DIRS, out);
        this.rayAttacks(sq, ORTHO_DIRS, out);
        break;
    }
    return out;
  }

  /** Pieces of `color` attacking `sq`, ascending order (ignores pins). */
  attackers(color: Color, sq: number): number[] {
    const out: number[] = [];
    for (let s = 0; s < 64; s++) {
      const p = this.squares[s];
      if (p && p.color === color && this.attacks(s).has(sq)) out.push(s);
    }
    return out;
  }

  isAttackedBy(color: Color, sq: number): boolean {
    return this.attackers(color, sq).length > 0;
  }

  /**
   * python-chess pin_mask: the full line through the king and the pinning
   * slider, or null when the piece is not pinned (BB_ALL).
   */
  pin(color: Color, sq: number): Set<number> | null {
    const king = this.king(color);
    if (king === null) return null;
    const lineTypes: { matches: (a: number, b: number) => boolean; sliders: PieceType[] }[] = [
      { matches: (a, b) => a !== b && squareFile(a) === squareFile(b), sliders: [ROOK, QUEEN] },
      { matches: (a, b) => a !== b && squareRank(a) === squareRank(b), sliders: [ROOK, QUEEN] },
      {
        matches: (a, b) =>
          a !== b &&
          Math.abs(squareFile(a) - squareFile(b)) === Math.abs(squareRank(a) - squareRank(b)),
        sliders: [BISHOP, QUEEN],
      },
    ];
    for (const lt of lineTypes) {
      if (!lt.matches(king, sq)) continue;
      // Snipers on this line type (python-chess scans the whole attack set of
      // the king for this direction class, both diagonals together).
      for (let s = 63; s >= 0; s--) {
        const p = this.squares[s];
        if (!p || p.color === color || !lt.sliders.includes(p.type) || !lt.matches(king, s)) {
          continue;
        }
        const btw = between(s, king);
        const blockers = btw.filter((b) => b === sq || this.squares[b] !== null);
        if (blockers.length === 1 && blockers[0] === sq) {
          return fullLine(king, s);
        }
      }
      break;
    }
    return null;
  }

  isPinned(color: Color, sq: number): boolean {
    return this.pin(color, sq) !== null;
  }

  checkers(): number[] {
    const king = this.king(this.turn);
    if (king === null) return [];
    return this.attackers(!this.turn, king);
  }

  isCheck(): boolean {
    return this.checkers().length > 0;
  }

  isCheckmate(): boolean {
    return this.isCheck() && this.legalMoves().length === 0;
  }

  isEnPassant(m: Move): boolean {
    const p = this.squares[m.from];
    return (
      this.epSquare === m.to &&
      !!p &&
      p.type === PAWN &&
      squareFile(m.from) !== squareFile(m.to) &&
      this.squares[m.to] === null
    );
  }

  isCapture(m: Move): boolean {
    const t = this.squares[m.to];
    return (t !== null && t.color !== this.turn) || this.isEnPassant(m);
  }

  private isCastling(m: Move): boolean {
    const p = this.squares[m.from];
    return !!p && p.type === KING && Math.abs(squareFile(m.to) - squareFile(m.from)) === 2;
  }

  /** Applies a pseudo-legal move without validation (python-chess push). */
  push(m: Move): void {
    const p = this.squares[m.from];
    if (!p) throw new Error(`push() expects a pseudo-legal move: ${moveToUci(m)}`);
    const captured = this.squares[m.to];
    const isEp = this.isEnPassant(m);
    const isCastle = this.isCastling(m);

    this.halfmove = p.type === PAWN || captured !== null || isEp ? 0 : this.halfmove + 1;
    if (!this.turn) this.fullmove += 1;

    this.squares[m.from] = null;
    if (isEp) {
      this.squares[square(squareFile(m.to), squareRank(m.from))] = null;
    }
    if (isCastle) {
      const rank = squareRank(m.from);
      const kingSide = squareFile(m.to) > squareFile(m.from);
      const rookFrom = square(kingSide ? 7 : 0, rank);
      const rookTo = square(kingSide ? 5 : 3, rank);
      this.squares[rookTo] = this.squares[rookFrom];
      this.squares[rookFrom] = null;
    }
    this.squares[m.to] = m.promotion ? { type: m.promotion, color: p.color } : p;

    this.epSquare = null;
    if (p.type === PAWN && Math.abs(m.to - m.from) === 16) {
      this.epSquare = (m.from + m.to) / 2;
    }

    const touch = (sq: number) => {
      if (sq === 4) this.castling.K = this.castling.Q = false;
      if (sq === 60) this.castling.k = this.castling.q = false;
      if (sq === 7) this.castling.K = false;
      if (sq === 0) this.castling.Q = false;
      if (sq === 63) this.castling.k = false;
      if (sq === 56) this.castling.q = false;
    };
    touch(m.from);
    touch(m.to);
    this.turn = !this.turn;
  }

  private cleanCastling(): string {
    const ok = (flag: boolean, kingSq: number, rookSq: number, color: Color) => {
      const k = this.squares[kingSq];
      const r = this.squares[rookSq];
      return (
        flag && !!k && k.type === KING && k.color === color && !!r && r.type === ROOK && r.color === color
      );
    };
    let out = "";
    if (ok(this.castling.K, 4, 7, WHITE)) out += "K";
    if (ok(this.castling.Q, 4, 0, WHITE)) out += "Q";
    if (ok(this.castling.k, 60, 63, BLACK)) out += "k";
    if (ok(this.castling.q, 60, 56, BLACK)) out += "q";
    return out;
  }

  pseudoLegalMoves(): Move[] {
    const out: Move[] = [];
    const us = this.turn;
    const add = (from: number, to: number) => {
      const p = this.squares[from];
      if (p && p.type === PAWN && (squareRank(to) === 7 || squareRank(to) === 0)) {
        for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT] as PieceType[]) out.push({ from, to, promotion: promo });
      } else {
        out.push({ from, to, promotion: null });
      }
    };
    for (let sq = 0; sq < 64; sq++) {
      const p = this.squares[sq];
      if (!p || p.color !== us) continue;
      if (p.type === PAWN) {
        const dr = us ? 8 : -8;
        const startRank = us ? 1 : 6;
        const one = sq + dr;
        if (one >= 0 && one < 64 && !this.squares[one]) {
          add(sq, one);
          const two = sq + 2 * dr;
          if (squareRank(sq) === startRank && !this.squares[two]) add(sq, two);
        }
        for (const t of this.attacks(sq)) {
          const tp = this.squares[t];
          if (tp) {
            if (tp.color !== us) add(sq, t);
          } else if (t === this.epSquare) {
            // python-chess only generates en passant when an enemy pawn sits
            // directly behind the (empty) en-passant square.
            const victim = this.squares[square(squareFile(t), squareRank(sq))];
            if (victim && victim.type === PAWN && victim.color !== us) add(sq, t);
          }
        }
        continue;
      }
      for (const t of this.attacks(sq)) {
        const tp = this.squares[t];
        if (!tp || tp.color !== us) add(sq, t);
      }
      if (p.type === KING) {
        const rights = this.cleanCastling();
        const homeRank = us ? 0 : 7;
        if (sq === square(4, homeRank)) {
          const kFlag = us ? "K" : "k";
          const qFlag = us ? "Q" : "q";
          if (
            rights.includes(kFlag) &&
            !this.squares[square(5, homeRank)] &&
            !this.squares[square(6, homeRank)]
          ) {
            out.push({ from: sq, to: square(6, homeRank), promotion: null });
          }
          if (
            rights.includes(qFlag) &&
            !this.squares[square(3, homeRank)] &&
            !this.squares[square(2, homeRank)] &&
            !this.squares[square(1, homeRank)]
          ) {
            out.push({ from: sq, to: square(2, homeRank), promotion: null });
          }
        }
      }
    }
    return out;
  }

  legalMoves(): Move[] {
    const us = this.turn;
    if (this.king(us) === null) return this.pseudoLegalMoves();
    return this.pseudoLegalMoves().filter((m) => {
      if (this.isCastling(m)) {
        const rank = squareRank(m.from);
        const path = squareFile(m.to) > squareFile(m.from) ? [4, 5, 6] : [4, 3, 2];
        if (path.some((f) => this.isAttackedBy(!us, square(f, rank)))) return false;
      }
      const b = this.copy();
      b.push(m);
      const k = b.king(us);
      return k === null || !b.isAttackedBy(!us, k);
    });
  }

  san(m: Move): string {
    const p = this.squares[m.from];
    if (!p) throw new Error("no piece on from-square");
    let san: string;
    if (this.isCastling(m)) {
      san = squareFile(m.to) > squareFile(m.from) ? "O-O" : "O-O-O";
    } else {
      const capture = this.isCapture(m);
      if (p.type === PAWN) {
        san = (capture ? FILE_NAMES[squareFile(m.from)] + "x" : "") + squareName(m.to);
        if (m.promotion) san += "=" + SYMBOLS[m.promotion].toUpperCase();
      } else {
        san = SYMBOLS[p.type].toUpperCase();
        const others = this.legalMoves().filter(
          (o) => o.to === m.to && o.from !== m.from && this.squares[o.from]?.type === p.type,
        );
        if (others.length) {
          const sameFile = others.some((o) => squareFile(o.from) === squareFile(m.from));
          const sameRank = others.some((o) => squareRank(o.from) === squareRank(m.from));
          if (!sameFile) san += FILE_NAMES[squareFile(m.from)];
          else if (!sameRank) san += String(squareRank(m.from) + 1);
          else san += squareName(m.from);
        }
        san += (capture ? "x" : "") + squareName(m.to);
      }
    }
    const after = this.copy();
    after.push(m);
    if (after.isCheckmate()) san += "#";
    else if (after.isCheck()) san += "+";
    return san;
  }

  /** Lenient SAN parser (ignores check/annotation suffixes, accepts 0-0). */
  parseSan(san: string): Move {
    const norm = (s: string) => s.replace(/[+#!?]/g, "").replace(/0/g, "O");
    const target = norm(san.trim());
    for (const m of this.legalMoves()) {
      if (norm(this.san(m)) === target) return m;
    }
    throw new Error(`illegal san: ${san}`);
  }

  hasLegalEnPassant(): boolean {
    if (this.epSquare === null) return false;
    return this.legalMoves().some((m) => this.isEnPassant(m));
  }

  boardFen(): string {
    const rows: string[] = [];
    for (let rank = 7; rank >= 0; rank--) {
      let row = "";
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const p = this.squares[square(file, rank)];
        if (!p) {
          empty += 1;
          continue;
        }
        if (empty) row += String(empty);
        empty = 0;
        const sym = SYMBOLS[p.type];
        row += p.color ? sym.toUpperCase() : sym;
      }
      if (empty) row += String(empty);
      rows.push(row);
    }
    return rows.join("/");
  }

  /** FEN with python-chess default en_passant="legal" semantics. */
  fen(): string {
    const ep = this.hasLegalEnPassant() && this.epSquare !== null ? squareName(this.epSquare) : "-";
    return [
      this.boardFen(),
      this.turn ? "w" : "b",
      this.cleanCastling() || "-",
      ep,
      String(this.halfmove),
      String(this.fullmove),
    ].join(" ");
  }
}
