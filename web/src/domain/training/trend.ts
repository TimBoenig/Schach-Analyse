// Progress over time from the training log: weekly solve rates and whether the
// recent weeks are really better than the ones before (two-proportion test),
// overall and per area. Small samples never produce a "you improved" claim.

import { MIN_SITUATIONS } from "../profile/evidence";
import { CATEGORY_ORDER, type Category, type Exercise } from "./exercises";
import { addDays, isDue, isMastered, type ProgressMap, type TrainingLog } from "./progress";

export interface WeekPoint {
  /** Monday-independent: the first day of the 7-day window. */
  start: string;
  done: number;
  correct: number;
  rate: number | null;
}

export type Direction = "up" | "down" | "flat" | "unknown";

export interface Trend {
  recent: [number, number];
  before: [number, number];
  /** Change of the solve rate in percentage points, null without data on both sides. */
  delta: number | null;
  direction: Direction;
}

/** Attempts needed on each side before a trend is called. */
export const TREND_MIN_ATTEMPTS = MIN_SITUATIONS * 2;
const Z = 1.96;

/** Solve rates in consecutive 7-day windows ending today, oldest first. */
export function weeklyRates(log: TrainingLog, today: string, weeks = 8): WeekPoint[] {
  return Array.from({ length: weeks }, (_, w) => {
    const start = addDays(today, -7 * (weeks - w) + 1);
    let done = 0;
    let correct = 0;
    for (let d = 0; d < 7; d++) {
      const day = log[addDays(start, d)];
      if (day) {
        done += day.done;
        correct += day.correct;
      }
    }
    return { start, done, correct, rate: done ? Math.round((correct / done) * 1000) / 10 : null };
  });
}

/** Two-proportion z-test; "flat" means enough data but no real difference. */
export function compareRates(recent: [number, number], before: [number, number]): Trend {
  const [k1, n1] = recent;
  const [k2, n2] = before;
  const delta = n1 && n2 ? Math.round((k1 / n1 - k2 / n2) * 1000) / 10 : null;
  if (n1 < TREND_MIN_ATTEMPTS || n2 < TREND_MIN_ATTEMPTS) return { recent, before, delta, direction: "unknown" };
  const p = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  const z = se > 0 ? (k1 / n1 - k2 / n2) / se : 0;
  return { recent, before, delta, direction: z >= Z ? "up" : z <= -Z ? "down" : "flat" };
}

function span(log: TrainingLog, today: string, from: number, days: number, pick: (d: TrainingLog[string]) => [number, number] | undefined) {
  let k = 0;
  let n = 0;
  for (let i = from; i < from + days; i++) {
    const day = log[addDays(today, -i)];
    const v = day && pick(day);
    if (v) {
      n += v[0];
      k += v[1];
    }
  }
  return [k, n] as [number, number];
}

/** Last `days` against the `days` before, overall and for each area. */
export function trainingTrends(log: TrainingLog, today: string, days = 14): { overall: Trend; byCategory: Partial<Record<Category, Trend>> } {
  const overall = compareRates(
    span(log, today, 0, days, (d) => [d.done, d.correct]),
    span(log, today, days, days, (d) => [d.done, d.correct]),
  );
  const byCategory: Partial<Record<Category, Trend>> = {};
  for (const c of CATEGORY_ORDER) {
    const t = compareRates(span(log, today, 0, days, (d) => d.by_category[c]), span(log, today, days, days, (d) => d.by_category[c]));
    if (t.recent[1] || t.before[1]) byCategory[c] = t;
  }
  return { overall, byCategory };
}

export interface OpeningProgress {
  id: string;
  opening: string;
  color: "white" | "black";
  box: number;
  attempts: number;
  solved: number;
  last: string | null;
  state: "new" | "due" | "mastered" | "learning";
}

/** Where each of the player's opening drills stands in the repetition boxes. */
export function openingProgress(pool: Exercise[], progress: ProgressMap, today: string): OpeningProgress[] {
  return pool
    .filter((e) => e.kind === "repertoire")
    .map((e) => {
      const p = progress[e.id];
      const ex = e as Extract<Exercise, { kind: "repertoire" }>;
      return {
        id: e.id,
        opening: ex.opening,
        color: ex.color,
        box: p?.box ?? 0,
        attempts: p?.attempts ?? 0,
        solved: p?.solved ?? 0,
        last: p?.last || null,
        state: !p ? "new" : isMastered(p) ? "mastered" : isDue(p, today) ? "due" : "learning",
      } as OpeningProgress;
    })
    .sort((a, b) => b.box - a.box || b.attempts - a.attempts);
}
