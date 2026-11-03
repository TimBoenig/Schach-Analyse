// Fair comparison of two players: every number comes with its uncertainty, so
// "Max has the better endgame" is only said when the gap is larger than what
// a handful of games could produce by chance. The same estimates drive the
// friends ranking (points = chance of being better than each other player),
// the head-to-head duel card and the matchup tips of the scouting report.
//
// The win forecast combines the Elo expectation (from comparable ratings)
// with the direct encounters: the rating counts like ELO_PRIOR_GAMES games,
// so a 3:0 between two equally rated players moves the forecast, but does not
// turn it into 100 %.

import { trSpeed } from "../i18n";
import { expectedScore } from "../profile/benchmarks";
import { ERROR_OVERDISPERSION, MIN_GROUP_GAMES } from "../profile/evidence";
import type { PlayerProfile, SkillScore } from "../profile/models";
import { SKILL_NAMES } from "../profile/skills";
import type { HeadToHead } from "./h2h";

export interface Estimate {
  value: number;
  /** Standard error of `value`. */
  se: number;
}

/** Analyzed games per player before accuracy, blunders and skills are compared. */
export const MIN_COMPARE_ANALYZED = 5;
// Typical spread of one game's accuracy, used when a profile has too few games to measure it.
const ACCURACY_SD = 9;
// An active player's rating is uncertain by about this much (Glicko RD on Lichess is ~50–70).
export const RATING_SE = 60;
// The rating gap counts like this many direct games in the forecast.
export const ELO_PRIOR_GAMES = 10;
// Without comparable ratings the forecast starts at 50 % with this weight.
const NEUTRAL_PRIOR_GAMES = 4;
// Probability of being better from which a side "leads" a comparison, and "clearly" leads.
export const EDGE_P = 0.8;
export const SURE_P = 0.95;
// Two-sided 80 % band for the forecast: a range people can read as "likely".
const BAND_Z = 1.2816;

/** Standard normal cumulative distribution (Abramowitz–Stegun 7.1.26, error < 1e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Chance that `a` is truly better than `b`, given both estimates' uncertainty. */
export function probBetter(a: Estimate, b: Estimate, higherIsBetter = true): number {
  const d = higherIsBetter ? a.value - b.value : b.value - a.value;
  const se = Math.hypot(a.se, b.se);
  if (d === 0) return 0.5;
  if (se <= 0) return d > 0 ? 1 : 0;
  return normalCdf(d / se);
}

/** Standard error of a score in percent points (+1/+2 so a 3:0 keeps some spread). */
export function scoreSe(pct: number, games: number): number {
  if (games <= 0) return 50;
  const p = ((pct / 100) * games + 1) / (games + 2);
  return 100 * Math.sqrt((p * (1 - p)) / games);
}

export function scoreEstimate(p: PlayerProfile): Estimate | null {
  const pct = p.overview.score_pct;
  if (!p.total_games || pct === null || pct === undefined) return null;
  return { value: Number(pct), se: scoreSe(Number(pct), p.total_games) };
}

/** Points above/below the Elo expectation per game, in percent points. */
export function expectationEstimate(p: PlayerProfile): Estimate | null {
  const rc = p.rating;
  if (!rc || rc.expected_score === null || rc.rated_games < MIN_GROUP_GAMES) return null;
  // One game's score spreads by at most 0.5 around its expectation.
  return { value: ((rc.score - rc.expected_score) / rc.rated_games) * 100, se: 50 / Math.sqrt(rc.rated_games) };
}

export function accuracyEstimate(p: PlayerProfile): Estimate | null {
  const n = p.analyzed_games;
  if (n < MIN_COMPARE_ANALYZED) return null;
  const measured = Number(p.overview.accuracy_sd) || 0;
  // A few similar games understate the spread, so below 10 games the typical value is the floor.
  const sd = n >= 10 && measured > 0 ? measured : Math.max(measured, ACCURACY_SD);
  return { value: Number(p.overview.avg_accuracy), se: sd / Math.sqrt(n) };
}

export function blunderEstimate(p: PlayerProfile): Estimate | null {
  const n = p.analyzed_games;
  if (n < MIN_COMPARE_ANALYZED) return null;
  const b = Number((p.overview.quality_counts ?? {}).Blunder ?? 0);
  // Blunders cluster in bad games, so the Poisson spread is inflated.
  return { value: b / n, se: Math.sqrt(ERROR_OVERDISPERSION * (b + 0.5)) / n };
}

/** A skill as an estimate; its margin is a 95 % band. */
export function skillEstimate(s: SkillScore | undefined): Estimate | null {
  if (!s || s.sample <= 0 || s.grade === "Keine Uhrdaten") return null;
  return { value: s.score, se: (s.margin ?? 30) / 1.96 };
}

export type Edge = "me" | "them" | "even";

export function edgeOf(pMe: number | null): { edge: Edge; sure: boolean } {
  if (pMe === null) return { edge: "even", sure: false };
  if (pMe >= EDGE_P) return { edge: "me", sure: pMe >= SURE_P };
  if (pMe <= 1 - EDGE_P) return { edge: "them", sure: pMe <= 1 - SURE_P };
  return { edge: "even", sure: false };
}

export interface MatchupRow {
  key: string;
  label: string;
  group: "Ergebnisse" | "Spielqualität" | "Fähigkeiten";
  higher_is_better: boolean;
  me: number | null;
  them: number | null;
  /** Chance that you are truly better here (null without data on both sides). */
  p_me: number | null;
  edge: Edge;
  /** The lead is beyond reasonable doubt (95 %). */
  sure: boolean;
}

export interface Prediction {
  /** Your expected points per game against the player, in percent. */
  pct: number;
  /** 80 % band of the forecast. */
  low: number;
  high: number;
  /** Ratings the forecast starts from (null: no comparable ratings). */
  elo: { me: number; them: number; speed: string; from: "Wertung" | "letzte Partie" } | null;
  /** Elo expectation alone, in percent (null without ratings). */
  elo_pct: number | null;
  h2h_games: number;
  /** One German sentence on what the forecast rests on. */
  basis: string;
}

export interface Matchup {
  prediction: Prediction | null;
  rows: MatchupRow[];
  /** Comparisons you lead, they lead, and open ones (only rows with data). */
  ahead: number;
  behind: number;
  even: number;
}

const SKILL_KEYS = ["opening", "middlegame", "endgame", "tactics", "safety", "conversion", "defense", "time"] as const;

/** Speed (English key) the two mostly play each other in, else the user's main one. */
function duelSpeed(h2h: HeadToHead, me: PlayerProfile | null, them: PlayerProfile): string | null {
  const by = new Map<string, number>();
  for (const g of h2h.recent) if (g.speed) by.set(g.speed, (by.get(g.speed) ?? 0) + 1);
  let best: string | null = null;
  for (const [s, n] of by) if (best === null || n > (by.get(best) as number)) best = s;
  return best ?? me?.rating?.speed ?? them.rating?.speed ?? null;
}

function ratingIn(p: PlayerProfile | null, speed: string): number | null {
  const v = Number(((p?.overview.ratings ?? {}) as Record<string, number>)[trSpeed(speed)]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function predict(me: PlayerProfile | null, them: PlayerProfile, h2h: HeadToHead, comparableRatings: boolean): Prediction | null {
  const speed = duelSpeed(h2h, me, them);
  let elo: Prediction["elo"] = null;
  if (speed && comparableRatings) {
    const a = ratingIn(me, speed);
    const b = ratingIn(them, speed);
    if (a !== null && b !== null) elo = { me: a, them: b, speed: trSpeed(speed), from: "Wertung" };
  }
  if (!elo) {
    // Ratings from a game between the two are on the same platform by definition.
    const g = h2h.recent.find((x) => x.rating_a !== null && x.rating_b !== null && (!speed || x.speed === speed)) ?? h2h.recent.find((x) => x.rating_a !== null && x.rating_b !== null);
    if (g) elo = { me: g.rating_a as number, them: g.rating_b as number, speed: trSpeed(g.speed), from: "letzte Partie" };
  }
  if (!elo && !h2h.games) return null;
  const eloP = elo ? expectedScore(elo.me, elo.them) : null;
  const prior = eloP ?? 0.5;
  const k = eloP !== null ? ELO_PRIOR_GAMES : NEUTRAL_PRIOR_GAMES;
  const points = h2h.wins + h2h.draws / 2;
  const p = (prior * k + points) / (k + h2h.games);
  const sd = Math.sqrt((p * (1 - p)) / (k + h2h.games + 1));
  const parts: string[] = [];
  if (elo) parts.push(`der Wertung (${elo.speed} ${Math.round(elo.me)} zu ${Math.round(elo.them)}${elo.from === "letzte Partie" ? ", aus eurer letzten Partie" : ""})`);
  if (h2h.games) parts.push(plural(h2h.games, "direkten Partie", "direkten Partien"));
  return {
    pct: p * 100,
    low: Math.max(0, p - BAND_Z * sd) * 100,
    high: Math.min(1, p + BAND_Z * sd) * 100,
    elo,
    elo_pct: eloP === null ? null : eloP * 100,
    h2h_games: h2h.games,
    basis: `Aus ${parts.join(" und ")}.`,
  };
}

/**
 * You against one player: forecast and every comparable number with who is
 * ahead. `comparableRatings` must only be true when both play mostly on the
 * same platform (Lichess and Chess.com ratings differ by a lot).
 */
export function buildMatchup(
  me: PlayerProfile | null,
  them: PlayerProfile,
  h2h: HeadToHead,
  comparableRatings: boolean,
): Matchup {
  const prediction = predict(me, them, h2h, comparableRatings);
  const rows: MatchupRow[] = [];
  const add = (key: string, label: string, group: MatchupRow["group"], higher: boolean, a: Estimate | null, b: Estimate | null) => {
    const pMe = a && b ? probBetter(a, b, higher) : null;
    rows.push({ key, label, group, higher_is_better: higher, me: a?.value ?? null, them: b?.value ?? null, p_me: pMe, ...edgeOf(pMe) });
  };
  if (prediction?.elo?.from === "Wertung") {
    add("rating", `Wertung (${prediction.elo.speed})`, "Ergebnisse", true, { value: prediction.elo.me, se: RATING_SE }, { value: prediction.elo.them, se: RATING_SE });
  }
  if (me) {
    add("expectation", "Über Erwartung", "Ergebnisse", true, expectationEstimate(me), expectationEstimate(them));
    add("accuracy", "Genauigkeit", "Spielqualität", true, accuracyEstimate(me), accuracyEstimate(them));
    add("blunders", "Patzer pro Partie", "Spielqualität", false, blunderEstimate(me), blunderEstimate(them));
    for (const k of SKILL_KEYS) {
      const ok = (p: PlayerProfile) => p.analyzed_games >= MIN_COMPARE_ANALYZED;
      add(
        k,
        SKILL_NAMES[k],
        "Fähigkeiten",
        true,
        ok(me) ? skillEstimate(me.skills.find((s) => s.key === k)) : null,
        ok(them) ? skillEstimate(them.skills.find((s) => s.key === k)) : null,
      );
    }
  }
  const known = rows.filter((r) => r.p_me !== null);
  return {
    prediction,
    rows,
    ahead: known.filter((r) => r.edge === "me").length,
    behind: known.filter((r) => r.edge === "them").length,
    even: known.filter((r) => r.edge === "even").length,
  };
}
