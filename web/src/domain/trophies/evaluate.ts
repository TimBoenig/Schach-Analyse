// Which trophies a player has, how far away the others are, and how two
// collections compare.
import type { RawGame } from "../metrics";
import { TIER_POINTS, TIERS, TROPHIES, type Tier, type TrophyDef } from "./catalog";
import { computeStats, type StatKey, type TrophyOptions } from "./stats";

/**
 * Stats that are a single best game or a rating, not work that adds up: the
 * progress line calls them "best so far", and they are no "next trophy" tip
 * (a 1500-rated win is not 83 % of the way to beating an 1800).
 */
export const BEST_OF: ReadonlySet<StatKey> = new Set<StatKey>([
  "peak_rating", "max_beaten_rating", "max_beaten_gap", "max_game_plies", "max_think", "max_checks", "max_captures",
  "max_knight_moves", "max_king_moves", "max_promotions_game", "max_brilliants_game", "max_blunders_game", "best_accuracy",
  "highest_wp_lost",
]);

export interface TrophyState {
  def: TrophyDef;
  /** The stat's current value (0 for a stat that never happened). */
  value: number;
  unlocked: boolean;
  /** 0..1 on the way to the goal; trophies for a lowest/shortest value are all or nothing. */
  progress: number;
  /** A game that shows it, when the trophy has one. */
  game?: string;
  /** The value is a best so far (see BEST_OF), not a running total. */
  best: boolean;
  /** False for a lowest/shortest-value trophy that has no measurement yet (the value then reads 0, which would look like the best). */
  measured: boolean;
}

export interface TrophyReport {
  states: TrophyState[];
  unlocked: number;
  total: number;
  points: number;
  maxPoints: number;
  /** Games the trophies were counted from (finished games without computer opponents). */
  games: number;
  byTier: Record<Tier, { unlocked: number; total: number }>;
}

export function evaluateTrophies(games: RawGame[], names: string[], opts: TrophyOptions = {}): TrophyReport {
  const { stats, games: counted } = computeStats(games, names, opts);
  const byTier = Object.fromEntries(TIERS.map((tier) => [tier, { unlocked: 0, total: 0 }])) as TrophyReport["byTier"];
  let points = 0;
  let maxPoints = 0;
  const states = TROPHIES.map((def): TrophyState => {
    const s = stats[def.stat];
    const value = s.value ?? 0;
    const unlocked = def.below ? s.value !== null && s.value <= def.goal : value >= def.goal;
    byTier[def.tier].total++;
    maxPoints += TIER_POINTS[def.tier];
    if (unlocked) {
      byTier[def.tier].unlocked++;
      points += TIER_POINTS[def.tier];
    }
    return {
      def,
      value,
      unlocked,
      progress: unlocked ? 1 : def.below ? 0 : Math.min(1, value / def.goal),
      game: def.proof && unlocked ? s.game : undefined,
      best: BEST_OF.has(def.stat),
      measured: s.value !== null,
    };
  });
  const unlocked = states.filter((s) => s.unlocked).length;
  return { states, unlocked, total: states.length, points, maxPoints, games: counted, byTier };
}

export interface TrophyComparison {
  /** Trophy ids both have, only the first player has, only the second has, and neither. */
  both: string[];
  onlyA: string[];
  onlyB: string[];
  neither: string[];
}

/** Sorts every trophy by who holds it. Both reports come from the same catalog. */
export function compareTrophies(a: TrophyReport, b: TrophyReport): TrophyComparison {
  const out: TrophyComparison = { both: [], onlyA: [], onlyB: [], neither: [] };
  const theirs = new Map(b.states.map((s) => [s.def.id, s.unlocked]));
  for (const s of a.states) {
    const other = theirs.get(s.def.id) ?? false;
    (s.unlocked ? (other ? out.both : out.onlyA) : other ? out.onlyB : out.neither).push(s.def.id);
  }
  return out;
}

/** The locked trophies closest to being earned (only work that adds up: counts, days, streaks). */
export function nextTrophies(report: TrophyReport, n = 3): TrophyState[] {
  return report.states
    .filter((s) => !s.unlocked && !s.def.below && !s.best && s.progress > 0 && s.def.goal > 1)
    .sort((x, y) => y.progress - x.progress || TIER_POINTS[x.def.tier] - TIER_POINTS[y.def.tier])
    .slice(0, n);
}
