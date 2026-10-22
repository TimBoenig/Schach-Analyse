// When a game was played, read from its PGN headers. Lives in metrics because
// the date filter needs it as much as the profile's trend and session analysis.

import type { RawGame } from "./models";

const HEADER_RE = /\[(\w+)\s+"([^"]*)"\]/g;

function parseUtc(dateStr: string, timeStr: string | null): number | null {
  const d = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(dateStr);
  if (!d) return null;
  const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])];
  let h = 0;
  let mi = 0;
  let s = 0;
  if (timeStr !== null) {
    const t = /^(\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(timeStr);
    if (!t) return null;
    [h, mi, s] = [Number(t[1]), Number(t[2]), Number(t[3])];
    if (h > 23 || mi > 59 || s > 61) return null;
  }
  const dt = new Date(Date.UTC(y, mo - 1, da, h, mi, s));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== da) return null;
  return dt.getTime() / 1000;
}

/**
 * Best-effort start time of the game as a UTC epoch (seconds).
 *
 * The stored 'timestamp' is the save time, not the play time, so session and
 * trend analysis must use the PGN UTCDate/UTCTime headers instead.
 */
export function parsePlayedAt(game: Pick<RawGame, "pgn" | "date">): number | null {
  const headers: Record<string, string> = {};
  let count = 0;
  for (const m of (game.pgn || "").matchAll(HEADER_RE)) {
    if (count++ >= 40) break;
    headers[m[1]] = m[2];
  }
  let dateStr = headers.UTCDate || game.date || headers.Date || "";
  const timeStr = headers.UTCTime || headers.StartTime || "12:00:00";
  dateStr = dateStr.replace(/-/g, ".");
  if (!/^\d{4}\.\d{2}\.\d{2}$/.test(dateStr)) return null;
  return parseUtc(dateStr, timeStr.slice(0, 8)) ?? parseUtc(dateStr, null);
}
