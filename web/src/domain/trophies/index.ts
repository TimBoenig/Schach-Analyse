// Trophies: collectible achievements computed from the games already in the app.
export { LEVELS, TIER_LABEL, TIER_POINTS, TIERS, TROPHIES } from "./catalog";
export type { Tier, TrophyDef, TrophyIcon } from "./catalog";
export { BEST_OF, collectorLevel, compareTrophies, evaluateTrophies, nextTrophies } from "./evaluate";
export type { CollectorLevel, TrophyComparison, TrophyReport, TrophyState } from "./evaluate";
export { MIN_QUALITY_MOVES, MIN_STREAK_MOVES, STAT_KEYS } from "./stats";
export type { StatKey, TrophyOptions } from "./stats";
