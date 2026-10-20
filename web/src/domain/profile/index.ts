// Player profile & game review domain services (headless, no DOM).
//
// - buildPlayerProfile: aggregates many games into skills, strengths/weaknesses,
//   playing style, recurring patterns, a training plan and personal puzzles.
// - buildGameReview: German post-game review for a single analyzed game.

export { benchmark, currentRating, expectedScore, ratingContext, typicalSkillScores } from "./benchmarks";
export { buildPlayerProfile } from "./builder";
export { gameCoachMessages, PROFILE_QUESTIONS, profileCoachMessages, profileSummary } from "./coach";
export type { CoachMessage, GameContext } from "./coach";
export { extractFeatures, GameFeatures, MoveEvent, sanForUci } from "./features";
export { buildGameReview, schoolGrade } from "./game_review";
export { buildDeepInsights, pieceOf, sessions, SESSION_GAP_SECONDS } from "./insights";
export type { DeepInsights, MoveBucket, PieceBucket, ScoreBucket } from "./insights";
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
  RatingContext,
  SkillScore,
  StyleAxis,
  StyleProfile,
  TrainingItem,
} from "./models";
export { SKILL_NAMES } from "./skills";
