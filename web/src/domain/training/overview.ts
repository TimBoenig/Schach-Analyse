// What the training pages show at a glance: where an exercise stands, how an
// area is filled, which exercises a free session takes, how the week and the
// last months went, and what a finished session came to. Pure rules, no DOM,
// so every label and count on those pages can be tested.
import { CATEGORY_ORDER, type Category, type Exercise } from "./exercises";
import { EXERCISE_MINUTES, type SessionPart } from "./plan";
import { addDays, categoryProgress, type CategoryProgress, type ExerciseProgress, isDue, isMastered, type ProgressMap, type TrainingLog } from "./progress";
import { type DayTheme, type WeekPlan, weekStart } from "./week";
import { t } from "../../i18n";

// ---------- one exercise ----------

/**
 * Where an exercise stands. "retry" is a miss that comes back tomorrow; an
 * exercise that sits safely stays "mastered" on the day its long interval
 * runs out, so the count of safe exercises does not wobble from day to day.
 */
export type ExerciseState = "new" | "retry" | "due" | "learning" | "mastered";

export function exerciseState(p: ExerciseProgress | undefined, today: string): ExerciseState {
  if (!p || p.attempts === 0) return "new";
  if (isMastered(p)) return "mastered";
  if (isDue(p, today)) return "due";
  return p.box === 0 ? "retry" : "learning";
}

export const STATE_LABEL: Record<ExerciseState, string> = {
  new: t("neu"),
  retry: t("kommt morgen wieder"),
  due: t("fällig"),
  learning: t("im Aufbau"),
  mastered: t("sicher"),
};

// ---------- one area ----------

export interface CategoryOverview extends CategoryProgress {
  /** Never tried. */
  fresh: number;
  /** Tried, not yet safe. */
  learning: number;
  /** Tried before and due again today (safe ones included: their interval ran out). */
  due: number;
}

export function categoryOverview(pool: Exercise[], progress: ProgressMap, today: string): CategoryOverview[] {
  const due = new Map<Category, number>();
  for (const e of pool) if (isDue(progress[e.id], today)) due.set(e.category, (due.get(e.category) ?? 0) + 1);
  return categoryProgress(pool, progress).map((c) => ({
    ...c,
    fresh: c.total - c.seen,
    learning: c.seen - c.mastered,
    due: due.get(c.category) ?? 0,
  }));
}

export interface PoolTotals {
  total: number;
  fresh: number;
  learning: number;
  mastered: number;
  due: number;
}

export function poolTotals(rows: CategoryOverview[]): PoolTotals {
  const sum = (pick: (c: CategoryOverview) => number) => rows.reduce((s, c) => s + pick(c), 0);
  return { total: sum((c) => c.total), fresh: sum((c) => c.fresh), learning: sum((c) => c.learning), mastered: sum((c) => c.mastered), due: sum((c) => c.due) };
}

/** Exercises per free session: enough for a real set, short enough to finish. */
export const SESSION_SIZE = 10;

// Due repetitions first (they are the ones about to be forgotten), then new
// material, then what is in progress; safe exercises only fill what is left.
const PICK_RANK: Record<ExerciseState, number> = { due: 0, new: 1, retry: 2, learning: 2, mastered: 3 };

/** The exercises a free session of these items takes, in the order they are asked. */
export function pickSession(items: Exercise[], progress: ProgressMap, today: string, size = SESSION_SIZE): string[] {
  const rank = (e: Exercise) => (isDue(progress[e.id], today) ? 0 : PICK_RANK[exerciseState(progress[e.id], today)]);
  return items
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i)
    .slice(0, size)
    .map((x) => x.e.id);
}

/** Every exercise that is due again, oldest due date first. */
export function dueExercises(pool: Exercise[], progress: ProgressMap, today: string): string[] {
  return pool
    .filter((e) => isDue(progress[e.id], today))
    .sort((a, b) => progress[a.id].due.localeCompare(progress[b.id].due))
    .map((e) => e.id);
}

/** Rough length of a set of exercises in whole minutes (at least one for a non-empty set). */
export function estimateMinutes(ids: string[], byId: Map<string, Exercise>): number {
  const sum = ids.reduce((s, id) => s + EXERCISE_MINUTES[byId.get(id)?.kind ?? "puzzle"], 0);
  return ids.length ? Math.max(1, Math.round(sum)) : 0;
}

// ---------- the week ----------

export type DayState = "done" | "missed" | "open";

export interface WeekDayView {
  date: string;
  theme: DayTheme;
  isToday: boolean;
  /** "missed": a past day without training. "open": today not trained yet, or a day to come. */
  state: DayState;
  done: number;
  correct: number;
}

export interface WeekView {
  days: WeekDayView[];
  trained: number;
  target: number;
  /** Training days still needed for the target, and whether the days left allow it. */
  missing: number;
  reachable: boolean;
}

export function weekView(week: WeekPlan, log: TrainingLog, today: string): WeekView {
  const days = week.days.map((d): WeekDayView => {
    const entry = log[d.date];
    const done = entry?.done ?? 0;
    return { date: d.date, theme: d.theme, isToday: d.date === today, state: done ? "done" : d.date < today ? "missed" : "open", done, correct: entry?.correct ?? 0 };
  });
  const trained = days.filter((d) => d.state === "done").length;
  const missing = Math.max(0, week.target_days - trained);
  const left = days.filter((d) => d.state === "open").length;
  return { days, trained, target: week.target_days, missing, reachable: missing <= left };
}

// ---------- the last months ----------

export interface ActivityDay {
  date: string;
  done: number;
  correct: number;
  /** 0 = nothing, 1..4 = share of the busiest day in the window. */
  level: 0 | 1 | 2 | 3 | 4;
  /** After today: drawn empty. */
  future: boolean;
}

export interface Activity {
  /** One array per week, Monday first, oldest week first; the last one is the current week. */
  weeks: ActivityDay[][];
  activeDays: number;
  done: number;
  correct: number;
  /** Busiest day of the window, or null without any training. */
  best: ActivityDay | null;
}

/** The training calendar of the last `weeks` calendar weeks. */
export function activity(log: TrainingLog, today: string, weeks = 16): Activity {
  const first = addDays(weekStart(today), -7 * (weeks - 1));
  const flat = Array.from({ length: weeks * 7 }, (_, i) => {
    const date = addDays(first, i);
    const entry = date <= today ? log[date] : undefined;
    return { date, done: entry?.done ?? 0, correct: entry?.correct ?? 0, future: date > today };
  });
  const max = Math.max(0, ...flat.map((d) => d.done));
  const days = flat.map((d): ActivityDay => ({ ...d, level: d.done ? (Math.max(1, Math.ceil((d.done / max) * 4)) as 1 | 2 | 3 | 4) : 0 }));
  const active = days.filter((d) => d.done > 0);
  return {
    weeks: Array.from({ length: weeks }, (_, w) => days.slice(w * 7, w * 7 + 7)),
    activeDays: active.length,
    done: active.reduce((s, d) => s + d.done, 0),
    correct: active.reduce((s, d) => s + d.correct, 0),
    best: active.reduce<ActivityDay | null>((b, d) => (!b || d.done > b.done ? d : b), null),
  };
}

export interface LogTotals {
  days: number;
  done: number;
  correct: number;
  /** Share solved at the first try in percent, null before the first exercise. */
  rate: number | null;
  /** Longest run of training days in a row. */
  longest: number;
}

export function logTotals(log: TrainingLog): LogTotals {
  const dates = Object.keys(log)
    .filter((d) => log[d].done > 0)
    .sort();
  const done = dates.reduce((s, d) => s + log[d].done, 0);
  const correct = dates.reduce((s, d) => s + log[d].correct, 0);
  let longest = 0;
  let run = 0;
  dates.forEach((d, i) => {
    run = i > 0 && addDays(dates[i - 1], 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
  });
  return { days: dates.length, done, correct, rate: done ? Math.round((correct / done) * 1000) / 10 : null, longest };
}

// ---------- a finished session ----------

export interface PartResult {
  key: string;
  title: string;
  sub: string;
  done: number;
  solved: number;
}

export interface SessionResult {
  done: number;
  solved: number;
  parts: PartResult[];
  /** Ids missed at the first try, in the order they were asked. */
  missed: string[];
  /** "perfect": all solved. "good": at least 70 %. "mixed": less. "none": nothing answered. */
  verdict: "perfect" | "good" | "mixed" | "none";
}

// From this share solved at the first try Lucena calls a session a strong one.
const GOOD_SHARE = 0.7;

/** What a session came to; `results` holds the first-try outcome per exercise id. */
export function sessionResult(parts: SessionPart[], results: Record<string, boolean>): SessionResult {
  const rows = parts.map((p): PartResult => {
    const ids = p.ids.filter((id) => id in results);
    return { key: p.key, title: p.title, sub: p.sub, done: ids.length, solved: ids.filter((id) => results[id]).length };
  });
  const done = rows.reduce((s, r) => s + r.done, 0);
  const solved = rows.reduce((s, r) => s + r.solved, 0);
  const missed = parts.flatMap((p) => p.ids).filter((id) => results[id] === false);
  return { done, solved, parts: rows.filter((r) => r.done > 0), missed, verdict: !done ? "none" : solved === done ? "perfect" : solved / done >= GOOD_SHARE ? "good" : "mixed" };
}

/** Areas in the order the exercise library lists them, grouped by where the material comes from. */
export const LIBRARY_GROUPS: { key: string; label: string; categories: Category[] }[] = [
  { key: "errors", label: t("Aus deinen Fehlern"), categories: ["blunder", "chance", "opening", "endgame", "conversion", "defense"] },
  { key: "openings", label: t("Eröffnungen"), categories: ["repertoire"] },
  { key: "basics", label: t("Grundlagen"), categories: ["basics"] },
];

/** The area the library opens with: the asked one, else the first with due work, else the first with exercises. */
export function startCategory(rows: CategoryOverview[], asked?: string): Category {
  const order = LIBRARY_GROUPS.flatMap((g) => g.categories);
  const by = new Map(rows.map((r) => [r.category, r]));
  if (asked && (CATEGORY_ORDER as string[]).includes(asked)) return asked as Category;
  return order.find((c) => (by.get(c)?.due ?? 0) > 0) ?? order.find((c) => (by.get(c)?.total ?? 0) > 0) ?? order[0];
}

/** The exercises made from one game's positions (its errors and missed chances), in the order they happened. */
export function gameExercises(pool: Exercise[], gameId: string): string[] {
  return pool
    .filter((e) => e.kind !== "repertoire" && e.game_id === gameId)
    .sort((a, b) => ((a.kind !== "repertoire" && a.ply_index) || 0) - ((b.kind !== "repertoire" && b.ply_index) || 0))
    .map((e) => e.id);
}
