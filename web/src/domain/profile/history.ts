// The long view for the profile's "Verlauf": rating and accuracy over months
// and years. Both are cut from the full history (not from the page's period)
// and thinned to what a chart of that span can show: one closing value per
// day for the rating, days, weeks, months or quarters for the accuracy.
import { t } from "../../i18n";


const DAY = 86400;

/** [epoch seconds, rating], oldest first. */
export type RatingSeries = [number, number][];

export interface RatingPoint {
  /** Time of the day's last game. */
  t: number;
  /** Rating after that game. */
  value: number;
  /** Local day "YYYY-MM-DD". */
  day: string;
  /** Rated games played that day. */
  games: number;
}

export interface RatingHistory {
  points: RatingPoint[];
  /** Rating at the left and right edge of the span. */
  first: number;
  last: number;
  /** last - first. */
  change: number;
  /** Highest and lowest rating after any game of the span (not only at the end of a day). */
  peak: { t: number; value: number };
  low: { t: number; value: number };
  /** Rated games inside the span. */
  games: number;
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** Local calendar day of a timestamp, "YYYY-MM-DD". */
export function localDay(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** Start of a local "YYYY-MM-DD" day as epoch seconds. */
export function dayStart(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).getTime() / 1000;
}

/**
 * One point per day, the rating after the day's last game: twenty blitz games
 * in an evening are one step of the line, not twenty zigzags. `rangeDays`
 * counts back from the newest game (null = everything), so an account that
 * has been quiet for a year still shows its last active months.
 */
export function ratingHistory(series: RatingSeries, rangeDays: number | null): RatingHistory | null {
  const sorted = [...series].filter(([tk, r]) => tk > 0 && r > 0).sort((a, b) => a[0] - b[0]);
  if (!sorted.length) return null;
  const end = sorted[sorted.length - 1][0];
  const from = rangeDays ? dayStart(localDay(end - rangeDays * DAY)) : -Infinity;
  const points: RatingPoint[] = [];
  let peak: { t: number; value: number } | null = null;
  let low: { t: number; value: number } | null = null;
  for (const [tk, value] of sorted) {
    if (tk < from) continue;
    if (!peak || value > peak.value) peak = { t: tk, value };
    if (!low || value < low.value) low = { t: tk, value };
    const day = localDay(tk);
    const prev = points[points.length - 1];
    if (prev && prev.day === day) {
      prev.t = tk;
      prev.value = value;
      prev.games++;
    } else {
      points.push({ t: tk, value, day, games: 1 });
    }
  }
  if (!points.length || !peak || !low) return null;
  const first = points[0].value;
  const last = points[points.length - 1].value;
  return {
    points,
    first,
    last,
    change: last - first,
    peak,
    low,
    games: points.reduce((n, p) => n + p.games, 0),
  };
}

// ---------- accuracy ----------

export type Bucket = "day" | "week" | "month" | "quarter";

/** One row of the profile's daily trend (see builder.ts, periodRows). */
export interface DayRow {
  day: string;
  games: number;
  /** Analysed games of the day; older profiles without the field count every game. */
  analyzed?: number;
  avg_accuracy: number | null;
}

export interface AccuracyPoint {
  /** Start of the bucket (epoch seconds). */
  t: number;
  /** "YYYY-MM-DD" of the bucket's first day. */
  key: string;
  bucket: Bucket;
  /** Average game accuracy, every analysed game counting once. */
  value: number;
  /** Analysed games behind the value. */
  games: number;
}

export interface AccuracyHistory {
  bucket: Bucket;
  points: AccuracyPoint[];
  /** Average over the whole span, every analysed game counting once. */
  average: number;
  games: number;
}

/**
 * The step a span is drawn in: fine enough to show a trend, coarse enough
 * that a step holds several games. Six weeks show days, half a year weeks,
 * three years months, anything longer quarters.
 */
export function bucketFor(spanDays: number): Bucket {
  if (spanDays <= 45) return "day";
  if (spanDays <= 200) return "week";
  if (spanDays <= 1100) return "month";
  return "quarter";
}

/** First day of the bucket a day belongs to. */
export function bucketStart(day: string, bucket: Bucket): string {
  if (bucket === "day") return day;
  const [y, m, d] = day.split("-").map(Number);
  if (bucket === "month") return `${y}-${p2(m)}-01`;
  if (bucket === "quarter") return `${y}-${p2(Math.floor((m - 1) / 3) * 3 + 1)}-01`;
  // Week: its Monday.
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`;
}

/**
 * Accuracy over time from the daily rows. `rangeDays` counts back from the
 * newest day with an analysed game; the bucket size follows the span that is
 * actually shown, so "Alles" over two months still shows weeks, not one bar.
 */
export function accuracyHistory(daily: DayRow[], rangeDays: number | null): AccuracyHistory | null {
  const rows = daily
    .map((r) => ({ day: r.day, n: r.avg_accuracy === null ? 0 : (r.analyzed ?? r.games), acc: r.avg_accuracy ?? 0 }))
    .filter((r) => r.n > 0)
    .sort((a, b) => (a.day < b.day ? -1 : 1));
  if (!rows.length) return null;
  const end = dayStart(rows[rows.length - 1].day);
  const from = rangeDays ? end - rangeDays * DAY : -Infinity;
  const shown = rows.filter((r) => dayStart(r.day) >= from);
  const span = (end - dayStart(shown[0].day)) / DAY + 1;
  const bucket = bucketFor(span);
  const groups = new Map<string, { sum: number; n: number }>();
  for (const r of shown) {
    const key = bucketStart(r.day, bucket);
    const g = groups.get(key) ?? { sum: 0, n: 0 };
    g.sum += r.acc * r.n;
    g.n += r.n;
    groups.set(key, g);
  }
  const points = [...groups.entries()].map(([key, g]) => ({ t: dayStart(key), key, bucket, value: g.sum / g.n, games: g.n }));
  const games = shown.reduce((n, r) => n + r.n, 0);
  return { bucket, points, average: shown.reduce((s, r) => s + r.acc * r.n, 0) / games, games };
}

// ---------- spans ----------

export interface RangeOption {
  key: string;
  label: string;
  /** Days back from the newest entry; null = the whole history. */
  days: number | null;
  /** The span in a sentence: "+23 in den letzten 3 Monaten". */
  text: string;
}

const RANGES: RangeOption[] = [
  { key: "1m", label: "1 M", days: 31, text: t("im letzten Monat") },
  { key: "3m", label: "3 M", days: 92, text: t("in den letzten 3 Monaten") },
  { key: "6m", label: "6 M", days: 183, text: t("in den letzten 6 Monaten") },
  { key: "1y", label: "1 J", days: 366, text: t("im letzten Jahr") },
];
const ALL: RangeOption = { key: "all", label: t("Alles"), days: null, text: "insgesamt" };

/**
 * The spans worth offering for a history of `spanDays`: only those shorter
 * than the history, then "Alles". A history of five weeks offers "1 M" and
 * "Alles", one of three days only "Alles".
 */
export function rangeChoices(spanDays: number): RangeOption[] {
  return [...RANGES.filter((r) => (r.days as number) < spanDays), ALL];
}

/** The span a chart opens with: the last year where there is more, else everything. */
export function defaultRange(choices: RangeOption[]): RangeOption {
  return choices.find((c) => c.key === "1y") ?? choices[choices.length - 1];
}

const MONTHS = [t("Jan"), t("Feb"), t("Mär"), t("Apr"), t("Mai"), t("Jun"), t("Jul"), t("Aug"), t("Sep"), t("Okt"), t("Nov"), t("Dez")];

/** "12. Mär 2026", "Woche ab 9. Mär 2026", "März 2026", "Q1 2026". */
export function bucketLabel(key: string, bucket: Bucket): string {
  const [y, m, d] = key.split("-").map(Number);
  if (bucket === "quarter") return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
  if (bucket === "month") return `${MONTHS[m - 1]} ${y}`;
  const day = `${d}. ${MONTHS[m - 1]} ${y}`;
  return bucket === "week" ? t("Woche ab {day}", { day }) : day;
}
