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
export * from "./constants";
export { extractGameTimestamp, filterGames, getUserColor, matchesFilters } from "./filters";
export type { FilterableGame } from "./filters";
export { GameRecord, outcomeFor, parseMoves, parseSummary } from "./models";
export type { GameMeta, Outcome, RawGame } from "./models";
export { detectSpeedCategory } from "./speed";
export { classifyTermination } from "./termination";
