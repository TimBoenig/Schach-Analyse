// Game filtering and user color resolution (port of src/backend/analysis/metrics/filters.py).

import { VALID_DATE_FILTERS } from "./constants";
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
}

const DATE_FILTER_SECONDS: Record<string, number> = {
  "Last 24 Hours": 86400,
  "Last 7 Days": 7 * 86400,
  "Last 30 Days": 30 * 86400,
  "Last 90 Days": 90 * 86400,
};

/** Extract a Unix epoch timestamp (seconds) from a game record. */
export function extractGameTimestamp(game: FilterableGame): number | null {
  const ts = game.timestamp;
  if (ts !== null && ts !== undefined && ts !== "") {
    const n = Number(ts);
    if (Number.isFinite(n)) return n;
  }

  const dateStr = String(game.date ?? "").trim();
  if (dateStr) {
    const d = dateStr.replace(/\./g, "-");
    if (d.length >= 10) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.slice(0, 10));
      if (m) {
        const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
        const dt = new Date(Date.UTC(y, mo - 1, da));
        if (dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === da) return dt.getTime() / 1000;
      }
    } else if (d.length >= 4 && /^\d{4}$/.test(d.slice(0, 4))) {
      return Date.UTC(Number(d.slice(0, 4)), 0, 1) / 1000;
    }
  }
  return null;
}

function withinDate(dateFilter: string, ts: number | null, now?: number): boolean {
  if (dateFilter === "All Time" || !dateFilter) return true;
  if (!VALID_DATE_FILTERS.has(dateFilter)) return false;
  if (ts === null) return false;

  const current = now ?? Date.now() / 1000;
  if (dateFilter in DATE_FILTER_SECONDS) return current - ts <= DATE_FILTER_SECONDS[dateFilter];
  if (dateFilter === "This Year") {
    return new Date(ts * 1000).getFullYear() === new Date(current * 1000).getFullYear();
  }
  return false;
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

  if (dateFilter !== "All Time") {
    if (!withinDate(dateFilter, extractGameTimestamp(game), now)) return false;
  }
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
