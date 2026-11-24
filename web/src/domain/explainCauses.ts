// Board-based causes behind a weak move that need no tactic: a weakened king,
// a lost castling right, a trade into a worse endgame, a missed passed pawn …
// Only detection lives here (facts about squares and pieces); explain.ts turns
// the facts into German and English sentences. Everything is read from the view
// of the side that played the move ("me").

import {
  BISHOP,
  type Board,
  type Color,
  KING,
  KNIGHT,
  type Move,
  PAWN,
  type PieceType,
  QUEEN,
  ROOK,
  squareFile,
  squareName,
  squareRank,
} from "./tactics/board";
import { ENDGAME_LOW_TOTAL_NON_PAWN, PIECE_VALUES } from "./tactics/constants";
import { nonPawnMaterial } from "./tactics/phase";

/** A line of the engine played out on copies of the board (boards[0] = start). */
export interface PlayedLine {
  boards: Board[];
  sans: string[];
  moves: Move[];
}

export type Cause =
  | { kind: "missed-win"; sans: string[]; gain: number }
  | { kind: "missed-promotion"; san: string; square: string }
  | { kind: "missed-passed-pawn"; san: string; square: string }
  | { kind: "allowed-promotion"; san: string; square: string }
  | { kind: "allowed-passed-pawn"; san: string; square: string }
  | { kind: "missed-recapture"; san: string; square: string }
  | { kind: "king-weakened"; san: string; square: string }
  | { kind: "castling-lost" }
  | { kind: "endgame-trade"; queens: boolean }
  | { kind: "bishop-pair" }
  | { kind: "isolated-pawn"; square: string }
  | { kind: "doubled-pawns"; file: string }
  | { kind: "rim-knight"; square: string };

export type Idea =
  | { kind: "castle" }
  | { kind: "promote" }
  | { kind: "check" }
  | { kind: "capture"; victim: PieceType; square: string }
  | { kind: "pawn-attack"; square: string }
  | { kind: "attack"; targets: { type: PieceType; square: string }[] }
  | { kind: "develop"; piece: PieceType; square: string }
  | { kind: "center-pawn"; square: string }
  | { kind: "rook-file"; file: string; open: boolean }
  | { kind: "central-piece"; piece: PieceType; square: string }
  | { kind: "retreat"; piece: PieceType; square: string }
  | { kind: "king"; square: string }
  | { kind: "move"; piece: PieceType; square: string };

const material = (b: Board, c: Color) => {
  let sum = 0;
  for (const [, p] of b.pieceMap()) if (p.color === c) sum += PIECE_VALUES[p.type];
  return sum;
};
const count = (b: Board, type: PieceType, c: Color) => b.pieces(type, c).length;

/** Rank counted from the mover's side: 0 = home rank, 7 = promotion rank. */
const relRank = (sq: number, c: Color) => (c ? squareRank(sq) : 7 - squareRank(sq));

/** No opposing pawn in front of `sq` on its own or an adjacent file. */
function isPassed(b: Board, sq: number, c: Color): boolean {
  const f = squareFile(sq);
  const r = relRank(sq, c);
  for (const [s, p] of b.pieceMap()) {
    if (p.type !== PAWN || p.color === c) continue;
    if (Math.abs(squareFile(s) - f) <= 1 && relRank(s, c) > r) return false;
  }
  return true;
}

/** Squares of `c`'s pawns that have no friendly pawn on an adjacent file. */
function isolatedPawns(b: Board, c: Color): number[] {
  const files = new Set(b.pieces(PAWN, c).map(squareFile));
  return b.pieces(PAWN, c).filter((s) => !files.has(squareFile(s) - 1) && !files.has(squareFile(s) + 1));
}

function doubledFiles(b: Board, c: Color): number[] {
  const seen = new Map<number, number>();
  for (const s of b.pieces(PAWN, c)) seen.set(squareFile(s), (seen.get(squareFile(s)) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([f]) => f);
}

const diffOf = (b: Board, me: Color) => material(b, me) - material(b, !me);
/** Material change a line ends with, counting the worse of its last two positions (cut-off exchanges). */
const lineBalance = (line: PlayedLine, me: Color) => Math.min(...line.boards.slice(-2).map((b) => diffOf(b, me)));

export interface CauseContext {
  before: Board;
  afterMove: Board;
  move: Move;
  me: Color;
  /** The engine's line from the position before the move (its first move is the better one). */
  best: PlayedLine;
  /** The engine's line after the move, starting with the opponent's reply. boards[0] = afterMove. */
  reply: PlayedLine;
  previous?: { uci: string; san: string };
}

/** Concrete causes of an error that is not a plain tactic, most telling first. */
export function detectCauses(c: CauseContext): Cause[] {
  const { before, afterMove, move, me, best, reply } = c;
  const out: Cause[] = [];
  const piece = before.pieceAt(move.from);
  if (!piece) return out;
  const bm = best.moves[0];
  const playedBest = bm && bm.from === move.from && bm.to === move.to;
  const base = diffOf(before, me);

  // Material the better line wins and the game move does not.
  if (bm && !playedBest && best.boards.length > 2) {
    const bestGain = lineBalance(best, me) - base;
    const playedGain = (reply.boards.length > 2 ? lineBalance(reply, me) : diffOf(afterMove, me)) - base;
    if (bestGain >= 2 && bestGain - playedGain >= 2) out.push({ kind: "missed-win", sans: best.sans, gain: bestGain });
  }

  // Passed pawns: the one the better move pushes, the one the reply promotes.
  if (bm && !playedBest) {
    const bp = before.pieceAt(bm.from);
    if (bp?.type === PAWN) {
      if (bm.promotion) out.push({ kind: "missed-promotion", san: best.sans[0], square: squareName(bm.to) });
      else if (relRank(bm.to, me) >= 5 && isPassed(best.boards[1], bm.to, me)) out.push({ kind: "missed-passed-pawn", san: best.sans[0], square: squareName(bm.to) });
    }
  }
  for (let i = 0; i < reply.moves.length && i < 6; i += 2) {
    const rm = reply.moves[i];
    const rp = reply.boards[i].pieceAt(rm.from);
    if (rp?.type !== PAWN) continue;
    if (rm.promotion) {
      out.push({ kind: "allowed-promotion", san: reply.sans[i], square: squareName(rm.to) });
      break;
    }
    if (i === 0 && relRank(rm.to, !me) >= 5 && isPassed(reply.boards[1], rm.to, !me)) out.push({ kind: "allowed-passed-pawn", san: reply.sans[0], square: squareName(rm.to) });
  }

  // Recapture skipped: the opponent just took, the better move takes back.
  if (c.previous?.san.includes("x") && bm && !playedBest) {
    const sq = c.previous.uci.slice(2, 4);
    if (squareName(bm.to) === sq && squareName(move.to) !== sq && before.pieceAt(bm.to)) out.push({ kind: "missed-recapture", san: best.sans[0], square: sq });
  }

  const middle = nonPawnMaterial(before, !me) >= ENDGAME_LOW_TOTAL_NON_PAWN / 2;

  // A pawn in front of the castled king leaves.
  const king = before.king(me);
  if (piece.type === PAWN && king !== null && middle && relRank(king, me) === 0 && !before.pieceAt(move.to)) {
    const kf = squareFile(king);
    const castled = kf >= 5 || kf <= 2;
    if (castled && relRank(move.from, me) === 1 && Math.abs(squareFile(move.from) - kf) <= 1 && count(before, QUEEN, !me) > 0) {
      out.push({ kind: "king-weakened", san: before.san(move), square: squareName(move.from) });
    }
  }

  // Castling rights gone without castling.
  const rights = me ? before.castling.K || before.castling.Q : before.castling.k || before.castling.q;
  const rightsAfter = me ? afterMove.castling.K || afterMove.castling.Q : afterMove.castling.k || afterMove.castling.q;
  const castles = piece.type === KING && Math.abs(move.to - move.from) === 2;
  if (rights && !rightsAfter && !castles && middle && before.fullmove <= 25) out.push({ kind: "castling-lost" });

  // Trade into an endgame: queens off, or most of the pieces gone, within the next moves.
  const horizon = reply.boards[Math.min(reply.boards.length - 1, 3)];
  const traded = Boolean(before.pieceAt(move.to)) || Boolean(reply.moves[0] && afterMove.pieceAt(reply.moves[0].to));
  if (traded) {
    const queensBefore = count(before, QUEEN, me) + count(before, QUEEN, !me);
    const queensAfter = count(horizon, QUEEN, me) + count(horizon, QUEEN, !me);
    const total = (b: Board) => nonPawnMaterial(b, me) + nonPawnMaterial(b, !me);
    if (queensBefore > 0 && queensAfter === 0) out.push({ kind: "endgame-trade", queens: true });
    else if (total(before) > ENDGAME_LOW_TOTAL_NON_PAWN && total(horizon) <= ENDGAME_LOW_TOTAL_NON_PAWN) out.push({ kind: "endgame-trade", queens: false });
  }

  // Bishop pair given up.
  if (traded && count(before, BISHOP, me) === 2 && count(before, BISHOP, !me) === 2) {
    const after = reply.boards[Math.min(reply.boards.length - 1, 1)];
    if (count(after, BISHOP, me) === 1 && count(after, BISHOP, !me) === 2) out.push({ kind: "bishop-pair" });
  }

  // Pawn structure: a pawn move or pawn capture that leaves new weaknesses.
  if (piece.type === PAWN) {
    const wasIso = new Set(isolatedPawns(before, me));
    const isoNow = isolatedPawns(afterMove, me);
    const fresh = isoNow.find((s) => !wasIso.has(s));
    if (fresh !== undefined && isoNow.length > wasIso.size) out.push({ kind: "isolated-pawn", square: squareName(fresh) });
    const df = doubledFiles(afterMove, me).filter((f) => !doubledFiles(before, me).includes(f));
    if (df.length) out.push({ kind: "doubled-pawns", file: "abcdefgh"[df[0]] });
  }

  // A knight on the rim controls few squares.
  if (piece.type === KNIGHT && (squareFile(move.to) === 0 || squareFile(move.to) === 7) && !before.pieceAt(move.to) && before.fullmove <= 25) {
    out.push({ kind: "rim-knight", square: squareName(move.to) });
  }
  return out;
}

/** What a (good or better) move is about, for moves without a tactic to name. */
export function describeIdea(before: Board, move: Move): Idea {
  const me = before.turn;
  const piece = before.pieceAt(move.from)!;
  const after = before.copy();
  after.push(move);
  const to = squareName(move.to);
  const captured = before.pieceAt(move.to);

  if (piece.type === KING && Math.abs(move.to - move.from) === 2) return { kind: "castle" };
  if (move.promotion) return { kind: "promote" };
  if (captured && captured.color !== me) return { kind: "capture", victim: captured.type, square: to };
  if (after.isCheck()) return { kind: "check" };

  const attacked: { type: PieceType; square: string }[] = [];
  for (const s of after.attacks(move.to)) {
    const p = after.pieceAt(s);
    if (p && p.color !== me && p.type !== PAWN && p.type !== KING) attacked.push({ type: p.type, square: squareName(s) });
  }
  if (piece.type === PAWN) {
    const f = squareFile(move.to);
    if ((f === 3 || f === 4) && relRank(move.to, me) >= 3) return { kind: "center-pawn", square: to };
    for (const s of after.attacks(move.to)) {
      const p = after.pieceAt(s);
      if (p && p.color !== me && p.type === PAWN) return { kind: "pawn-attack", square: squareName(s) };
    }
  } else {
    if (attacked.length) return { kind: "attack", targets: attacked.sort((a, b) => PIECE_VALUES[b.type] - PIECE_VALUES[a.type]).slice(0, 2) };
    const home = relRank(move.from, me) === 0;
    if ((piece.type === KNIGHT || piece.type === BISHOP) && home && before.fullmove <= 15) return { kind: "develop", piece: piece.type, square: to };
    if (piece.type === ROOK) {
      const f = squareFile(move.to);
      const own = before.pieces(PAWN, me).some((s) => squareFile(s) === f);
      const theirs = before.pieces(PAWN, !me).some((s) => squareFile(s) === f);
      if (!own) return { kind: "rook-file", file: "abcdefgh"[f], open: !theirs };
    }
    if (before.isAttackedBy(!me, move.from) && !after.isAttackedBy(!me, move.to)) return { kind: "retreat", piece: piece.type, square: to };
    const f = squareFile(move.to);
    const r = squareRank(move.to);
    if ((piece.type === KNIGHT || piece.type === BISHOP) && f >= 2 && f <= 5 && r >= 2 && r <= 5) return { kind: "central-piece", piece: piece.type, square: to };
    if (piece.type === KING) return { kind: "king", square: to };
  }
  return { kind: "move", piece: piece.type, square: to };
}
