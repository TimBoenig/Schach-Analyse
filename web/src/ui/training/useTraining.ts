import { useEffect, useMemo, useState } from "preact/hooks";

import { buildProfileInWorker } from "../../app/profileClient";
import type { PlayerProfile } from "../../domain/profile";
import {
  buildDailyPlan,
  type DailyPlan,
  DEFAULT_PREFS,
  type Exercise,
  localDay,
  logAttempt,
  migrateSolved,
  planOutdated,
  type ProgressMap,
  recordAttempt,
  summarizeTraining,
  type TrainingLog,
  type TrainingPrefs,
  type TrainingSummary,
} from "../../domain/training";
import { getSetting, listGames, setSetting } from "../../storage/db";

// Settings keys; they sync across devices like every other setting.
const K = {
  progress: "training.progress",
  log: "training.log",
  prefs: "training.prefs",
  plan: "training.plan",
  legacySolved: "training.solved",
} as const;

const ALL = { format: "All Formats", date: "All Time", color: "All Colors" };

/** Profile over all games (training ignores the page filters of Profil/Einblicke). */
export async function loadFullProfile(): Promise<PlayerProfile | null> {
  const names = await getSetting<string[]>("usernames", []);
  if (!names.length) return null;
  return buildProfileInWorker({ games: await listGames(), usernames: names, ...ALL });
}

/** Training state for the AI coach on other pages. */
export async function loadTrainingSummary(pool: Exercise[]): Promise<TrainingSummary | null> {
  const log = await getSetting<TrainingLog>(K.log, {});
  if (!Object.keys(log).length) return null;
  const plan = await getSetting<DailyPlan | null>(K.plan, null);
  const today = localDay();
  return summarizeTraining(pool, await getSetting<ProgressMap>(K.progress, {}), log, today, plan?.date === today ? plan.headline : undefined);
}

export function useTraining() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [usernames, setUsernames] = useState<string[] | null>(null);
  const [progress, setProgress] = useState<ProgressMap>({});
  const [log, setLog] = useState<TrainingLog>({});
  const [prefs, setPrefsState] = useState<TrainingPrefs>(DEFAULT_PREFS);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
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
        const p = names.length ? await loadFullProfile() : null;
        if (!alive) return;
        if (p && planOutdated(pl, pf, today)) {
          pl = buildDailyPlan({ skills: p.skills, patterns: p.patterns, pool: p.exercises, progress: prog, prefs: pf, today });
          void setSetting(K.plan, pl);
        }
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
    setProgress((prev) => {
      const next = recordAttempt(prev, ex.id, success, today);
      void setSetting(K.progress, next);
      return next;
    });
    setLog((prev) => {
      const next = logAttempt(prev, today, ex.category, success);
      void setSetting(K.log, next);
      return next;
    });
  };

  const rebuild = (pf: TrainingPrefs) => {
    if (!profile) return;
    const pl = buildDailyPlan({ skills: profile.skills, patterns: profile.patterns, pool, progress, prefs: pf, today });
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
    loading,
    error,
    today,
    record,
    setPrefs,
    rebuild: () => rebuild(prefs),
  };
}

export type TrainingState = ReturnType<typeof useTraining>;
