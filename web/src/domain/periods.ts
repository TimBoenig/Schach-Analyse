// Default periods per page. "Gesamter Zeitraum" mixes games from years ago
// with today's play: a profile, a comparison or a chart then describes a
// player who no longer exists, and friends whose games are only analysed back
// to some point are measured over a different span than the user. Each page
// therefore starts with the span its numbers need:
//
// - 30 days where the question is "how am I doing lately" (start page, game list)
//   and the comparison with the 30 days before still has enough games;
// - 90 days where the numbers need many games to settle (profile skills,
//   insights, openings, move tally, the friends league and the duel page).
//
// When the default span holds too few games (a break from chess, games only
// imported from long ago), the page widens step by step instead of showing an
// empty page. A period the user picks is always kept as picked.

import { dateWindow } from "./metrics/filters";

export type PeriodPage = "home" | "games" | "profile" | "insights" | "openings" | "moves" | "league" | "duel" | "aiExport";

export const PAGE_PERIODS: Record<PeriodPage, string> = {
  home: "Last 30 Days",
  games: "Last 30 Days",
  profile: "Last 90 Days",
  insights: "Last 90 Days",
  openings: "Last 90 Days",
  moves: "Last 90 Days",
  league: "Last 90 Days",
  duel: "Last 90 Days",
  aiExport: "Last 90 Days",
};

/** Spans a default widens through, shortest first. */
export const WIDEN_CHAIN = ["Last 14 Days", "Last 30 Days", "Last 90 Days", "Last 365 Days", "All Time"] as const;

/** Games a page needs in its default span before it stops widening. */
export const MIN_PERIOD_GAMES = 10;

/**
 * The first span from `preferred` on (then ever longer) for which `enough`
 * holds; "All Time" when none does. `enough` gets the span's start in epoch
 * seconds (null for "All Time"), so callers can count with one pass per span.
 */
export function settlePeriod(preferred: string, enough: (start: number | null, period: string) => boolean, now = Date.now() / 1000): string {
  const from = WIDEN_CHAIN.indexOf(preferred as (typeof WIDEN_CHAIN)[number]);
  const chain = from >= 0 ? WIDEN_CHAIN.slice(from) : [preferred, ...WIDEN_CHAIN.filter((p) => p !== preferred)];
  for (const period of chain) {
    const w = dateWindow(period, now);
    if (enough(w?.start ?? null, period)) return period;
  }
  return "All Time";
}

/**
 * `settlePeriod` for "at least `min` of these timestamps": the usual case of
 * a page that needs a number of games (epoch seconds; null = undated, which
 * only "All Time" counts).
 */
export function settleByCount(preferred: string, times: (number | null)[], min = MIN_PERIOD_GAMES, now = Date.now() / 1000): string {
  return settlePeriod(preferred, (start) => (start === null ? times.length : times.filter((t) => t !== null && t >= start).length) >= min, now);
}
