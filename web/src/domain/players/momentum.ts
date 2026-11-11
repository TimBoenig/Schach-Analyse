// Form inside the group: each player's latest results, how their accuracy
// moved week by week, and whether they play clearly better or worse lately
// than before.
//
// Accuracy is taken per game and corrected by the ranking's own time-control
// effects (fairness.ts), so switching from Blitz to Rapid does not pass for
// progress. A change is only called a trend when both windows hold
// MIN_GROUP_GAMES analyzed games and the gap passes a two-sided 95 % test.

import { filterGames } from "../metrics/filters";
import { type Outcome, outcomeFor, parseSummary, type RawGame } from "../metrics/models";
import { parsePlayedAt } from "../metrics/played";
import { detectSpeedCategory } from "../metrics/speed";
import { meansDiffer, MIN_GROUP_GAMES, Z95 } from "../profile/evidence";

export const MOMENTUM_WEEKS = 12;
/** Recent window for the trend, in days. */
export const TREND_DAYS = 30;
const WEEK = 7 * 86400;
// Weeks with fewer analyzed games than this get no point of their own in the curve.
const MIN_WEEK_GAMES = 2;

export interface FormWeek {
  /** Monday 00:00 UTC, epoch seconds. */
  start: number;
  games: number;
  /** Average fair accuracy of the week (null below MIN_WEEK_GAMES). */
  accuracy: number | null;
  /** Rolling three-week average, weighted by games (null below three games). */
  smooth: number | null;
}

export interface MomentumRow {
  id: string;
  name: string;
  is_me: boolean;
  /** Up to five latest results, newest last. */
  last: Outcome[];
  /** Current run, newest game backwards (null below two). */
  streak: { kind: Outcome; count: number } | null;
  weeks: FormWeek[];
  recent: { games: number; accuracy: number | null };
  before: { games: number; accuracy: number | null };
  /** Recent minus earlier accuracy (null when a window is empty). */
  delta: number | null;
  /** "up"/"down" for a clear change, "flat" when both windows are big enough but equal within noise. */
  trend: "up" | "down" | "flat" | null;
}

export interface MomentumMember {
  id: string;
  name: string;
  is_me: boolean;
  usernames: string[];
}

function speedOf(g: RawGame): string {
  if (g.chess960) return "Chess960";
  return (g.speed_category || "").trim() || detectSpeedCategory(g.time_control, g.event) || "Other";
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

function mondayOf(t: number): number {
  const day = Math.floor(t / 86400);
  // 1970-01-01 was a Thursday: days since the last Monday.
  const back = (day + 3) % 7;
  return (day - back) * 86400;
}

export function groupMomentum(
  members: MomentumMember[],
  games: RawGame[],
  {
    format = "All Formats",
    date = "All Time",
    now = Date.now() / 1000,
    effects = {},
  }: { format?: string; date?: string; now?: number; effects?: Record<string, { accuracy: number }> } = {},
): MomentumRow[] {
  const firstWeek = mondayOf(now) - (MOMENTUM_WEEKS - 1) * WEEK;
  return members.map((m) => {
    const own = filterGames(games, m.usernames, "All Colors", format, "All Sources", date)
      .map(([g, color]) => ({ g, color, at: parsePlayedAt(g) }))
      .filter((x): x is { g: RawGame; color: "white" | "black"; at: number } => x.at !== null && x.at <= now)
      .sort((a, b) => a.at - b.at);

    const results = own.map((x) => outcomeFor(x.g.result, x.color)).filter((o): o is Outcome => o !== null);
    let streak: MomentumRow["streak"] = null;
    if (results.length) {
      const kind = results[results.length - 1];
      let count = 0;
      while (count < results.length && results[results.length - 1 - count] === kind) count++;
      if (count >= 2) streak = { kind, count };
    }

    const acc: { at: number; value: number }[] = [];
    for (const x of own) {
      const side = (parseSummary(x.g.summary_json)?.[x.color] ?? null) as Record<string, unknown> | null;
      const a = Number(side?.accuracy ?? 0);
      if (!side || !Number.isFinite(a) || a <= 0) continue;
      // Effects are relative to the group's mix: a hard time control gets points back.
      acc.push({ at: x.at, value: a - (effects[speedOf(x.g)]?.accuracy ?? 0) });
    }

    const weeks: FormWeek[] = [];
    for (let w = 0; w < MOMENTUM_WEEKS; w++) {
      const start = firstWeek + w * WEEK;
      const vals = acc.filter((x) => x.at >= start && x.at < start + WEEK).map((x) => x.value);
      weeks.push({ start, games: vals.length, accuracy: vals.length >= MIN_WEEK_GAMES ? mean(vals) : null, smooth: null });
    }
    weeks.forEach((wk) => {
      const span = acc.filter((x) => x.at >= wk.start - 2 * WEEK && x.at < wk.start + WEEK);
      wk.smooth = span.length >= 3 && wk.games > 0 ? mean(span.map((x) => x.value)) : null;
    });

    const cut = now - TREND_DAYS * 86400;
    const recent = acc.filter((x) => x.at >= cut).map((x) => x.value);
    const before = acc.filter((x) => x.at < cut).map((x) => x.value);
    const r = mean(recent);
    const b = mean(before);
    const delta = r !== null && b !== null ? r - b : null;
    let trend: MomentumRow["trend"] = null;
    if (recent.length >= MIN_GROUP_GAMES && before.length >= MIN_GROUP_GAMES && delta !== null) {
      trend = meansDiffer(recent, before, Z95) ? (delta > 0 ? "up" : "down") : "flat";
    }
    return {
      id: m.id,
      name: m.name,
      is_me: m.is_me,
      last: results.slice(-5),
      streak,
      weeks,
      recent: { games: recent.length, accuracy: r },
      before: { games: before.length, accuracy: b },
      delta,
      trend,
    };
  });
}
