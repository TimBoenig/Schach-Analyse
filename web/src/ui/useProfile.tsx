import { useEffect, useState } from "preact/hooks";

import { buildProfileInWorker } from "../app/profileClient";
import { statsFormat } from "../domain/analysisDepth";
import { trFilter } from "../domain/i18n";
import { dateWindow, extractGameTimestamp, filterGames, isRangeFilter, isValidDateFilter, previousDateFilter, rangeFilter } from "../domain/metrics";
import { PAGE_PERIODS, type PeriodPage, settleByCount } from "../domain/periods";
import type { PlayerProfile } from "../domain/profile";
import type { StoredGame } from "../domain/types";
import { getSetting, listGames, onDataChanged, setSetting } from "../storage/db";
import { IconChevron, IconFilter } from "./icons";
import { useBulletPrefs } from "./useAnalysisPrefs";
import { useNarrow } from "./useNarrow";

export const FORMATS = ["All Formats", "Bullet", "Blitz", "Rapid", "Classical", "Daily"];

/** Label of a format option; "Alle Formate" says when Bullet is left out. */
export function formatOptionLabel(format: string, excludeBullet: boolean): string {
  return excludeBullet && format === "All Formats" ? "Alle außer Bullet" : trFilter(format);
}
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
const PERIODS_KEY = "ui.periods";

export interface ProfileFilters {
  format: string;
  date: string;
  color: string;
}

// "All Time" stays the reference for "is a filter active" (the empty-page
// hints); the period a page starts with comes from PAGE_PERIODS.
const DEFAULT_FILTERS: ProfileFilters = { format: "All Formats", date: "All Time", color: "All Colors" };
type Shared = Pick<ProfileFilters, "format" | "color">;
// Format and colour are shared between Start, Profil, Einblicke, Eröffnungen
// and Züge, so switching pages keeps them. The period is each page's own: the
// start page looks at the last 30 days, the profile at 90 (see periods.ts). A
// period the user picks is saved per page, so it is still there tomorrow.
let lastShared: Shared = { format: DEFAULT_FILTERS.format, color: DEFAULT_FILTERS.color };
let chosenPeriods: Partial<Record<PeriodPage, string>> = {};
let restored: Promise<void> | null = null;

function restoreFilters(): Promise<void> {
  restored ??= Promise.all([
    getSetting<Partial<ProfileFilters> | null>(FILTERS_KEY, null),
    getSetting<Partial<Record<PeriodPage, string>> | null>(PERIODS_KEY, null),
  ]).then(([f, periods]) => {
    // Older versions stored one period for every page here; it is left out on
    // purpose, so every page starts with its own default once.
    if (f) lastShared = { format: f.format ?? lastShared.format, color: f.color ?? lastShared.color };
    if (periods && typeof periods === "object") chosenPeriods = Object.fromEntries(Object.entries(periods).filter(([, v]) => typeof v === "string" && isValidDateFilter(v)));
  });
  return restored;
}

export function filtersActive(f: ProfileFilters): boolean {
  return f.format !== DEFAULT_FILTERS.format || f.date !== DEFAULT_FILTERS.date || f.color !== DEFAULT_FILTERS.color;
}

/**
 * The period a page shows: the user's pick for it, else the page's default
 * widened until it holds enough of the user's games (format and colour applied).
 */
export function pagePeriod(page: PeriodPage, games: StoredGame[], names: string[], format: string, color: string, chosen = chosenPeriods[page]): string {
  if (chosen) return chosen;
  const times = filterGames(games, names, color, format).map(([g]) => extractGameTimestamp(g));
  return settleByCount(PAGE_PERIODS[page], times);
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
export function useProfile({ page, compare = false }: { page: PeriodPage; compare?: boolean }) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [games, setGames] = useState<StoredGame[]>([]);
  const [usernames, setUsernames] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [shared, setShared] = useState<Shared>(lastShared);
  const [chosen, setChosen] = useState<string | null>(chosenPeriods[page] ?? null);
  // The period actually shown (the pick, or the settled default).
  const [period, setPeriod] = useState<string>(chosenPeriods[page] ?? PAGE_PERIODS[page]);
  const [version, setVersion] = useState(0);
  const { excludeBullet, ready } = useBulletPrefs();

  const filters: ProfileFilters = { ...shared, date: period };
  const setFilters = (f: ProfileFilters) => {
    if (f.format !== shared.format || f.color !== shared.color) {
      lastShared = { format: f.format, color: f.color };
      setShared(lastShared);
      void setSetting(FILTERS_KEY, lastShared);
    }
    if (f.date !== period) {
      chosenPeriods = { ...chosenPeriods, [page]: f.date };
      setChosen(f.date);
      setPeriod(f.date);
      void setSetting(PERIODS_KEY, chosenPeriods);
    }
  };

  // A running analysis saves a game every few seconds; rebuilding on each save
  // kept the profile worker busy for nothing, so bursts of changes count once.
  useEffect(() => {
    let timer = 0;
    const off = onDataChanged(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setVersion((v) => v + 1), 800);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    void restoreFilters().then(() => {
      setShared(lastShared);
      setChosen(chosenPeriods[page] ?? null);
    });
  }, [page]);

  useEffect(() => {
    let alive = true;
    if (!ready) return;
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
        const format = statsFormat(shared.format, excludeBullet);
        const date = pagePeriod(page, all, names, format, shared.color, chosen ?? undefined);
        const build = (d: string) => buildProfileInWorker({ games: all, usernames: names, ...shared, format, date: d });
        const p = await build(date);
        let cmp: Comparison | null = null;
        if (compare) {
          const fallback = !dateWindow(date);
          const span = fallback ? COMPARE_FALLBACK : date;
          const before = previousDateFilter(span);
          const [current, previous] = await Promise.all([
            fallback ? build(span) : p,
            before ? build(before) : Promise.resolve(null),
          ]);
          cmp = { current, previous, label: trFilter(span), fallback };
        }
        if (alive) {
          setGames(all);
          setPeriod(date);
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
  }, [shared, chosen, page, version, compare, excludeBullet, ready]);

  return { profile, comparison, games, usernames, loading, error, filters, setFilters, excludeBullet };
}

function Select({
  value,
  options,
  onChange,
  label,
  optionLabel = trFilter,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  label: string;
  optionLabel?: (o: string) => string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.currentTarget.value)} aria-label={label}>
      {options.map((o) => (
        <option key={o} value={o}>
          {optionLabel(o)}
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

export function FilterBar({
  filters,
  onChange,
  hideDate = false,
}: {
  filters: ProfileFilters;
  onChange: (f: ProfileFilters) => void;
  /** The start page picks the period with its own quick buttons. */
  hideDate?: boolean;
}) {
  const { excludeBullet } = useBulletPrefs();
  const narrow = useNarrow();
  const selects = (
    <div class="filters">
      <Select
        value={filters.format}
        options={FORMATS}
        onChange={(format) => onChange({ ...filters, format })}
        label="Bedenkzeit"
        optionLabel={(o) => formatOptionLabel(o, excludeBullet)}
      />
      {!hideDate && <PeriodSelect value={filters.date} onChange={(date) => onChange({ ...filters, date })} />}
      <Select value={filters.color} options={COLORS} onChange={(color) => onChange({ ...filters, color })} label="Farbe" />
    </div>
  );
  if (!narrow) return selects;
  // Phones: one line says what is shown; the three selects open below it on
  // a tap, instead of taking two rows above every page for good.
  const active = [
    filters.format !== DEFAULT_FILTERS.format || excludeBullet ? formatOptionLabel(filters.format, excludeBullet) : null,
    filters.color !== DEFAULT_FILTERS.color ? trFilter(filters.color) : null,
  ].filter((v): v is string => v !== null);
  // The period is always named: every page starts with a limited one now.
  const shown = [active.length ? active.join(" · ") : "Alle Partien", ...(hideDate ? [] : [trFilter(filters.date)])].join(" · ");
  return (
    <details class={`filter-fold${active.length ? " active" : ""}`}>
      <summary>
        <IconFilter />
        <span class="filter-fold-text">{shown}</span>
        <span class="filter-fold-hint">Filter</span>
        <IconChevron />
      </summary>
      {selects}
    </details>
  );
}
