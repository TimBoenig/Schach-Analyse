// Training progress: spaced repetition per exercise (Leitner boxes) and a
// per-day log for streaks and statistics. Plain JSON so it syncs as a setting.

import { CATEGORY_ORDER, type Category, type Exercise } from "./exercises";

export interface ExerciseProgress {
  /** Leitner box 0..MAX_BOX; a miss sends the exercise back to 0. */
  box: number;
  /** Next day the exercise is due again (YYYY-MM-DD, local). */
  due: string;
  attempts: number;
  solved: number;
  /** Day of the last attempt. */
  last: string;
}

export type ProgressMap = Record<string, ExerciseProgress>;

export interface DayLog {
  done: number;
  correct: number;
  by_category: Partial<Record<Category, [number, number]>>;
}

export type TrainingLog = Record<string, DayLog>;

// Days until an exercise comes back after a correct answer in box 1..5.
export const INTERVALS = [1, 3, 7, 14, 30];
export const MAX_BOX = INTERVALS.length;
// From this box on an exercise counts as mastered and leaves the regular rotation.
export const MASTERED_BOX = 3;

/** Local calendar day, YYYY-MM-DD. */
export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return localDay(new Date(y, m - 1, d + n));
}

export function recordAttempt(progress: ProgressMap, id: string, success: boolean, today: string): ProgressMap {
  const prev = progress[id] ?? { box: 0, due: today, attempts: 0, solved: 0, last: "" };
  const box = success ? Math.min(prev.box + 1, MAX_BOX) : 0;
  return {
    ...progress,
    [id]: {
      box,
      // A miss comes back tomorrow, a success after a growing interval.
      due: addDays(today, success ? INTERVALS[box - 1] : 1),
      attempts: prev.attempts + 1,
      solved: prev.solved + (success ? 1 : 0),
      last: today,
    },
  };
}

export function logAttempt(log: TrainingLog, today: string, category: Category, success: boolean): TrainingLog {
  const day = log[today] ?? { done: 0, correct: 0, by_category: {} };
  const [n, ok] = day.by_category[category] ?? [0, 0];
  return {
    ...log,
    [today]: {
      done: day.done + 1,
      correct: day.correct + (success ? 1 : 0),
      by_category: { ...day.by_category, [category]: [n + 1, ok + (success ? 1 : 0)] },
    },
  };
}

/** Exercises that were seen before and are due again today. */
export function isDue(p: ExerciseProgress | undefined, today: string): boolean {
  return Boolean(p && p.attempts > 0 && p.due <= today);
}

export function isMastered(p: ExerciseProgress | undefined): boolean {
  return Boolean(p && p.box >= MASTERED_BOX);
}

/** Days in a row with at least one exercise, counting back from today (or yesterday if today is still open). */
export function streak(log: TrainingLog, today: string): number {
  let day = log[today]?.done ? today : addDays(today, -1);
  let n = 0;
  while (log[day]?.done) {
    n += 1;
    day = addDays(day, -1);
  }
  return n;
}

export interface CategoryProgress {
  category: Category;
  total: number;
  seen: number;
  mastered: number;
  attempts: number;
  solved: number;
  /** Share of attempts solved, in percent (null before the first attempt). */
  rate: number | null;
}

export function categoryProgress(pool: Exercise[], progress: ProgressMap): CategoryProgress[] {
  return CATEGORY_ORDER.map((category) => {
    const items = pool.filter((e) => e.category === category);
    const ps = items.map((e) => progress[e.id]).filter((p): p is ExerciseProgress => Boolean(p));
    const attempts = ps.reduce((s, p) => s + p.attempts, 0);
    const solved = ps.reduce((s, p) => s + p.solved, 0);
    return {
      category,
      total: items.length,
      seen: ps.filter((p) => p.attempts > 0).length,
      mastered: ps.filter(isMastered).length,
      attempts,
      solved,
      rate: attempts ? Math.round((solved / attempts) * 1000) / 10 : null,
    };
  });
}

/** Moves the old "solved puzzles" flags (game:ply) into the new progress map. */
export function migrateSolved(solved: Record<string, boolean>, progress: ProgressMap, today: string): ProgressMap {
  const out = { ...progress };
  for (const [key, ok] of Object.entries(solved)) {
    const id = `p:${key}`;
    if (ok && !out[id]) out[id] = { box: 1, due: addDays(today, INTERVALS[0]), attempts: 1, solved: 1, last: today };
  }
  return out;
}

/** Training state in a few numbers (for the AI coach and the progress page). */
export interface TrainingSummary {
  streak: number;
  /** Exercises done and solved in the last 7 days including today. */
  week: { done: number; correct: number };
  categories: CategoryProgress[];
  headline?: string;
}

export function summarizeTraining(
  pool: Exercise[],
  progress: ProgressMap,
  log: TrainingLog,
  today: string,
  headline?: string,
): TrainingSummary {
  const week = { done: 0, correct: 0 };
  for (let i = 0; i < 7; i++) {
    const d = log[addDays(today, -i)];
    if (d) {
      week.done += d.done;
      week.correct += d.correct;
    }
  }
  return { streak: streak(log, today), week, categories: categoryProgress(pool, progress), headline };
}
