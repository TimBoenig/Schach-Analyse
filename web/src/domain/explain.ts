// Concrete, chess-language explanations of a move: what the opponent's best
// reply does (fork, pin, capture, mate) and what the better move would have
// achieved. Replaces bare numbers like "10 % Gewinnchance verloren" with
// sentences such as "Dein Gegner gewinnt mit Sxe7+ per Gabel deine Dame."
//
// Good moves get the same treatment from the other side: the fork the move
// sets up, the threat it stops ("Du verhinderst damit eine Springergabel auf
// e3") or the threat it creates. Threats are read statically by letting the
// other side move twice in a row (a "null move"), so this needs no extra engine
// search and works for stored games, side lines and the free board alike.
//
// Everything is phrased from the mover's view ("du" = side that played the move).

import {
  type Board as TBoard,
  Board,
  type Color,
  KING,
  KNIGHT,
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
import { staticExchangeEvaluation } from "./tactics/see";

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
  /**
   * The move's classification. Errors get the refutation and the better move,
   * everything else what the move achieves. Without it, only the engine's own
   * first choice counts as good.
   */
  classification?: string;
  /** The opponent's move just before, to tell a recapture from a free capture. */
  previousMove?: { uci: string; san: string };
}

const ERROR_CLASSES = new Set(["Inaccuracy", "Mistake", "Miss", "Blunder"]);
// A threat to win material counts from two pawns' worth upwards (a knight for a
// pawn, the exchange); a single loose pawn is too common to mention on every move.
const WIN_THRESHOLD_CP = 200;

// Nominative and accusative with a possessive, e.g. "dein Turm" / "deinen Turm".
// `of` is the genitive ("den Verlust deines Turms"), `fork` the compound noun.
const NAMES: Record<PieceType, { nom: string; acc: string; of: string; gen: "m" | "f"; fork: string }> = {
  1: { nom: "Bauer", acc: "Bauern", of: "Bauern", gen: "m", fork: "Bauerngabel" },
  2: { nom: "Springer", acc: "Springer", of: "Springers", gen: "m", fork: "Springergabel" },
  3: { nom: "Läufer", acc: "Läufer", of: "Läufers", gen: "m", fork: "Läufergabel" },
  4: { nom: "Turm", acc: "Turm", of: "Turms", gen: "m", fork: "Turmgabel" },
  5: { nom: "Dame", acc: "Dame", of: "Dame", gen: "f", fork: "Damengabel" },
  6: { nom: "König", acc: "König", of: "Königs", gen: "m", fork: "Königsgabel" },
};

const fem = (t: PieceType) => NAMES[t].gen === "f";
const yourNom = (t: PieceType) => `${fem(t) ? "deine" : "dein"} ${NAMES[t].nom}`;
const yourAcc = (t: PieceType) => `${fem(t) ? "deine" : "deinen"} ${NAMES[t].acc}`;
const theirNom = (t: PieceType) => `${fem(t) ? "seine" : "sein"} ${NAMES[t].nom}`;
const yourOf = (t: PieceType) => `${fem(t) ? "deiner" : "deines"} ${NAMES[t].of}`;
const theirAcc = (t: PieceType) => `${fem(t) ? "seine" : "seinen"} ${NAMES[t].acc}`;
/** Dative after "mit": "mit deinem Springer", "mit einem Bauern". */
const withPiece = (t: PieceType) => (t === PAWN ? "einem Bauern" : `${fem(t) ? "deiner" : "deinem"} ${NAMES[t].nom}`);
const pronoun = (t: PieceType) => (fem(t) ? "sie" : "er");

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

const sameMove = (a: Move, b: Move) => a.from === b.from && a.to === b.to && (a.promotion ?? null) === (b.promotion ?? null);
const isLegal = (board: TBoard, m: Move) => board.legalMoves().some((x) => sameMove(x, m));

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
    if (!isLegal(b, m)) break;
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

/** Non-pawn pieces (and the king) of `victim` attacked from `sq`, most valuable first. */
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

/** The same position with the other side to move, or null when that is not a legal position. */
function passTurn(board: TBoard): TBoard | null {
  // The side to move is in check: it may not pass, the "threat" would be a king capture.
  if (board.isCheck()) return null;
  const b = board.copy();
  b.turn = !b.turn;
  b.epSquare = null;
  return b;
}

/** Fork targets of `move` (played by the side to move), or [] when it is no fork. */
function forkTargets(board: TBoard, move: Move): PieceType[] {
  const after = board.copy();
  after.push(move);
  const victim = !board.turn;
  const targets = attackedTargets(after, move.to, victim);
  // Cheap pre-check before the full motif detector.
  if (targets.length < 2) return [];
  return detectTacticalMotifs(board, after, move, board.turn).includes(TacticalTheme.FORK) ? targets : [];
}

interface Threat {
  kind: "mate" | "fork" | "win";
  move: Move;
  san: string;
  /** The moving piece. */
  piece: PieceType;
  /** Fork: the attacked pieces. Win: the piece that would be lost. */
  targets: PieceType[];
  /** Win: the square of the piece that would be lost. */
  square: number;
  /** Win: centipawns the attacker would gain. */
  gain: number;
}

/** What the side to move in `board` could do right now: mate, fork, win a piece. Most serious first. */
function threatsOf(board: TBoard): Threat[] {
  const out: Threat[] = [];
  const victim = !board.turn;
  const won = new Set<number>();
  for (const m of board.legalMoves()) {
    const piece = board.pieceAt(m.from);
    if (!piece) continue;
    const after = board.copy();
    after.push(m);
    if (after.isCheckmate()) {
      out.push({ kind: "mate", move: m, san: board.san(m), piece: piece.type, targets: [KING], square: m.to, gain: 0 });
      continue;
    }
    const fork = forkTargets(board, m);
    if (fork.length >= 2) {
      out.push({ kind: "fork", move: m, san: board.san(m), piece: piece.type, targets: fork, square: m.to, gain: 0 });
      continue;
    }
    const target = board.pieceAt(m.to);
    if (target && target.color === victim && target.type !== PAWN && !won.has(m.to)) {
      const gain = staticExchangeEvaluation(board, m.to, board.turn);
      if (gain >= WIN_THRESHOLD_CP) {
        won.add(m.to);
        // The exchange starts with the cheapest attacker; name that capture.
        const cheapest = board
          .legalMoves()
          .filter((x) => x.to === m.to && board.pieceAt(x.from))
          .sort((a, b) => PIECE_VALUES[board.pieceAt(a.from)!.type] - PIECE_VALUES[board.pieceAt(b.from)!.type])[0] ?? m;
        out.push({ kind: "win", move: cheapest, san: board.san(cheapest), piece: board.pieceAt(cheapest.from)!.type, targets: [target.type], square: m.to, gain });
      }
    }
  }
  const rank = (t: Threat) => (t.kind === "mate" ? 1000 : t.kind === "fork" ? 500 + Math.max(...t.targets.map((x) => (x === KING ? 99 : PIECE_VALUES[x]))) : t.gain / 100);
  return out.sort((a, b) => rank(b) - rank(a));
}

/** True when `t` (found in another position) still works for the side to move in `board`. */
function threatStillWorks(board: TBoard, t: Threat): boolean {
  if (t.kind === "win") {
    const p = board.pieceAt(t.square);
    return Boolean(p && p.color !== board.turn && p.type === t.targets[0] && staticExchangeEvaluation(board, t.square, board.turn) >= WIN_THRESHOLD_CP);
  }
  if (board.pieceAt(t.move.from)?.type !== t.piece || !isLegal(board, t.move)) return false;
  if (t.kind === "mate") {
    const after = board.copy();
    after.push(t.move);
    return after.isCheckmate();
  }
  return forkTargets(board, t.move).length >= 2;
}

/** "eine Springergabel auf e3 (Ne3)" */
const forkPhrase = (t: Threat) => `eine ${NAMES[t.piece].fork} auf ${squareName(t.move.to)} (${t.san})`;

/** An arrow for the board that shows the idea behind a sentence. */
export interface IdeaArrow {
  from: string;
  to: string;
  /** Whose idea: the mover's ("me") or the opponent's ("opp"). */
  by: "me" | "opp";
}

export interface Explanation {
  /** German sentences, most important first. */
  lines: string[];
  /** Arrows that show the moves the sentences talk about. */
  arrows: IdeaArrow[];
  /** Squares the sentences talk about (fork square, attacked pieces). */
  squares: string[];
}

interface Note {
  text: string;
  arrows: IdeaArrow[];
  squares: number[];
}

const arrowOf = (m: Move, by: IdeaArrow["by"]): IdeaArrow => ({ from: squareName(m.from), to: squareName(m.to), by });
const note = (text: string, arrows: IdeaArrow[] = [], squares: number[] = []): Note => ({ text, arrows, squares });

/** Squares of the pieces of `victim` attacked from `sq` (same filter as attackedTargets). */
function attackedSquares(board: TBoard, sq: number, victim: Color): number[] {
  return [...board.attacks(sq)].filter((t) => {
    const p = board.pieceAt(t);
    return p && p.color === victim && p.type !== PAWN;
  });
}

/** Sentence for a threat of the opponent that the move took away. */
function preventedNote(t: Threat, move: Move, before: TBoard): Note {
  // No arrow from a piece the move just took off the board.
  const marks = move.to === t.move.from ? [] : [arrowOf(t.move, "opp")];
  if (t.kind === "mate") return note(`Du verhinderst damit das drohende Matt durch ${t.san}.`, marks);
  if (t.kind === "fork") return note(`Du verhinderst damit ${forkPhrase(t)} gegen ${joinPieces(t.targets, yourAcc)}.`, marks, [t.move.to]);
  const victim = t.targets[0];
  const sq = squareName(t.square);
  if (move.from === t.square) return note(`Du bringst ${yourAcc(victim)} in Sicherheit: Auf ${sq} war ${pronoun(victim)} angegriffen und nicht ausreichend gedeckt.`, marks);
  if (move.to === t.move.from) return note(`Du schlägst die Figur, die ${yourAcc(victim)} auf ${sq} bedroht hat.`, marks, [t.square]);
  const captured = before.pieceAt(move.to);
  if (captured && captured.color !== before.turn) return note(`Du nimmst eine Figur, die ${yourAcc(victim)} auf ${sq} angegriffen hat.`, marks, [t.square]);
  return note(`Damit schützt du ${yourAcc(victim)} auf ${sq}, ${fem(victim) ? "die" : "den"} dein Gegner sonst mit ${t.san} gewonnen hätte.`, marks, [t.square]);
}

/** Pin or skewer set up by the slider on `sq` of `attacker`; `you` = the attacker is the mover. */
function rayNote(board: TBoard, sq: number, attacker: Color, san: string, you: boolean): Note | null {
  const own = you ? theirAcc : yourAcc;
  for (const [frontSq, front, rearSq, rear] of findSliderRayTargets(board, sq, attacker)) {
    const skewer = rear.type !== KING && front.type !== PAWN && PIECE_VALUES[front.type] > PIECE_VALUES[rear.type];
    const squares = [frontSq, rearSq];
    if (front.type === KING || skewer) {
      const lost = `geht ${you ? theirNom(rear.type) : yourNom(rear.type)} dahinter verloren`;
      return note(
        you
          ? `Mit ${san} spießt du ${own(front.type)} auf: Weicht ${pronoun(front.type)} aus, ${lost}.`
          : `Mit ${san} spießt dein Gegner ${own(front.type)} auf: Weicht ${pronoun(front.type)} aus, ${lost}.`,
        [],
        squares,
      );
    }
    if (rear.type === KING || rear.type === QUEEN || (rear.type === ROOK && front.type !== PAWN)) {
      return note(you ? `Mit ${san} fesselst du ${own(front.type)} an ${own(rear.type)}.` : `Mit ${san} fesselt dein Gegner ${own(front.type)} an ${own(rear.type)}.`, [], squares);
    }
  }
  return null;
}

/**
 * What the opponent's best reply does to the mover. `balance` is the mover's
 * material lead before the move, so a trade the move started is no loss.
 */
function replyNote(afterMove: TBoard, reply: Move, replySan: string, me: Color, balance: number): Note | null {
  const afterReply = afterMove.copy();
  afterReply.push(reply);
  const opp = !me;
  const motifs = detectTacticalMotifs(afterMove, afterReply, reply, opp);
  const captured = afterMove.pieceAt(reply.to);
  const marks = [arrowOf(reply, "opp")];

  if (motifs.includes(TacticalTheme.FORK)) {
    const targets = attackedTargets(afterReply, reply.to, me);
    if (targets.length >= 2) return note(`Dein Gegner antwortet ${replySan} und greift mit einer Gabel ${joinPieces(targets, yourAcc)} gleichzeitig an.`, marks, attackedSquares(afterReply, reply.to, me));
  }
  if (motifs.includes(TacticalTheme.PIN) || motifs.includes(TacticalTheme.SKEWER)) {
    const n = rayNote(afterReply, reply.to, opp, replySan, false);
    if (n) return { ...n, arrows: marks };
  }
  if (motifs.includes(TacticalTheme.DISCOVERED_ATTACK)) return note(`${replySan} ist ein Abzugsangriff: Dein Gegner zieht eine Figur weg und öffnet damit eine zweite Angriffslinie.`, marks);
  if (motifs.includes(TacticalTheme.BACK_RANK)) return note(`Deine Grundreihe ist schwach: ${replySan} nutzt aus, dass dein König kein Luftloch hat.`, marks);
  if (captured && captured.color === me && captured.type !== PAWN && material(afterReply, me) - material(afterReply, opp) < balance) {
    const t = captured.type;
    const free = legalDefenders(afterMove, me, reply.to).length === 0;
    const capturer = afterMove.pieceAt(reply.from);
    // A recapturable trade is no loss; only free pieces or captures by a cheaper piece are.
    if (free) return note(`Dein Gegner schlägt mit ${replySan} ${fem(t) ? "deine ungedeckte" : "deinen ungedeckten"} ${NAMES[t].acc}.`, marks);
    if (capturer && PIECE_VALUES[capturer.type] < PIECE_VALUES[t]) return note(`Dein Gegner schlägt mit ${replySan} ${yourAcc(t)} und gewinnt Material, auch wenn du zurückschlägst.`, marks);
  }
  return null;
}

/** The opponent's threats before the move (he would play them if it were his turn). */
function opponentThreats(before: TBoard): Threat[] {
  const passed = passTurn(before);
  return passed ? threatsOf(passed) : [];
}

/** Threats of the opponent that `move` takes away. */
function preventedBy(before: TBoard, move: Move, threats: Threat[]): Threat[] {
  if (!threats.length) return [];
  const after = before.copy();
  after.push(move);
  // A check only postpones the threat; the opponent must answer it first.
  if (after.isCheck()) return [];
  return threats.filter((t) => !threatStillWorks(after, t));
}

/** Notes for a good move: what it does, what it stops, what it threatens. */
function explainGood(before: TBoard, move: Move, san: string, input: ExplainInput): Note[] {
  const me = before.turn;
  const after = before.copy();
  after.push(move);
  const out: Note[] = [];
  const piece = before.pieceAt(move.from);
  if (!piece) return out;
  if (after.isCheckmate()) return [note("Schachmatt! Damit ist die Partie entschieden.")];

  const mateAfter = input.mateAfter ?? null;
  const sign = me ? 1 : -1;
  if (mateAfter !== null && sign * mateAfter > 0) {
    const n = Math.abs(mateAfter);
    const line = playLine(after, input.replyPv, n * 2 - 1);
    out.push(note(`Damit erzwingst du Matt in ${n} ${n === 1 ? "Zug" : "Zügen"}${line.sans.length ? `: ${lineText([san, ...line.sans], before, n * 2 - 1)}` : ""}.`));
  }

  const motifs = detectTacticalMotifs(before, after, move, me);
  const captured = before.pieceAt(move.to);
  const diff = (b: TBoard) => material(b, me) - material(b, !me);

  if (motifs.includes(TacticalTheme.SACRIFICE)) {
    out.push(note(`Mit ${san} opferst du ${yourAcc(piece.type)} – und die Engine bestätigt, dass sich das lohnt.`));
  }
  if (motifs.includes(TacticalTheme.FORK)) {
    const targets = attackedTargets(after, move.to, !me);
    if (targets.length >= 2) {
      const squares = attackedSquares(after, move.to, !me);
      out.push(
        note(
          `Mit ${san} greifst du mit einer ${NAMES[piece.type].fork} ${joinPieces(targets, theirAcc)} gleichzeitig an.`,
          squares.map((t) => ({ from: squareName(move.to), to: squareName(t), by: "me" as const })),
          squares,
        ),
      );
    }
  } else if (motifs.includes(TacticalTheme.PIN) || motifs.includes(TacticalTheme.SKEWER)) {
    const n = rayNote(after, move.to, me, san, true);
    if (n) out.push(n);
  } else if (motifs.includes(TacticalTheme.DISCOVERED_ATTACK)) {
    out.push(note(`${san} ist ein Abzugsangriff: Du ziehst eine Figur weg und öffnest damit eine zweite Angriffslinie.`));
  }

  const evens = diff(before) < 0 && diff(after) >= 0;
  const prev = input.previousMove;
  const isCapture = Boolean(captured && captured.color !== me);
  // Without the previous move, only call it a recapture when nothing can take back.
  const recapture =
    isCapture && (prev ? prev.san.includes("x") && prev.uci.slice(2, 4) === input.uci.slice(2, 4) : evens && legalDefenders(before, !me, move.to).length === 0);

  // The opponent's threats this move took care of. Taking back the piece that
  // just captured goes without saying.
  const prevented = preventedBy(before, move, opponentThreats(before)).filter((t) => !(recapture && t.move.from === move.to));
  if (prevented.length && out.length < 2) out.push(preventedNote(prevented[0], move, before));

  if (captured && isCapture && out.length < 2) {
    const t = captured.type;
    const free = legalDefenders(before, !me, move.to).length === 0;
    if (recapture) out.push(note(evens ? "Du schlägst zurück und gleichst das Material wieder aus." : "Du schlägst zurück."));
    else if (t !== PAWN && free) out.push(note(`Du schlägst ${fem(t) ? "die ungedeckte" : "den ungedeckten"} ${NAMES[t].acc} auf ${squareName(move.to)}.`));
    else if (t !== PAWN && PIECE_VALUES[piece.type] < PIECE_VALUES[t] && piece.type !== KING) out.push(note(`Du schlägst ${theirAcc(t)} mit ${withPiece(piece.type)} und gewinnst Material.`));
  }

  // Material the engine line wins, when no sentence above already says so.
  if (!out.length && input.replyPv.length) {
    const line = playLine(before, [input.uci, ...input.replyPv], 7);
    if (line.boards.length > 3) {
      // The worse of the last two positions, so a line cut off mid-exchange
      // does not count a piece that is about to be taken back.
      const gain = Math.min(...line.boards.slice(-2).map(diff)) - diff(before);
      if (gain >= 1) out.push(note(`Nach ${lineText(line.sans, before, 7)} gewinnst du ${materialWords(gain)}.`));
    }
  }

  // New threats: what the mover could do next if the opponent ignored the move.
  if (out.length < 2) {
    const passed = passTurn(after);
    if (passed) {
      const old = threatsOf(before);
      const known = (t: Threat) => old.some((o) => o.kind === t.kind && o.square === t.square && o.move.to === t.move.to);
      const t = threatsOf(passed).find((x) => !known(x));
      const marks = t ? [arrowOf(t.move, "me")] : [];
      if (t?.kind === "mate") out.push(note(`Du drohst Matt mit ${t.san}.`, marks));
      else if (t?.kind === "fork") out.push(note(`Du drohst ${forkPhrase(t)} gegen ${joinPieces(t.targets, theirAcc)}.`, marks, [t.move.to]));
      else if (t?.kind === "win") {
        const victim = t.targets[0];
        const by = t.piece !== KING && PIECE_VALUES[t.piece] < PIECE_VALUES[victim] ? ` mit ${withPiece(t.piece)}` : "";
        const where = `${theirAcc(victim)} auf ${squareName(t.square)}`;
        out.push(note(by ? `Du greifst ${where}${by} an.` : `Du greifst ${where} an, ${fem(victim) ? "die" : "der"} nicht ausreichend gedeckt ist.`, marks, [t.square]));
      }
    }
  }

  if (!out.length && piece.type === KING && Math.abs(move.to - move.from) === 2) {
    out.push(note("Du rochierst: Dein König steht sicherer und dein Turm kommt ins Spiel."));
  }
  if (move.promotion === QUEEN) out.push(note("Du wandelst deinen Bauern in eine Dame um."));
  else if (move.promotion === KNIGHT) out.push(note("Du wandelst in einen Springer um – genau das richtige Stück für diese Stellung."));
  return out;
}

/** Notes for an error: the refutation, what it costs, and what the better move did. */
function explainError(before: TBoard, move: Move, input: ExplainInput, playedBest: boolean): Note[] {
  const me = before.turn;
  const afterMove = before.copy();
  afterMove.push(move);
  const out: Note[] = [];
  const sign = me ? 1 : -1;

  // Allowed mate.
  const mateAfter = input.mateAfter ?? null;
  if (mateAfter !== null && sign * mateAfter < 0 && !afterMove.isCheckmate()) {
    const n = Math.abs(mateAfter);
    const line = playLine(afterMove, input.replyPv, n * 2 - 1);
    out.push(note(`Danach kann dein Gegner in ${n} ${n === 1 ? "Zug" : "Zügen"} mattsetzen${line.sans.length ? `: ${lineText(line.sans, afterMove, n * 2 - 1)}` : ""}.`, line.moves.slice(0, 1).map((m) => arrowOf(m, "opp"))));
  }

  // The opponent's threats before the move: an ignored one is worth saying so.
  const threats = opponentThreats(before);
  const reply = playLine(afterMove, input.replyPv, 8);
  const ignored = reply.moves.length ? threats.find((t) => sameMove(t.move, reply.moves[0]) || (t.kind === "win" && t.square === reply.moves[0].to)) : undefined;

  // The opponent's best reply, read as a motif or a capture.
  if (reply.moves.length && !out.length) {
    const n = replyNote(afterMove, reply.moves[0], reply.sans[0], me, material(before, me) - material(before, !me));
    if (n) out.push(ignored ? { ...n, text: `Du hast die Drohung übersehen: ${n.text}` } : n);
  }

  // Material the forced line costs, when no motif already says it.
  if (reply.boards.length > 2) {
    const diff = (b: TBoard) => material(b, me) - material(b, !me);
    // The better of the last two positions, so a line cut off mid-exchange
    // does not count a piece that is about to be taken back.
    const ends = reply.boards.slice(-2).map(diff);
    const total = diff(before) - Math.max(...ends);
    if (total >= 1 && out.length < 2) {
      out.push(note(`Nach der besten Antwort ${lineText(reply.sans, afterMove, 6)} verlierst du ${materialWords(total)}.`, out.length ? [] : [arrowOf(reply.moves[0], "opp")]));
    }
  }

  // A piece left hanging by the move itself.
  if (!out.length) {
    const hangingBefore = new Set(getHangingPieces(before, me).map((h) => h.square));
    const fresh = getHangingPieces(afterMove, me, move, before).filter((h) => !hangingBefore.has(h.square) && h.piece_type !== PAWN);
    const worst = fresh.sort((a, b) => PIECE_VALUES[b.piece_type as PieceType] - PIECE_VALUES[a.piece_type as PieceType])[0];
    if (worst) out.push(note(`Nach diesem Zug ist ${yourNom(worst.piece_type as PieceType)} auf ${worst.square} nicht mehr ausreichend gedeckt.`, [], [worst.square_index]));
  }

  // What the better move would have done (the board already shows it as an arrow).
  if (!playedBest && input.bestPv.length) {
    const best = playLine(before, input.bestPv, 6);
    if (best.moves.length) {
      const bm = best.moves[0];
      const bSan = best.sans[0];
      const mateBefore = input.mateBefore ?? null;
      const afterBest = best.boards[1];
      const bestMotifs = detectTacticalMotifs(before, afterBest, bm, me);
      const target = before.pieceAt(bm.to);
      // The threat the game move ignored and the better move would have stopped.
      const stopped = ignored && preventedBy(before, bm, [ignored]).length ? ignored : null;
      if (mateBefore !== null && sign * mateBefore > 0) {
        out.push(note(`Du hattest Matt in ${Math.abs(mateBefore)}: ${lineText(best.sans, before, Math.abs(mateBefore) * 2 - 1)}.`));
      } else if (bestMotifs.includes(TacticalTheme.FORK)) {
        const targets = attackedTargets(afterBest, bm.to, !me);
        out.push(note(`Besser war ${bSan}: Damit greifst du mit einer Gabel ${joinPieces(targets, theirAcc)} gleichzeitig an.`));
      } else if (target && target.color !== me && target.type !== PAWN && legalDefenders(before, !me, bm.to).length === 0) {
        out.push(note(`Besser war ${bSan}: ${fem(target.type) ? "Die" : "Der"} gegnerische ${NAMES[target.type].nom} auf ${squareName(bm.to)} war ungedeckt.`));
      } else if (stopped) {
        const what = stopped.kind === "mate" ? `das Matt durch ${stopped.san}` : stopped.kind === "fork" ? forkPhrase(stopped) : `den Verlust ${yourOf(stopped.targets[0])}`;
        out.push(note(`Besser war ${bSan}: Damit verhinderst du ${what}.`));
      } else if (bestMotifs.includes(TacticalTheme.PIN)) {
        out.push(note(`Besser war ${bSan} mit einer Fesselung.`));
      } else if (bestMotifs.includes(TacticalTheme.SKEWER)) {
        out.push(note(`Besser war ${bSan} mit einem Spieß.`));
      } else if (out.length < 2) {
        out.push(note(`Besser war ${lineText(best.sans, before, 3)}.`));
      }
    }
  }
  return out;
}

const EMPTY: Explanation = { lines: [], arrows: [], squares: [] };

/**
 * Explains a move in German sentences, most important first, with the arrows
 * and squares they talk about. Empty when nothing concrete can be said (quiet
 * positional moves).
 */
export function explainMoveDetailed(input: ExplainInput): Explanation {
  let before: TBoard;
  let move: Move;
  try {
    before = new Board(input.fenBefore);
    move = moveFromUci(input.uci);
  } catch {
    return EMPTY;
  }
  if (!before.legalMoves().some((x) => x.from === move.from && x.to === move.to)) return EMPTY;
  const playedBest = input.bestPv[0]?.slice(0, 4) === input.uci.slice(0, 4);
  const good = input.classification ? !ERROR_CLASSES.has(input.classification) : playedBest;
  const notes = (good ? explainGood(before, move, before.san(move), input) : explainError(before, move, input, playedBest)).slice(0, 3);
  return {
    lines: notes.map((n) => n.text),
    arrows: notes.flatMap((n) => n.arrows),
    squares: [...new Set(notes.flatMap((n) => n.squares))].map(squareName),
  };
}

/** The sentences of explainMoveDetailed() alone. */
export function explainMove(input: ExplainInput): string[] {
  return explainMoveDetailed(input).lines;
}
