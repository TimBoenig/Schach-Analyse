// Opening insights: the player's repertoire per colour, how each opening goes
// (results, opening accuracy, position after the opening, when theory and the
// first serious error come) and how the player meets the opponent's first move.
// Results work without engine analysis; the quality columns need analyzed games.

import type { GameFeatures } from "./features";
import { avg, pyRound } from "./num";

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
  /** Headline findings in German, strongest first. */
  facts: string[];
}

// Openings with fewer games than this are listed but not used for findings.
export const MIN_FACT_GAMES = 3;
const RECENT_GAMES = 8;

export const openingMain = (name: string) => name.split(":")[0].split(",")[0].trim();

const OPENINGS_DE: Record<string, string> = {
  "Italian Game": "Italienische Partie",
  "Sicilian Defense": "Sizilianische Verteidigung",
  "French Defense": "Französische Verteidigung",
  "Caro-Kann Defense": "Caro-Kann-Verteidigung",
  "Queen's Gambit Declined": "Abgelehntes Damengambit",
  "Queen's Gambit Accepted": "Angenommenes Damengambit",
  "Queen's Gambit": "Damengambit",
  "Ruy Lopez": "Spanische Partie",
  "Scotch Game": "Schottische Partie",
  "King's Indian Defense": "Königsindische Verteidigung",
  "Nimzo-Indian Defense": "Nimzowitsch-Indische Verteidigung",
  "Queen's Pawn Game": "Damenbauernspiel",
  "King's Pawn Game": "Königsbauernspiel",
  "English Opening": "Englische Eröffnung",
  "Scandinavian Defense": "Skandinavische Verteidigung",
  "Pirc Defense": "Pirc-Verteidigung",
  "Petrov's Defense": "Russische Verteidigung",
  "Four Knights Game": "Vierspringerspiel",
  "Two Knights Defense": "Zweispringerspiel im Nachzuge",
  "Slav Defense": "Slawische Verteidigung",
  "Dutch Defense": "Holländische Verteidigung",
  "Vienna Game": "Wiener Partie",
  "King's Gambit": "Königsgambit",
  "London System": "London-System",
};

/** German name where a common one exists; otherwise the (English) book name. */
export function openingLabel(name: string): string {
  return OPENINGS_DE[name] ?? name;
}

const pct = (scores: number[]) => (scores.length ? avg(scores) * 100 : null);
const de = (n: number) => String(pyRound(n)).replace(".", ",");
const COLOR_DE = { white: "Weiß", black: "Schwarz" } as const;

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
    facts: [],
  };
  out.facts = openingFacts(out, allWp.length);
  return out;
}

function openingFacts(o: OpeningInsights, analyzedGames: number): string[] {
  const facts: [number, string][] = [];
  for (const color of ["white", "black"] as const) {
    const solid = o[color].filter((l) => l.games >= MIN_FACT_GAMES && l.score_pct !== null);
    if (solid.length < 2) continue;
    const byScore = [...solid].sort((a, b) => b.score_pct! - a.score_pct! || b.games - a.games);
    const best = byScore[0];
    const worst = byScore[byScore.length - 1];
    if (best.score_pct! - worst.score_pct! >= 15) {
      facts.push([
        best.score_pct! - 50,
        `Stärkste Eröffnung mit ${COLOR_DE[color]}: ${openingLabel(best.name)} mit ${de(best.score_pct!)} % der Punkte aus ${best.games} Partien.`,
      ]);
      facts.push([
        50 - worst.score_pct!,
        `Schwächste Eröffnung mit ${COLOR_DE[color]}: ${openingLabel(worst.name)} mit nur ${de(worst.score_pct!)} % der Punkte aus ${worst.games} Partien.`,
      ]);
    }
  }

  const vs = o.black_vs.filter((v) => v.games >= MIN_FACT_GAMES && v.score_pct !== null);
  if (vs.length >= 2) {
    const sorted = [...vs].sort((a, b) => b.score_pct! - a.score_pct!);
    const hi = sorted[0];
    const lo = sorted[sorted.length - 1];
    const gap = hi.score_pct! - lo.score_pct!;
    if (gap >= 15) {
      facts.push([
        gap,
        `Mit Schwarz holst du gegen 1. ${lo.san} nur ${de(lo.score_pct!)} % der Punkte, gegen 1. ${hi.san} dagegen ${de(hi.score_pct!)} %.`,
      ]);
    }
  }

  if (o.wp_after_opening !== null && analyzedGames >= 5) {
    const wp = o.wp_after_opening;
    if (wp <= 45) {
      facts.push([50 - wp, `Nach der Eröffnung stehst du im Schnitt schon schlechter (Gewinnchance ${de(wp)} %).`]);
    } else if (wp >= 55) {
      facts.push([wp - 50, `Du kommst meist gut aus der Eröffnung: Danach liegt deine Gewinnchance im Schnitt bei ${de(wp)} %.`]);
    }
  }

  for (const l of [...o.white, ...o.black]) {
    if (l.games < MIN_FACT_GAMES) continue;
    if (l.first_error_move !== null && l.first_error_move <= 12 && l.analyzed >= MIN_FACT_GAMES) {
      facts.push([
        25 - l.first_error_move,
        `${openingLabel(l.name)} (${COLOR_DE[l.color]}): Dein erster schwerer Fehler kommt im Schnitt schon in Zug ${de(l.first_error_move)}.`,
      ]);
    }
    if (l.wp_after_opening !== null && l.wp_after_opening <= 40 && l.analyzed >= MIN_FACT_GAMES) {
      facts.push([
        50 - l.wp_after_opening,
        `${openingLabel(l.name)} (${COLOR_DE[l.color]}): Nach der Eröffnung liegt deine Gewinnchance nur bei ${de(l.wp_after_opening)} %. Hier lohnt sich Theorie.`,
      ]);
    }
  }

  return facts
    .sort((a, b) => b[0] - a[0])
    .map(([, t]) => t)
    .filter((t, i, all) => all.indexOf(t) === i)
    .slice(0, 6);
}
