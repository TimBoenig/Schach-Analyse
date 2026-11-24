// Axis maths for the charts: round numbers on the value axis, calendar steps
// on the time axis. Pure, so the choices are testable without a browser.
import { dayMonthLabel, t } from "../../i18n";


const DAY = 86400;

export interface ValueScale {
  min: number;
  max: number;
  ticks: number[];
}

/** A step of 1, 2, 2.5 or 5 times a power of ten close to `raw`. */
function niceStep(raw: number): number {
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

/**
 * A value axis that starts and ends on round numbers and holds about `count`
 * grid lines. `lo`/`hi` clamp it (an accuracy never leaves 0..100), `minSpan`
 * keeps small wobbles small, and a flat series still gets a band around its
 * one value.
 */
export function valueScale(values: number[], count = 4, { lo = -Infinity, hi = Infinity, pad = 0.08, minSpan = 0 }: { lo?: number; hi?: number; pad?: number; minSpan?: number } = {}): ValueScale {
  if (!values.length) return { min: 0, max: 1, ticks: [0, 1] };
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max === min) {
    const half = Math.max(1, Math.abs(max) * 0.05);
    min -= half;
    max += half;
  }
  // A narrow band would blow two points of difference up into a mountain range.
  if (max - min < minSpan) {
    const mid = Math.min(hi - minSpan / 2, Math.max(lo + minSpan / 2, (max + min) / 2));
    min = mid - minSpan / 2;
    max = mid + minSpan / 2;
    pad = 0;
  }
  const room = (max - min) * pad;
  const step = niceStep((max - min + 2 * room) / Math.max(1, count));
  const from = Math.max(lo, Math.floor((min - room) / step) * step);
  const to = Math.min(hi, Math.ceil((max + room) / step) * step);
  const ticks: number[] = [];
  // Rounding keeps 0.1 + 0.2 style noise out of the labels.
  for (let v = from; v <= to + step * 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
  return { min: from, max: to, ticks };
}

export interface TimeTick {
  t: number;
  label: string;
}

const MONTHS = [t("Jan"), t("Feb"), t("Mär"), t("Apr"), t("Mai"), t("Jun"), t("Jul"), t("Aug"), t("Sep"), t("Okt"), t("Nov"), t("Dez")];
const epoch = (d: Date) => d.getTime() / 1000;

/** Month steps tried in turn until the labels fit. */
const MONTH_STEPS = [1, 2, 3, 6, 12, 24, 60];
const DAY_STEPS = [1, 2, 7, 14];

/**
 * Calendar ticks between two times, at most `max` of them: days for a few
 * weeks, month starts for months and years, each January carrying its year so
 * "Mär" is never ambiguous.
 */
export function timeTicks(t0: number, t1: number, max: number): TimeTick[] {
  if (!(t1 > t0) || max < 1) return [];
  const span = (t1 - t0) / DAY;
  const start = new Date(t0 * 1000);
  if (span <= 62) {
    for (const step of DAY_STEPS) {
      const ticks: TimeTick[] = [];
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      // Weekly steps sit on Mondays, so two charts side by side agree.
      if (step >= 7) d.setDate(d.getDate() + ((8 - d.getDay()) % 7));
      for (; epoch(d) <= t1; d.setDate(d.getDate() + step)) if (epoch(d) >= t0) ticks.push({ t: epoch(d), label: dayMonthLabel(d, false) });
      if (ticks.length <= max) return ticks;
    }
  }
  for (const step of MONTH_STEPS) {
    const ticks: TimeTick[] = [];
    // Steps of several months align to the calendar (quarters, half-years, years).
    const d = new Date(start.getFullYear(), Math.floor(start.getMonth() / step) * step, 1);
    for (; epoch(d) <= t1; d.setMonth(d.getMonth() + step)) {
      if (epoch(d) < t0) continue;
      const jan = d.getMonth() === 0;
      ticks.push({ t: epoch(d), label: step >= 12 ? String(d.getFullYear()) : jan ? String(d.getFullYear()) : MONTHS[d.getMonth()] });
    }
    if (ticks.length <= max) return ticks;
  }
  return [];
}

/** Index of the point whose x is closest to `x` (points sorted by x). */
export function nearestIndex(xs: number[], x: number): number {
  if (!xs.length) return -1;
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && x - xs[lo - 1] <= xs[lo] - x ? lo - 1 : lo;
}
