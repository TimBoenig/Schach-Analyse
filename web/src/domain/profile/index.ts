// Player profile & game review domain services (headless, no DOM).
//
// - buildPlayerProfile: aggregates many games into skills, strengths/weaknesses,
//   playing style, recurring patterns, a training plan and exercises from the player's own games.
// - buildGameReview: German post-game review for a single analyzed game.

export { benchmark, currentRating, expectedScore, performanceRating, ratingContext, typicalSkillScores } from "./benchmarks";
export { buildPlayerProfile } from "./builder";
export { extractFeatures, GameFeatures, MoveEvent, sanForUci } from "./features";
export { buildGameReview, schoolGrade } from "./game_review";
export { buildDeepInsights, pieceOf, sessions, SESSION_GAP_SECONDS } from "./insights";
export type { DeepInsights, MoveBucket, PieceBucket, ScoreBucket } from "./insights";
export { buildPrecision, wilsonMargin } from "./precision";
export { buildEvolution, bySpeed, gameTypes, personalFeedback } from "./evolution";
export type { Evolution, EvolutionBlock, FeedbackItem, GameTypeStat, MetricChange } from "./evolution";
export type { AccuracySpread, CurvePoint, PrecisionStats, RatingBucket, ScoreStat, Turnarounds } from "./precision";
export { buildMoveTally, HIGHLIGHT_CLASSES, SERIOUS_CLASSES, sumOf, TALLY_CLASSES, TOP_CLASSES, totalOf } from "./moves";
export type { ClassTally, Counts, MoveHighlight, MoveTally, TallyBlock, TallyClass, TallyFinding, TallyGame } from "./moves";
export { buildOpeningInsights, movesText, openingLabel, openingMain, openingParts } from "./openings";
export { fenAfter, LEAK_MIN_JUDGED, TREE_PLIES } from "./openingTree";
export type { OpeningLeak, OpeningNode, OpeningTree, TreeGame } from "./openingTree";
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
export { PRIOR_WEIGHT, RELIABLE_MARGIN, settleSkills, SKILL_NAMES } from "./skills";
export { STYLE_MIN_GAMES } from "./style";
export * as evidence from "./evidence";
export { activityCalendar, comparePeriods, dailyActivity, focusNotes, formSummary, SKILL_TREND_POINTS, trendOf } from "./dashboard";
export type { CalendarDay, DailyRow, FormSummary, KpiChange, PeriodComparison, SkillChange } from "./dashboard";
export { blunderCost, CONDITION_KEYS, conditionResult, conditionValues, DAYPARTS, gameFacts, OPP_BANDS, OPP_GAP, pointsAtCleanShare, standoutCondition } from "./lab";
export type { BlunderCost, ConditionPick, ConditionResult, Daypart, GameFact, OppBand } from "./lab";
export { ratingForSkill, RATED_SKILLS, STRENGTH_MAX, STRENGTH_MIN, strengthMap } from "./strength";
export type { SkillStrength } from "./strength";
export { ETA_MAX_DAYS, nextMilestone, PACE_DAYS, PACE_MIN, ratingJourney } from "./journey";
export type { RatingJourney } from "./journey";
