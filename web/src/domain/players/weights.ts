// How much each comparison factor counts, in percent of the overall score.
// One table for the friends ranking, the battle and the duel forecast, so the
// numbers people read under "So wird gewertet" are exactly the ones used.
//
// Why this split: results against the opponents' strength and the quality of
// the moves are the two honest measures of playing strength (35 % each, the
// move quality slightly more because it needs no opponent ratings). The eight
// skills share 25 %: they are measured from the same moves as accuracy and
// blunders, so giving them more would count the same thing several times.
// Activity is a small bonus for playing. Rating and raw points are shown but
// count 0 %: a new account's rating says nothing yet, and raw points depend on
// whom someone chooses to play ("Über Erwartung" measures that fairly).

export const SKILL_FACTORS = ["opening", "middlegame", "endgame", "tactics", "safety", "conversion", "defense", "time"] as const;

export const FACTOR_WEIGHTS: Record<string, number> = {
  rating: 0,
  score: 0,
  expectation: 25,
  h2h: 10,
  accuracy: 22,
  blunders: 13,
  ...Object.fromEntries(SKILL_FACTORS.map((k) => [k, 25 / SKILL_FACTORS.length])),
  activity: 5,
};
