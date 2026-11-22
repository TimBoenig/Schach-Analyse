// Precision statistics: how sure each number is (confidence margins), how the
// player scores against the rating expectation, how games develop move by move,
// how consistent the accuracy is, and how often won/lost positions turn around.
// Everything is from the tracked player's perspective.

import { expectedScore } from "./benchmarks";
import type { GameFeatures } from "./features";
import { MIN_GROUP_GAMES, MIN_SITUATIONS, restOf, scoreDeviation, scoreZ, shareAtLeast, Z95 } from "./evidence";
import { avg, pstdev, pyRound } from "./num";
import { t, dec } from "../../i18n";

/** Score of a group of games with its 95 % confidence margin. */
export interface ScoreStat {
  key: string;
  label: string;
  games: number;
  score_pct: number | null;
  /** Half width of the 95 % interval in percentage points (null below 2 games). */
  margin: number | null;
}

export interface RatingBucket extends ScoreStat {
  /** Points the Elo formula expected, in percent (null without ratings). */
  expected_pct: number | null;
  avg_diff: number | null;
}

export interface CurvePoint {
  move: number;
  /** Average winning chance of the player after this move, in percent. */
  avg_wp: number;
  games: number;
}

export interface AccuracySpread {
  games: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  stdev: number | null;
  /** Counts per 10-point band: index 0 = under 50 %, then 50–60 … 90–100. */
  histogram: { label: string; games: number }[];
  /** Average accuracy in wins, draws and losses. */
  by_result: { key: "win" | "draw" | "loss"; label: string; games: number; accuracy: number | null }[];
}

export interface Turnarounds {
  /** Games where the player stood clearly better at some point. */
  winning: number;
  converted: number;
  drawn_from_winning: number;
  lost_from_winning: number;
  /** Games where the player stood clearly worse at some point. */
  losing: number;
  saved: number;
  won_from_losing: number;
}

export interface PrecisionStats {
  overall: ScoreStat;
  by_rating_diff: RatingBucket[];
  /** Points scored minus points expected, in percentage points (null without ratings). */
  vs_expectation: number | null;
  rated_games: number;
  by_length: ScoreStat[];
  by_color: ScoreStat[];
  curve: CurvePoint[];
  spread: AccuracySpread;
  turnarounds: Turnarounds;
  /** Weighted findings for the headline list. */
  facts: [number, string][];
}

// Winning chance at which a position counts as clearly won or lost.
const CLEAR_EDGE = 0.75;
// A rating gap below this counts as an even pairing.
const EVEN_GAP = 75;
// Curve points need this many running games to be shown.
const CURVE_MIN_GAMES = 5;
const CURVE_MAX_MOVE = 60;
const MIN_GAMES = MIN_GROUP_GAMES;

const de = (v: number, digits = 0) => v.toFixed(digits).replace(".", dec());

/**
 * 95 % Wilson interval half width for a score in [0, 1] over n games.
 * Wilson stays sensible near 0 % and 100 % and for small samples, where the
 * plain normal approximation would promise far too much precision.
 */
export function wilsonMargin(score: number, n: number): number | null {
  if (n < 2) return null;
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const half = (z * Math.sqrt((score * (1 - score)) / n + (z * z) / (4 * n * n))) / denom;
  return pyRound(half * 100, 1);
}

function scoreStat(key: string, label: string, fs: GameFeatures[]): ScoreStat {
  const scores = fs.map((f) => f.score).filter((s): s is number => s !== null);
  const mean = scores.length ? avg(scores) : null;
  return {
    key,
    label,
    games: scores.length,
    score_pct: mean !== null ? pyRound(mean * 100, 1) : null,
    margin: mean !== null ? wilsonMargin(mean, scores.length) : null,
  };
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function ratingBuckets(fs: GameFeatures[]): RatingBucket[] {
  const rated = fs.filter((f) => f.user_rating > 0 && f.opp_rating > 0 && f.score !== null);
  const groups: [string, string, (d: number) => boolean][] = [
    ["stronger", t("Gegen Stärkere (ab +{EVEN_GAP})", { EVEN_GAP }), (d) => d >= EVEN_GAP],
    ["even", t("Etwa gleich stark (±{EVEN_GAP})", { EVEN_GAP }), (d) => Math.abs(d) < EVEN_GAP],
    ["weaker", t("Gegen Schwächere (ab −{EVEN_GAP})", { EVEN_GAP }), (d) => d <= -EVEN_GAP],
  ];
  return groups.map(([key, label, test]) => {
    const group = rated.filter((f) => test(f.opp_rating - f.user_rating));
    const diffs = group.map((f) => f.opp_rating - f.user_rating);
    return {
      ...scoreStat(key, label, group),
      expected_pct: group.length ? pyRound(avg(group.map((f) => expectedScore(f.user_rating, f.opp_rating))) * 100, 1) : null,
      avg_diff: group.length ? Math.round(avg(diffs)) : null,
    };
  });
}

function lengthBuckets(fs: GameFeatures[]): ScoreStat[] {
  const full = (f: GameFeatures) => Math.ceil(f.plies / 2);
  const groups: [string, string, (n: number) => boolean][] = [
    ["short", t("Kurz (bis 25 Züge)"), (n) => n <= 25],
    ["mid", t("Mittel (26–40)"), (n) => n > 25 && n <= 40],
    ["long", t("Lang (41–60)"), (n) => n > 40 && n <= 60],
    ["marathon", t("Sehr lang (über 60)"), (n) => n > 60],
  ];
  return groups.map(([key, label, test]) => scoreStat(key, label, fs.filter((f) => f.plies > 0 && test(full(f)))));
}

/** Average winning chance by move number over the analyzed games still running. */
function advantageCurve(analyzed: GameFeatures[]): CurvePoint[] {
  const sums = new Map<number, { wp: number; n: number }>();
  for (const f of analyzed) {
    for (const m of f.moves) {
      if (!m.classification || m.move_number > CURVE_MAX_MOVE) continue;
      const e = sums.get(m.move_number) ?? { wp: 0, n: 0 };
      e.wp += m.wp_after;
      e.n += 1;
      sums.set(m.move_number, e);
    }
  }
  return [...sums.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, e]) => e.n >= CURVE_MIN_GAMES)
    .map(([move, e]) => ({ move, avg_wp: pyRound((e.wp / e.n) * 100, 1), games: e.n }));
}

function accuracySpread(analyzed: GameFeatures[]): AccuracySpread {
  const accs = analyzed.map((f) => f.rec.game_acc).filter((a) => a > 0);
  const sorted = [...accs].sort((a, b) => a - b);
  const bands: [string, (a: number) => boolean][] = [
    [t("unter 50"), (a) => a < 50],
    ["50–60", (a) => a >= 50 && a < 60],
    ["60–70", (a) => a >= 60 && a < 70],
    ["70–80", (a) => a >= 70 && a < 80],
    ["80–90", (a) => a >= 80 && a < 90],
    ["90–100", (a) => a >= 90],
  ];
  const results: ["win" | "draw" | "loss", string, (f: GameFeatures) => boolean][] = [
    ["win", t("In Siegen"), (f) => f.rec.is_win],
    ["draw", t("In Remis"), (f) => f.rec.is_draw],
    ["loss", t("In Niederlagen"), (f) => f.rec.is_loss],
  ];
  return {
    games: accs.length,
    median: sorted.length ? pyRound(quantile(sorted, 0.5), 1) : null,
    p25: sorted.length ? pyRound(quantile(sorted, 0.25), 1) : null,
    p75: sorted.length ? pyRound(quantile(sorted, 0.75), 1) : null,
    stdev: sorted.length >= 2 ? pyRound(pstdev(sorted), 1) : null,
    histogram: bands.map(([label, test]) => ({ label, games: accs.filter(test).length })),
    by_result: results.map(([key, label, test]) => {
      const group = analyzed.filter(test).map((f) => f.rec.game_acc).filter((a) => a > 0);
      return { key, label, games: group.length, accuracy: group.length ? pyRound(avg(group), 1) : null };
    }),
  };
}

function turnarounds(analyzed: GameFeatures[]): Turnarounds {
  const tk: Turnarounds = { winning: 0, converted: 0, drawn_from_winning: 0, lost_from_winning: 0, losing: 0, saved: 0, won_from_losing: 0 };
  for (const f of analyzed) {
    const score = f.score;
    if (score === null || !f.moves.length) continue;
    // Before and after own moves: a won position handed over by an opponent's
    // blunder counts even if the player throws it away with the very next move.
    const wps = f.moves.filter((m) => m.classification).flatMap((m) => [m.wp_before, m.wp_after]);
    if (wps.some((wp) => wp >= CLEAR_EDGE)) {
      tk.winning += 1;
      if (score === 1) tk.converted += 1;
      else if (score === 0.5) tk.drawn_from_winning += 1;
      else tk.lost_from_winning += 1;
    }
    if (wps.some((wp) => wp <= 1 - CLEAR_EDGE)) {
      tk.losing += 1;
      if (score > 0) tk.saved += 1;
      if (score === 1) tk.won_from_losing += 1;
    }
  }
  return tk;
}

function findings(p: Omit<PrecisionStats, "facts">): [number, string][] {
  const facts: [number, string][] = [];

  // Rating expectation: only with enough rated games, and only beyond the noise.
  if (p.vs_expectation !== null && p.rated_games >= MIN_GROUP_GAMES) {
    const gap = p.vs_expectation;
    const expected = { games: p.rated_games, score_pct: 50 + gap };
    if (Math.abs(gap) >= 6 && scoreDeviation(expected, 50, Z95, MIN_GROUP_GAMES) !== 0) {
      facts.push([
        Math.abs(gap) * 0.9,
        gap > 0
          ? t("Du holst {de} Prozentpunkte mehr, als deine Wertung erwarten lässt. Deine Zahl dürfte bald steigen.", { de: de(gap) })
          : t("Du holst {de} Prozentpunkte weniger, als deine Wertung erwarten lässt.", { de: de(-gap) }),
      ]);
    }
  }
  const stronger = p.by_rating_diff[0];
  if (stronger.games >= MIN_GAMES && stronger.score_pct !== null && stronger.expected_pct !== null) {
    const gap = stronger.score_pct - stronger.expected_pct;
    if (gap >= 12 && scoreDeviation(stronger, stronger.expected_pct, Z95, MIN_GAMES) > 0) facts.push([gap * 0.7, t("Gegen stärkere Gegner spielst du über dich hinaus: {de} % statt erwarteter {de2} %.", { de: de(stronger.score_pct), de2: de(stronger.expected_pct) })]);
  }
  const weaker = p.by_rating_diff[2];
  if (weaker.games >= MIN_GAMES && weaker.score_pct !== null && weaker.expected_pct !== null) {
    const gap = weaker.expected_pct - weaker.score_pct;
    if (gap >= 12 && scoreDeviation(weaker, weaker.expected_pct, Z95, MIN_GAMES) < 0) facts.push([gap * 0.8, t("Gegen schwächere Gegner lässt du Punkte liegen: {de} % statt erwarteter {de2} %.", { de: de(weaker.score_pct), de2: de(weaker.expected_pct) })]);
  }

  // Thrown wins in percent of all winning positions.
  const tk = p.turnarounds;
  if (tk.winning >= MIN_SITUATIONS) {
    const lostShare = (tk.lost_from_winning / tk.winning) * 100;
    // Everybody throws away a won position now and then; only a share that is
    // high (20 %) and, with confidence, above 10 % is worth a remark.
    if (lostShare >= 20 && shareAtLeast(tk.lost_from_winning, tk.winning, 0.1)) {
      facts.push([lostShare / 2, t("Aus {winning} klar gewonnenen Stellungen hast du {lost_from_winning} noch verloren ({de} %).", { winning: tk.winning, lost_from_winning: tk.lost_from_winning, de: de(lostShare) })]);
    }
  }
  if (tk.losing >= MIN_SITUATIONS) {
    const savedShare = (tk.saved / tk.losing) * 100;
    if (savedShare >= 35 && shareAtLeast(tk.saved, tk.losing, 0.2)) facts.push([savedShare / 4, t("Du gibst nicht auf: {de} % deiner klar verlorenen Stellungen hast du noch gerettet.", { de: de(savedShare) })]);
  }

  // Consistency: a wide spread means the level depends on the day.
  const s = p.spread;
  if (s.games >= MIN_GROUP_GAMES * 2 && s.stdev !== null && s.stdev >= 12) {
    facts.push([s.stdev / 2, t("Deine Genauigkeit schwankt stark (±{de} Punkte). Die Hälfte deiner Partien liegt zwischen {de2} und {de3} %.", { de: de(s.stdev), de2: de(s.p25 ?? 0), de3: de(s.p75 ?? 0) })]);
  }

  // Game length: a clear weak spot in long or short games.
  const lens = p.by_length.filter((b) => b.games >= MIN_GAMES && b.score_pct !== null);
  if (lens.length >= 2 && p.overall.score_pct !== null) {
    const worst = lens.reduce((a, b) => ((b.score_pct as number) < (a.score_pct as number) ? b : a));
    const gap = p.overall.score_pct - (worst.score_pct as number);
    const rest = restOf(p.overall, worst);
    if (gap >= 15 && rest.games >= MIN_GAMES && scoreZ(worst, rest) <= -Z95) facts.push([gap * 0.6, t("In {0}en Partien holst du nur {de} % (sonst {de2} %).", { 0: worst.label.split(" (")[0].toLowerCase(), de: de(worst.score_pct as number), de2: de(p.overall.score_pct) })]);
  }
  return facts;
}

export function buildPrecision(feats: GameFeatures[]): PrecisionStats {
  const analyzed = feats.filter((f) => f.analyzed);
  const byRating = ratingBuckets(feats);
  const rated = feats.filter((f) => f.user_rating > 0 && f.opp_rating > 0 && f.score !== null);
  const expected = rated.length ? avg(rated.map((f) => expectedScore(f.user_rating, f.opp_rating))) : null;
  const actual = rated.length ? avg(rated.map((f) => f.score as number)) : null;
  const base: Omit<PrecisionStats, "facts"> = {
    overall: scoreStat("all", t("Alle Partien"), feats),
    by_rating_diff: byRating,
    vs_expectation: expected !== null && actual !== null ? pyRound((actual - expected) * 100, 1) : null,
    rated_games: rated.length,
    by_length: lengthBuckets(feats),
    by_color: [
      scoreStat("white", t("Mit Weiß"), feats.filter((f) => f.rec.user_color === "white")),
      scoreStat("black", t("Mit Schwarz"), feats.filter((f) => f.rec.user_color === "black")),
    ],
    curve: advantageCurve(analyzed),
    spread: accuracySpread(analyzed),
    turnarounds: turnarounds(analyzed),
  };
  return { ...base, facts: findings(base) };
}
