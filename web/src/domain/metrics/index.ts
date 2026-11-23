// Metrics package: statistics aggregation and filtering (headless, no DOM).

export {
  AdvantageStats,
  ClockStats,
  ColorStats,
  FormatStats,
  HangingStats,
  OpeningStats,
  PhaseStats,
  StatsAccumulator,
  pct,
} from "./accumulators";
export { calculateStats, getDrillDownItems } from "./aggregator";
export { isBotGame, withoutBots } from "./bots";
export * from "./constants";
export {
  dateWindow,
  extractGameTimestamp,
  filterGames,
  getUserColor,
  inDateFilter,
  isBulletGame,
  isRangeFilter,
  isValidDateFilter,
  matchesFilters,
  NO_BULLET,
  previousDateFilter,
  rangeFilter,
} from "./filters";
export type { DateWindow, FilterableGame } from "./filters";
export { finishedDate, parseEndedAt, parseFinishedAt, parsePlayedAt } from "./played";
export { GameRecord, outcomeFor, parseMoves, parseSummary } from "./models";
export type { GameMeta, Outcome, RawGame } from "./models";
export { detectSpeedCategory, hasRatingPool, UNTIMED } from "./speed";
export { classifyTermination } from "./termination";
