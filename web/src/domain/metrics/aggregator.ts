// Metrics orchestration (port of src/backend/analysis/metrics/aggregator.py).

import { StatsAccumulator } from "./accumulators";
import { filterGames } from "./filters";
import { GameRecord, type RawGame } from "./models";

type Dict = Record<string, any>;

/** Comprehensive game statistics over the filtered games of the tracked usernames. */
export function calculateStats(
  games: RawGame[],
  usernames: Iterable<string>,
  colorFilter = "All Colors",
  formatFilter = "All Formats",
  sourceFilter = "All Sources",
  dateFilter = "All Time",
): Dict {
  const acc = new StatsAccumulator();
  for (const [game, color] of filterGames(
    games,
    usernames,
    colorFilter,
    formatFilter,
    sourceFilter,
    dateFilter,
  )) {
    acc.add(GameRecord.fromDict(game, color));
  }
  return acc.finalize(colorFilter, formatFilter, sourceFilter, dateFilter);
}

/**
 * Drill-down items for a category and optional subcategory, e.g.
 * ('hung_pieces', 'queen'), ('blunders'), ('tactical_themes', 'fork'),
 * ('advantage', 'thrown_losses'), ('brilliancies').
 */
export function getDrillDownItems(stats: Dict, category: string, subcategory?: string): Dict[] {
  if (category === "brilliancies") return stats.brilliancies ?? [];

  const catData: unknown = (stats.drill_down ?? {})[category] ?? {};
  if (Array.isArray(catData)) return catData as Dict[];
  if (catData && typeof catData === "object") {
    const entries = Object.entries(catData as Record<string, Dict[]>);
    if (subcategory) {
      const direct = (catData as Record<string, Dict[]>)[subcategory];
      if (direct) return direct;
      const sub = subcategory.toLowerCase();
      for (const [k, v] of entries) if (k.toLowerCase() === sub) return v;
      for (const [k, v] of entries) {
        const kl = k.toLowerCase();
        if (kl.startsWith(sub) || sub.startsWith(kl)) return v;
      }
      return [];
    }
    if ("all" in (catData as object)) return (catData as Record<string, Dict[]>).all;
    return entries.flatMap(([, v]) => (Array.isArray(v) ? v : []));
  }
  return [];
}
