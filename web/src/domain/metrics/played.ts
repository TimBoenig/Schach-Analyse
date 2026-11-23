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
    const tk = /^(\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(timeStr);
    if (!tk) return null;
    [h, mi, s] = [Number(tk[1]), Number(tk[2]), Number(tk[3])];
    if (h > 23 || mi > 59 || s > 61) return null;
  }
  const dt = new Date(Date.UTC(y, mo - 1, da, h, mi, s));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== da) return null;
  return dt.getTime() / 1000;
}

function readHeaders(pgn: string | undefined | null): Record<string, string> {
  const headers: Record<string, string> = {};
  let count = 0;
  for (const m of (pgn || "").matchAll(HEADER_RE)) {
    if (count++ >= 60) break;
    headers[m[1]] = m[2];
  }
  return headers;
}

/**
 * Best-effort start time of the game as a UTC epoch (seconds).
 *
 * The stored 'timestamp' is the save time, not the play time, so session and
 * trend analysis must use the PGN UTCDate/UTCTime headers instead.
 */
export function parsePlayedAt(game: Pick<RawGame, "pgn" | "date">): number | null {
  const headers = readHeaders(game.pgn);
  let dateStr = headers.UTCDate || game.date || headers.Date || "";
  const timeStr = headers.UTCTime || headers.StartTime || "12:00:00";
  dateStr = dateStr.replace(/-/g, ".");
  if (!/^\d{4}\.\d{2}\.\d{2}$/.test(dateStr)) return null;
  return parseUtc(dateStr, timeStr.slice(0, 8)) ?? parseUtc(dateStr, null);
}

/**
 * When the game ended (UTC epoch seconds), from the EndDate/EndTime headers
 * (chess.com always writes them; the Lichess import adds them from the last
 * move). Null when the PGN carries no end.
 */
export function parseEndedAt(game: Pick<RawGame, "pgn">): number | null {
  const h = readHeaders(game.pgn);
  const dateStr = (h.EndDate ?? "").replace(/-/g, ".");
  if (!/^\d{4}\.\d{2}\.\d{2}$/.test(dateStr)) return null;
  return parseUtc(dateStr, (h.EndTime || "12:00:00").slice(0, 8)) ?? parseUtc(dateStr, null);
}

/**
 * The moment a game belongs to in lists and timelines: when it ended, else
 * when it started. A correspondence game that runs for weeks must sit where
 * it was finished, otherwise it hides far down the list behind games that
 * began after it but were played out sooner.
 */
export function parseFinishedAt(game: Pick<RawGame, "pgn" | "date">): number | null {
  return parseEndedAt(game) ?? parsePlayedAt(game);
}

/** "YYYY.MM.DD" of the end (UTC) for list headers, falling back to the start date. */
export function finishedDate(game: Pick<RawGame, "pgn" | "date">): string {
  const at = parseEndedAt(game);
  if (at === null) return game.date ?? "";
  const d = new Date(at * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}`;
}
