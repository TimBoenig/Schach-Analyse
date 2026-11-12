// The rating as a journey: where it started, where it stands, the best it has
// been and how far the next goal is. The pace comes from a straight line
// through the last weeks; a time of arrival is only given while that line
// clearly points up, and it is worded as "at this pace", not as a forecast.

const DAY = 86400;
/** Window the pace is measured over. */
export const PACE_DAYS = 90;
/** Rated games and days the window must hold before a pace is given. */
export const PACE_MIN_GAMES = 12;
export const PACE_MIN_DAYS = 14;
/** Rating points per month from which the pace counts as moving. */
export const PACE_MIN = 3;
/** Arrival times further out than this say nothing. */
export const ETA_MAX_DAYS = 730;
const GOAL_STEP = 50;

export interface RatingJourney {
  start: number;
  current: number;
  peak: number;
  goal: number;
  /** Rating points per 30 days over the last PACE_DAYS; null with too little data. */
  per_month: number | null;
  /** Days until the goal at that pace; null when the pace is flat, falling or unknown. */
  eta_days: number | null;
  reached: boolean;
  /** 0..1 of the way from start to goal. */
  progress: number;
}

/** The next round number that is still a real step away. */
export function nextMilestone(current: number): number {
  const next = Math.ceil((current + 1) / GOAL_STEP) * GOAL_STEP;
  return next - current < GOAL_STEP / 2 ? next + GOAL_STEP : next;
}

/** `series` = [epoch seconds, rating] oldest first; `goal` null picks the next milestone. */
export function ratingJourney(series: [number, number][], goal: number | null, now = Date.now() / 1000): RatingJourney | null {
  if (!series.length) return null;
  const current = series[series.length - 1][1];
  const start = series[0][1];
  const peak = Math.max(...series.map(([, r]) => r));
  const target = goal && goal > 0 ? goal : nextMilestone(current);

  const recent = series.filter(([t]) => t >= now - PACE_DAYS * DAY);
  let perMonth: number | null = null;
  if (recent.length >= PACE_MIN_GAMES && recent[recent.length - 1][0] - recent[0][0] >= PACE_MIN_DAYS * DAY) {
    const n = recent.length;
    const mt = recent.reduce((s, [t]) => s + t, 0) / n;
    const mr = recent.reduce((s, [, r]) => s + r, 0) / n;
    let num = 0;
    let den = 0;
    for (const [t, r] of recent) {
      num += (t - mt) * (r - mr);
      den += (t - mt) ** 2;
    }
    perMonth = den > 0 ? (num / den) * 30 * DAY : null;
  }

  const reached = current >= target;
  const eta = !reached && perMonth !== null && perMonth >= PACE_MIN ? ((target - current) / perMonth) * 30 : null;
  const from = Math.min(start, current);
  return {
    start,
    current,
    peak,
    goal: target,
    per_month: perMonth === null ? null : Math.round(perMonth * 10) / 10,
    eta_days: eta !== null && eta <= ETA_MAX_DAYS ? Math.round(eta) : null,
    reached,
    progress: reached ? 1 : Math.min(1, Math.max(0, (current - from) / (target - from || 1))),
  };
}
