// Player profile & game review domain services (headless, no DOM).
//
// - buildPlayerProfile: aggregates many games into skills, strengths/weaknesses,
//   playing style, recurring patterns, a training plan and exercises from the player's own games.
// - buildGameReview: German post-game review for a single analyzed game.

export { benchmark, currentRating, expectedScore, ratingContext, typicalSkillScores } from "./benchmarks";
export { buildPlayerProfile } from "./builder";
export {
  annotatedMoves,
  DETAIL_LEVELS,
  gameCoachMessages,
  OPENING_QUESTIONS,
  PROFILE_QUESTIONS,
  profileBrief,
  profileCoachMessages,
  profileContext,
  reportMessages,
  TRAINING_QUESTIONS,
} from "./coach";
export type { CoachDetail, CoachMessage, GameContext, TrainingContext } from "./coach";
export { extractFeatures, GameFeatures, MoveEvent, sanForUci } from "./features";
export { buildGameReview, schoolGrade } from "./game_review";
export { buildDeepInsights, pieceOf, sessions, SESSION_GAP_SECONDS } from "./insights";
export type { DeepInsights, MoveBucket, PieceBucket, ScoreBucket } from "./insights";
export { buildOpeningInsights, openingLabel, openingMain } from "./openings";
export type { FirstMoveStat, MoveChoice, OpeningGameRef, OpeningInsights, OpeningStat } from "./openings";
export type {
  GameRef,
  GameReview,
  Insight,
  KeyMoment,
  OpeningLine,
  Pattern,
  PhaseReview,
  PlayerProfile,
  GameDigest,
  RatingContext,
  SkillScore,
  StyleAxis,
  StyleProfile,
  TrainingItem,
} from "./models";
export { SKILL_NAMES } from "./skills";
