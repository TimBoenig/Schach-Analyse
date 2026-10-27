// Evidence rules: when numbers are solid enough to become advice.
//
// Every sentence the app derives from the games ("after a loss you score less",
// "play 1. e4 against her", "your weakest opening is …") must rest on enough
// games and on a gap larger than chance. A 2:0 in some opening or one bad
// evening is no pattern, so each finding passes two checks:
//  1. a minimum sample (games, moves or situations) per group, and
//  2. a significance test, so a gap is only reported when chance alone would
//     rarely produce it.
// Numbers below the bar may still be shown (drawn faint), but never as advice.

/** Two-sided 95 % (one group against another). */
export const Z95 = 1.96;
/** One-sided 95 % ("at least this share", "below 50 %"). */
export const Z_ONE = 1.645;
// Picking the best and the worst of several groups (time slots, openings,
// game types) finds a "gap" by chance much more often than one planned
// comparison. Bonferroni for about six pairs keeps the false alarm rate at 5 %.
export const Z_MULTI = 2.64;

/** Games per group before its score is compared (colour, time of day, speed, game type …). */
export const MIN_GROUP_GAMES = 10;
/** Games in an opening or first move before it is called strong/weak or recommended. */
export const MIN_LINE_GAMES = 8;
/** Own moves per bucket before its error rate is compared. */
export const MIN_BUCKET_MOVES = 150;
/** Serious errors before "x % of your errors …" statements. */
export const MIN_ERRORS = 15;
/** Clearly won/lost positions before conversion or defence statements. */
export const MIN_SITUATIONS = 8;
/** Analyzed games before averages over them are turned into advice. */
export const MIN_ANALYZED = 10;

// Moves of one game are not independent: the same opponent, the same mood and
// the same kind of position. With this intra-game correlation, 20 moves of one
// game carry the information of about 5 independent moves (design effect
// 1 + (m - 1) * rho), so a few long games no longer look like a big sample.
export const MOVE_CORRELATION = 0.15;

export interface ScoreSample {
  games: number;
  /** 0..100 */
  score_pct: number | null;
}

/**
 * Variance of one game's score (0, ½ or 1). p(1-p) is the upper bound (draws
 * only shrink it); the +1/+2 adjustment keeps a 3:0 from claiming zero spread.
 */
function scoreVar(pct: number, n: number): number {
  const p = ((pct / 100) * n + 1) / (n + 2);
  return p * (1 - p);
}

/** z of the gap between two scores (positive when `a` is higher). */
export function scoreZ(a: ScoreSample, b: ScoreSample): number {
  if (a.score_pct === null || b.score_pct === null || a.games < 1 || b.games < 1) return 0;
  const se = Math.sqrt(scoreVar(a.score_pct, a.games) / a.games + scoreVar(b.score_pct, b.games) / b.games);
  return (a.score_pct - b.score_pct) / 100 / se;
}

/** Two groups score clearly differently: both big enough and the gap beyond chance. */
export function scoresDiffer(a: ScoreSample, b: ScoreSample, z = Z95, min = MIN_GROUP_GAMES): boolean {
  return a.games >= min && b.games >= min && Math.abs(scoreZ(a, b)) >= z;
}

/**
 * Sign of a group's deviation from a fixed baseline (50 %, the Elo expectation
 * …): 1 clearly above, -1 clearly below, 0 within noise or too few games.
 */
export function scoreDeviation(s: ScoreSample, baselinePct: number, z = Z_ONE, min = MIN_LINE_GAMES): -1 | 0 | 1 {
  if (s.score_pct === null || s.games < min) return 0;
  const se = Math.sqrt(scoreVar(s.score_pct, s.games) / s.games);
  const t = (s.score_pct - baselinePct) / 100 / se;
  return t >= z ? 1 : t <= -z ? -1 : 0;
}

/** All games except `part`, so a group is compared with the others rather than with a total that contains it. */
export function restOf(total: ScoreSample, part: ScoreSample): ScoreSample {
  const games = total.games - part.games;
  if (games <= 0 || total.score_pct === null || part.score_pct === null) return { games: Math.max(0, games), score_pct: null };
  return { games, score_pct: (total.score_pct * total.games - part.score_pct * part.games) / games };
}

// Errors cluster in bad games (one collapse brings three blunders), so error
// counts vary more than a Poisson count would; the variance is inflated by this factor.
export const ERROR_OVERDISPERSION = 1.6;

/**
 * Error rates (errors per move) clearly differ: test of the log rate ratio
 * (Poisson counts with overdispersion, +½ so zero errors stay defined).
 */
export function ratesDiffer(
  errA: number,
  movesA: number,
  errB: number,
  movesB: number,
  z = Z95,
  minMoves = MIN_BUCKET_MOVES,
): boolean {
  if (movesA < minMoves || movesB < minMoves) return false;
  const a = errA + 0.5;
  const b = errB + 0.5;
  const logRatio = Math.log(a / movesA / (b / movesB));
  return Math.abs(logRatio) / Math.sqrt(ERROR_OVERDISPERSION * (1 / a + 1 / b)) >= z;
}

/** Wilson score interval [low, high] for k successes in n trials. */
export function wilson(k: number, n: number, z = Z95): [number, number] {
  if (n <= 0) return [0, 1];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** The share k/n is at least `threshold`, with 95 % confidence. */
export function shareAtLeast(k: number, n: number, threshold: number, z = Z_ONE): boolean {
  return n > 0 && wilson(k, n, z)[0] >= threshold;
}

/** The share k/n is below `threshold`, with 95 % confidence. */
export function shareBelow(k: number, n: number, threshold: number, z = Z_ONE): boolean {
  return n > 0 && wilson(k, n, z)[1] < threshold;
}

function meanVar(xs: number[]): [number, number] {
  const m = xs.reduce((s, v) => s + v, 0) / xs.length;
  const v = xs.length > 1 ? xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1) : 0;
  return [m, v];
}

/** Means of two samples clearly differ (Welch test). */
export function meansDiffer(a: number[], b: number[], z = Z95, min = MIN_GROUP_GAMES): boolean {
  if (a.length < min || b.length < min) return false;
  const [ma, va] = meanVar(a);
  const [mb, vb] = meanVar(b);
  const se = Math.sqrt(va / a.length + vb / b.length);
  return se > 0 ? Math.abs(ma - mb) / se >= z : ma !== mb;
}

/** Effective number of independent moves for `moves` spread over `games` games. */
export function effectiveMoves(moves: number, games: number): number {
  if (moves <= 0 || games <= 0) return 0;
  const perGame = moves / games;
  return moves / (1 + (perGame - 1) * MOVE_CORRELATION);
}
