import { useEffect, useState } from "preact/hooks";

import { buildProfileInWorker } from "../app/profileClient";
import { trFilter } from "../domain/i18n";
import type { PlayerProfile } from "../domain/profile";
import { getSetting, listGames, onDataChanged } from "../storage/db";

const FORMATS = ["All Formats", "Bullet", "Blitz", "Rapid", "Classical", "Daily"];
const DATES = ["All Time", "Last 30 Days", "Last 90 Days", "This Year"];
const COLORS = ["All Colors", "White", "Black"];

export interface ProfileFilters {
  format: string;
  date: string;
  color: string;
}

const DEFAULT_FILTERS: ProfileFilters = { format: "All Formats", date: "All Time", color: "All Colors" };
// Shared between Profil and Einblicke so switching pages keeps the selection.
let lastFilters: ProfileFilters = DEFAULT_FILTERS;

export function filtersActive(f: ProfileFilters): boolean {
  return f.format !== DEFAULT_FILTERS.format || f.date !== DEFAULT_FILTERS.date || f.color !== DEFAULT_FILTERS.color;
}

/** Loads the (worker-built, cached) profile for the stored usernames and filters. */
export function useProfile() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [usernames, setUsernames] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFiltersState] = useState<ProfileFilters>(lastFilters);
  const [version, setVersion] = useState(0);

  const setFilters = (f: ProfileFilters) => {
    lastFilters = f;
    setFiltersState(f);
  };

  useEffect(() => onDataChanged(() => setVersion((v) => v + 1)), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const names = await getSetting<string[]>("usernames", []);
      if (!alive) return;
      setUsernames(names);
      if (!names.length) {
        setLoading(false);
        return;
      }
      try {
        const games = await listGames();
        const p = await buildProfileInWorker({ games, usernames: names, ...filters });
        if (alive) {
          setProfile(p);
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
  }, [filters, version]);

  return { profile, usernames, loading, error, filters, setFilters };
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

export function FilterBar({ filters, onChange }: { filters: ProfileFilters; onChange: (f: ProfileFilters) => void }) {
  return (
    <div class="filters">
      <Select value={filters.format} options={FORMATS} onChange={(format) => onChange({ ...filters, format })} label="Bedenkzeit" />
      <Select value={filters.date} options={DATES} onChange={(date) => onChange({ ...filters, date })} label="Zeitraum" />
      <Select value={filters.color} options={COLORS} onChange={(color) => onChange({ ...filters, color })} label="Farbe" />
    </div>
  );
}
