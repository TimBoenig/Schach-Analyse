// "Your endgame plays like FIDE 1750": each part of the game placed on the
// FIDE scale.
//
// The yardstick is the opponents in the same games, not a fixed table. A
// fixed "accuracy X is typical for rating Y" table only holds for the engine,
// depth and accuracy formula it was made with; this site analyses with its own
// engine at a shallow depth and a stricter accuracy curve, so a table from
// Lichess or Chess.com placed everybody hundreds of points too high. The
// opponents, though, are measured with exactly the same engine, depth and
// formula, and their ratings are known. So for every part of the game:
//
//   estimate = opponents' average rating (FIDE scale)
//              − C · ln(your error rate / their error rate)
//
// - The log of the error ratio is the scaling law behind every published
//   error-to-rating relation: Regan's intrinsic ratings (IPR = 3571 − 15413 · AE,
//   errors scaled logarithmically) and the Lichess-database fit
//   Elo = 5189 − 849 · ln(ACPL) (Bianco 2026, 14,307 players). A ratio also
//   cancels any factor by which this engine finds more or fewer errors than
//   a deeper one.
// - C: the Lichess-band errors (113, 77, 51, 21 centipawns at 1100, 1500,
//   1900, 2300) converted to FIDE with the ChessGoals survey give 370 to 670
//   FIDE points per unit of ln. We use 450, near the low end, so the estimates
//   rather understate than overstate how far a part of the game sits from the
//   opponents' level.
// - Errors: lost winning chance per own move after the book (the win-%
//   version of centipawn loss) for the phases and the whole game, blunders per
//   move for piece safety, unpunished opponent errors for tactics.
//
// Thin data must not produce bold numbers: a single game says ±400 Elo
// (Patzer's Review), so every estimate carries a standard error (per game,
// clustered, delta method) and is shrunk toward the player's own rating on
// the FIDE scale: skills of one player rarely sit more than one or two hundred
// points apart. The 95 % margin is shown with the value.

import { FIDE_FLOOR, toFide } from "./fide";
import type { GameFeatures } from "./features";
import { ratingSource } from "./benchmarks";
import { SKILL_NAMES } from "./skills";

/** FIDE points per unit of ln(error ratio). See the header for the derivation. */
export const ELO_PER_LN_ERRORS = 450;
/**
 * Least noise of one game's estimate (FIDE points, 1 SD). Published checks put
 * a single game at about ±400 and need some 40 games for ±50 (Patzer's Review
 * 2020); the per-game delta method alone is too optimistic on a handful of
 * games, so it never goes below this.
 */
export const PER_GAME_ELO_SD = 250;
/** Spread of a player's skills around their overall strength (prior SD, FIDE points). */
export const SKILL_SPREAD = 150;
/** Above this 95 % margin a value is drawn faint and never called a strength. */
export const RELIABLE_ELO_MARGIN = 150;
/** Fewer analysed games with known opponent ratings give no estimate at all. */
export const MIN_STRENGTH_GAMES = 5;
export const STRENGTH_MIN = FIDE_FLOOR;
export const STRENGTH_MAX = 2800;
const Z95 = 1.96;

export interface SkillStrength {
  key: string;
  name: string;
  /** Estimated FIDE rating of this part of the game, within STRENGTH_MIN..STRENGTH_MAX. */
  rating: number;
  /** 95 % uncertainty in FIDE points. */
  margin: number;
  /** -1 below the scale, 1 above it, 0 inside. */
  capped: -1 | 0 | 1;
  reliable: boolean;
  /** Own error rate divided by the opponents' (below 1 = fewer errors). */
  error_ratio: number;
  games: number;
}

export interface StrengthMap {
  skills: SkillStrength[];
  /** The whole game (all moves after the book) on the same scale. */
  overall: SkillStrength | null;
  /** Average opponent on the FIDE scale: the level the error ratios are measured against. */
  opponents_fide: number;
  /** The player's own rating on the FIDE scale (null without one). */
  own_fide: number | null;
  /** Part of the conversion lies below the survey's range (rough near the FIDE floor). */
  extrapolated: boolean;
}

/** One analysed game seen from both sides. */
export interface GamePair {
  own: GameFeatures;
  opp: GameFeatures;
}

export interface Tally {
  errors: number;
  units: number;
}

type Counter = (f: GameFeatures) => Tally;

const lostChance =
  (phase: string | null): Counter =>
  (f) => {
    let errors = 0;
    let units = 0;
    for (const m of f.moves) {
      if (m.is_book || !m.classification || (phase && m.phase !== phase)) continue;
      errors += m.wp_drop * 100;
      units += 1;
    }
    return { errors, units };
  };

const blunders: Counter = (f) => {
  let errors = 0;
  let units = 0;
  for (const m of f.moves) {
    if (m.is_book || !m.classification) continue;
    if (m.classification === "Blunder") errors += 1;
    units += 1;
  }
  return { errors, units };
};

const unpunished: Counter = (f) => ({ errors: f.punish_chances - f.punished, units: f.punish_chances });

// Each metric with a pseudo-count of `prior` units at the pooled error rate
// added to both sides: it pulls a ratio from a handful of moves toward 1 and
// keeps it finite when one side made no error at all.
const METRICS: { key: string; count: Counter; prior: number }[] = [
  { key: "opening", count: lostChance("opening"), prior: 15 },
  { key: "middlegame", count: lostChance("middlegame"), prior: 15 },
  { key: "endgame", count: lostChance("endgame"), prior: 15 },
  { key: "tactics", count: unpunished, prior: 4 },
  { key: "safety", count: blunders, prior: 60 },
];
const OVERALL = { key: "overall", count: lostChance(null), prior: 30 };

/** ln(own rate / opponent rate) with its clustered (per game) standard error. */
export function errorRatio(pairs: GamePair[], count: Counter, prior: number): { ln: number; se: number; games: number } | null {
  return tallyRatio(
    pairs.map((p) => ({ u: count(p.own), o: count(p.opp) })),
    prior,
  );
}

/** errorRatio on ready tallies per game: `u` the player's own, `o` the opponent's. */
export function tallyRatio(games: { u: Tally; o: Tally }[], prior: number): { ln: number; se: number; games: number } | null {
  const rows = games.filter((r) => r.u.units > 0 || r.o.units > 0);
  const n = rows.length;
  if (n < 2) return null;
  let lu = 0;
  let mu = 0;
  let lo = 0;
  let mo = 0;
  for (const r of rows) {
    lu += r.u.errors;
    mu += r.u.units;
    lo += r.o.errors;
    mo += r.o.units;
  }
  if (!mu || !mo || lu + lo <= 0) return null;
  const pooled = (lu + lo) / (mu + mo);
  const LU = lu + pooled * prior;
  const MU = mu + prior;
  const LO = lo + pooled * prior;
  const MO = mo + prior;
  const ln = Math.log(LU / MU) - Math.log(LO / MO);
  // Delta method on the four sums, with games as clusters: moves of one game
  // are not independent, games are.
  let ss = 0;
  for (const r of rows) {
    const d = r.u.errors / LU - r.u.units / MU - r.o.errors / LO + r.o.units / MO;
    ss += d * d;
  }
  const se = Math.sqrt((ss * n) / (n - 1));
  return { ln, se, games: n };
}

function settle(key: string, anchor: number, prior: number, ratio: { ln: number; se: number; games: number }): SkillStrength {
  const observed = anchor - ELO_PER_LN_ERRORS * ratio.ln;
  const seObs = Math.max(ELO_PER_LN_ERRORS * ratio.se, PER_GAME_ELO_SD / Math.sqrt(ratio.games));
  // Normal-normal empirical Bayes: precision-weighted blend of measurement and prior.
  const wObs = 1 / seObs ** 2;
  const wPrior = 1 / SKILL_SPREAD ** 2;
  const mean = (observed * wObs + prior * wPrior) / (wObs + wPrior);
  const margin = Math.round((Z95 / Math.sqrt(wObs + wPrior)) / 10) * 10;
  const capped: -1 | 0 | 1 = mean < STRENGTH_MIN ? -1 : mean > STRENGTH_MAX ? 1 : 0;
  const rating = Math.round(Math.min(STRENGTH_MAX, Math.max(STRENGTH_MIN, mean)) / 10) * 10;
  return {
    key,
    name: key === "overall" ? "Gesamt" : SKILL_NAMES[key],
    rating,
    margin,
    capped,
    reliable: ratio.games >= MIN_STRENGTH_GAMES && margin <= RELIABLE_ELO_MARGIN,
    error_ratio: Math.round(Math.exp(ratio.ln) * 100) / 100,
    games: ratio.games,
  };
}

/**
 * Every part of the game on the FIDE scale, strongest first. Needs analysed
 * games whose opponent rating is known; null below MIN_STRENGTH_GAMES of them.
 * `ownFide` is the player's current rating on the FIDE scale (the prior).
 */
export function strengthMap(pairs: GamePair[], ownFide: number | null): StrengthMap | null {
  const rated = pairs.filter((p) => p.own.analyzed && p.own.opp_rating > 0);
  if (rated.length < MIN_STRENGTH_GAMES) return null;
  let sum = 0;
  let extrapolated = false;
  for (const p of rated) {
    const fide = toFide(p.own.opp_rating, ratingSource(p.own), p.own.rec.speed);
    sum += fide.rating;
    extrapolated ||= fide.extrapolated;
  }
  const anchor = sum / rated.length;
  const prior = ownFide ?? anchor;
  const skills: SkillStrength[] = [];
  for (const m of METRICS) {
    const ratio = errorRatio(rated, m.count, m.prior);
    if (ratio) skills.push(settle(m.key, anchor, prior, ratio));
  }
  const all = errorRatio(rated, OVERALL.count, OVERALL.prior);
  return {
    skills: skills.sort((a, b) => b.rating - a.rating),
    overall: all ? settle("overall", anchor, prior, all) : null,
    opponents_fide: Math.round(anchor),
    own_fide: ownFide,
    extrapolated: extrapolated || (ownFide !== null && ownFide <= FIDE_FLOOR),
  };
}
