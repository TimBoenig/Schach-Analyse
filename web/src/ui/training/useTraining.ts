import { useEffect, useMemo, useState } from "preact/hooks";

import { buildProfileInWorker } from "../../app/profileClient";
import { EXCLUDE_BULLET_KEY, statsFormat } from "../../domain/analysisDepth";
import type { PlayerProfile } from "../../domain/profile";
import {
  buildDailyPlan,
  buildWeekPlan,
  categoryNeeds,
  type DailyPlan,
  DEFAULT_PREFS,
  type Exercise,
  localDay,
  logAttempt,
  migrateSolved,
  planOutdated,
  isReview,
  type ProgressMap,
  recordAttempt,
  summarizeTraining,
  type TrainingLog,
  type TrainingPrefs,
  themeOf,
  weekOutdated,
  type WeekPlan,
} from "../../domain/training";
import { getSetting, listGames, setSetting } from "../../storage/db";

// Settings keys; they sync across devices like every other setting.
const K = {
  progress: "training.progress",
  log: "training.log",
  prefs: "training.prefs",
  plan: "training.plan",
  week: "training.week",
  legacySolved: "training.solved",
} as const;

const ALL = { format: "All Formats", date: "All Time", color: "All Colors" };

/** Profile over all games (training ignores the page filters of Profil/Einblicke). */
export async function loadFullProfile(): Promise<PlayerProfile | null> {
  const names = await getSetting<string[]>("usernames", []);
  if (!names.length) return null;
  const format = statsFormat(ALL.format, await getSetting<boolean>(EXCLUDE_BULLET_KEY, false));
  return buildProfileInWorker({ games: await listGames(), usernames: names, ...ALL, format });
}

/** Records one exercise result outside the training page (start page's position of the day). */
export async function recordTrainingResult(ex: Exercise, success: boolean): Promise<void> {
  const today = localDay();
  const [progress, log] = await Promise.all([getSetting<ProgressMap>(K.progress, {}), getSetting<TrainingLog>(K.log, {})]);
  const review = isReview(progress[ex.id], today);
  await setSetting(K.progress, recordAttempt(progress, ex.id, success, today));
  await setSetting(K.log, logAttempt(log, today, ex.category, success, review));
}

/** Spaced-repetition progress, for picking the position of the day. */
export function loadTrainingProgress(): Promise<ProgressMap> {
  return getSetting<ProgressMap>(K.progress, {});
}

export interface TodayTraining {
  streak: number;
  week: { done: number; correct: number };
  done: number;
  /** Exercises in today's plan, 0 when no plan was made today. */
  planned: number;
  headline: string | null;
}

/** Today's training state for the start page, without building a plan. */
export async function loadTodayTraining(): Promise<TodayTraining> {
  const today = localDay();
  const [log, plan] = await Promise.all([getSetting<TrainingLog>(K.log, {}), getSetting<DailyPlan | null>(K.plan, null)]);
  const s = summarizeTraining([], {}, log, today);
  const todays = plan?.date === today ? plan : null;
  return {
    streak: s.streak,
    week: s.week,
    done: log[today]?.done ?? 0,
    planned: todays ? todays.blocks.reduce((n, b) => n + b.exercise_ids.length, 0) : 0,
    headline: todays?.headline ?? null,
  };
}

/** The stored week plan, or a fresh one when a new calendar week has started. */
function currentWeek(stored: WeekPlan | null, p: PlayerProfile, today: string): WeekPlan {
  if (!weekOutdated(stored, today)) return stored!;
  const withExercises = new Set(p.exercises.map((e) => e.category));
  // The week follows the profile, not the manual focus, which only steers single days.
  const ranking = categoryNeeds(p.skills, p.patterns, "auto")
    .map((n) => n.category)
    .filter((c) => withExercises.has(c));
  return buildWeekPlan(ranking, today);
}

export function useTraining() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [usernames, setUsernames] = useState<string[] | null>(null);
  const [progress, setProgress] = useState<ProgressMap>({});
  const [log, setLog] = useState<TrainingLog>({});
  const [prefs, setPrefsState] = useState<TrainingPrefs>(DEFAULT_PREFS);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [week, setWeek] = useState<WeekPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const today = localDay();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const names = await getSetting<string[]>("usernames", []);
        if (!alive) return;
        setUsernames(names);
        let prog = await getSetting<ProgressMap>(K.progress, {});
        const legacy = await getSetting<Record<string, boolean>>(K.legacySolved, {});
        if (Object.keys(legacy).length) {
          prog = migrateSolved(legacy, prog, today);
          await setSetting(K.progress, prog);
          await setSetting(K.legacySolved, {});
        }
        const lg = await getSetting<TrainingLog>(K.log, {});
        const pf = { ...DEFAULT_PREFS, ...(await getSetting<Partial<TrainingPrefs>>(K.prefs, {})) };
        let pl = await getSetting<DailyPlan | null>(K.plan, null);
        let wk = await getSetting<WeekPlan | null>(K.week, null);
        const p = names.length ? await loadFullProfile() : null;
        if (!alive) return;
        if (p) {
          const fresh = currentWeek(wk, p, today);
          if (fresh !== wk) void setSetting(K.week, fresh);
          wk = fresh;
        }
        if (p && (planOutdated(pl, pf, today) || pl?.theme === undefined)) {
          pl = buildDailyPlan({ skills: p.skills, patterns: p.patterns, pool: p.exercises, progress: prog, prefs: pf, today, theme: themeOf(wk, today) });
          void setSetting(K.plan, pl);
        }
        setWeek(wk);
        setProfile(p);
        setProgress(prog);
        setLog(lg);
        setPrefsState(pf);
        setPlan(pl);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const pool = profile?.exercises ?? [];
  const byId = useMemo(() => new Map(pool.map((e) => [e.id, e])), [pool]);

  const record = (ex: Exercise, success: boolean) => {
    // Functional updates: several results can land before a re-render.
    // Decided from the progress before this attempt (the log update runs after it).
    const review = isReview(progress[ex.id], today);
    setProgress((prev) => {
      const next = recordAttempt(prev, ex.id, success, today);
      void setSetting(K.progress, next);
      return next;
    });
    setLog((prev) => {
      const next = logAttempt(prev, today, ex.category, success, review);
      void setSetting(K.log, next);
      return next;
    });
  };

  const rebuild = (pf: TrainingPrefs) => {
    if (!profile) return;
    const pl = buildDailyPlan({ skills: profile.skills, patterns: profile.patterns, pool, progress, prefs: pf, today, theme: themeOf(week, today) });
    setPlan(pl);
    void setSetting(K.plan, pl);
  };

  const setPrefs = (pf: TrainingPrefs) => {
    setPrefsState(pf);
    void setSetting(K.prefs, pf);
    rebuild(pf);
  };

  return {
    profile,
    usernames,
    pool,
    byId,
    progress,
    log,
    prefs,
    plan,
    week,
    loading,
    error,
    today,
    record,
    setPrefs,
    rebuild: () => rebuild(prefs),
  };
}

export type TrainingState = ReturnType<typeof useTraining>;
