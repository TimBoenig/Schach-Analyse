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
  repertoireDrill,
} from "./exercises";
export type { Category, CategoryInfo, Exercise, PlayoutExercise, PlayoutGoal, PuzzleExercise, RepertoireExercise } from "./exercises";
export { buildDailyPlan, categoryNeeds, DEFAULT_PREFS, EXERCISE_MINUTES, MINUTE_CHOICES, planOutdated } from "./plan";
export type { CategoryNeed, DailyPlan, PlanBlock, PlanInput, TrainingPrefs } from "./plan";
export {
  addDays,
  categoryProgress,
  INTERVALS,
  isDue,
  isMastered,
  localDay,
  logAttempt,
  MASTERED_BOX,
  migrateSolved,
  recordAttempt,
  streak,
  summarizeTraining,
} from "./progress";
export type { CategoryProgress, DayLog, ExerciseProgress, ProgressMap, TrainingLog, TrainingSummary } from "./progress";
export { HOLD_LOST_CP, judgePlayout, PROMOTE_KEPT_CP, scoreCp, WIN_KEPT_CP, WIN_LOST_CP } from "./playout";
export type { PlayoutState, Verdict } from "./playout";
