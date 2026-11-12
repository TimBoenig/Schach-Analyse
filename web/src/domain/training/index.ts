// Training domain (headless): exercise pool from the player's own games,
// spaced-repetition progress and the daily training plan.

export { BASIC_ENDGAMES } from "./basics";
export {
  buildExercisePool,
  CATEGORIES,
  CATEGORY_ORDER,
  countByCategory,
  lineToSan,
  puzzleCategory,
  puzzleLine,
  repertoireDrill,
} from "./exercises";
export type { Category, CategoryInfo, Exercise, PlayoutExercise, PlayoutGoal, PuzzleExercise, RepertoireExercise } from "./exercises";
export { buildDailyPlan, categoryNeeds, DEFAULT_PREFS, EXERCISE_MINUTES, interleave, MINUTE_CHOICES, planOutdated, relevance, sessionParts } from "./plan";
export type { CategoryNeed, DailyPlan, PlanBlock, PlanInput, SessionPart, TrainingPrefs } from "./plan";
export {
  addDays,
  categoryProgress,
  INTERVALS,
  isDue,
  isReview,
  isMastered,
  localDay,
  logAttempt,
  MASTERED_BOX,
  migrateSolved,
  puzzleOfTheDay,
  recordAttempt,
  retention,
  streak,
  summarizeTraining,
} from "./progress";
export type { CategoryProgress, DayLog, Retention, ExerciseProgress, ProgressMap, TrainingLog, TrainingSummary } from "./progress";
export { HOLD_LOST_CP, judgePlayout, PROMOTE_KEPT_CP, scoreCp, WIN_KEPT_CP, WIN_LOST_CP } from "./playout";
export type { PlayoutState, Verdict } from "./playout";
export { buildWeekPlan, TARGET_DAYS, themeLabel, themeOf, weekOutdated, weekStart } from "./week";
export type { DayTheme, WeekDay, WeekPlan } from "./week";
export { trainingStart, transferReport } from "./transfer";
export type { GameErrorPoint, TransferMetric, TransferReport, TransferRow } from "./transfer";
export { isSoundMove, playOnStats, REFUTATION_MAX_REPLIES, refutationLine } from "./refutation";
export type { LineStep, PlayOnStats } from "./refutation";
export { compareRates, openingProgress, trainingTrends, TREND_MIN_ATTEMPTS, weeklyRates } from "./trend";
export type { Direction, OpeningProgress, Trend, WeekPoint } from "./trend";
export { LIBRARY_DRILLS, OPENING_LIBRARY } from "./library";
export type { LibraryLine, LibraryOpening } from "./library";
