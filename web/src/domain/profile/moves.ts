// Move tally: how often a player made each kind of move (Brilliant … Blunder)
// over all analyzed games, with rates, phases, months, highlights and a
// comparison with the opponents of the same games.
//
// The counts are plain facts and always shown. Sentences built from them
// ("fewer blunders than your opponents", "most blunders in the endgame") pass
// the evidence rules in ./evidence like every other piece of advice.

import { parseSummary } from "../metrics/models";
import { type GameFeatures, moveLabel } from "./features";
import { MIN_GROUP_GAMES, ratesDiffer, Z_MULTI } from "./evidence";

/** Classifications best to worst, as the move list shows them. */
export const TALLY_CLASSES = [
  "Brilliant",
  "Great",
  "Best",
  "Excellent",
  "Good",
  "Book",
  "Inaccuracy",
  "Mistake",
  "Miss",
  "Blunder",
] as const;
export type TallyClass = (typeof TALLY_CLASSES)[number];

/** Moves at least as good as the engine's choice. */
export const TOP_CLASSES: readonly TallyClass[] = ["Brilliant", "Great", "Best"];
/** Moves that cost real winning chances. */
export const SERIOUS_CLASSES: readonly TallyClass[] = ["Mistake", "Miss", "Blunder"];
/** Brilliant and great moves are rare, so every one of them is worth seeing again. */
export const HIGHLIGHT_CLASSES: readonly TallyClass[] = ["Brilliant", "Great"];
export const MAX_HIGHLIGHTS = 30;
export const MAX_TOP_GAMES = 5;
// The latest games form the "recent" block of the trend comparison, the rest
// is "before"; both need MIN_GROUP_GAMES games.
export const RECENT_GAMES = 20;

export type Counts = Record<TallyClass, number>;

export interface ClassTally {
  key: TallyClass;
  count: number;
  /** Average per analyzed game. */
  per_game: number;
  /** Per 100 own moves. */
  per_100: number;
  /** Analyzed games with at least one such move. */
  games_with: number;
}

export interface TallyBlock {
  key: string;
  label: string;
  games: number;
  moves: number;
  counts: Counts;
}

export interface MoveHighlight {
  game_id: string;
  ply_index: number;
  classification: TallyClass;
  /** "23... Lxf7" */
  move: string;
  opponent: string;
  date: string;
  phase: string;
}

export interface TallyGame {
  game_id: string;
  opponent: string;
  date: string;
  brilliant: number;
  great: number;
  accuracy: number;
}

export interface TallyFinding {
  key: string;
  title: string;
  text: string;
  tone: "pos" | "neg";
}

export interface MoveTally {
  games: number;
  moves: number;
  counts: Counts;
  classes: ClassTally[];
  /** The opponents' moves in the same games (null when no summary has them). */
  opponents: { moves: number; counts: Counts } | null;
  phases: TallyBlock[];
  /** Calendar months (UTC, "2026-04"), oldest first. */
  months: TallyBlock[];
  /** Brilliant and great moves, newest first. */
  highlights: MoveHighlight[];
  /** Games with the most brilliant and great moves. */
  top_games: TallyGame[];
  records: {
    games_with_brilliant: number;
    most_brilliant: number;
    blunder_free_games: number;
    longest_blunder_free: number;
    current_blunder_free: number;
  };
  findings: TallyFinding[];
}

const PHASE_NAMES: [string, string][] = [
  ["opening", "Eröffnung"],
  ["middlegame", "Mittelspiel"],
  ["endgame", "Endspiel"],
];

export function emptyCounts(): Counts {
  return Object.fromEntries(TALLY_CLASSES.map((k) => [k, 0])) as Counts;
}

const isTally = (c: string): c is TallyClass => (TALLY_CLASSES as readonly string[]).includes(c);

export const sumOf = (counts: Counts, keys: readonly TallyClass[]): number => keys.reduce((s, k) => s + counts[k], 0);

export const totalOf = (counts: Counts): number => sumOf(counts, TALLY_CLASSES);

export function monthKey(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function block(key: string, label: string): TallyBlock {
  return { key, label, games: 0, moves: 0, counts: emptyCounts() };
}

function gameCounts(f: GameFeatures): Counts {
  const c = emptyCounts();
  for (const m of f.moves) if (isTally(m.classification)) c[m.classification] += 1;
  return c;
}

/** The opponent's counts from the stored per-side summary. */
function opponentCounts(f: GameFeatures): Counts | null {
  const summary = parseSummary(f.rec.raw_game.summary_json);
  const side = (summary?.[f.rec.user_color === "white" ? "black" : "white"] ?? null) as Record<string, unknown> | null;
  if (!side) return null;
  const c = emptyCounts();
  for (const k of TALLY_CLASSES) c[k] = Number(side[k] ?? 0) || 0;
  return totalOf(c) ? c : null;
}

function addCounts(into: Counts, from: Counts): void {
  for (const k of TALLY_CLASSES) into[k] += from[k];
}

const per100 = (n: number, moves: number) => (moves ? (n / moves) * 100 : 0);
const de1 = (v: number) => v.toFixed(1).replace(".", ",");

/** Chronological order; games without a time keep their stored order at the start. */
function chronological(fs: GameFeatures[]): GameFeatures[] {
  return [...fs].sort((a, b) => (a.played_at || 0) - (b.played_at || 0) || a.date.localeCompare(b.date));
}

function streaks(ordered: GameFeatures[], clean: (f: GameFeatures) => boolean): [number, number] {
  let longest = 0;
  let run = 0;
  for (const f of ordered) {
    run = clean(f) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return [longest, run];
}

/**
 * Tally of all analyzed games in `feats` from the tracked player's side.
 * Returns null when none of them is analyzed.
 */
export function buildMoveTally(feats: GameFeatures[]): MoveTally | null {
  const analyzed = chronological(feats.filter((f) => f.analyzed));
  if (!analyzed.length) return null;

  const counts = emptyCounts();
  const gamesWith = emptyCounts();
  const opp = emptyCounts();
  let oppMoves = 0;
  let oppGames = 0;
  const phases = new Map(PHASE_NAMES.map(([k, name]) => [k, block(k, name)]));
  const months = new Map<string, TallyBlock>();
  const highlights: MoveHighlight[] = [];
  const perGame: { f: GameFeatures; c: Counts }[] = [];

  for (const f of analyzed) {
    const c = gameCounts(f);
    perGame.push({ f, c });
    addCounts(counts, c);
    for (const k of TALLY_CLASSES) if (c[k]) gamesWith[k] += 1;

    const seen = new Set<string>();
    for (const m of f.moves) {
      if (!isTally(m.classification)) continue;
      const p = phases.get(m.phase);
      if (p) {
        p.moves += 1;
        p.counts[m.classification] += 1;
        if (!seen.has(m.phase)) p.games += 1;
        seen.add(m.phase);
      }
      if (HIGHLIGHT_CLASSES.includes(m.classification)) {
        highlights.push({
          game_id: f.game_id,
          ply_index: m.ply_index,
          classification: m.classification,
          move: moveLabel(m.move_number, f.rec.user_color === "white", m.san),
          opponent: f.rec.opp_name,
          date: f.date,
          phase: m.phase,
        });
      }
    }

    if (f.played_at) {
      const mk = monthKey(f.played_at);
      const b = months.get(mk) ?? block(mk, mk);
      months.set(mk, b);
      b.games += 1;
      b.moves += totalOf(c);
      addCounts(b.counts, c);
    }

    const oc = opponentCounts(f);
    if (oc) {
      addCounts(opp, oc);
      oppMoves += totalOf(oc);
      oppGames += 1;
    }
  }

  const moves = totalOf(counts);
  const games = analyzed.length;
  const classes: ClassTally[] = TALLY_CLASSES.map((key) => ({
    key,
    count: counts[key],
    per_game: counts[key] / games,
    per_100: per100(counts[key], moves),
    games_with: gamesWith[key],
  }));

  const topGames = perGame
    .filter(({ c }) => c.Brilliant + c.Great > 0)
    .sort((a, b) => b.c.Brilliant - a.c.Brilliant || b.c.Great - a.c.Great || b.f.rec.game_acc - a.f.rec.game_acc)
    .slice(0, MAX_TOP_GAMES)
    .map(({ f, c }) => ({
      game_id: f.game_id,
      opponent: f.rec.opp_name,
      date: f.date,
      brilliant: c.Brilliant,
      great: c.Great,
      accuracy: f.rec.game_acc,
    }));

  const noBlunder = (f: GameFeatures) => !f.moves.some((m) => m.classification === "Blunder");
  const [longest, current] = streaks(analyzed, noBlunder);

  const tally: MoveTally = {
    games,
    moves,
    counts,
    classes,
    opponents: oppGames ? { moves: oppMoves, counts: opp } : null,
    phases: [...phases.values()],
    months: [...months.keys()].sort().map((k) => months.get(k) as TallyBlock),
    highlights: highlights.reverse().slice(0, MAX_HIGHLIGHTS),
    top_games: topGames,
    records: {
      games_with_brilliant: gamesWith.Brilliant,
      most_brilliant: Math.max(0, ...perGame.map(({ c }) => c.Brilliant)),
      blunder_free_games: analyzed.filter(noBlunder).length,
      longest_blunder_free: longest,
      current_blunder_free: current,
    },
    findings: [],
  };
  tally.findings = tallyFindings(tally, perGame);
  return tally;
}

/** Evidence-checked sentences about the tally (empty when nothing is clear). */
function tallyFindings(t: MoveTally, perGame: { f: GameFeatures; c: Counts }[]): TallyFinding[] {
  const out: TallyFinding[] = [];

  // 1. Against the opponents of the same games.
  if (t.opponents) {
    const o = t.opponents;
    const mine = sumOf(t.counts, SERIOUS_CLASSES);
    const theirs = sumOf(o.counts, SERIOUS_CLASSES);
    if (ratesDiffer(mine, t.moves, theirs, o.moves)) {
      const fewer = per100(mine, t.moves) < per100(theirs, o.moves);
      out.push({
        key: "vs_opp_errors",
        title: fewer ? "Weniger grobe Fehler als die Gegner" : "Mehr grobe Fehler als die Gegner",
        text: `Du machst ${de1(per100(mine, t.moves))} Fehler, Patzer und verpasste Chancen pro 100 Züge, die Gegner ${de1(per100(theirs, o.moves))}.`,
        tone: fewer ? "pos" : "neg",
      });
    }
    const myTop = sumOf(t.counts, TOP_CLASSES);
    const theirTop = sumOf(o.counts, TOP_CLASSES);
    if (ratesDiffer(myTop, t.moves, theirTop, o.moves)) {
      const more = per100(myTop, t.moves) > per100(theirTop, o.moves);
      out.push({
        key: "vs_opp_top",
        title: more ? "Öfter den besten Zug als die Gegner" : "Seltener den besten Zug als die Gegner",
        text: `${Math.round(per100(myTop, t.moves))} % deiner Züge sind brillant, großartig oder der beste Zug, bei den Gegnern ${Math.round(per100(theirTop, o.moves))} %.`,
        tone: more ? "pos" : "neg",
      });
    }
  }

  // 2. The phase with clearly the most serious errors; picking the worst of three needs Z_MULTI.
  const rated = t.phases.filter((p) => p.moves);
  const rate = (p: TallyBlock) => per100(sumOf(p.counts, SERIOUS_CLASSES), p.moves);
  const worst = [...rated].sort((a, b) => rate(b) - rate(a))[0];
  if (worst && rated.length >= 2) {
    const restMoves = t.moves - worst.moves;
    const restErr = sumOf(t.counts, SERIOUS_CLASSES) - sumOf(worst.counts, SERIOUS_CLASSES);
    if (ratesDiffer(sumOf(worst.counts, SERIOUS_CLASSES), worst.moves, restErr, restMoves, Z_MULTI)) {
      out.push({
        key: "phase_errors",
        title: `Die meisten groben Fehler im ${worst.label === "Eröffnung" ? "Eröffnungsteil" : worst.label}`,
        text: `Dort machst du ${de1(rate(worst))} pro 100 Züge, im Rest der Partie ${de1(per100(restErr, restMoves))}.`,
        tone: "neg",
      });
    }
  }

  // 3. Recent games against the ones before.
  const recent = perGame.slice(-RECENT_GAMES);
  const before = perGame.slice(0, -RECENT_GAMES);
  if (recent.length >= MIN_GROUP_GAMES && before.length >= MIN_GROUP_GAMES) {
    const sum = (xs: typeof perGame, keys: readonly TallyClass[]) => xs.reduce((s, x) => s + sumOf(x.c, keys), 0);
    const mv = (xs: typeof perGame) => xs.reduce((s, x) => s + totalOf(x.c), 0);
    const [rE, bE, rM, bM] = [sum(recent, SERIOUS_CLASSES), sum(before, SERIOUS_CLASSES), mv(recent), mv(before)];
    if (ratesDiffer(rE, rM, bE, bM)) {
      const better = per100(rE, rM) < per100(bE, bM);
      out.push({
        key: "trend_errors",
        title: better ? "Weniger grobe Fehler als früher" : "Mehr grobe Fehler als früher",
        text: `In den letzten ${recent.length} Partien ${de1(per100(rE, rM))} pro 100 Züge, davor ${de1(per100(bE, bM))}.`,
        tone: better ? "pos" : "neg",
      });
    }
  }
  return out;
}
