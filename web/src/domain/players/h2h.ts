// Head-to-head results between two players and the user's most frequent
// opponents. Needs no engine analysis: only names, results and dates.

import { filterGames } from "../metrics/filters";
import { outcomeFor, type RawGame } from "../metrics/models";
import { parsePlayedAt } from "../metrics/played";

export interface H2HGame {
  id: string;
  date: string;
  played_at: number | null;
  /** Colour of the first player (`a`). */
  color: "white" | "black";
  /** Points of the first player: 1, 0.5 or 0. */
  score: number;
  opening: string;
  speed: string;
}

export interface HeadToHead {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** Points of the first player in percent (null without finished games). */
  score_pct: number | null;
  /** Newest first. */
  recent: H2HGame[];
}

const POINTS = { win: 1, draw: 0.5, loss: 0 } as const;
const lowerSet = (names: Iterable<string>) => new Set([...names].map((n) => n.toLowerCase()));

/** Finished games between `a` and `b` from a's perspective, within the filters. */
export function headToHead(
  games: RawGame[],
  a: Iterable<string>,
  b: Iterable<string>,
  formatFilter = "All Formats",
  dateFilter = "All Time",
): HeadToHead {
  const other = lowerSet(b);
  const out: HeadToHead = { games: 0, wins: 0, draws: 0, losses: 0, score_pct: null, recent: [] };
  for (const [g, color] of filterGames(games, a, "All Colors", formatFilter, "All Sources", dateFilter)) {
    const opp = String((color === "white" ? g.black : g.white) ?? "").toLowerCase();
    if (!other.has(opp)) continue;
    const o = outcomeFor(g.result, color);
    if (!o) continue;
    out.games++;
    if (o === "win") out.wins++;
    else if (o === "draw") out.draws++;
    else out.losses++;
    out.recent.push({
      id: String(g.id ?? ""),
      date: String(g.date ?? ""),
      played_at: parsePlayedAt(g),
      color,
      score: POINTS[o],
      opening: String(g.opening ?? ""),
      speed: String(g.speed_category ?? ""),
    });
  }
  if (out.games) out.score_pct = ((out.wins + out.draws / 2) / out.games) * 100;
  out.recent.sort((x, y) => (y.played_at ?? 0) - (x.played_at ?? 0) || y.date.localeCompare(x.date));
  return out;
}

export interface FrequentOpponent {
  username: string;
  games: number;
  /** The user's points against them in percent. */
  score_pct: number | null;
  last_played: number | null;
}

/** Opponents the user met at least `min` times, most games first (for quick adding). */
export function frequentOpponents(games: RawGame[], mine: Iterable<string>, exclude: Iterable<string> = [], min = 2): FrequentOpponent[] {
  const skip = lowerSet(exclude);
  const by = new Map<string, { username: string; games: number; points: number; finished: number; last: number | null }>();
  for (const [g, color] of filterGames(games, mine)) {
    const name = String((color === "white" ? g.black : g.white) ?? "").trim();
    if (!name || name === "?" || skip.has(name.toLowerCase())) continue;
    const key = name.toLowerCase();
    const e = by.get(key) ?? { username: name, games: 0, points: 0, finished: 0, last: null };
    e.games++;
    const o = outcomeFor(g.result, color);
    if (o) {
      e.finished++;
      e.points += POINTS[o];
    }
    const at = parsePlayedAt(g);
    if (at !== null && (e.last === null || at > e.last)) e.last = at;
    by.set(key, e);
  }
  return [...by.values()]
    .filter((e) => e.games >= min)
    .map((e) => ({
      username: e.username,
      games: e.games,
      score_pct: e.finished ? (e.points / e.finished) * 100 : null,
      last_played: e.last,
    }))
    .sort((x, y) => y.games - x.games || (y.last_played ?? 0) - (x.last_played ?? 0));
}
