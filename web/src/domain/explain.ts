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
import { type Cause, describeIdea, detectCauses, type Idea } from "./explainCauses";
import { findSliderRayTargets, legalDefenders } from "./tactics/board_utils";
import { PIECE_VALUES, TacticalTheme } from "./tactics/constants";
import { getHangingPieces } from "./tactics/hanging";
import { detectTacticalMotifs } from "./tactics/motifs";
import { staticExchangeEvaluation } from "./tactics/see";
import { lang, t } from "../i18n";

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
  /** Winning chance (0..1) from the mover's view before and after the move; lets an error without a concrete cause say how the position shifted. */
  winBefore?: number;
  winAfter?: number;
}

const ERROR_CLASSES = new Set(["Inaccuracy", "Mistake", "Miss", "Blunder"]);
// A threat to win material counts from two pawns' worth upwards (a knight for a
// pawn, the exchange); a single loose pawn is too common to mention on every move.
const WIN_THRESHOLD_CP = 200;

// Nominative and accusative with a possessive, e.g. "dein Turm" / "deinen Turm".
// `of` is the genitive ("den Verlust deines Turms"), `fork` the compound noun.
const NAMES: Record<PieceType, { nom: string; acc: string; of: string; gen: "m" | "f"; fork: string }> = {
  1: { nom: t("Bauer"), acc: t("Bauern"), of: t("Bauern"), gen: "m", fork: t("Bauerngabel") },
  2: { nom: t("Springer"), acc: t("Springer"), of: t("Springers"), gen: "m", fork: t("Springergabel") },
  3: { nom: t("Läufer"), acc: t("Läufer"), of: t("Läufers"), gen: "m", fork: t("Läufergabel") },
  4: { nom: t("Turm"), acc: t("Turm"), of: t("Turms"), gen: "m", fork: t("Turmgabel") },
  5: { nom: t("Dame"), acc: t("Dame"), of: t("Dame"), gen: "f", fork: t("Damengabel") },
  6: { nom: t("König"), acc: t("König"), of: t("Königs"), gen: "m", fork: t("Königsgabel") },
};

// German needs gender and case; English has one form ("your knight", "it").
// i18n: the German words below are grammar, not texts to translate.
const en = () => lang() === "en";
const fem = (tk: PieceType) => NAMES[tk].gen === "f";
// i18n: grammar
const yourNom = (tk: PieceType) => (en() ? `your ${NAMES[tk].nom}` : `${fem(tk) ? "deine" : "dein"} ${NAMES[tk].nom}`);
// i18n: grammar
const yourAcc = (tk: PieceType) => (en() ? `your ${NAMES[tk].acc}` : `${fem(tk) ? "deine" : "deinen"} ${NAMES[tk].acc}`);
// i18n: grammar
const theirNom = (tk: PieceType) => (en() ? `their ${NAMES[tk].nom}` : `${fem(tk) ? "seine" : "sein"} ${NAMES[tk].nom}`);
// i18n: grammar
const yourOf = (tk: PieceType) => (en() ? `your ${NAMES[tk].of}` : `${fem(tk) ? "deiner" : "deines"} ${NAMES[tk].of}`);
// i18n: grammar
const theirAcc = (tk: PieceType) => (en() ? `their ${NAMES[tk].acc}` : `${fem(tk) ? "seine" : "seinen"} ${NAMES[tk].acc}`);
/** Dative after "mit": "mit deinem Springer", "mit einem Bauern". */
// i18n: grammar
const withPiece = (tk: PieceType) => (tk === PAWN ? t("einem Bauern") : en() ? `your ${NAMES[tk].nom}` : `${fem(tk) ? "deiner" : "deinem"} ${NAMES[tk].nom}`);
// i18n: grammar
const pronoun = (tk: PieceType) => (en() ? "it" : fem(tk) ? "sie" : "er");
/** Article or relative pronoun that follows the piece's gender in German. */
// i18n: grammar
const ARTICLE_EN: Record<string, string> = { die: "which", der: "which", den: "which", Die: "The", Der: "The", "deine ungedeckte": "your undefended", "deinen ungedeckten": "your undefended", "die ungedeckte": "the undefended", "den ungedeckten": "the undefended" };
const art = (de: string) => (en() ? (ARTICLE_EN[de] ?? de) : de);

function material(board: TBoard, color: Color): number {
  let sum = 0;
  for (const [, p] of board.pieceMap()) if (p.color === color) sum += PIECE_VALUES[p.type];
  return sum;
}

function materialWords(v: number): string {
  if (v >= 9) return t("die Dame oder entsprechend viel Material");
  if (v >= 5) return t("einen Turm oder entsprechend viel Material");
  if (v >= 3) return t("eine Figur");
  if (v === 2) return t("die Qualität oder zwei Bauern");
  return t("einen Bauern");
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
  for (const tk of board.attacks(sq)) {
    const p = board.pieceAt(tk);
    if (p && p.color === victim && p.type !== PAWN) out.push(p.type);
  }
  return out.sort((a, b) => (b === KING ? 99 : PIECE_VALUES[b]) - (a === KING ? 99 : PIECE_VALUES[a]));
}

function joinPieces(types: PieceType[], fmt: (tk: PieceType) => string): string {
  const parts = types.slice(0, 3).map(fmt);
  return parts.length > 1 ? t("{list} und {last}", { list: parts.slice(0, -1).join(", "), last: parts[parts.length - 1] }) : parts[0] ?? "";
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
  const rank = (tk: Threat) => (tk.kind === "mate" ? 1000 : tk.kind === "fork" ? 500 + Math.max(...tk.targets.map((x) => (x === KING ? 99 : PIECE_VALUES[x]))) : tk.gain / 100);
  return out.sort((a, b) => rank(b) - rank(a));
}

/** True when `t` (found in another position) still works for the side to move in `board`. */
function threatStillWorks(board: TBoard, tk: Threat): boolean {
  if (tk.kind === "win") {
    const p = board.pieceAt(tk.square);
    return Boolean(p && p.color !== board.turn && p.type === tk.targets[0] && staticExchangeEvaluation(board, tk.square, board.turn) >= WIN_THRESHOLD_CP);
  }
  if (board.pieceAt(tk.move.from)?.type !== tk.piece || !isLegal(board, tk.move)) return false;
  if (tk.kind === "mate") {
    const after = board.copy();
    after.push(tk.move);
    return after.isCheckmate();
  }
  return forkTargets(board, tk.move).length >= 2;
}

/** "eine Springergabel auf e3 (Ne3)" */
const forkPhrase = (tk: Threat) => t("eine {fork} auf {squareName} ({san})", { fork: NAMES[tk.piece].fork, squareName: squareName(tk.move.to), san: tk.san });

/** An arrow for the board that shows the idea behind a sentence. */
export interface IdeaArrow {
  from: string;
  to: string;
  /** Whose idea: the mover's ("me") or the opponent's ("opp"). */
  by: "me" | "opp";
}

export interface Explanation {
  /** Sentences in the page's language, most important first. */
  lines: string[];
  /** True when a sentence names the better move or the mate that was missed (language independent). */
  betterMove: boolean;
  /** The sentences that only repeat the better move ("Besser war Sxe5 mit einer Fesselung."), without a reason of their own. */
  bareBetter: string[];
  /** Arrows that show the moves the sentences talk about. */
  arrows: IdeaArrow[];
  /** Squares the sentences talk about (fork square, attacked pieces). */
  squares: string[];
}

interface Note {
  text: string;
  /** Names the better move (or the missed mate). */
  better?: boolean;
  /** Names the better move and nothing more. */
  bare?: boolean;
  arrows: IdeaArrow[];
  squares: number[];
}

const arrowOf = (m: Move, by: IdeaArrow["by"]): IdeaArrow => ({ from: squareName(m.from), to: squareName(m.to), by });
const note = (text: string, arrows: IdeaArrow[] = [], squares: number[] = []): Note => ({ text, arrows, squares });
const betterNote = (text: string, bare = false): Note => ({ ...note(text), better: true, bare });

/** Squares of the pieces of `victim` attacked from `sq` (same filter as attackedTargets). */
function attackedSquares(board: TBoard, sq: number, victim: Color): number[] {
  return [...board.attacks(sq)].filter((tk) => {
    const p = board.pieceAt(tk);
    return p && p.color === victim && p.type !== PAWN;
  });
}

/** Sentence for a threat of the opponent that the move took away. */
function preventedNote(tk: Threat, move: Move, before: TBoard): Note {
  // No arrow from a piece the move just took off the board.
  const marks = move.to === tk.move.from ? [] : [arrowOf(tk.move, "opp")];
  if (tk.kind === "mate") return note(t("Du verhinderst damit das drohende Matt durch {san}.", { san: tk.san }), marks);
  if (tk.kind === "fork") return note(t("Du verhinderst damit {forkPhrase} gegen {joinPieces}.", { forkPhrase: forkPhrase(tk), joinPieces: joinPieces(tk.targets, yourAcc) }), marks, [tk.move.to]);
  const victim = tk.targets[0];
  const sq = squareName(tk.square);
  if (move.from === tk.square) return note(t("Du bringst {yourAcc} in Sicherheit: Auf {sq} war {pronoun} angegriffen und nicht ausreichend gedeckt.", { yourAcc: yourAcc(victim), sq, pronoun: pronoun(victim) }), marks);
  if (move.to === tk.move.from) return note(t("Du schlägst die Figur, die {yourAcc} auf {sq} bedroht hat.", { yourAcc: yourAcc(victim), sq }), marks, [tk.square]);
  const captured = before.pieceAt(move.to);
  if (captured && captured.color !== before.turn) return note(t("Du nimmst eine Figur, die {yourAcc} auf {sq} angegriffen hat.", { yourAcc: yourAcc(victim), sq }), marks, [tk.square]);
  return note(t("Damit schützt du {yourAcc} auf {sq}, {2} dein Gegner sonst mit {san} gewonnen hätte.", { yourAcc: yourAcc(victim), sq, 2: art(fem(victim) ? "die" : "den"), san: tk.san }), marks, [tk.square]);
}

/** Pin or skewer set up by the slider on `sq` of `attacker`; `you` = the attacker is the mover. */
function rayNote(board: TBoard, sq: number, attacker: Color, san: string, you: boolean): Note | null {
  const own = you ? theirAcc : yourAcc;
  for (const [frontSq, front, rearSq, rear] of findSliderRayTargets(board, sq, attacker)) {
    const skewer = rear.type !== KING && front.type !== PAWN && PIECE_VALUES[front.type] > PIECE_VALUES[rear.type];
    const squares = [frontSq, rearSq];
    if (front.type === KING || skewer) {
      const lost = t("geht {0} dahinter verloren", { 0: you ? theirNom(rear.type) : yourNom(rear.type) });
      return note(
        you
          ? t("Mit {san} spießt du {own} auf: Weicht {pronoun} aus, {lost}.", { san, own: own(front.type), pronoun: pronoun(front.type), lost })
          : t("Mit {san} spießt dein Gegner {own} auf: Weicht {pronoun} aus, {lost}.", { san, own: own(front.type), pronoun: pronoun(front.type), lost }),
        [],
        squares,
      );
    }
    if (rear.type === KING || rear.type === QUEEN || (rear.type === ROOK && front.type !== PAWN)) {
      return note(you ? t("Mit {san} fesselst du {own} an {own2}.", { san, own: own(front.type), own2: own(rear.type) }) : t("Mit {san} fesselt dein Gegner {own} an {own2}.", { san, own: own(front.type), own2: own(rear.type) }), [], squares);
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
    if (targets.length >= 2) return note(t("Dein Gegner antwortet {replySan} und greift mit einer Gabel {joinPieces} gleichzeitig an.", { replySan, joinPieces: joinPieces(targets, yourAcc) }), marks, attackedSquares(afterReply, reply.to, me));
  }
  if (motifs.includes(TacticalTheme.PIN) || motifs.includes(TacticalTheme.SKEWER)) {
    const n = rayNote(afterReply, reply.to, opp, replySan, false);
    if (n) return { ...n, arrows: marks };
  }
  if (motifs.includes(TacticalTheme.DISCOVERED_ATTACK)) return note(t("{replySan} ist ein Abzugsangriff: Dein Gegner zieht eine Figur weg und öffnet damit eine zweite Angriffslinie.", { replySan }), marks);
  if (motifs.includes(TacticalTheme.BACK_RANK)) return note(t("Deine Grundreihe ist schwach: {replySan} nutzt aus, dass dein König kein Luftloch hat.", { replySan }), marks);
  if (captured && captured.color === me && captured.type !== PAWN && material(afterReply, me) - material(afterReply, opp) < balance) {
    const tk = captured.type;
    const free = legalDefenders(afterMove, me, reply.to).length === 0;
    const capturer = afterMove.pieceAt(reply.from);
    // A recapturable trade is no loss; only free pieces or captures by a cheaper piece are.
    if (free) return note(t("Dein Gegner schlägt mit {replySan} {1} {acc}.", { replySan, 1: art(fem(tk) ? "deine ungedeckte" : "deinen ungedeckten"), acc: NAMES[tk].acc }), marks);
    if (capturer && PIECE_VALUES[capturer.type] < PIECE_VALUES[tk]) return note(t("Dein Gegner schlägt mit {replySan} {yourAcc} und gewinnt Material, auch wenn du zurückschlägst.", { replySan, yourAcc: yourAcc(tk) }), marks);
  }
  return null;
}


/** How a winning chance (0..1, mover's view) reads in words, for "the position was X, now it is Y". */
function standingWords(p: number): string {
  if (p >= 0.9) return t("für dich gewonnen");
  if (p >= 0.72) return t("für dich klar besser");
  if (p >= 0.57) return t("für dich etwas besser");
  if (p > 0.43) return t("ausgeglichen");
  if (p > 0.28) return t("für dich etwas schlechter");
  if (p > 0.1) return t("für dich klar schlechter");
  return t("für dich verloren");
}

/** The shift of the position in words, when it crossed a threshold; null otherwise. */
function shiftNote(input: ExplainInput): Note | null {
  if (input.winBefore === undefined || input.winAfter === undefined) return null;
  const a = standingWords(input.winBefore);
  const b = standingWords(input.winAfter);
  if (a !== b) return note(t("Die Stellung war {a}, jetzt ist sie {b}.", { a, b }));
  return note(t("Die Stellung bleibt zwar {a}, aber der Zug war nicht der genaueste."));
}

/** The idea of a move as a clause that follows "Mit Nf3 …" / "Damit …" (verb first, "du" as subject). */
function ideaClause(idea: Idea): string {
  const listed = (types: { type: PieceType; square: string }[]) => {
    const parts = types.map((x) => t("{piece} auf {square}", { piece: theirAcc(x.type), square: x.square }));
    return parts.length > 1 ? t("{list} und {last}", { list: parts.slice(0, -1).join(", "), last: parts[parts.length - 1] }) : parts[0];
  };
  switch (idea.kind) {
    case "castle":
      return t("rochierst du: Dein König steht sicherer und dein Turm kommt ins Spiel");
    case "promote":
      return t("wandelst du deinen Bauern um");
    case "check":
      return t("gibst du Schach und behältst die Initiative");
    case "capture":
      return t("schlägst du {theirAcc} auf {square}", { theirAcc: theirAcc(idea.victim), square: idea.square });
    case "pawn-attack":
      return t("greifst du den Bauern auf {square} an", { square: idea.square });
    case "attack":
      return t("greifst du {listed} an", { listed: listed(idea.targets) });
    case "develop":
      return t("entwickelst du {yourAcc} nach {square}", { yourAcc: yourAcc(idea.piece), square: idea.square });
    case "center-pawn":
      return t("besetzt du das Zentrum");
    case "rook-file":
      return idea.open
        ? t("stellst du deinen Turm auf die offene {file}-Linie", { file: idea.file })
        : t("stellst du deinen Turm auf die halboffene {file}-Linie", { file: idea.file });
    case "central-piece":
      return t("stellst du {yourAcc} zentral auf {square}, wo {pronoun} mehr Felder kontrolliert", { yourAcc: yourAcc(idea.piece), square: idea.square, pronoun: pronoun(idea.piece) });
    case "retreat":
      return t("ziehst du {yourAcc} nach {square} aus dem Angriff", { yourAcc: yourAcc(idea.piece), square: idea.square });
    case "king":
      return t("ziehst du deinen König nach {square}", { square: idea.square });
    default:
      return t("ziehst du {yourAcc} nach {square}", { yourAcc: yourAcc(idea.piece), square: idea.square });
  }
}

/** Sentence for a board-based cause of an error. */
function causeNote(c: Cause): Note {
  switch (c.kind) {
    case "missed-win":
      return note(t("Du hättest mit {lineText} {materialWords} gewonnen.", { lineText: c.sans.slice(0, 4).join(" "), materialWords: materialWords(c.gain) }));
    case "missed-promotion":
      return note(t("Mit {san} hättest du deinen Bauern auf {square} umgewandelt.", { san: c.san, square: c.square }));
    case "missed-passed-pawn":
      return note(t("{san} hätte einen Freibauern auf {square} geschaffen, den dein Gegner kaum aufhalten kann.", { san: c.san, square: c.square }));
    case "allowed-promotion":
      return note(t("Dein Gegner kommt mit {san} zur Umwandlung auf {square}.", { san: c.san, square: c.square }));
    case "allowed-passed-pawn":
      return note(t("Dein Gegner schiebt mit {san} einen Freibauern bis {square}.", { san: c.san, square: c.square }));
    case "missed-recapture":
      return note(t("Du hast nicht zurückgeschlagen: {san} auf {square} war nötig.", { san: c.san, square: c.square }));
    case "king-weakened":
      return note(t("Mit {san} verlässt ein Schutzbauer deinen König ({square}): Er steht jetzt offener und die gegnerische Dame kann das nutzen.", { san: c.san, square: c.square }));
    case "castling-lost":
      return note(t("Du verlierst das Recht zu rochieren, bevor dein König in Sicherheit ist."));
    case "endgame-trade":
      return note(c.queens ? t("Der Damentausch führt in ein Endspiel, in dem dein Gegner besser dasteht.") : t("Der Abtausch führt in ein Endspiel, das für dich schlechter steht."));
    case "bishop-pair":
      return note(t("Du gibst das Läuferpaar auf, und dein Gegner behält seine beiden Läufer."));
    case "isolated-pawn":
      return note(t("Dein Bauer auf {square} hat keine Nachbarbauern mehr und ist leicht anzugreifen.", { square: c.square }));
    case "doubled-pawns":
      return note(t("Auf der {file}-Linie stehen jetzt zwei deiner Bauern hintereinander (Doppelbauern).", { file: c.file }));
    default:
      return note(t("Dein Springer auf {square} steht am Rand und kontrolliert nur wenige Felder.", { square: c.square }));
  }
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
  return threats.filter((tk) => !threatStillWorks(after, tk));
}

/** Notes for a good move: what it does, what it stops, what it threatens. */
function explainGood(before: TBoard, move: Move, san: string, input: ExplainInput): Note[] {
  const me = before.turn;
  const after = before.copy();
  after.push(move);
  const out: Note[] = [];
  const piece = before.pieceAt(move.from);
  if (!piece) return out;
  if (after.isCheckmate()) return [note(t("Schachmatt! Damit ist die Partie entschieden."))];

  const mateAfter = input.mateAfter ?? null;
  const sign = me ? 1 : -1;
  if (mateAfter !== null && sign * mateAfter > 0) {
    const n = Math.abs(mateAfter);
    const line = playLine(after, input.replyPv, n * 2 - 1);
    out.push(note(t("Damit erzwingst du Matt in {n} {1}{2}.", { n, 1: n === 1 ? t("Zug") : t("Zügen"), 2: line.sans.length ? `: ${lineText([san, ...line.sans], before, n * 2 - 1)}` : "" })));
  }

  const motifs = detectTacticalMotifs(before, after, move, me);
  const captured = before.pieceAt(move.to);
  const diff = (b: TBoard) => material(b, me) - material(b, !me);

  if (motifs.includes(TacticalTheme.SACRIFICE)) {
    out.push(note(t("Mit {san} opferst du {yourAcc} – und die Engine bestätigt, dass sich das lohnt.", { san, yourAcc: yourAcc(piece.type) })));
  }
  if (motifs.includes(TacticalTheme.FORK)) {
    const targets = attackedTargets(after, move.to, !me);
    if (targets.length >= 2) {
      const squares = attackedSquares(after, move.to, !me);
      out.push(
        note(
          t("Mit {san} greifst du mit einer {fork} {joinPieces} gleichzeitig an.", { san, fork: NAMES[piece.type].fork, joinPieces: joinPieces(targets, theirAcc) }),
          squares.map((tk) => ({ from: squareName(move.to), to: squareName(tk), by: "me" as const })),
          squares,
        ),
      );
    }
  } else if (motifs.includes(TacticalTheme.PIN) || motifs.includes(TacticalTheme.SKEWER)) {
    const n = rayNote(after, move.to, me, san, true);
    if (n) out.push(n);
  } else if (motifs.includes(TacticalTheme.DISCOVERED_ATTACK)) {
    out.push(note(t("{san} ist ein Abzugsangriff: Du ziehst eine Figur weg und öffnest damit eine zweite Angriffslinie.", { san })));
  }

  const evens = diff(before) < 0 && diff(after) >= 0;
  const prev = input.previousMove;
  const isCapture = Boolean(captured && captured.color !== me);
  // Without the previous move, only call it a recapture when nothing can take back.
  const recapture =
    isCapture && (prev ? prev.san.includes("x") && prev.uci.slice(2, 4) === input.uci.slice(2, 4) : evens && legalDefenders(before, !me, move.to).length === 0);

  // The opponent's threats this move took care of. Taking back the piece that
  // just captured goes without saying.
  const prevented = preventedBy(before, move, opponentThreats(before)).filter((tk) => !(recapture && tk.move.from === move.to));
  if (prevented.length && out.length < 2) out.push(preventedNote(prevented[0], move, before));

  if (captured && isCapture && out.length < 2) {
    const tk = captured.type;
    const free = legalDefenders(before, !me, move.to).length === 0;
    if (recapture) out.push(note(evens ? t("Du schlägst zurück und gleichst das Material wieder aus.") : t("Du schlägst zurück.")));
    else if (tk !== PAWN && free) out.push(note(t("Du schlägst {0} {acc} auf {squareName}.", { 0: art(fem(tk) ? "die ungedeckte" : "den ungedeckten"), acc: NAMES[tk].acc, squareName: squareName(move.to) })));
    else if (tk !== PAWN && PIECE_VALUES[piece.type] < PIECE_VALUES[tk] && piece.type !== KING) out.push(note(t("Du schlägst {theirAcc} mit {withPiece} und gewinnst Material.", { theirAcc: theirAcc(tk), withPiece: withPiece(piece.type) })));
  }

  // Material the engine line wins, when no sentence above already says so.
  if (!out.length && input.replyPv.length) {
    const line = playLine(before, [input.uci, ...input.replyPv], 7);
    if (line.boards.length > 3) {
      // The worse of the last two positions, so a line cut off mid-exchange
      // does not count a piece that is about to be taken back.
      const gain = Math.min(...line.boards.slice(-2).map(diff)) - diff(before);
      if (gain >= 1) out.push(note(t("Nach {lineText} gewinnst du {materialWords}.", { lineText: lineText(line.sans, before, 7), materialWords: materialWords(gain) })));
    }
  }

  // New threats: what the mover could do next if the opponent ignored the move.
  if (out.length < 2) {
    const passed = passTurn(after);
    if (passed) {
      const old = threatsOf(before);
      const known = (tk: Threat) => old.some((o) => o.kind === tk.kind && o.square === tk.square && o.move.to === tk.move.to);
      const tk = threatsOf(passed).find((x) => !known(x));
      const marks = tk ? [arrowOf(tk.move, "me")] : [];
      if (tk?.kind === "mate") out.push(note(t("Du drohst Matt mit {san}.", { san: tk.san }), marks));
      else if (tk?.kind === "fork") out.push(note(t("Du drohst {forkPhrase} gegen {joinPieces}.", { forkPhrase: forkPhrase(tk), joinPieces: joinPieces(tk.targets, theirAcc) }), marks, [tk.move.to]));
      else if (tk?.kind === "win") {
        const victim = tk.targets[0];
        const by = tk.piece !== KING && PIECE_VALUES[tk.piece] < PIECE_VALUES[victim] ? t(" mit {piece}", { piece: withPiece(tk.piece) }) : "";
        const where = t("{piece} auf {square}", { piece: theirAcc(victim), square: squareName(tk.square) });
        out.push(note(by ? t("Du greifst {where}{by} an.", { where, by }) : t("Du greifst {where} an, {1} nicht ausreichend gedeckt ist.", { where, 1: art(fem(victim) ? "die" : "der") }), marks, [tk.square]));
      }
    }
  }

  if (!out.length && piece.type === KING && Math.abs(move.to - move.from) === 2) {
    out.push(note(t("Du rochierst: Dein König steht sicherer und dein Turm kommt ins Spiel.")));
  }
  // A quiet move: still say what it is about instead of staying silent.
  if (!out.length && !move.promotion) out.push(note(t("Mit {san} {clause}.", { san, clause: ideaClause(describeIdea(before, move)) })));
  if (move.promotion === QUEEN) out.push(note(t("Du wandelst deinen Bauern in eine Dame um.")));
  else if (move.promotion === KNIGHT) out.push(note(t("Du wandelst in einen Springer um – genau das richtige Stück für diese Stellung.")));
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
    out.push(note(t("Danach kann dein Gegner in {n} {1} mattsetzen{2}.", { n, 1: n === 1 ? t("Zug") : t("Zügen"), 2: line.sans.length ? `: ${lineText(line.sans, afterMove, n * 2 - 1)}` : "" }), line.moves.slice(0, 1).map((m) => arrowOf(m, "opp"))));
  }

  // The opponent's threats before the move: an ignored one is worth saying so.
  const threats = opponentThreats(before);
  const reply = playLine(afterMove, input.replyPv, 8);
  const ignored = reply.moves.length ? threats.find((tk) => sameMove(tk.move, reply.moves[0]) || (tk.kind === "win" && tk.square === reply.moves[0].to)) : undefined;

  // The opponent's best reply, read as a motif or a capture.
  if (reply.moves.length && !out.length) {
    const n = replyNote(afterMove, reply.moves[0], reply.sans[0], me, material(before, me) - material(before, !me));
    if (n) out.push(ignored ? { ...n, text: t("Du hast die Drohung übersehen: {text}", { text: n.text }) } : n);
  }

  // Material the forced line costs, when no motif already says it.
  if (reply.boards.length > 2) {
    const diff = (b: TBoard) => material(b, me) - material(b, !me);
    // The better of the last two positions, so a line cut off mid-exchange
    // does not count a piece that is about to be taken back.
    const ends = reply.boards.slice(-2).map(diff);
    const total = diff(before) - Math.max(...ends);
    if (total >= 1 && out.length < 2) {
      out.push(note(t("Nach der besten Antwort {lineText} verlierst du {materialWords}.", { lineText: lineText(reply.sans, afterMove, 6), materialWords: materialWords(total) }), out.length ? [] : [arrowOf(reply.moves[0], "opp")]));
    }
  }

  // A piece left hanging by the move itself.
  if (!out.length) {
    const hangingBefore = new Set(getHangingPieces(before, me).map((h) => h.square));
    const fresh = getHangingPieces(afterMove, me, move, before).filter((h) => !hangingBefore.has(h.square) && h.piece_type !== PAWN);
    const worst = fresh.sort((a, b) => PIECE_VALUES[b.piece_type as PieceType] - PIECE_VALUES[a.piece_type as PieceType])[0];
    if (worst) out.push(note(t("Nach diesem Zug ist {yourNom} auf {square} nicht mehr ausreichend gedeckt.", { yourNom: yourNom(worst.piece_type as PieceType), square: worst.square }), [], [worst.square_index]));
  }

  // Causes that need no tactic: a weakened king, a trade into a bad endgame, a missed passed pawn …
  const best = playLine(before, input.bestPv, 7);
  if (out.length < 2) {
    for (const c of detectCauses({ before, afterMove, move, me, best, reply, previous: input.previousMove }).slice(0, 2 - out.length)) out.push(causeNote(c));
  }
  // Nothing concrete found: at least say how the position shifted instead of quoting a percentage.
  if (!out.length) {
    const shift = shiftNote(input);
    if (shift) out.push(shift);
  }

  // What the better move would have done (the board already shows it as an arrow).
  if (!playedBest && input.bestPv.length) {
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
        out.push(betterNote(t("Du hattest Matt in {0}: {lineText}.", { 0: Math.abs(mateBefore), lineText: lineText(best.sans, before, Math.abs(mateBefore) * 2 - 1) })));
      } else if (bestMotifs.includes(TacticalTheme.FORK)) {
        const targets = attackedTargets(afterBest, bm.to, !me);
        out.push(betterNote(t("Besser war {bSan}: Damit greifst du mit einer Gabel {joinPieces} gleichzeitig an.", { bSan, joinPieces: joinPieces(targets, theirAcc) })));
      } else if (target && target.color !== me && target.type !== PAWN && legalDefenders(before, !me, bm.to).length === 0) {
        out.push(betterNote(t("Besser war {bSan}: {1} gegnerische {nom} auf {squareName} war ungedeckt.", { bSan, 1: art(fem(target.type) ? "Die" : "Der"), nom: NAMES[target.type].nom, squareName: squareName(bm.to) })));
      } else if (stopped) {
        const what = stopped.kind === "mate" ? t("das Matt durch {san}", { san: stopped.san }) : stopped.kind === "fork" ? forkPhrase(stopped) : t("den Verlust {yourOf}", { yourOf: yourOf(stopped.targets[0]) });
        out.push(betterNote(t("Besser war {bSan}: Damit verhinderst du {what}.", { bSan, what })));
      } else if (bestMotifs.includes(TacticalTheme.PIN)) {
        out.push(betterNote(t("Besser war {bSan} mit einer Fesselung.", { bSan }), true));
      } else if (bestMotifs.includes(TacticalTheme.SKEWER)) {
        out.push(betterNote(t("Besser war {bSan} mit einem Spieß.", { bSan }), true));
      } else {
        out.push(betterNote(t("Besser war {bSan}: Damit {clause}.", { bSan, clause: ideaClause(describeIdea(before, bm)) })));
      }
    }
  }
  return out;
}

const EMPTY: Explanation = { lines: [], betterMove: false, bareBetter: [], arrows: [], squares: [] };

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
    betterMove: notes.some((n) => n.better),
    bareBetter: notes.filter((n) => n.bare).map((n) => n.text),
    arrows: notes.flatMap((n) => n.arrows),
    squares: [...new Set(notes.flatMap((n) => n.squares))].map(squareName),
  };
}

/** The sentences of explainMoveDetailed() alone. */
export function explainMove(input: ExplainInput): string[] {
  return explainMoveDetailed(input).lines;
}
