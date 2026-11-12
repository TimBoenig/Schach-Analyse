// "Your endgame plays like 1850": each skill score turned back into the rating
// at which that score is typical. The same estimated reference values as the
// "Typisch für …" marks in the profile, read in the other direction, so they
// are orientation and the UI says so.

import { typicalSkillScores } from "./benchmarks";
import type { SkillScore } from "./models";

export const STRENGTH_MIN = 800;
export const STRENGTH_MAX = 2400;

export interface SkillStrength {
  key: string;
  name: string;
  score: number;
  /** Rating at which this score is typical, within STRENGTH_MIN..STRENGTH_MAX. */
  rating: number;
  /** -1 below the scale, 1 above it, 0 inside. */
  capped: -1 | 0 | 1;
  reliable: boolean;
}

const LOW = typicalSkillScores(STRENGTH_MIN);
const HIGH = typicalSkillScores(STRENGTH_MAX);

/**
 * Skills whose typical score rises with the rating. Defence does not (weak
 * opponents hand back more lost games) and time management has no reference,
 * so neither can be placed on a rating scale.
 */
export const RATED_SKILLS: readonly string[] = Object.keys(LOW).filter((k) => HIGH[k] - LOW[k] >= 10);

/** Rating at which `score` is the typical value of skill `key`; null for skills without a rising reference. */
export function ratingForSkill(key: string, score: number): { rating: number; capped: -1 | 0 | 1 } | null {
  if (!RATED_SKILLS.includes(key)) return null;
  if (score <= LOW[key]) return { rating: STRENGTH_MIN, capped: -1 };
  if (score >= HIGH[key]) return { rating: STRENGTH_MAX, capped: 1 };
  let lo = STRENGTH_MIN;
  let hi = STRENGTH_MAX;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (typicalSkillScores(mid)[key] < score) lo = mid;
    else hi = mid;
  }
  return { rating: Math.round((lo + hi) / 20) * 10, capped: 0 };
}

/** Every measured skill that can be placed on the rating scale, strongest first. */
export function strengthMap(skills: SkillScore[]): SkillStrength[] {
  const out: SkillStrength[] = [];
  for (const s of skills) {
    if (s.sample <= 0) continue;
    const r = ratingForSkill(s.key, s.score);
    if (r) out.push({ key: s.key, name: s.name, score: s.score, rating: r.rating, capped: r.capped, reliable: s.reliable });
  }
  return out.sort((a, b) => b.rating - a.rating);
}
