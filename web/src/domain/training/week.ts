// Weekly training structure. Instead of a new random mix every day, the week has
// a theme per day: the biggest weakness three times, the second twice, the third
// once, never the same theme on two days in a row (spaced, interleaved practice),
// and Sunday for repetition and reviewing the week's own games. The week is made
// once per calendar week and stored, so the themes don't shift when the profile
// is rebuilt mid-week.

import { CATEGORIES, type Category } from "./exercises";
import { addDays } from "./progress";

export type DayTheme = Category | "review";

export interface WeekDay {
  date: string;
  theme: DayTheme;
}

export interface WeekPlan {
  /** Monday of the week (YYYY-MM-DD). */
  start: string;
  days: WeekDay[];
  /** Training days the week aims for (habit target, rest days allowed). */
  target_days: number;
  /** Category ranking the week was built from, strongest need first. */
  ranking: Category[];
}

// Mon..Sat slots: index into the ranking (0 = biggest weakness); Sunday is repetition.
const SLOTS = [0, 1, 0, 2, 1, 0];
export const TARGET_DAYS = 5;

/** Monday of the week that contains `day`. */
export function weekStart(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/** Week plan from the ranked categories (strongest need first, only ones with exercises). */
export function buildWeekPlan(ranking: Category[], today: string): WeekPlan {
  const start = weekStart(today);
  const top = ranking.slice(0, 3);
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    if (i === 6 || !top.length) return { date, theme: "review" as const };
    return { date, theme: top[SLOTS[i] % top.length] };
  });
  // With fewer than three categories the slots can repeat back to back; swap in review then.
  for (let i = 1; i < 6; i++) if (days[i].theme === days[i - 1].theme && top.length > 1) days[i] = { ...days[i], theme: top[(SLOTS[i] + 1) % top.length] };
  return { start, days, target_days: TARGET_DAYS, ranking: top };
}

/** Theme of `today`, or null when the stored week is from another week. */
export function themeOf(week: WeekPlan | null, today: string): DayTheme | null {
  return week?.days.find((d) => d.date === today)?.theme ?? null;
}

export function weekOutdated(week: WeekPlan | null, today: string): boolean {
  return !week || week.start !== weekStart(today);
}

export function themeLabel(theme: DayTheme): string {
  return theme === "review" ? "Wiederholung & Partien" : CATEGORIES[theme].label;
}
