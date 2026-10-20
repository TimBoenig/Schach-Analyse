// Port of src/backend/api/chess_com_api.py (chess.com Published-Data API).
//
// The desktop app's HTML-scraping fallback in getGameById is not ported: the
// chess.com website does not send CORS headers, so a browser cannot read it.

import { asRecord, logApiError, makeRequest, safeJson } from "./base";

export const CHESSCOM_BASE_URL = "https://api.chess.com/pub";

/** One game of a monthly archive, as returned by chess.com (untrusted). */
export interface ChesscomGame {
  url?: string;
  pgn?: string;
  end_time?: number;
  rules?: string;
  time_class?: string;
  white?: { username?: string; rating?: number; result?: string };
  black?: { username?: string; rating?: number; result?: string };
  [key: string]: unknown;
}

export interface RatingStat {
  rating: number | null | undefined;
  peak: number | null | undefined;
  games: number;
  win?: number;
  loss?: number;
  draw?: number;
}

export interface UserProfile {
  platform: "chesscom" | "lichess";
  username: string;
  title: string | null | undefined;
  avatar: string | null | undefined;
  country: string | null | undefined;
  joined: number | null | undefined;
  url: string | null | undefined;
  bullet: RatingStat;
  blitz: RatingStat;
  rapid: RatingStat;
  classical: RatingStat;
  puzzle: RatingStat;
  total_games: number;
  win_rate: number;
  record: { win: number; loss: number; draw: number };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const optNum = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const optStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function gamesOf(data: unknown): ChesscomGame[] {
  const games = asRecord(data).games;
  return Array.isArray(games) ? (games.filter((g) => g && typeof g === "object") as ChesscomGame[]) : [];
}

function archivesOf(data: unknown): string[] {
  const archives = asRecord(data).archives;
  return Array.isArray(archives) ? archives.filter((a): a is string => typeof a === "string") : [];
}

export interface CallOptions {
  signal?: AbortSignal;
}

/** Last `limit` games of a user, newest first. */
export async function getLastGames(username: string, limit = 20, opts: CallOptions = {}): Promise<ChesscomGame[]> {
  try {
    const archives = await getArchiveUrls(username, opts);
    const all: ChesscomGame[] = [];
    for (const url of [...archives].reverse()) {
      const resp = await makeRequest(url, { signal: opts.signal });
      const games = gamesOf(await safeJson(resp));
      games.sort((a, b) => num(b.end_time) - num(a.end_time));
      all.push(...games);
      if (all.length >= limit) break;
    }
    return all.slice(0, limit);
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    logApiError("Chess.com", "get_last_games", err);
    return [];
  }
}

/** Monthly archive URLs of a user, oldest first. */
export async function getArchiveUrls(username: string, opts: CallOptions = {}): Promise<string[]> {
  const clean = username.trim().toLowerCase();
  if (!clean) return [];
  const resp = await makeRequest(`${CHESSCOM_BASE_URL}/player/${encodeURIComponent(clean)}/games/archives`, {
    signal: opts.signal,
  });
  return archivesOf(await safeJson(resp));
}

/** All games of one monthly archive that carry a PGN. */
export async function getArchiveGames(archiveUrl: string, opts: CallOptions = {}): Promise<ChesscomGame[]> {
  const resp = await makeRequest(archiveUrl, { signal: opts.signal });
  return gamesOf(await safeJson(resp)).filter((g) => typeof g.pgn === "string" && g.pgn);
}

/** Games of a user that ended on the given calendar day (UTC day window, like the desktop app). */
export async function getUserGamesByDate(username: string, date: Date, opts: CallOptions = {}): Promise<ChesscomGame[]> {
  try {
    const y = date.getFullYear();
    const m = date.getMonth();
    const d = date.getDate();
    const url = `${CHESSCOM_BASE_URL}/player/${encodeURIComponent(username)}/games/${y}/${String(m + 1).padStart(2, "0")}`;
    const games = gamesOf(await safeJson(await makeRequest(url, { signal: opts.signal })));
    const start = Date.UTC(y, m, d) / 1000;
    const end = start + 86400 - 1e-6;
    return games.filter((g) => {
      const t = num(g.end_time);
      return t && start <= t && t <= end;
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    logApiError("Chess.com", "get_user_games_by_date", err);
    return [];
  }
}

/** Finds a game by id in the given player's archives (newest month first). */
export async function getGameById(gameId: string, username?: string | null, opts: CallOptions = {}): Promise<ChesscomGame | null> {
  if (!username) return null;
  try {
    const archives = await getArchiveUrls(username, opts);
    for (const url of [...archives].reverse()) {
      const resp = await makeRequest(url, { signal: opts.signal });
      const game = gamesOf(await safeJson(resp)).find((g) => (g.url ?? "").endsWith(gameId));
      if (game) return game;
    }
    return null;
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    console.error(`Error searching archives: ${String(err)}`);
    return null;
  }
}

/** Extracts the numeric game id from chess.com game URLs (live, daily). */
export function extractGameId(url: string): string | null {
  const match = /(?:game\/live|live\/game|game\/daily)\/(\d+)/.exec(url);
  return match ? match[1] : null;
}

/** Public profile plus rating stats, normalized like the desktop app. */
export async function getUserProfile(username: string, opts: CallOptions = {}): Promise<UserProfile | null> {
  const clean = username.trim().toLowerCase();
  if (!clean) return null;
  const base = `${CHESSCOM_BASE_URL}/player/${encodeURIComponent(clean)}`;
  const prof = asRecord(await safeJson(await makeRequest(base, { signal: opts.signal })));
  if (!Object.keys(prof).length) return null;
  const stats = asRecord(await safeJson(await makeRequest(`${base}/stats`, { signal: opts.signal })));

  const parseStat = (key: string): Required<RatingStat> => {
    const item = asRecord(stats[key]);
    const record = asRecord(item.record);
    const win = num(record.win);
    const loss = num(record.loss);
    const draw = num(record.draw);
    return {
      rating: optNum(asRecord(item.last).rating),
      peak: optNum(asRecord(item.best).rating),
      games: win + loss + draw,
      win,
      loss,
      draw,
    };
  };
  const bullet = parseStat("chess_bullet");
  const blitz = parseStat("chess_blitz");
  const rapid = parseStat("chess_rapid");
  const daily = parseStat("chess_daily");
  const tactics = asRecord(stats.tactics);
  const highest = optNum(asRecord(tactics.highest).rating);
  const lowest = optNum(asRecord(tactics.lowest).rating);

  const all = [bullet, blitz, rapid, daily];
  const sum = (k: "games" | "win" | "loss" | "draw") => all.reduce((acc, s) => acc + s[k], 0);
  const total = sum("games");
  return {
    platform: "chesscom",
    username: optStr(prof.username) ?? clean,
    title: optStr(prof.title),
    avatar: optStr(prof.avatar),
    country: optStr(prof.country),
    joined: optNum(prof.joined),
    url: optStr(prof.url),
    bullet,
    blitz,
    rapid,
    classical: daily,
    puzzle: { rating: highest || lowest, peak: highest, games: 0 },
    total_games: total,
    win_rate: total > 0 ? (sum("win") / total) * 100 : 0,
    record: { win: sum("win"), loss: sum("loss"), draw: sum("draw") },
  };
}
