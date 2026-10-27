// Dashboard view model: compares a period of the player's games with the
// equally long period before it, so daily use answers "am I getting better,
// and at what?" rather than repeating all-time averages.

import { trSpeed } from "../i18n";
import { extractGameTimestamp, type FilterableGame, getUserColor, outcomeFor } from "../metrics";
import type { PlayerProfile, SkillScore } from "./models";
import { fmt } from "./num";

export interface KpiChange {
  key: "games" | "score" | "accuracy" | "blunders" | "punish" | "rating";
  label: string;
  value: number | null;
  previous: number | null;
  delta: number | null;
  /** False where a falling number is the good direction (blunders). */
  higher_is_better: boolean;
  /** Change counts as clear progress or regress beyond this size. */
  threshold: number;
}

export interface SkillChange {
  key: string;
  name: string;
  score: number;
  previous: number | null;
  delta: number | null;
  reliable: boolean;
  /** 95 % uncertainty of `delta` in points (null without a previous value). */
  noise?: number | null;
}

export interface PeriodComparison {
  kpis: KpiChange[];
  skills: SkillChange[];
  improved: SkillChange[];
  declined: SkillChange[];
}

export interface CalendarDay {
  day: string; // YYYY-MM-DD, local
  games: number;
  score_pct: number | null;
  future: boolean;
}

const de = (x: number, digits: number) => fmt(x, digits).replace(".", ",");

// Skill scores move a few points from noise alone; smaller changes are not called a trend.
export const SKILL_TREND_POINTS = 5;

function blundersPerGame(p: PlayerProfile): number | null {
  if (!p.analyzed_games) return null;
  return Number(p.overview.quality_counts?.Blunder ?? 0) / p.analyzed_games;
}

function kpi(
  key: KpiChange["key"],
  label: string,
  value: number | null,
  previous: number | null,
  higher: boolean,
  threshold: number,
): KpiChange {
  const delta = value !== null && previous !== null ? value - previous : null;
  return { key, label, value, previous, delta, higher_is_better: higher, threshold };
}

/** "up" for a clear improvement, "down" for a clear decline, "flat" otherwise. */
export function trendOf(k: Pick<KpiChange, "delta" | "higher_is_better" | "threshold">): "up" | "down" | "flat" {
  if (k.delta === null || Math.abs(k.delta) < k.threshold) return "flat";
  return k.delta > 0 === k.higher_is_better ? "up" : "down";
}

function usable(s: SkillScore | undefined): s is SkillScore {
  return Boolean(s && s.sample > 0);
}

export function comparePeriods(cur: PlayerProfile, prev: PlayerProfile | null): PeriodComparison {
  const p = prev && prev.total_games ? prev : null;
  const o = cur.overview;
  const po = p?.overview;
  const rating = cur.rating;
  // A rating only compares within one time control.
  const prevRating = p?.rating && rating && p.rating.speed === rating.speed ? p.rating.rating : null;
  const kpis: KpiChange[] = [
    kpi("games", "Partien", cur.total_games, p ? p.total_games : null, true, Number.POSITIVE_INFINITY),
    kpi("score", "Punkte-Quote", cur.total_games ? o.score_pct : null, p ? po!.score_pct : null, true, 5),
    kpi(
      "accuracy",
      "Genauigkeit",
      cur.analyzed_games ? o.avg_accuracy : null,
      p && p.analyzed_games ? po!.avg_accuracy : null,
      true,
      1.5,
    ),
    kpi("blunders", "Patzer pro Partie", blundersPerGame(cur), p ? blundersPerGame(p) : null, false, 0.2),
    kpi(
      "punish",
      "Gegnerfehler bestraft",
      cur.deep?.punish.rate ?? null,
      p?.deep?.punish.rate ?? null,
      true,
      5,
    ),
    kpi("rating", rating ? `Wertung ${trSpeed(rating.speed)}` : "Wertung", rating?.rating ?? null, prevRating, true, 15),
  ];

  const before = new Map((p?.skills ?? []).filter(usable).map((s) => [s.key, s]));
  const skills: SkillChange[] = cur.skills.filter(usable).map((s) => {
    const b = before.get(s.key);
    return {
      key: s.key,
      name: s.name,
      score: s.score,
      previous: b ? b.score : null,
      delta: b ? s.score - b.score : null,
      reliable: s.reliable && Boolean(b?.reliable),
      // 95 % uncertainty of the change: both periods' margins combined.
      noise: b ? Math.hypot(s.margin ?? 0, b.margin ?? 0) : null,
    };
  });
  // A change counts once it is larger than the noise of both measurements.
  const beyond = (s: SkillChange) => Math.abs(s.delta as number) >= Math.max(SKILL_TREND_POINTS, s.noise ?? 0);
  const trending = skills.filter((s) => s.reliable && s.delta !== null && beyond(s));
  const improved = trending
    .filter((s) => (s.delta as number) >= SKILL_TREND_POINTS)
    .sort((a, b) => (b.delta as number) - (a.delta as number))
    .slice(0, 3);
  const declined = trending
    .filter((s) => (s.delta as number) <= -SKILL_TREND_POINTS)
    .sort((a, b) => (a.delta as number) - (b.delta as number))
    .slice(0, 3);
  return { kpis, skills, improved, declined };
}

/** Short German sentences for the top of the dashboard, most useful first. */
export function focusNotes(cur: PlayerProfile, cmp: PeriodComparison): string[] {
  const notes: string[] = [];
  const acc = cmp.kpis.find((k) => k.key === "accuracy");
  if (acc && acc.delta !== null && trendOf(acc) !== "flat") {
    notes.push(
      `Deine Genauigkeit ist um ${de(Math.abs(acc.delta), 1)} Punkte ${acc.delta > 0 ? "gestiegen" : "gefallen"} ` +
        `(${de(acc.previous as number, 1)} → ${de(acc.value as number, 1)} %).`,
    );
  }
  const bl = cmp.kpis.find((k) => k.key === "blunders");
  if (bl && bl.delta !== null && trendOf(bl) !== "flat") {
    notes.push(
      `${bl.delta < 0 ? "Weniger" : "Mehr"} Patzer: ${de(bl.value as number, 2)} pro Partie statt ${de(bl.previous as number, 2)}.`,
    );
  }
  if (cmp.improved.length) {
    notes.push(`Besser geworden: ${cmp.improved.map((s) => `${s.name} (+${de(s.delta as number, 0)})`).join(", ")}.`);
  }
  if (cmp.declined.length) {
    notes.push(`Nachgelassen: ${cmp.declined.map((s) => `${s.name} (${de(s.delta as number, 0)})`).join(", ")}.`);
  }
  if (cur.weaknesses.length) notes.push(`Größte Baustelle: ${cur.weaknesses[0].title}.`);
  return notes;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const dayString = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * Activity grid ending with the week of `today`: one column per week
 * (Monday first), one cell per day, from the profile's daily trend rows.
 */
export function activityCalendar(
  daily: { day: string; games: number; score_pct: number }[],
  today: string,
  weeks = 12,
): CalendarDay[][] {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const [y, m, d] = today.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (weeks - 1) * 7);
  const cols: CalendarDay[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const day = dayString(start);
      const row = byDay.get(day);
      col.push({ day, games: row?.games ?? 0, score_pct: row && row.games ? row.score_pct : null, future: day > today });
      start.setDate(start.getDate() + 1);
    }
    cols.push(col);
  }
  return cols;
}

/**
 * Games per local day straight from the stored games (no analysis needed), so
 * the activity calendar shows every played game whatever the page filters are.
 */
export function dailyActivity(
  games: (FilterableGame & { result?: string | null })[],
  usernames: string[],
): { day: string; games: number; score_pct: number }[] {
  const days = new Map<string, { games: number; points: number; finished: number }>();
  for (const g of games) {
    const color = getUserColor(g, usernames);
    const ts = color ? extractGameTimestamp(g) : null;
    if (!color || ts === null) continue;
    const day = dayString(new Date(ts * 1000));
    const d = days.get(day) ?? { games: 0, points: 0, finished: 0 };
    d.games++;
    const o = outcomeFor(g.result, color);
    if (o) {
      d.finished++;
      d.points += o === "win" ? 1 : o === "draw" ? 0.5 : 0;
    }
    days.set(day, d);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, d]) => ({ day, games: d.games, score_pct: d.finished ? (d.points / d.finished) * 100 : 50 }));
}

export interface FormSummary {
  /** Average accuracy of the last `window` weeks with games, and of the weeks before. */
  recent: number | null;
  previous: number | null;
  best: { week: string; accuracy: number } | null;
  /** Least-squares slope in accuracy points per four weeks (null below 4 weeks). */
  trend_per_month: number | null;
  weeks: number;
}

// Weekly accuracy is noisy; four weeks smooth out a single bad evening.
const FORM_WINDOW = 4;

/** Summary of the weekly form curve: recent vs. earlier level, best week and direction. */
export function formSummary(weekly: { week: string; avg_accuracy: number | null }[]): FormSummary {
  const pts = weekly.filter((w) => w.avg_accuracy !== null) as { week: string; avg_accuracy: number }[];
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
  const recent = mean(pts.slice(-FORM_WINDOW).map((p) => p.avg_accuracy));
  const previous = pts.length > FORM_WINDOW ? mean(pts.slice(0, -FORM_WINDOW).map((p) => p.avg_accuracy)) : null;
  const best = pts.length ? pts.reduce((a, b) => (b.avg_accuracy > a.avg_accuracy ? b : a)) : null;
  let trend: number | null = null;
  if (pts.length >= 4) {
    // Weeks without games are left out, so x is the real week offset, not the index.
    const t0 = Date.parse(pts[0].week);
    const xs = pts.map((p) => (Date.parse(p.week) - t0) / (7 * 86400000));
    const ys = pts.map((p) => p.avg_accuracy);
    const mx = mean(xs) as number;
    const my = mean(ys) as number;
    const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const sxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
    trend = sxx > 0 ? Math.round((sxy / sxx) * 4 * 10) / 10 : null;
  }
  return {
    recent: recent !== null ? Math.round(recent * 10) / 10 : null,
    previous: previous !== null ? Math.round(previous * 10) / 10 : null,
    best: best ? { week: best.week, accuracy: Math.round(best.avg_accuracy * 10) / 10 } : null,
    trend_per_month: trend,
    weeks: pts.length,
  };
}
