// Rating context for the profile: what is typical at the player's rating, how
// they performed against the ratings they met, and the Elo expectation.
//
// The reference values are estimates for online club play (Lichess-style
// accuracy, blitz/rapid), interpolated linearly between rating anchors. They are
// meant as orientation ("for 1400 this is normal"), not as precise statistics,
// and the UI labels them as estimates.

import type { GameFeatures } from "./features";
import type { RatingContext, SkillScore } from "./models";
import { pyRound } from "./num";
import {
  consistencyScore,
  conversionScore,
  defenseScore,
  phaseScore,
  safetyScore,
  tacticsScore,
} from "./skills";

const ANCHORS = [800, 1200, 1500, 1800, 2100, 2400];

// Each row: values at the ANCHORS ratings.
const TABLE = {
  accuracy: [62, 70, 76, 81, 86, 90],
  acc_opening: [72, 78, 82, 85, 88, 91],
  acc_middlegame: [58, 66, 72, 77, 82, 87],
  acc_endgame: [58, 66, 72, 78, 83, 88],
  serious_per100: [9, 6, 4.2, 3, 2, 1.2],
  punish_rate: [0.35, 0.48, 0.58, 0.67, 0.75, 0.83],
  take_rate: [0.55, 0.68, 0.77, 0.84, 0.9, 0.94],
  misses_per_game: [2.2, 1.6, 1.1, 0.8, 0.5, 0.3],
  blunder_per100: [6, 4, 2.8, 1.8, 1.1, 0.6],
  hung_per_game: [1.6, 1.1, 0.75, 0.5, 0.3, 0.15],
  conversion_pct: [55, 65, 72, 80, 86, 91],
  // Weaker opponents blunder more, so comebacks are more common at low ratings.
  comeback_pct: [30, 24, 19, 15, 11, 8],
  accuracy_spread: [14, 12.5, 11, 10, 9, 8],
} as const;

export type BenchmarkKey = keyof typeof TABLE;

/** Interpolated reference value for `rating` (clamped to the table range). */
export function benchmark(key: BenchmarkKey, rating: number): number {
  const row = TABLE[key];
  if (rating <= ANCHORS[0]) return row[0];
  for (let i = 1; i < ANCHORS.length; i++) {
    if (rating <= ANCHORS[i]) {
      const t = (rating - ANCHORS[i - 1]) / (ANCHORS[i] - ANCHORS[i - 1]);
      return row[i - 1] + t * (row[i] - row[i - 1]);
    }
  }
  return row[row.length - 1];
}

/** Skill scores a typical player of this rating reaches, with the profile's own formulas. */
export function typicalSkillScores(rating: number): Record<string, number> {
  const b = (k: BenchmarkKey) => benchmark(k, rating);
  return {
    opening: phaseScore(b("acc_opening"), b("serious_per100") * 0.6),
    middlegame: phaseScore(b("acc_middlegame"), b("serious_per100") * 1.2),
    endgame: phaseScore(b("acc_endgame"), b("serious_per100")),
    tactics: tacticsScore(b("punish_rate"), b("take_rate"), b("misses_per_game")),
    safety: safetyScore(b("blunder_per100"), b("hung_per_game")),
    conversion: conversionScore(b("conversion_pct")),
    defense: defenseScore(b("comeback_pct")),
    time: 50,
    consistency: consistencyScore(b("accuracy_spread")),
  };
}

/** Elo expectation of scoring against an opponent (0..1). */
export function expectedScore(own: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - own) / 400));
}

/** Current rating: latest rating in the time control with the most rated games. */
export function currentRating(feats: GameFeatures[]): { rating: number; speed: string } | null {
  const bySpeed = new Map<string, GameFeatures[]>();
  for (const f of feats) {
    if (!f.user_rating) continue;
    const list = bySpeed.get(f.rec.speed);
    if (list) list.push(f);
    else bySpeed.set(f.rec.speed, [f]);
  }
  let best: [string, GameFeatures[]] | null = null;
  for (const entry of bySpeed) if (!best || entry[1].length > best[1].length) best = entry;
  if (!best) return null;
  const latest = best[1].reduce((a, f) => ((f.played_at || 0) >= (a.played_at || 0) ? f : a));
  return { rating: latest.user_rating as number, speed: best[0] };
}

export function ratingContext(feats: GameFeatures[]): RatingContext | null {
  const cur = currentRating(feats);
  if (!cur) return null;
  const rated = feats.filter((f) => f.user_rating && f.opp_rating && f.score !== null);
  let score = 0;
  let expected = 0;
  let oppSum = 0;
  let wins = 0;
  let losses = 0;
  for (const f of rated) {
    const s = f.score as number;
    score += s;
    // Each game against the rating the player had at that time.
    expected += expectedScore(f.user_rating as number, f.opp_rating as number);
    oppSum += f.opp_rating as number;
    if (s === 1) wins++;
    else if (s === 0) losses++;
  }
  const n = rated.length;
  const avgOpp = n ? oppSum / n : null;
  return {
    rating: cur.rating,
    speed: cur.speed,
    rated_games: n,
    avg_opponent: avgOpp !== null ? Math.round(avgOpp) : null,
    performance: n && avgOpp !== null ? Math.round(avgOpp + (400 * (wins - losses)) / n) : null,
    score: pyRound(score, 1),
    expected_score: n ? pyRound(expected, 1) : null,
    typical_accuracy: pyRound(benchmark("accuracy", cur.rating), 1),
    typical_phase_accuracy: {
      opening: pyRound(benchmark("acc_opening", cur.rating), 1),
      middlegame: pyRound(benchmark("acc_middlegame", cur.rating), 1),
      endgame: pyRound(benchmark("acc_endgame", cur.rating), 1),
    },
  };
}

/** Attach the typical score for the player's rating to each skill. */
export function withTypical(skills: SkillScore[], rating: number | null): SkillScore[] {
  if (rating === null) return skills.map((s) => ({ ...s, typical: null }));
  const typical = typicalSkillScores(rating);
  return skills.map((s) => ({ ...s, typical: s.key === "time" ? null : (typical[s.key] ?? null) }));
}
