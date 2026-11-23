// The one-glance call of a duel between two league players: who is favoured and by
// how much, in a few plain classes the page can phrase without statistics jargon.
import { pairForecastOf } from "./league";
import type { PairForecast } from "./league";
import type { HeadToHead } from "./h2h";
import { lichessBlitzToElo } from "../profile/fide";
import type { StrengthEstimate } from "./strength";

/** Favourite classes by the forecast score of the first player. */
export type DuelCall = "clear-a" | "slight-a" | "even" | "slight-b" | "clear-b";

export interface DuelOverview {
  call: DuelCall;
  /** Expected score of the first player in percent (50 = even). */
  score_a: number;
  /** Elo of the first player minus Elo of the second (as shown in the league). */
  elo_gap: number;
  forecast: PairForecast;
  /** The direct games between the two (null when they never played each other). */
  record: Pick<HeadToHead, "games" | "wins" | "draws" | "losses"> | null;
}

// Below 55 % the forecast is closer to a coin flip than to a favourite; 70 % and
// above means the favourite wins about every second game more than the other.
export const EVEN_BAND = 0.55;
export const CLEAR_BAND = 0.7;

export function callOf(p: number): DuelCall {
  const lead = Math.max(p, 1 - p);
  if (lead < EVEN_BAND) return "even";
  const side = p > 0.5 ? "a" : "b";
  return lead >= CLEAR_BAND ? `clear-${side}` : `slight-${side}`;
}

/** The duel of A against B, or null while one of them has no strength estimate yet. */
export function duelOverview(a: StrengthEstimate | null, b: StrengthEstimate | null, h2h: HeadToHead | null): DuelOverview | null {
  const forecast = pairForecastOf(a, b, h2h);
  if (!forecast || !a || !b) return null;
  return {
    call: callOf(forecast.p),
    score_a: forecast.p * 100,
    elo_gap: lichessBlitzToElo(a.value) - lichessBlitzToElo(b.value),
    forecast,
    record: h2h && h2h.games > 0 ? { games: h2h.games, wins: h2h.wins, draws: h2h.draws, losses: h2h.losses } : null,
  };
}
