// Opening insights: the player's repertoire per colour, how each opening goes
// (results, opening accuracy, position after the opening, when theory and the
// first serious error come) and how the player meets the opponent's first move.
// Results work without engine analysis; the quality columns need analyzed games.

import type { GameFeatures } from "./features";
import { MIN_ANALYZED, MIN_LINE_GAMES, scoresDiffer, Z_MULTI } from "./evidence";
import { avg, pyRound } from "./num";
import { buildOpeningTree, fenAfter, mainLine, type OpeningLeak, type OpeningTree } from "./openingTree";
import { t, dec } from "../../i18n";

export interface OpeningGameRef {
  id: string;
  date: string;
  played_at: number | null;
  opponent: string;
  opp_rating: number;
  score: number | null;
  accuracy: number | null;
}

export interface OpeningStat {
  /** Main opening name (family), e.g. "Sicilian Defense". */
  name: string;
  eco: string;
  color: "white" | "black";
  games: number;
  wins: number;
  draws: number;
  losses: number;
  score_pct: number | null;
  analyzed: number;
  /** Accuracy of the player's opening moves (analyzed games only). */
  opening_accuracy: number | null;
  /** Player's winning chance at the end of the opening phase, in percent. */
  wp_after_opening: number | null;
  /** Move number of the player's first move outside the opening book. */
  book_exit_move: number | null;
  /** Average move number of the player's first serious error. */
  first_error_move: number | null;
  /** Most played sub-variations (full names) with their counts. */
  variations: { name: string; games: number }[];
  /** Newest first. */
  recent: OpeningGameRef[];
  /** Typical moves of this opening in the player's games (SAN from the start). */
  line: string[];
  /** Position after `line`, for the opening's picture. */
  fen: string;
}

export interface MoveChoice {
  san: string;
  games: number;
  score_pct: number | null;
}

export interface FirstMoveStat extends MoveChoice {
  /** For Black: the player's replies to this first move. */
  replies: MoveChoice[];
}

export interface OpeningInsights {
  white: OpeningStat[];
  black: OpeningStat[];
  /** The player's first moves as White. */
  white_first: MoveChoice[];
  /** The opponent's first moves when the player has Black, with the player's replies. */
  black_vs: FirstMoveStat[];
  /** The player's first moves as White, with the opponents' replies (for scouting). */
  white_vs: FirstMoveStat[];
  /** Average winning chance after the opening over all analyzed games, in percent. */
  wp_after_opening: number | null;
  /** The player's own opening tree per colour, with the moves that keep going wrong. */
  tree: OpeningTree;
  /** Headline findings in German, strongest first. */
  facts: string[];
  /** The same findings for one colour's tab: that colour's plus the colour-neutral ones. */
  color_facts: Record<"white" | "black", string[]>;
}

// Openings with fewer games than this are listed but not used for findings.
export const MIN_FACT_GAMES = MIN_LINE_GAMES;
const RECENT_GAMES = 8;

export const openingMain = (name: string) => name.split(":")[0].split(",")[0].trim();

/** "Italian Game: Two Knights Defense, Knight Attack" -> German main name + variation. */
export function openingParts(name: string): { main: string; variation: string } {
  const main = openingMain(name);
  return { main: openingLabel(main), variation: name.slice(main.length).replace(/^[:,]\s*/, "") };
}

const OPENINGS_DE: Record<string, string> = {
  "Italian Game": t("Italienische Partie"),
  "Sicilian Defense": t("Sizilianische Verteidigung"),
  "French Defense": t("Französische Verteidigung"),
  "Caro-Kann Defense": t("Caro-Kann-Verteidigung"),
  "Queen's Gambit Declined": t("Abgelehntes Damengambit"),
  "Queen's Gambit Accepted": t("Angenommenes Damengambit"),
  "Queen's Gambit": t("Damengambit"),
  "Ruy Lopez": t("Spanische Partie"),
  "Scotch Game": t("Schottische Partie"),
  "King's Indian Defense": t("Königsindische Verteidigung"),
  "Nimzo-Indian Defense": t("Nimzowitsch-Indische Verteidigung"),
  "Queen's Pawn Game": t("Damenbauernspiel"),
  "King's Pawn Game": t("Königsbauernspiel"),
  "English Opening": t("Englische Eröffnung"),
  "Scandinavian Defense": t("Skandinavische Verteidigung"),
  "Pirc Defense": t("Pirc-Verteidigung"),
  "Petrov's Defense": t("Russische Verteidigung"),
  "Four Knights Game": t("Vierspringerspiel"),
  "Two Knights Defense": t("Zweispringerspiel im Nachzuge"),
  "Slav Defense": t("Slawische Verteidigung"),
  "Dutch Defense": t("Holländische Verteidigung"),
  "Vienna Game": t("Wiener Partie"),
  "King's Gambit": t("Königsgambit"),
  "London System": t("London-System"),
  "Philidor Defense": t("Philidor-Verteidigung"),
  "Alekhine Defense": t("Aljechin-Verteidigung"),
  "Modern Defense": t("Moderne Verteidigung"),
  "Bishop's Opening": t("Läuferspiel"),
  "Center Game": t("Mittelgambit"),
  "Danish Gambit": t("Nordisches Gambit"),
  "Evans Gambit": t("Evans-Gambit"),
  "Elephant Gambit": t("Elefantengambit"),
  "Ponziani Opening": t("Ponziani-Eröffnung"),
  "Grünfeld Defense": t("Grünfeld-Indische Verteidigung"),
  "Queen's Indian Defense": t("Damenindische Verteidigung"),
  "Catalan Opening": t("Katalanische Eröffnung"),
  "Benoni Defense": t("Benoni-Verteidigung"),
  "Benko Gambit": t("Wolga-Gambit"),
  "Budapest Defense": t("Budapester Gambit"),
  "Bird Opening": t("Bird-Eröffnung"),
  "Zukertort Opening": t("Zukertort-Eröffnung"),
  "Réti Opening": t("Réti-Eröffnung"),
  "Trompowsky Attack": t("Trompowsky-Angriff"),
  "Owen Defense": t("Owen-Verteidigung"),
  "Englund Gambit": t("Englund-Gambit"),
  "Indian Defense": t("Indische Verteidigung"),
  "Semi-Slav Defense": t("Halbslawische Verteidigung"),
  "Bogo-Indian Defense": t("Bogoljubow-Indische Verteidigung"),
  "Old Indian Defense": t("Altindische Verteidigung"),
  "Polish Opening": t("Polnische Eröffnung"),
  "Van't Kruijs Opening": t("Van-’t-Kruijs-Eröffnung"),
  "King's Gambit Accepted": t("Angenommenes Königsgambit"),
  "King's Gambit Declined": t("Abgelehntes Königsgambit"),
  "Nimzowitsch Defense": t("Nimzowitsch-Verteidigung"),
  "King's Indian Attack": t("Königsindischer Angriff"),
  "Tarrasch Defense": t("Tarrasch-Verteidigung"),
  "Benko Gambit Accepted": t("Angenommenes Wolga-Gambit"),
  "Vienna Gambit": t("Wiener Gambit"),
  "Latvian Gambit": t("Lettisches Gambit"),
  "Hungarian Opening": t("Ungarische Eröffnung"),
};

/** German name where a common one exists; otherwise the (English) book name. */
export function openingLabel(name: string): string {
  return OPENINGS_DE[name] ?? name;
}

const pct = (scores: number[]) => (scores.length ? avg(scores) * 100 : null);
const de = (n: number) => String(pyRound(n)).replace(".", dec());
const COLOR_DE = { white: t("Weiß"), black: t("Schwarz") } as const;

function scoreCounts(fs: GameFeatures[]) {
  const scores = fs.map((f) => f.score).filter((s): s is number => s !== null);
  return {
    wins: scores.filter((s) => s === 1).length,
    draws: scores.filter((s) => s === 0.5).length,
    losses: scores.filter((s) => s === 0).length,
    score_pct: pct(scores),
  };
}

function openingAccuracy(f: GameFeatures): number | null {
  const raw = f.rec.raw_game as Record<string, unknown>;
  const v = Number(raw[`${f.rec.user_color}_opening_acc`]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Player's winning chance after the last move of the opening phase (analyzed games). */
function wpAfterOpening(f: GameFeatures): number | null {
  if (!f.analyzed) return null;
  const opening = f.moves.filter((m) => m.phase === "opening" && m.classification);
  return opening.length ? opening[opening.length - 1].wp_after : null;
}

function bookExit(f: GameFeatures): number | null {
  if (!f.moves.some((m) => m.is_book)) return null;
  return f.moves.find((m) => !m.is_book)?.move_number ?? null;
}

function newestFirst(a: GameFeatures, b: GameFeatures): number {
  return (b.played_at ?? 0) - (a.played_at ?? 0) || b.date.localeCompare(a.date);
}

function stat(name: string, color: "white" | "black", fs: GameFeatures[]): OpeningStat {
  const line = mainLine(fs);
  const accs = fs.map(openingAccuracy).filter((v): v is number => v !== null);
  const wps = fs.map(wpAfterOpening).filter((v): v is number => v !== null);
  const exits = fs.map(bookExit).filter((v): v is number => v !== null);
  const firstErr = fs
    .filter((f) => f.analyzed)
    .map((f) => f.moves.find((m) => m.is_serious_error)?.move_number)
    .filter((v): v is number => v !== undefined);
  const vars = new Map<string, number>();
  for (const f of fs) {
    const full = f.rec.opening.trim();
    if (full && full !== name) vars.set(full, (vars.get(full) ?? 0) + 1);
  }
  return {
    name,
    eco: fs.find((f) => f.rec.eco)?.rec.eco ?? "",
    color,
    games: fs.length,
    ...scoreCounts(fs),
    analyzed: fs.filter((f) => f.analyzed).length,
    opening_accuracy: accs.length ? avg(accs) : null,
    wp_after_opening: wps.length ? avg(wps) * 100 : null,
    book_exit_move: exits.length ? avg(exits) : null,
    first_error_move: firstErr.length ? avg(firstErr) : null,
    variations: [...vars.entries()]
      .map(([n, games]) => ({ name: n, games }))
      .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name))
      .slice(0, 3),
    recent: [...fs]
      .sort(newestFirst)
      .slice(0, RECENT_GAMES)
      .map((f) => ({
        id: f.game_id,
        date: f.date,
        played_at: f.played_at,
        opponent: f.rec.opp_name,
        opp_rating: f.opp_rating,
        score: f.score,
        accuracy: f.rec.game_acc > 0 ? f.rec.game_acc : null,
      })),
    line,
    fen: fenAfter(line),
  };
}

function choices(groups: Map<string, GameFeatures[]>): MoveChoice[] {
  return [...groups.entries()]
    .map(([san, fs]) => ({ san, games: fs.length, score_pct: scoreCounts(fs).score_pct }))
    .sort((a, b) => b.games - a.games || a.san.localeCompare(b.san));
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

export function buildOpeningInsights(feats: GameFeatures[]): OpeningInsights {
  const byLine = new Map<string, GameFeatures[]>();
  const whiteFirst = new Map<string, GameFeatures[]>();
  const blackVs = new Map<string, GameFeatures[]>();
  const whiteVs = new Map<string, GameFeatures[]>();
  for (const f of feats) {
    if (f.chess960) continue; // Chess960 has no opening theory to compare.
    const color = f.rec.user_color;
    if (f.rec.opening) push(byLine, `${color}\u0000${openingMain(f.rec.opening)}`, f);
    const [first, reply] = f.first_sans;
    if (!first) continue;
    if (color === "white") {
      push(whiteFirst, first, f);
      if (reply) push(whiteVs, first, f);
    } else if (reply) push(blackVs, first, f);
  }

  const lines = [...byLine.entries()].map(([k, fs]) => {
    const [color, name] = k.split("\u0000") as ["white" | "black", string];
    return stat(name, color, fs);
  });
  const sortLines = (c: "white" | "black") =>
    lines.filter((l) => l.color === c).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));

  const withReplies = (groups: Map<string, GameFeatures[]>): FirstMoveStat[] =>
    [...groups.entries()]
      .map(([san, fs]) => {
        const replies = new Map<string, GameFeatures[]>();
        for (const f of fs) push(replies, f.first_sans[1], f);
        return { san, games: fs.length, score_pct: scoreCounts(fs).score_pct, replies: choices(replies) };
      })
      .sort((a, b) => b.games - a.games || a.san.localeCompare(b.san));

  const allWp = feats.map(wpAfterOpening).filter((v): v is number => v !== null);
  const out: OpeningInsights = {
    white: sortLines("white"),
    black: sortLines("black"),
    white_first: choices(whiteFirst),
    black_vs: withReplies(blackVs),
    white_vs: withReplies(whiteVs),
    wp_after_opening: allWp.length ? avg(allWp) * 100 : null,
    tree: buildOpeningTree(feats),
    facts: [],
    color_facts: { white: [], black: [] },
  };
  const found = openingFacts(out, allWp.length);
  out.facts = pickFacts(found, null);
  out.color_facts = { white: pickFacts(found, "white"), black: pickFacts(found, "black") };
  return out;
}

type Fact = [weight: number, text: string, color: "white" | "black" | null];

/** Strongest findings first; `color` keeps that colour's and the neutral ones. */
function pickFacts(facts: Fact[], color: "white" | "black" | null): string[] {
  return facts
    .filter((f) => color === null || f[2] === null || f[2] === color)
    .sort((a, b) => b[0] - a[0])
    .map(([, tk]) => tk)
    .filter((tk, i, all) => all.indexOf(tk) === i)
    .slice(0, 6);
}

function openingFacts(o: OpeningInsights, analyzedGames: number): Fact[] {
  const facts: Fact[] = [];
  for (const color of ["white", "black"] as const) {
    const solid = o[color].filter((l) => l.games >= MIN_FACT_GAMES && l.score_pct !== null);
    if (solid.length < 2) continue;
    const byScore = [...solid].sort((a, b) => b.score_pct! - a.score_pct! || b.games - a.games);
    const best = byScore[0];
    const worst = byScore[byScore.length - 1];
    const z = solid.length > 2 ? Z_MULTI : undefined;
    if (best.score_pct! - worst.score_pct! >= 15 && scoresDiffer(best, worst, z, MIN_FACT_GAMES)) {
      facts.push([
        best.score_pct! - 50,
        t("Stärkste Eröffnung mit {0}: {openingLabel} mit {de} % der Punkte aus {games} Partien.", { 0: COLOR_DE[color], openingLabel: openingLabel(best.name), de: de(best.score_pct!), games: best.games }),
        color,
      ]);
      facts.push([
        50 - worst.score_pct!,
        t("Schwächste Eröffnung mit {0}: {openingLabel} mit nur {de} % der Punkte aus {games} Partien.", { 0: COLOR_DE[color], openingLabel: openingLabel(worst.name), de: de(worst.score_pct!), games: worst.games }),
        color,
      ]);
    }
  }

  const vs = o.black_vs.filter((v) => v.games >= MIN_FACT_GAMES && v.score_pct !== null);
  if (vs.length >= 2) {
    const sorted = [...vs].sort((a, b) => b.score_pct! - a.score_pct!);
    const hi = sorted[0];
    const lo = sorted[sorted.length - 1];
    const gap = hi.score_pct! - lo.score_pct!;
    if (gap >= 15 && scoresDiffer(hi, lo, vs.length > 2 ? Z_MULTI : undefined, MIN_FACT_GAMES)) {
      facts.push([
        gap,
        t("Mit Schwarz holst du gegen 1. {san} nur {de} % der Punkte, gegen 1. {san2} dagegen {de2} %.", { san: lo.san, de: de(lo.score_pct!), san2: hi.san, de2: de(hi.score_pct!) }),
        "black",
      ]);
    }
  }

  if (o.wp_after_opening !== null && analyzedGames >= MIN_ANALYZED) {
    const wp = o.wp_after_opening;
    if (wp <= 45) {
      facts.push([50 - wp, t("Nach der Eröffnung stehst du im Schnitt schon schlechter (Gewinnchance {de} %).", { de: de(wp) }), null]);
    } else if (wp >= 55) {
      facts.push([wp - 50, t("Du kommst meist gut aus der Eröffnung: Danach liegt deine Gewinnchance im Schnitt bei {de} %.", { de: de(wp) }), null]);
    }
  }

  for (const l of [...o.white, ...o.black]) {
    if (l.games < MIN_FACT_GAMES) continue;
    if (l.first_error_move !== null && l.first_error_move <= 12 && l.analyzed >= MIN_FACT_GAMES) {
      facts.push([
        25 - l.first_error_move,
        t("{openingLabel} ({1}): Dein erster schwerer Fehler kommt im Schnitt schon in Zug {de}.", { openingLabel: openingLabel(l.name), 1: COLOR_DE[l.color], de: de(l.first_error_move) }),
        l.color,
      ]);
    }
    if (l.wp_after_opening !== null && l.wp_after_opening <= 40 && l.analyzed >= MIN_FACT_GAMES) {
      facts.push([
        50 - l.wp_after_opening,
        t("{openingLabel} ({1}): Nach der Eröffnung liegt deine Gewinnchance nur bei {de} %. Hier lohnt sich Theorie.", { openingLabel: openingLabel(l.name), 1: COLOR_DE[l.color], de: de(l.wp_after_opening) }),
        l.color,
      ]);
    }
  }

  // A headline needs as many judged games as any other opening finding.
  const leak = o.tree.leaks.find((l) => l.judged >= MIN_FACT_GAMES);
  if (leak) facts.push([(leak.errors / leak.judged) * 40, leakFact(leak), leak.color]);

  return facts;
}

/** "1. e4 e5 2. Nf3 Nc6" style move list; a Black move alone gets "1… e5". */
export function movesText(sans: string[], startPly = 0): string {
  return sans
    .map((san, i) => {
      const ply = startPly + i;
      const no = Math.floor(ply / 2) + 1;
      if (ply % 2 === 0) return `${no}. ${san}`;
      return i === 0 ? `${no}… ${san}` : san;
    })
    .join(" ");
}

function leakFact(l: OpeningLeak): string {
  const ply = l.path.length - 1;
  const where = ply > 0 ? t("Nach {movesText} ", { movesText: movesText(l.path.slice(0, -1)) }) : t("Als ersten Zug ");
  const move = movesText([l.san], ply);
  const better = l.better ? t(" Besser ist {movesText}.", { movesText: movesText([l.better], ply) }) : "";
  return t("{where}spielst du oft {move}, das war in {errors} von {judged} Partien ein Fehler.{better}", { where, move, errors: l.errors, judged: l.judged, better });
}
