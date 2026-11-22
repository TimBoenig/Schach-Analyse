// The move tally as the "Züge & Fehler" page reads it: one row per kind of
// move with the opponents' rate beside it, the three phases side by side and
// the months as two lines. Counts are plain facts; a row is only called
// better or worse than the opponents when the difference passes the evidence
// rules, like every other statement in the app.
import { MIN_BUCKET_MOVES, ratesDiffer, Z_MULTI } from "./evidence";
import { type MoveTally, SERIOUS_CLASSES, sumOf, TALLY_CLASSES, type TallyBlock, type TallyClass, TOP_CLASSES } from "./moves";
import { t } from "../../i18n";

export type KindGroup = "shine" | "solid" | "error";

export const KIND_GROUPS: { key: KindGroup; label: string; classes: TallyClass[] }[] = [
  { key: "shine", label: t("Glanzzüge"), classes: ["Brilliant", "Great"] },
  { key: "solid", label: t("Solide Züge"), classes: ["Best", "Excellent", "Good", "Book"] },
  { key: "error", label: t("Fehler"), classes: ["Inaccuracy", "Mistake", "Miss", "Blunder"] },
];

// More of these is better, fewer of those is better. "Exzellent", "Gut" and
// book moves are left unjudged: a higher share of them can just as well mean
// fewer best moves.
const MORE_IS_BETTER: readonly TallyClass[] = ["Brilliant", "Great", "Best"];
const FEWER_IS_BETTER: readonly TallyClass[] = ["Inaccuracy", "Mistake", "Miss", "Blunder"];

export interface KindRow {
  key: TallyClass;
  group: KindGroup;
  count: number;
  per_100: number;
  per_game: number;
  games_with: number;
  /** The opponents' rate per 100 of their moves in the same games; null without their data. */
  opp_per_100: number | null;
  /** 1 clearly better than the opponents, -1 clearly worse, 0 no clear difference, null not judged. */
  verdict: -1 | 0 | 1 | null;
}

const per100 = (n: number, moves: number) => (moves ? (n / moves) * 100 : 0);

/** Every kind of move, best to worst, with the comparison against the opponents. */
export function kindRows(tk: MoveTally): KindRow[] {
  const o = tk.opponents;
  return TALLY_CLASSES.map((key) => {
    const c = tk.classes.find((x) => x.key === key)!;
    const group = KIND_GROUPS.find((g) => g.classes.includes(key))!.key;
    const more = MORE_IS_BETTER.includes(key);
    const judged = o !== null && (more || FEWER_IS_BETTER.includes(key));
    let verdict: KindRow["verdict"] = null;
    if (judged) {
      const mine = per100(c.count, tk.moves);
      const theirs = per100(o.counts[key], o.moves);
      // Seven rows are compared at once, so the bar is the one for multiple comparisons.
      verdict = ratesDiffer(c.count, tk.moves, o.counts[key], o.moves, Z_MULTI) ? (mine > theirs === more ? 1 : -1) : 0;
    }
    return { key, group, count: c.count, per_100: c.per_100, per_game: c.per_game, games_with: c.games_with, opp_per_100: o ? per100(o.counts[key], o.moves) : null, verdict };
  });
}

export interface TallySummary {
  /** Share of moves that are the engine's choice or better, in percent. */
  top_pct: number;
  /** Mistakes, misses and blunders per 100 moves. */
  serious_per_100: number;
  blunders_per_game: number;
  /** Brilliant and great moves. */
  shine: number;
  /** The opponents' two rates, each with whether the player is clearly better (1), worse (-1) or neither (0). */
  opponents: { top_pct: number; serious_per_100: number; top_verdict: -1 | 0 | 1; serious_verdict: -1 | 0 | 1 } | null;
}

export function tallySummary(tk: MoveTally): TallySummary {
  const o = tk.opponents;
  const top = sumOf(tk.counts, TOP_CLASSES);
  const serious = sumOf(tk.counts, SERIOUS_CLASSES);
  let opponents: TallySummary["opponents"] = null;
  if (o) {
    const oTop = sumOf(o.counts, TOP_CLASSES);
    const oSerious = sumOf(o.counts, SERIOUS_CLASSES);
    const side = (mine: number, theirs: number, more: boolean) => (ratesDiffer(mine, tk.moves, theirs, o.moves, Z_MULTI) ? (mine / tk.moves > theirs / o.moves === more ? 1 : -1) : 0);
    opponents = { top_pct: per100(oTop, o.moves), serious_per_100: per100(oSerious, o.moves), top_verdict: side(top, oTop, true), serious_verdict: side(serious, oSerious, false) };
  }
  return {
    top_pct: per100(top, tk.moves),
    serious_per_100: per100(serious, tk.moves),
    blunders_per_game: tk.games ? tk.counts.Blunder / tk.games : 0,
    shine: tk.counts.Brilliant + tk.counts.Great,
    opponents,
  };
}

export interface PhaseQuality {
  key: string;
  label: string;
  moves: number;
  block: TallyBlock;
  top_pct: number;
  serious_per_100: number;
  shine: number;
  /** Too few moves for a rate to mean much: drawn faint. */
  thin: boolean;
}

/** Opening, middlegame and endgame side by side; phases without a move are left out. */
export function phaseQuality(tk: MoveTally): PhaseQuality[] {
  return tk.phases
    .filter((p) => p.moves > 0)
    .map((p) => ({
      key: p.key,
      label: p.label,
      moves: p.moves,
      block: p,
      top_pct: per100(sumOf(p.counts, TOP_CLASSES), p.moves),
      serious_per_100: per100(sumOf(p.counts, SERIOUS_CLASSES), p.moves),
      shine: p.counts.Brilliant + p.counts.Great,
      thin: p.moves < MIN_BUCKET_MOVES,
    }));
}

/** A month enters the lines from this many moves (about four games); thinner months would only add noise. */
export const MIN_TREND_MOVES = 120;

export interface MonthQuality {
  /** "2026-04" */
  key: string;
  games: number;
  moves: number;
  top_pct: number;
  serious_per_100: number;
}

/** Months with enough moves, oldest first, as the two rates that tell progress. */
export function monthlyQuality(months: TallyBlock[], minMoves = MIN_TREND_MOVES): MonthQuality[] {
  return months
    .filter((m) => m.moves >= minMoves)
    .map((m) => ({ key: m.key, games: m.games, moves: m.moves, top_pct: per100(sumOf(m.counts, TOP_CLASSES), m.moves), serious_per_100: per100(sumOf(m.counts, SERIOUS_CLASSES), m.moves) }));
}

/** A slice of the player's moves with its count of serious errors (a move number range, a piece, a kind of position). */
export interface ErrorBucket {
  label: string;
  moves: number;
  errors: number;
}

export interface ErrorExtreme<B extends ErrorBucket> {
  bucket: B;
  /** Serious errors per 100 moves in the bucket and in all the other buckets together. */
  per_100: number;
  rest_per_100: number;
}

/**
 * The slice where clearly more errors happen than in all the others together,
 * and the one with clearly fewer. A slice is only named when the difference
 * holds for several comparisons at once; with three to six slices on screen a
 * single test would call something striking far too often.
 */
export function errorExtremes<B extends ErrorBucket>(buckets: B[]): { high: ErrorExtreme<B> | null; low: ErrorExtreme<B> | null } {
  const moves = buckets.reduce((s, b) => s + b.moves, 0);
  const errors = buckets.reduce((s, b) => s + b.errors, 0);
  let high: ErrorExtreme<B> | null = null;
  let low: ErrorExtreme<B> | null = null;
  for (const bucket of buckets) {
    const restMoves = moves - bucket.moves;
    const restErrors = errors - bucket.errors;
    if (!ratesDiffer(bucket.errors, bucket.moves, restErrors, restMoves, Z_MULTI)) continue;
    const e = { bucket, per_100: per100(bucket.errors, bucket.moves), rest_per_100: per100(restErrors, restMoves) };
    // Measured as a ratio to the rest, so a slice of few moves cannot win on its absolute rate alone.
    const ratio = (x: ErrorExtreme<B>) => (x.per_100 + 0.5) / (x.rest_per_100 + 0.5);
    if (e.per_100 > e.rest_per_100 && (!high || ratio(e) > ratio(high))) high = e;
    if (e.per_100 < e.rest_per_100 && (!low || ratio(e) < ratio(low))) low = e;
  }
  return { high, low };
}

const monthIndex = (key: string): number => {
  const [y, m] = key.split("-").map(Number);
  return y * 12 + m - 1;
};

/** The calendar months within `days` days back from the newest month; null keeps the whole history. */
export function lastMonths(months: MonthQuality[], days: number | null): MonthQuality[] {
  if (days === null || !months.length) return months;
  const span = Math.max(1, Math.round(days / 30.44));
  const last = monthIndex(months[months.length - 1].key);
  return months.filter((m) => monthIndex(m.key) > last - span);
}

export interface SpanQuality {
  months: number;
  games: number;
  moves: number;
  /** Both rates over all moves of the span; a month of 400 moves counts four times one of 100. */
  top_pct: number;
  serious_per_100: number;
  /** The months with the highest share of top moves and with the fewest errors (null for a single month). */
  best_top: MonthQuality | null;
  fewest_errors: MonthQuality | null;
}

export function spanQuality(months: MonthQuality[]): SpanQuality | null {
  const moves = months.reduce((s, m) => s + m.moves, 0);
  if (!moves) return null;
  const weighted = (pick: (m: MonthQuality) => number) => months.reduce((s, m) => s + pick(m) * m.moves, 0) / moves;
  const several = months.length > 1;
  return {
    months: months.length,
    games: months.reduce((s, m) => s + m.games, 0),
    moves,
    top_pct: weighted((m) => m.top_pct),
    serious_per_100: weighted((m) => m.serious_per_100),
    best_top: several ? months.reduce((a, b) => (b.top_pct > a.top_pct ? b : a)) : null,
    fewest_errors: several ? months.reduce((a, b) => (b.serious_per_100 < a.serious_per_100 ? b : a)) : null,
  };
}
