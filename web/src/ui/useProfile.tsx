import { useEffect, useState } from "preact/hooks";

import { buildProfileInWorker } from "../app/profileClient";
import { trFilter } from "../domain/i18n";
import { dateWindow, isRangeFilter, previousDateFilter, rangeFilter } from "../domain/metrics";
import type { PlayerProfile } from "../domain/profile";
import type { StoredGame } from "../domain/types";
import { getSetting, listGames, onDataChanged, setSetting } from "../storage/db";

const FORMATS = ["All Formats", "Bullet", "Blitz", "Rapid", "Classical", "Daily"];
export const DATES = [
  "All Time",
  "Last 7 Days",
  "Last 14 Days",
  "Last 30 Days",
  "Last 90 Days",
  "Last 180 Days",
  "Last 365 Days",
  "This Year",
];
const COLORS = ["All Colors", "White", "Black"];
const CUSTOM = "custom";
const FILTERS_KEY = "ui.filters";

export interface ProfileFilters {
  format: string;
  date: string;
  color: string;
}

const DEFAULT_FILTERS: ProfileFilters = { format: "All Formats", date: "All Time", color: "All Colors" };
// Shared between Start, Profil, Einblicke and Eröffnungen so switching pages
// keeps the selection; saved so the chosen period is still there tomorrow.
let lastFilters: ProfileFilters = DEFAULT_FILTERS;
let restored: Promise<void> | null = null;

function restoreFilters(): Promise<void> {
  restored ??= getSetting<Partial<ProfileFilters> | null>(FILTERS_KEY, null).then((f) => {
    if (f) lastFilters = { ...DEFAULT_FILTERS, ...f };
  });
  return restored;
}

export function filtersActive(f: ProfileFilters): boolean {
  return f.format !== DEFAULT_FILTERS.format || f.date !== DEFAULT_FILTERS.date || f.color !== DEFAULT_FILTERS.color;
}

export interface Comparison {
  current: PlayerProfile;
  previous: PlayerProfile | null;
  /** Period the comparison covers, e.g. "Letzte 30 Tage". */
  label: string;
  /** True when "All Time" is selected and the last 30 days stand in for it. */
  fallback: boolean;
}

// With "All Time" there is no period before; the last 30 days are the most
// useful stand-in for "how am I doing lately".
const COMPARE_FALLBACK = "Last 30 Days";

/**
 * Loads the (worker-built, cached) profile for the stored usernames and filters.
 * With `compare`, also the profile of the equally long period before.
 */
export function useProfile({ compare = false }: { compare?: boolean } = {}) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [games, setGames] = useState<StoredGame[]>([]);
  const [usernames, setUsernames] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFiltersState] = useState<ProfileFilters>(lastFilters);
  const [version, setVersion] = useState(0);

  const setFilters = (f: ProfileFilters) => {
    lastFilters = f;
    setFiltersState(f);
    void setSetting(FILTERS_KEY, f);
  };

  useEffect(() => onDataChanged(() => setVersion((v) => v + 1)), []);
  useEffect(() => {
    void restoreFilters().then(() => setFiltersState(lastFilters));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      await restoreFilters();
      const names = await getSetting<string[]>("usernames", []);
      if (!alive) return;
      setUsernames(names);
      if (!names.length) {
        setLoading(false);
        return;
      }
      try {
        const all = await listGames();
        const build = (date: string) => buildProfileInWorker({ games: all, usernames: names, ...filters, date });
        const p = await build(filters.date);
        let cmp: Comparison | null = null;
        if (compare) {
          const fallback = !dateWindow(filters.date);
          const period = fallback ? COMPARE_FALLBACK : filters.date;
          const before = previousDateFilter(period);
          const [current, previous] = await Promise.all([
            fallback ? build(period) : p,
            before ? build(before) : Promise.resolve(null),
          ]);
          cmp = { current, previous, label: trFilter(period), fallback };
        }
        if (alive) {
          setGames(all);
          setProfile(p);
          setComparison(cmp);
          setError("");
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [filters, version, compare]);

  return { profile, comparison, games, usernames, loading, error, filters, setFilters };
}

function Select({ value, options, onChange, label }: { value: string; options: string[]; onChange: (v: string) => void; label: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.currentTarget.value)} aria-label={label}>
      {options.map((o) => (
        <option key={o} value={o}>
          {trFilter(o)}
        </option>
      ))}
    </select>
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local calendar day of an epoch (seconds) as an <input type="date"> value. */
export function dayInput(seconds: number): string {
  const d = new Date(seconds * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local midnight of an <input type="date"> value, in epoch seconds (null if empty). */
function dayStart(value: string, plusDays = 0): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + plusDays).getTime() / 1000;
}

/** Range filter for the inclusive local days `from`..`to` (either may be empty). */
export function customRange(from: string, to: string): string {
  return rangeFilter(dayStart(from), dayStart(to, 1));
}

/** Period picker: presets plus "Eigener Zeitraum" with two date fields. */
export function PeriodSelect({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const custom = isRangeFilter(value);
  const w = custom ? dateWindow(value) : null;
  const from = w?.start != null ? dayInput(w.start) : "";
  const to = w?.end != null ? dayInput(w.end - 1) : "";
  return (
    <>
      <select
        value={custom ? CUSTOM : value}
        aria-label="Zeitraum"
        onChange={(e) => {
          const v = e.currentTarget.value;
          if (v !== CUSTOM) return onChange(v);
          // Start the custom period with the last four weeks; the fields refine it.
          const now = Date.now() / 1000;
          onChange(customRange(dayInput(now - 27 * 86400), dayInput(now)));
        }}
      >
        {DATES.map((o) => (
          <option key={o} value={o}>
            {trFilter(o)}
          </option>
        ))}
        <option value={CUSTOM}>{custom ? `Eigener: ${trFilter(value)}` : "Eigener Zeitraum …"}</option>
      </select>
      {custom && (
        <span class="date-range">
          <label>
            <span>von</span>
            <input type="date" value={from} max={to || undefined} onChange={(e) => onChange(customRange(e.currentTarget.value, to))} />
          </label>
          <label>
            <span>bis</span>
            <input type="date" value={to} min={from || undefined} onChange={(e) => onChange(customRange(from, e.currentTarget.value))} />
          </label>
        </span>
      )}
    </>
  );
}

export function FilterBar({ filters, onChange }: { filters: ProfileFilters; onChange: (f: ProfileFilters) => void }) {
  return (
    <div class="filters">
      <Select value={filters.format} options={FORMATS} onChange={(format) => onChange({ ...filters, format })} label="Bedenkzeit" />
      <PeriodSelect value={filters.date} onChange={(date) => onChange({ ...filters, date })} />
      <Select value={filters.color} options={COLORS} onChange={(color) => onChange({ ...filters, color })} label="Farbe" />
    </div>
  );
}
