// Fair comparison of two players: every number comes with its uncertainty, so
// "Max has the better endgame" is only said when the gap is larger than what
// a handful of games could produce by chance. The same estimates drive the
// friends ranking (points = chance of being better than each other player),
// the head-to-head duel card and the matchup tips of the scouting report.
//
// The win forecast starts from how the two compare in the rating-free factors
// (results against the opponents' strength, accuracy, blunders, skills) and
// adds the direct encounters: that starting point counts like
// QUALITY_PRIOR_GAMES games, so a 3:0 moves the forecast but does not turn it
// into 100 %. The rating is shown next to it but plays no part: a friend who
// just opened an account can be hundreds of points off for weeks.

import { trSpeed } from "../i18n";
import { expectedScore } from "../profile/benchmarks";
import { ERROR_OVERDISPERSION, MIN_GROUP_GAMES } from "../profile/evidence";
import type { PlayerProfile, SkillScore } from "../profile/models";
import { PRIOR_MARGIN, SKILL_NAMES } from "../profile/skills";
import { ADJUST_SE_SHARE, FAIRNESS_NOTE, type SpeedAdjust } from "./fairness";
import type { HeadToHead } from "./h2h";
import { FACTOR_WEIGHTS } from "./weights";

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
// The comparison of the players' own play counts like this many direct games.
export const QUALITY_PRIOR_GAMES = 6;
// Being certainly better everywhere moves the starting point by at most this
// much from 50 %: even a clearly better player drops points between friends.
const QUALITY_SPAN = 0.25;
// Without any comparison the forecast starts at 50 % with this weight.
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
  // One game's score spreads around its expectation by sqrt(p(1-p)) at most 0.5;
  // draws narrow it, so the player's own mean expectation gives a tighter, honest bound.
  const e = rc.expected_score / rc.rated_games;
  const sd = Math.max(0.35, Math.sqrt(Math.max(0, e * (1 - e))));
  return { value: ((rc.score - rc.expected_score) / rc.rated_games) * 100, se: (100 * sd) / Math.sqrt(rc.rated_games) };
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

/**
 * A skill as a rating-free estimate for comparisons. The profile blends each
 * measured skill with what is typical for the player's *rating* (weight
 * 1 - w, which the margin gives back: margin = PRIOR_MARGIN * sqrt(1 - w)).
 * Between two players that would let the rating decide close skills: the
 * lower-rated one is pulled down before a single move is looked at. Here that
 * share of the prior is swapped for `prior`, a value shared by everyone
 * compared (see `skillPrior`), so only the player's own moves separate them.
 */
export function skillEstimate(s: SkillScore | undefined, prior = 50): Estimate | null {
  if (!s || s.sample <= 0 || s.grade === "Keine Uhrdaten") return null;
  const margin = s.margin ?? PRIOR_MARGIN;
  const priorShare = s.margin === null || s.margin === undefined ? 0 : Math.min(1, (margin / PRIOR_MARGIN) ** 2);
  const ratingPrior = s.typical ?? 50;
  return { value: s.score + priorShare * (prior - ratingPrior), se: margin / 1.96 };
}

/**
 * Common prior for one skill among the compared players: the measured level
 * of the group, each player weighted by the evidence behind the skill, plus
 * one player's worth of 50 so two players with little data do not set it alone.
 */
export function skillPrior(skills: (SkillScore | undefined)[]): number {
  let sum = 50;
  let weight = 1;
  for (const s of skills) {
    if (!s || s.sample <= 0 || s.grade === "Keine Uhrdaten" || s.margin === null || s.margin === undefined) continue;
    const w = 1 - Math.min(1, (s.margin / PRIOR_MARGIN) ** 2);
    sum += w * (s.raw_score ?? s.score);
    weight += w;
  }
  return sum / weight;
}

/** Shift an estimate by a time-control correction; the correction's own uncertainty widens the error. */
export function shifted(e: Estimate | null, delta: number): Estimate | null {
  if (!e || !delta) return e;
  return { value: e.value + delta, se: Math.hypot(e.se, ADJUST_SE_SHARE * delta) };
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
  /** Elo expectation alone, in percent (null without ratings). For information only. */
  elo_pct: number | null;
  /** Starting point from the rating-free comparison, in percent (null without one). */
  quality_pct: number | null;
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
  /** Notes on how the numbers were made fair (e.g. time-control correction). */
  notes: string[];
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

function predict(me: PlayerProfile | null, them: PlayerProfile, h2h: HeadToHead, comparableRatings: boolean, quality: number | null): Prediction | null {
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
  if (quality === null && !h2h.games) return null;
  const eloP = elo ? expectedScore(elo.me, elo.them) : null;
  const qualityP = quality === null ? null : 0.5 + (quality - 0.5) * 2 * QUALITY_SPAN;
  const prior = qualityP ?? 0.5;
  const k = qualityP !== null ? QUALITY_PRIOR_GAMES : NEUTRAL_PRIOR_GAMES;
  const points = h2h.wins + h2h.draws / 2;
  const p = (prior * k + points) / (k + h2h.games);
  const sd = Math.sqrt((p * (1 - p)) / (k + h2h.games + 1));
  const parts: string[] = [];
  if (qualityP !== null) parts.push("eurem Spiel (Ergebnisse, Genauigkeit, Patzer, Fähigkeiten)");
  if (h2h.games) parts.push(plural(h2h.games, "direkten Partie", "direkten Partien"));
  return {
    pct: p * 100,
    low: Math.max(0, p - BAND_Z * sd) * 100,
    high: Math.min(1, p + BAND_Z * sd) * 100,
    elo,
    elo_pct: eloP === null ? null : eloP * 100,
    quality_pct: qualityP === null ? null : qualityP * 100,
    h2h_games: h2h.games,
    basis: `Aus ${parts.join(" und ")}. Die Wertung zählt nicht mit.`,
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
  /** Time-control corrections for [me, them] (see fairness.ts). */
  adjust: [SpeedAdjust, SpeedAdjust] | null = null,
): Matchup {
  const rows: MatchupRow[] = [];
  const add = (key: string, label: string, group: MatchupRow["group"], higher: boolean, a: Estimate | null, b: Estimate | null) => {
    const pMe = a && b ? probBetter(a, b, higher) : null;
    rows.push({ key, label, group, higher_is_better: higher, me: a?.value ?? null, them: b?.value ?? null, p_me: pMe, ...edgeOf(pMe) });
  };
  if (me) {
    add("expectation", "Über Erwartung", "Ergebnisse", true, expectationEstimate(me), expectationEstimate(them));
    add("accuracy", "Genauigkeit", "Spielqualität", true, shifted(accuracyEstimate(me), adjust?.[0].accuracy ?? 0), shifted(accuracyEstimate(them), adjust?.[1].accuracy ?? 0));
    add("blunders", "Patzer pro Partie", "Spielqualität", false, shifted(blunderEstimate(me), adjust?.[0].blunders ?? 0), shifted(blunderEstimate(them), adjust?.[1].blunders ?? 0));
    for (const k of SKILL_KEYS) {
      const ok = (p: PlayerProfile) => p.analyzed_games >= MIN_COMPARE_ANALYZED;
      const a = ok(me) ? me.skills.find((s) => s.key === k) : undefined;
      const b = ok(them) ? them.skills.find((s) => s.key === k) : undefined;
      const prior = skillPrior([a, b]);
      add(k, SKILL_NAMES[k], "Fähigkeiten", true, skillEstimate(a, prior), skillEstimate(b, prior));
    }
  }
  const known = rows.filter((r) => r.p_me !== null);
  // Weighted chance of being the better player, the same weights as the ranking.
  let wsum = 0;
  let psum = 0;
  for (const r of known) {
    const w = FACTOR_WEIGHTS[r.key] ?? 0;
    wsum += w;
    psum += w * (r.p_me as number);
  }
  const prediction = predict(me, them, h2h, comparableRatings, wsum ? psum / wsum : null);
  // The rating is shown for orientation only: it never counts as a lead.
  if (prediction?.elo?.from === "Wertung") {
    rows.unshift({
      key: "rating",
      label: `Wertung (${prediction.elo.speed})`,
      group: "Ergebnisse",
      higher_is_better: true,
      me: prediction.elo.me,
      them: prediction.elo.them,
      p_me: probBetter({ value: prediction.elo.me, se: RATING_SE }, { value: prediction.elo.them, se: RATING_SE }),
      ...edgeOf(null),
    });
  }
  return {
    prediction,
    rows,
    ahead: known.filter((r) => r.edge === "me").length,
    behind: known.filter((r) => r.edge === "them").length,
    even: known.filter((r) => r.edge === "even").length,
    notes: me && adjust && (adjust[0].accuracy || adjust[1].accuracy) ? [FAIRNESS_NOTE] : [],
  };
}
