// Player profile & game review domain services (headless, no DOM).
//
// - buildPlayerProfile: aggregates many games into skills, strengths/weaknesses,
//   playing style, recurring patterns, a training plan and personal puzzles.
// - buildGameReview: German post-game review for a single analyzed game.

export { buildPlayerProfile } from "./builder";
export { extractFeatures, GameFeatures, MoveEvent, sanForUci } from "./features";
export { buildGameReview, schoolGrade } from "./game_review";
export type {
  GameRef,
  GameReview,
  Insight,
  KeyMoment,
  OpeningLine,
  Pattern,
  PhaseReview,
  PlayerProfile,
  Puzzle,
  SkillScore,
  StyleAxis,
  StyleProfile,
  TrainingItem,
} from "./models";
export { SKILL_NAMES } from "./skills";
