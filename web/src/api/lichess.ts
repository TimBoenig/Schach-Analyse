// Port of src/backend/api/lichess_api.py. Games are normalized to the
// chess.com archive shape so callers can treat both sources alike.
//
// GET requests omit the desktop app's Content-Type header: it is meaningless
// without a body and would force a CORS preflight in the browser.

import type { RatingStat, UserProfile } from "./chesscom";
import { asRecord, logApiError, makeRequest, safeJson } from "./base";

export const LICHESS_BASE_URL = "https://lichess.org/api/games/user";
export const LICHESS_USER_URL = "https://lichess.org/api/user";
export const LICHESS_EXPORT_URL = "https://lichess.org/game/export";

export interface LichessGame {
  white: { username: string; rating: number | string; result: string };
  black: { username: string; rating: number | string; result: string };
  time_class: string;
  end_time: number;
  pgn: string;
  url: string;
}

export interface LichessGameExport {
  pgn: string;
  id: string | undefined;
  white: string;
  black: string;
  white_rating: number | undefined;
  black_rating: number | undefined;
}

export interface LichessOptions {
  /** Personal API token (optional; raises rate limits, allows private games). */
  token?: string | null;
}

export interface CallOptions {
  signal?: AbortSignal;
}

const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
const optNum = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

function normalizeGame(raw: unknown): LichessGame {
  const g = asRecord(raw);
  const players = asRecord(g.players);
  const side = (color: "white" | "black") => {
    const p = asRecord(players[color]);
    const rating = p.rating;
    return {
      username: str(asRecord(p.user).name, "?"),
      rating: typeof rating === "number" || typeof rating === "string" ? rating : "?",
      result: g.winner === color ? "win" : g.status === "mate" ? "checkmated" : "agreed",
    };
  };
  return {
    white: side("white"),
    black: side("black"),
    time_class: str(g.speed, "standard"),
    end_time: Math.trunc((optNum(g.createdAt) ?? 0) / 1000),
    pgn: str(g.pgn, ""),
    url: `https://lichess.org/${String(g.id)}`,
  };
}

function parseNdjson(text: string): LichessGame[] {
  const games: LichessGame[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      games.push(normalizeGame(JSON.parse(line)));
    } catch {
      // Skip malformed lines like the desktop app.
    }
  }
  return games;
}

export class LichessAPI {
  private readonly token: string | null;

  constructor(options: LichessOptions = {}) {
    this.token = options.token?.trim() || null;
  }

  getHeaders(accept = "application/x-ndjson"): Record<string, string> {
    const headers: Record<string, string> = { Accept: accept };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  /** Last `maxGames` games of a user (with clocks), newest first. */
  async getUserGames(username: string, maxGames = 20, opts: CallOptions = {}): Promise<LichessGame[]> {
    try {
      const resp = await makeRequest(`${LICHESS_BASE_URL}/${encodeURIComponent(username)}`, {
        headers: this.getHeaders(),
        params: { max: maxGames, moves: "true", opening: "true", pgnInJson: "true", clocks: "true" },
        signal: opts.signal,
      });
      return resp ? parseNdjson(await resp.text()) : [];
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      logApiError("Lichess", "get_user_games", err);
      return [];
    }
  }

  /** Games of a user played on the given local calendar day. */
  async getUserGamesByDate(username: string, date: Date, opts: CallOptions = {}): Promise<LichessGame[]> {
    try {
      const since = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      const until = since + 86_400_000 - 1;
      const resp = await makeRequest(`${LICHESS_BASE_URL}/${encodeURIComponent(username)}`, {
        headers: this.getHeaders(),
        params: {
          since,
          until,
          moves: "true",
          opening: "true",
          pgnInJson: "true",
          clocks: "true",
          max: 100,
        },
        signal: opts.signal,
      });
      return resp ? parseNdjson(await resp.text()) : [];
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      logApiError("Lichess", "get_user_games_by_date", err);
      return [];
    }
  }

  /** Extracts the 8-character game id from a lichess game URL ("" if none). */
  extractGameId(url: string): string {
    if (!url.toLowerCase().includes("lichess.org")) return "";
    const parts = url.replace(/\/$/, "").split("/");
    let id = parts[parts.length - 1];
    if (["white", "black"].includes(id.toLowerCase()) && parts.length > 1) id = parts[parts.length - 2];
    return id.length >= 8 ? id.slice(0, 8) : "";
  }

  /** Exports one game with clocks and evals; returns null on failure. */
  async getGameById(gameId: string, opts: CallOptions = {}): Promise<LichessGameExport | null> {
    try {
      const resp = await makeRequest(`${LICHESS_EXPORT_URL}/${encodeURIComponent(gameId)}`, {
        headers: this.getHeaders("application/json"),
        params: { moves: "true", pgnInJson: "true", clocks: "true", evals: "true" },
        signal: opts.signal,
      });
      const data = asRecord(await safeJson(resp));
      if (!Object.keys(data).length) return null;
      const players = asRecord(data.players);
      const white = asRecord(players.white);
      const black = asRecord(players.black);
      return {
        pgn: str(data.pgn, ""),
        id: typeof data.id === "string" ? data.id : undefined,
        white: str(asRecord(white.user).name, "?"),
        black: str(asRecord(black.user).name, "?"),
        white_rating: optNum(white.rating),
        black_rating: optNum(black.rating),
      };
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      console.error(`Error fetching game ${gameId}: ${String(err)}`);
      return null;
    }
  }

  /** Public profile and ratings, normalized like the chess.com profile. */
  async getUserProfile(username: string, opts: CallOptions = {}): Promise<UserProfile | null> {
    const clean = username.trim().toLowerCase();
    if (!clean) return null;
    const resp = await makeRequest(`${LICHESS_USER_URL}/${encodeURIComponent(clean)}`, {
      headers: this.getHeaders("application/json"),
      signal: opts.signal,
    });
    const data = asRecord(await safeJson(resp));
    if (!Object.keys(data).length) return null;
    const perfs = asRecord(data.perfs);
    const perf = (key: string): RatingStat => {
      const item = asRecord(perfs[key]);
      return { rating: optNum(item.rating), peak: null, games: optNum(item.games) ?? 0 };
    };
    const counts = asRecord(data.count);
    const total = optNum(counts.all) ?? 0;
    const win = optNum(counts.win) ?? 0;
    const optStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
    return {
      platform: "lichess",
      username: optStr(data.username) ?? clean,
      title: optStr(data.title),
      avatar: null,
      country: optStr(asRecord(data.profile).country),
      joined: optNum(data.createdAt),
      url: optStr(data.url),
      bullet: perf("bullet"),
      blitz: perf("blitz"),
      rapid: perf("rapid"),
      classical: perf("classical"),
      puzzle: perf("puzzle"),
      total_games: total,
      win_rate: total > 0 ? (win / total) * 100 : 0,
      record: { win, loss: optNum(counts.loss) ?? 0, draw: optNum(counts.draw) ?? 0 },
    };
  }
}
