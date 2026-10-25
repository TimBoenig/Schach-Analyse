// Precision statistics: how sure each number is (confidence margins), how the
// player scores against the rating expectation, how games develop move by move,
// how consistent the accuracy is, and how often won/lost positions turn around.
// Everything is from the tracked player's perspective.

import { expectedScore } from "./benchmarks";
import type { GameFeatures } from "./features";
import { avg, pstdev, pyRound } from "./num";

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
const MIN_GAMES = 6;

const de = (v: number, digits = 0) => v.toFixed(digits).replace(".", ",");

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
    ["stronger", `Gegen Stärkere (ab +${EVEN_GAP})`, (d) => d >= EVEN_GAP],
    ["even", `Etwa gleich stark (±${EVEN_GAP})`, (d) => Math.abs(d) < EVEN_GAP],
    ["weaker", `Gegen Schwächere (ab −${EVEN_GAP})`, (d) => d <= -EVEN_GAP],
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
    ["short", "Kurz (bis 25 Züge)", (n) => n <= 25],
    ["mid", "Mittel (26–40)", (n) => n > 25 && n <= 40],
    ["long", "Lang (41–60)", (n) => n > 40 && n <= 60],
    ["marathon", "Sehr lang (über 60)", (n) => n > 60],
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
    ["unter 50", (a) => a < 50],
    ["50–60", (a) => a >= 50 && a < 60],
    ["60–70", (a) => a >= 60 && a < 70],
    ["70–80", (a) => a >= 70 && a < 80],
    ["80–90", (a) => a >= 80 && a < 90],
    ["90–100", (a) => a >= 90],
  ];
  const results: ["win" | "draw" | "loss", string, (f: GameFeatures) => boolean][] = [
    ["win", "In Siegen", (f) => f.rec.is_win],
    ["draw", "In Remis", (f) => f.rec.is_draw],
    ["loss", "In Niederlagen", (f) => f.rec.is_loss],
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
  const t: Turnarounds = { winning: 0, converted: 0, drawn_from_winning: 0, lost_from_winning: 0, losing: 0, saved: 0, won_from_losing: 0 };
  for (const f of analyzed) {
    const score = f.score;
    if (score === null || !f.moves.length) continue;
    // Before and after own moves: a won position handed over by an opponent's
    // blunder counts even if the player throws it away with the very next move.
    const wps = f.moves.filter((m) => m.classification).flatMap((m) => [m.wp_before, m.wp_after]);
    if (wps.some((wp) => wp >= CLEAR_EDGE)) {
      t.winning += 1;
      if (score === 1) t.converted += 1;
      else if (score === 0.5) t.drawn_from_winning += 1;
      else t.lost_from_winning += 1;
    }
    if (wps.some((wp) => wp <= 1 - CLEAR_EDGE)) {
      t.losing += 1;
      if (score > 0) t.saved += 1;
      if (score === 1) t.won_from_losing += 1;
    }
  }
  return t;
}

function findings(p: Omit<PrecisionStats, "facts">): [number, string][] {
  const facts: [number, string][] = [];

  // Rating expectation: only with enough rated games, and only beyond the noise.
  if (p.vs_expectation !== null && p.rated_games >= 10 && p.overall.margin !== null) {
    const gap = p.vs_expectation;
    if (Math.abs(gap) >= Math.max(6, p.overall.margin / 2)) {
      facts.push([
        Math.abs(gap) * 0.9,
        gap > 0
          ? `Du holst ${de(gap)} Prozentpunkte mehr, als deine Wertung erwarten lässt. Deine Zahl dürfte bald steigen.`
          : `Du holst ${de(-gap)} Prozentpunkte weniger, als deine Wertung erwarten lässt.`,
      ]);
    }
  }
  const stronger = p.by_rating_diff[0];
  if (stronger.games >= MIN_GAMES && stronger.score_pct !== null && stronger.expected_pct !== null) {
    const gap = stronger.score_pct - stronger.expected_pct;
    if (gap >= 12) facts.push([gap * 0.7, `Gegen stärkere Gegner spielst du über dich hinaus: ${de(stronger.score_pct)} % statt erwarteter ${de(stronger.expected_pct)} %.`]);
  }
  const weaker = p.by_rating_diff[2];
  if (weaker.games >= MIN_GAMES && weaker.score_pct !== null && weaker.expected_pct !== null) {
    const gap = weaker.expected_pct - weaker.score_pct;
    if (gap >= 12) facts.push([gap * 0.8, `Gegen schwächere Gegner lässt du Punkte liegen: ${de(weaker.score_pct)} % statt erwarteter ${de(weaker.expected_pct)} %.`]);
  }

  // Thrown wins in percent of all winning positions.
  const t = p.turnarounds;
  if (t.winning >= MIN_GAMES) {
    const lostShare = (t.lost_from_winning / t.winning) * 100;
    if (lostShare >= 20) {
      facts.push([lostShare / 2, `Aus ${t.winning} klar gewonnenen Stellungen hast du ${t.lost_from_winning} noch verloren (${de(lostShare)} %).`]);
    }
  }
  if (t.losing >= MIN_GAMES) {
    const savedShare = (t.saved / t.losing) * 100;
    if (savedShare >= 35) facts.push([savedShare / 4, `Du gibst nicht auf: ${de(savedShare)} % deiner klar verlorenen Stellungen hast du noch gerettet.`]);
  }

  // Consistency: a wide spread means the level depends on the day.
  const s = p.spread;
  if (s.games >= 10 && s.stdev !== null && s.stdev >= 12) {
    facts.push([s.stdev / 2, `Deine Genauigkeit schwankt stark (±${de(s.stdev)} Punkte). Die Hälfte deiner Partien liegt zwischen ${de(s.p25 ?? 0)} und ${de(s.p75 ?? 0)} %.`]);
  }

  // Game length: a clear weak spot in long or short games.
  const lens = p.by_length.filter((b) => b.games >= MIN_GAMES && b.score_pct !== null);
  if (lens.length >= 2 && p.overall.score_pct !== null) {
    const worst = lens.reduce((a, b) => ((b.score_pct as number) < (a.score_pct as number) ? b : a));
    const gap = p.overall.score_pct - (worst.score_pct as number);
    if (gap >= 15) facts.push([gap * 0.6, `In ${worst.label.split(" (")[0].toLowerCase()}en Partien holst du nur ${de(worst.score_pct as number)} % (sonst ${de(p.overall.score_pct)} %).`]);
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
    overall: scoreStat("all", "Alle Partien", feats),
    by_rating_diff: byRating,
    vs_expectation: expected !== null && actual !== null ? pyRound((actual - expected) * 100, 1) : null,
    rated_games: rated.length,
    by_length: lengthBuckets(feats),
    by_color: [
      scoreStat("white", "Mit Weiß", feats.filter((f) => f.rec.user_color === "white")),
      scoreStat("black", "Mit Schwarz", feats.filter((f) => f.rec.user_color === "black")),
    ],
    curve: advantageCurve(analyzed),
    spread: accuracySpread(analyzed),
    turnarounds: turnarounds(analyzed),
  };
  return { ...base, facts: findings(base) };
}
