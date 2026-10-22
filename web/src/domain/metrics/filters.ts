// Game filtering and user color resolution (port of src/backend/analysis/metrics/filters.py).

import { VALID_DATE_FILTERS } from "./constants";
import { parsePlayedAt } from "./played";
import { detectSpeedCategory } from "./speed";

/** Minimal game shape the filters read; StoredGame satisfies it. */
export interface FilterableGame {
  white?: string | null;
  black?: string | null;
  chess960?: number | boolean | null;
  speed_category?: string | null;
  time_control?: string | null;
  event?: string | null;
  source?: string | null;
  timestamp?: number | string | null;
  date?: string | null;
  pgn?: string | null;
}

const DAY = 86400;

const DATE_FILTER_SECONDS: Record<string, number> = {
  "Last 24 Hours": DAY,
  "Last 7 Days": 7 * DAY,
  "Last 14 Days": 14 * DAY,
  "Last 30 Days": 30 * DAY,
  "Last 90 Days": 90 * DAY,
  "Last 180 Days": 180 * DAY,
  "Last 365 Days": 365 * DAY,
};

// A custom period travels through the same string filter as the presets, so
// worker requests, cache keys and saved settings need no second field:
// "range:<start>:<end>" in epoch seconds, end exclusive, either side optional.
const RANGE_PREFIX = "range:";

/** Half-open time window [start, end) in epoch seconds; null bounds are open. */
export interface DateWindow {
  start: number | null;
  end: number | null;
}

export function rangeFilter(start: number | null, end: number | null): string {
  const part = (v: number | null) => (v === null ? "" : String(Math.round(v)));
  return `${RANGE_PREFIX}${part(start)}:${part(end)}`;
}

export function isRangeFilter(dateFilter: string | null | undefined): boolean {
  return Boolean(dateFilter?.startsWith(RANGE_PREFIX));
}

function parseRange(dateFilter: string): DateWindow | null {
  const m = /^range:(-?\d*):(-?\d*)$/.exec(dateFilter);
  if (!m) return null;
  const start = m[1] ? Number(m[1]) : null;
  const end = m[2] ? Number(m[2]) : null;
  if (start !== null && end !== null && end <= start) return null;
  return { start, end };
}

/** Window a date filter covers at `now` (seconds); null for "All Time" or an unknown filter. */
export function dateWindow(dateFilter: string | null | undefined, now = Date.now() / 1000): DateWindow | null {
  if (!dateFilter || dateFilter === "All Time") return null;
  if (isRangeFilter(dateFilter)) return parseRange(dateFilter);
  if (dateFilter in DATE_FILTER_SECONDS) return { start: now - DATE_FILTER_SECONDS[dateFilter], end: null };
  if (dateFilter === "This Year") {
    return { start: new Date(new Date(now * 1000).getFullYear(), 0, 1).getTime() / 1000, end: null };
  }
  return null;
}

/**
 * The equally long window right before the filter's window, as a range filter,
 * so "last 30 days" can be compared with the 30 days before. Null when the
 * filter has no finite window to mirror.
 */
export function previousDateFilter(dateFilter: string | null | undefined, now = Date.now() / 1000): string | null {
  const w = dateWindow(dateFilter, now);
  if (!w || w.start === null) return null;
  const end = w.end ?? now;
  return rangeFilter(w.start - (end - w.start), w.start);
}

/**
 * When the game was played (epoch seconds). The PGN date comes first: the
 * stored `timestamp` is the save time, so a fresh import of old games would
 * otherwise land entirely in "last 7 days". It stays the fallback for games
 * without a usable date.
 */
export function extractGameTimestamp(game: FilterableGame): number | null {
  const played = parsePlayedAt({ pgn: game.pgn ?? undefined, date: game.date ?? undefined });
  if (played !== null) return played;

  const dateStr = String(game.date ?? "").trim();
  if (/^\d{4}([.-]|$)/.test(dateStr) && !/^\d{4}[.-]\d{2}[.-]\d{2}/.test(dateStr)) {
    // Only the year is known ("2024.??.??").
    return Date.UTC(Number(dateStr.slice(0, 4)), 0, 1) / 1000;
  }

  const ts = game.timestamp;
  if (ts !== null && ts !== undefined && ts !== "") {
    const n = Number(ts);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function isValidDateFilter(dateFilter: string): boolean {
  return VALID_DATE_FILTERS.has(dateFilter) || (isRangeFilter(dateFilter) && parseRange(dateFilter) !== null);
}

function withinDate(dateFilter: string, ts: number | null, now?: number): boolean {
  if (dateFilter === "All Time" || !dateFilter) return true;
  if (!isValidDateFilter(dateFilter)) return false;
  if (ts === null) return false;
  const w = dateWindow(dateFilter, now);
  if (!w) return false;
  return (w.start === null || ts >= w.start) && (w.end === null || ts < w.end);
}

/** True when the game falls inside the date filter (any player, no other criteria). */
export function inDateFilter(game: FilterableGame, dateFilter: string, now?: number): boolean {
  return withinDate(dateFilter, extractGameTimestamp(game), now);
}

/** 'white', 'black', or null when neither side is one of the tracked usernames. */
export function getUserColor(
  game: FilterableGame,
  usernames: Iterable<string>,
): "white" | "black" | null {
  const lower = new Set([...usernames].map((u) => u.toLowerCase()));
  if (lower.has((game.white || "").toLowerCase())) return "white";
  if (lower.has((game.black || "").toLowerCase())) return "black";
  return null;
}

export function matchesFilters(
  game: FilterableGame,
  userColor: string | null,
  colorFilter = "All Colors",
  formatFilter = "All Formats",
  sourceFilter = "All Sources",
  dateFilter = "All Time",
  now?: number,
): boolean {
  if (userColor !== "white" && userColor !== "black") return false;

  if (colorFilter === "White" && userColor !== "white") return false;
  if (colorFilter === "Black" && userColor !== "black") return false;

  const is960 = Boolean(game.chess960);
  if (formatFilter === "Freestyle (Chess960)") {
    if (!is960) return false;
  } else {
    if (is960 && formatFilter !== "All Formats") return false;
    if (formatFilter !== "All Formats") {
      let speed = (game.speed_category || "").trim();
      if (!speed) speed = detectSpeedCategory(game.time_control, game.event);
      if (speed.toLowerCase() !== formatFilter.toLowerCase()) return false;
    }
  }

  if (sourceFilter !== "All Sources") {
    const src = (game.source || "file").toLowerCase();
    const target = sourceFilter.toLowerCase();
    if (target.includes("chess") && !target.includes("lichess")) {
      if (
        src.includes("lichess") ||
        !(src.includes("chesscom") || src.includes("chess.com") || src === "chess")
      ) {
        return false;
      }
    } else if (target.includes("lichess")) {
      if (!src.includes("lichess")) return false;
    } else if (target.includes("file") && !["file", "pgn", "local", "text"].includes(src)) {
      return false;
    }
  }

  if (dateFilter !== "All Time" && !inDateFilter(game, dateFilter, now)) return false;
  return true;
}

/** Filter games by user-specified criteria, returning [game, userColor] pairs. */
export function filterGames<G extends FilterableGame>(
  games: G[],
  usernames: Iterable<string>,
  colorFilter = "All Colors",
  formatFilter = "All Formats",
  sourceFilter = "All Sources",
  dateFilter = "All Time",
): Array<[G, "white" | "black"]> {
  const names = [...usernames];
  const now = Date.now() / 1000;
  const matched: Array<[G, "white" | "black"]> = [];
  for (const g of games) {
    const color = getUserColor(g, names);
    if (color === null) continue;
    if (matchesFilters(g, color, colorFilter, formatFilter, sourceFilter, dateFilter, now)) {
      matched.push([g, color]);
    }
  }
  return matched;
}
