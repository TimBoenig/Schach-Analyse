// Concrete, chess-language explanations of a move: what the opponent's best
// reply does (fork, pin, capture, mate) and what the better move would have
// achieved. Replaces bare numbers like "10 % Gewinnchance verloren" with
// sentences such as "Dein Gegner gewinnt mit Sxe7+ per Gabel deine Dame."
//
// Everything is phrased from the mover's view ("du" = side that played the move).

import {
  type Board as TBoard,
  Board,
  type Color,
  KING,
  type Move,
  moveFromUci,
  PAWN,
  type PieceType,
  QUEEN,
  ROOK,
  squareName,
} from "./tactics/board";
import { findSliderRayTargets, legalDefenders } from "./tactics/board_utils";
import { PIECE_VALUES, TacticalTheme } from "./tactics/constants";
import { getHangingPieces } from "./tactics/hanging";
import { detectTacticalMotifs } from "./tactics/motifs";

export interface ExplainInput {
  fenBefore: string;
  uci: string;
  /** Engine line in the position before the move (best move first), UCI. */
  bestPv: string[];
  /** Engine line in the position after the move (opponent's best reply first), UCI. */
  replyPv: string[];
  /** White-perspective mate scores before and after the move, if any. */
  mateBefore?: number | null;
  mateAfter?: number | null;
}

// Nominative and accusative with a possessive, e.g. "dein Turm" / "deinen Turm".
const NAMES: Record<PieceType, { nom: string; acc: string; gen: "m" | "f" }> = {
  1: { nom: "Bauer", acc: "Bauern", gen: "m" },
  2: { nom: "Springer", acc: "Springer", gen: "m" },
  3: { nom: "Läufer", acc: "Läufer", gen: "m" },
  4: { nom: "Turm", acc: "Turm", gen: "m" },
  5: { nom: "Dame", acc: "Dame", gen: "f" },
  6: { nom: "König", acc: "König", gen: "m" },
};

const yourNom = (t: PieceType) => `${NAMES[t].gen === "f" ? "deine" : "dein"} ${NAMES[t].nom}`;
const yourAcc = (t: PieceType) => `${NAMES[t].gen === "f" ? "deine" : "deinen"} ${NAMES[t].acc}`;
const theirAcc = (t: PieceType) => `${NAMES[t].gen === "f" ? "seine" : "seinen"} ${NAMES[t].acc}`;

function material(board: TBoard, color: Color): number {
  let sum = 0;
  for (const [, p] of board.pieceMap()) if (p.color === color) sum += PIECE_VALUES[p.type];
  return sum;
}

function materialWords(v: number): string {
  if (v >= 9) return "die Dame oder entsprechend viel Material";
  if (v >= 5) return "einen Turm oder entsprechend viel Material";
  if (v >= 3) return "eine Figur";
  if (v === 2) return "die Qualität oder zwei Bauern";
  return "einen Bauern";
}

/** Plays a UCI line on a copy; stops at the first illegal move. Returns boards and SANs. */
function playLine(start: TBoard, pv: string[], max: number): { boards: TBoard[]; sans: string[]; moves: Move[] } {
  const boards = [start];
  const sans: string[] = [];
  const moves: Move[] = [];
  let b = start;
  for (const uci of pv.slice(0, max)) {
    let m: Move;
    try {
      m = moveFromUci(uci);
    } catch {
      break;
    }
    if (!b.legalMoves().some((x) => x.from === m.from && x.to === m.to && (x.promotion ?? null) === (m.promotion ?? null))) break;
    sans.push(b.san(m));
    const next = b.copy();
    next.push(m);
    boards.push(next);
    moves.push(m);
    b = next;
  }
  return { boards, sans, moves };
}

function lineText(sans: string[], start: TBoard, n: number): string {
  let num = start.fullmove;
  let white = start.turn;
  return sans
    .slice(0, n)
    .map((s, k) => {
      const label = white ? `${num}. ${s}` : k === 0 ? `${num}... ${s}` : s;
      if (!white) num++;
      white = !white;
      return label;
    })
    .join(" ");
}

/** Non-pawn pieces (and the king, when in check) of `victim` attacked from `sq`. */
function attackedTargets(board: TBoard, sq: number, victim: Color): PieceType[] {
  const out: PieceType[] = [];
  for (const t of board.attacks(sq)) {
    const p = board.pieceAt(t);
    if (p && p.color === victim && p.type !== PAWN) out.push(p.type);
  }
  return out.sort((a, b) => (b === KING ? 99 : PIECE_VALUES[b]) - (a === KING ? 99 : PIECE_VALUES[a]));
}

function joinPieces(types: PieceType[], fmt: (t: PieceType) => string): string {
  const parts = types.slice(0, 3).map(fmt);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} und ${parts[parts.length - 1]}` : parts[0] ?? "";
}

/** What the opponent's best reply does to the mover. */
function replySentence(afterMove: TBoard, reply: Move, replySan: string, me: Color): string | null {
  const afterReply = afterMove.copy();
  afterReply.push(reply);
  const opp = !me;
  const motifs = detectTacticalMotifs(afterMove, afterReply, reply, opp);
  const captured = afterMove.pieceAt(reply.to);

  if (motifs.includes(TacticalTheme.FORK)) {
    const targets = attackedTargets(afterReply, reply.to, me);
    if (targets.length >= 2) return `Dein Gegner antwortet ${replySan} und greift mit einer Gabel ${joinPieces(targets, yourAcc)} gleichzeitig an.`;
  }
  if (motifs.includes(TacticalTheme.PIN) || motifs.includes(TacticalTheme.SKEWER)) {
    for (const [, front, , rear] of findSliderRayTargets(afterReply, reply.to, opp)) {
      const skewer = rear.type !== KING && PIECE_VALUES[front.type] > PIECE_VALUES[rear.type] && front.type !== PAWN;
      if (front.type === KING || skewer) {
        return `Mit ${replySan} spießt dein Gegner ${yourAcc(front.type)} auf: Weicht ${front.type === KING ? "er" : NAMES[front.type].gen === "f" ? "sie" : "er"} aus, geht ${yourNom(rear.type)} dahinter verloren.`;
      }
      if (rear.type === KING || rear.type === QUEEN || (rear.type === ROOK && front.type !== PAWN)) {
        return `Mit ${replySan} fesselt dein Gegner ${yourAcc(front.type)} an ${yourAcc(rear.type)}.`;
      }
    }
  }
  if (motifs.includes(TacticalTheme.DISCOVERED_ATTACK)) return `${replySan} ist ein Abzugsangriff: Dein Gegner zieht eine Figur weg und öffnet damit eine zweite Angriffslinie.`;
  if (motifs.includes(TacticalTheme.BACK_RANK)) return `Deine Grundreihe ist schwach: ${replySan} nutzt aus, dass dein König kein Luftloch hat.`;
  if (captured && captured.color === me && captured.type !== PAWN) {
    const t = captured.type;
    const free = legalDefenders(afterMove, me, reply.to).length === 0;
    const capturer = afterMove.pieceAt(reply.from);
    // A recapturable trade is no loss; only free pieces or captures by a cheaper piece are.
    if (free) return `Dein Gegner schlägt mit ${replySan} ${NAMES[t].gen === "f" ? "deine ungedeckte" : "deinen ungedeckten"} ${NAMES[t].acc}.`;
    if (capturer && PIECE_VALUES[capturer.type] < PIECE_VALUES[t]) return `Dein Gegner schlägt mit ${replySan} ${yourAcc(t)} und gewinnt Material, auch wenn du zurückschlägst.`;
  }
  return null;
}

/**
 * German sentences explaining a move, most important first. Empty when nothing
 * concrete can be said (quiet positional moves).
 */
export function explainMove(input: ExplainInput): string[] {
  let before: TBoard;
  try {
    before = new Board(input.fenBefore);
  } catch {
    return [];
  }
  const me = before.turn;
  let move: Move;
  try {
    move = moveFromUci(input.uci);
  } catch {
    return [];
  }
  if (!before.legalMoves().some((x) => x.from === move.from && x.to === move.to)) return [];
  const afterMove = before.copy();
  afterMove.push(move);
  const playedBest = input.bestPv[0]?.slice(0, 4) === input.uci.slice(0, 4);
  const out: string[] = [];
  const sign = me ? 1 : -1;

  // Allowed mate.
  const mateAfter = input.mateAfter ?? null;
  if (mateAfter !== null && sign * mateAfter < 0 && !afterMove.isCheckmate()) {
    const n = Math.abs(mateAfter);
    const line = playLine(afterMove, input.replyPv, n * 2 - 1);
    out.push(`Danach kann dein Gegner in ${n} ${n === 1 ? "Zug" : "Zügen"} mattsetzen${line.sans.length ? `: ${lineText(line.sans, afterMove, n * 2 - 1)}` : ""}.`);
  }

  // The opponent's best reply, read as a motif or a capture.
  const reply = playLine(afterMove, input.replyPv, 8);
  if (!playedBest && reply.moves.length && !out.length) {
    const s = replySentence(afterMove, reply.moves[0], reply.sans[0], me);
    if (s) out.push(s);
  }

  // Material the forced line costs, when no motif already says it.
  if (!playedBest && reply.boards.length > 2) {
    const diff = (b: TBoard) => material(b, me) - material(b, !me);
    // The better of the last two positions, so a line cut off mid-exchange
    // does not count a piece that is about to be taken back.
    const ends = reply.boards.slice(-2).map(diff);
    const total = diff(before) - Math.max(...ends);
    if (total >= 1 && out.length < 2) {
      out.push(`Nach der besten Antwort ${lineText(reply.sans, afterMove, 6)} verlierst du ${materialWords(total)}.`);
    }
  }

  // A piece left hanging by the move itself.
  if (!playedBest && !out.length) {
    const hangingBefore = new Set(getHangingPieces(before, me).map((h) => h.square));
    const fresh = getHangingPieces(afterMove, me, move, before).filter((h) => !hangingBefore.has(h.square) && h.piece_type !== PAWN);
    const worst = fresh.sort((a, b) => PIECE_VALUES[b.piece_type as PieceType] - PIECE_VALUES[a.piece_type as PieceType])[0];
    if (worst) out.push(`Nach diesem Zug ist ${yourNom(worst.piece_type as PieceType)} auf ${worst.square} nicht mehr ausreichend gedeckt.`);
  }

  // What the better move would have done.
  if (!playedBest && input.bestPv.length) {
    const best = playLine(before, input.bestPv, 6);
    if (best.moves.length) {
      const bm = best.moves[0];
      const bSan = best.sans[0];
      const mateBefore = input.mateBefore ?? null;
      const afterBest = best.boards[1];
      const bestMotifs = detectTacticalMotifs(before, afterBest, bm, me);
      const target = before.pieceAt(bm.to);
      if (mateBefore !== null && sign * mateBefore > 0) {
        out.push(`Du hattest Matt in ${Math.abs(mateBefore)}: ${lineText(best.sans, before, Math.abs(mateBefore) * 2 - 1)}.`);
      } else if (bestMotifs.includes(TacticalTheme.FORK)) {
        const targets = attackedTargets(afterBest, bm.to, !me);
        out.push(`Besser war ${bSan}: Damit greifst du mit einer Gabel ${joinPieces(targets, theirAcc)} gleichzeitig an.`);
      } else if (target && target.color !== me && target.type !== PAWN && legalDefenders(before, !me, bm.to).length === 0) {
        out.push(`Besser war ${bSan}: ${NAMES[target.type].gen === "f" ? "Die" : "Der"} gegnerische ${NAMES[target.type].nom} auf ${squareName(bm.to)} war ungedeckt.`);
      } else if (bestMotifs.includes(TacticalTheme.PIN)) {
        out.push(`Besser war ${bSan} mit einer Fesselung.`);
      } else if (bestMotifs.includes(TacticalTheme.SKEWER)) {
        out.push(`Besser war ${bSan} mit einem Spieß.`);
      } else if (out.length < 2) {
        out.push(`Besser war ${lineText(best.sans, before, 3)}.`);
      }
    }
  }
  return out.slice(0, 3);
}
