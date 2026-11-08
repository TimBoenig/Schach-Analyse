// Insights on top of the friends ranking: where the user stands in the group,
// which friend is clearly better at something (so the user knows whose games
// to look at), who is on a run lately, and how two players do in the openings
// they both play.
//
// Every statement passes the same uncertainty checks as the ranking: a lead
// only counts at SURE_P (95 %) chance of being truly better, openings only
// from MIN_LINE_GAMES games per player and with a significant score gap.

import { filterGames } from "../metrics/filters";
import { type RawGame } from "../metrics/models";
import { parsePlayedAt } from "../metrics/played";
import { MIN_LINE_GAMES, scoresDiffer } from "../profile/evidence";
import type { PlayerProfile } from "../profile/models";
import { openingLabel, type OpeningStat } from "../profile/openings";
import { type Estimate, probBetter, SURE_P } from "./compare";
import { mainSource } from "./h2h";
import type { RankInput, Ranking, RankRow } from "./ranking";

// Factors that describe how someone plays. Rating, raw score, direct encounters
// and activity are results or habits, nothing one can copy from a friend.
const SKILL_LIKE = ["accuracy", "blunders", "expectation", "opening", "middlegame", "endgame", "tactics", "safety", "conversion", "defense", "time"];

export interface GroupPoint {
  key: string;
  label: string;
  higher_is_better: boolean;
  mine: number;
  /** The friend clearly ahead of the user (learn), or the runner-up (edges). */
  other_id: string;
  other_name: string;
  other: number;
  /** Chance the leader is truly better than the other side. */
  p: number;
}

export interface GroupStanding {
  /** Players in the comparison, the user included. */
  members: number;
  /** Factors where the user is clearly better than every friend with data. */
  edges: GroupPoint[];
  /** Factors where a friend is clearly better than the user, the clearest gap first. */
  learn: GroupPoint[];
}

const estOf = (r: RankRow, key: string): Estimate | null => {
  const c = r.cells[key];
  return c && c.value !== null && c.se !== null ? { value: c.value, se: c.se } : null;
};

/** Your clear strengths and weaknesses inside the group, from the ranking's estimates. */
export function groupStanding(ranking: Ranking, limit = 3): GroupStanding | null {
  const me = ranking.rows.find((r) => r.is_me);
  if (!me) return null;
  const friends = ranking.rows.filter((r) => !r.is_me);
  const edges: GroupPoint[] = [];
  const learn: GroupPoint[] = [];
  for (const f of ranking.factors) {
    if (!SKILL_LIKE.includes(f.key)) continue;
    const mine = estOf(me, f.key);
    if (!mine) continue;
    const others = friends
      .map((r) => ({ r, est: estOf(r, f.key) }))
      .filter((x): x is { r: RankRow; est: Estimate } => x.est !== null)
      .map((x) => ({ ...x, pThem: probBetter(x.est, mine, f.higher_is_better) }));
    if (!others.length) continue;
    const base = { key: f.key, label: f.label, higher_is_better: f.higher_is_better, mine: mine.value };
    // The friend most likely better than you here: if even they are clearly
    // behind, it is your edge; if they are clearly ahead, learn from them.
    const top = others.reduce((a, b) => (b.pThem > a.pThem ? b : a));
    const point = { ...base, other_id: top.r.id, other_name: top.r.name, other: top.est.value };
    if (1 - top.pThem >= SURE_P) edges.push({ ...point, p: 1 - top.pThem });
    else if (top.pThem >= SURE_P) learn.push({ ...point, p: top.pThem });
  }
  const gap = (g: GroupPoint) => Math.abs(g.other - g.mine) / (Math.abs(g.mine) + 1);
  const order = (a: GroupPoint, b: GroupPoint) => b.p - a.p || gap(b) - gap(a);
  return { members: ranking.rows.length, edges: edges.sort(order).slice(0, limit), learn: learn.sort(order).slice(0, limit) };
}

// ---------- form ----------

export const FORM_DAYS = 30;
/** Rated games in the window before a rating change is shown. */
export const FORM_MIN_GAMES = 5;

export interface FormRow {
  id: string;
  name: string;
  is_me: boolean;
  /** English speed key of the player's main time control. */
  speed: string;
  source: string;
  rating: number;
  /** Change over the window: last rating minus the last one before it. */
  delta: number;
  games: number;
}

const eloOf = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Rating change of every player over the last FORM_DAYS days, in their main
 * time control on their main platform only: Lichess and Chess.com ratings (and
 * Blitz and Rapid) differ by hundreds of points, mixing them fakes huge jumps.
 * Players with fewer than FORM_MIN_GAMES rated games in the window are left out.
 */
export function groupForm(inputs: Pick<RankInput, "id" | "name" | "is_me" | "usernames">[], games: RawGame[], now = Date.now() / 1000): FormRow[] {
  const from = now - FORM_DAYS * 86400;
  const rows: FormRow[] = [];
  for (const inp of inputs) {
    const source = mainSource(games, inp.usernames);
    const own = filterGames(games, inp.usernames).filter(([g]) => String(g.source ?? "file") === source);
    const recent = own.filter(([g]) => (parsePlayedAt(g) ?? 0) >= from);
    const bySpeed = new Map<string, number>();
    for (const [g] of recent) if (g.speed_category) bySpeed.set(g.speed_category, (bySpeed.get(g.speed_category) ?? 0) + 1);
    const speed = [...bySpeed.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!speed) continue;
    const points = own
      .filter(([g]) => g.speed_category === speed)
      .map(([g, color]) => ({ at: parsePlayedAt(g), elo: eloOf(color === "white" ? g.white_elo : g.black_elo) }))
      .filter((x): x is { at: number; elo: number } => x.at !== null && x.elo !== null && x.at <= now)
      .sort((a, b) => a.at - b.at);
    const inWindow = points.filter((x) => x.at >= from);
    if (inWindow.length < FORM_MIN_GAMES) continue;
    const before = points.filter((x) => x.at < from).at(-1) ?? inWindow[0];
    const last = inWindow[inWindow.length - 1];
    rows.push({ id: inp.id, name: inp.name, is_me: inp.is_me, speed, source, rating: last.elo, delta: last.elo - before.elo, games: inWindow.length });
  }
  return rows.sort((a, b) => b.delta - a.delta || a.name.localeCompare(b.name));
}

// ---------- shared openings ----------

export interface SharedOpening {
  name: string;
  color: "white" | "black";
  mine: { games: number; score_pct: number };
  theirs: { games: number; score_pct: number };
  /** Who clearly scores better (null: within noise). */
  better: "me" | "them" | null;
}

/** Openings both play with the same colour, each from MIN_LINE_GAMES games on; most played first. */
export function sharedOpenings(me: PlayerProfile, them: PlayerProfile, limit = 5): SharedOpening[] {
  const out: SharedOpening[] = [];
  for (const color of ["white", "black"] as const) {
    const theirs = new Map((them.openings?.[color] ?? []).map((o) => [o.name, o]));
    for (const a of me.openings?.[color] ?? []) {
      const b = theirs.get(a.name) as OpeningStat | undefined;
      if (!b || a.score_pct === null || b.score_pct === null || a.games < MIN_LINE_GAMES || b.games < MIN_LINE_GAMES) continue;
      const differ = scoresDiffer(a, b, undefined, MIN_LINE_GAMES);
      out.push({
        name: openingLabel(a.name),
        color,
        mine: { games: a.games, score_pct: a.score_pct },
        theirs: { games: b.games, score_pct: b.score_pct },
        better: differ ? (a.score_pct > b.score_pct ? "me" : "them") : null,
      });
    }
  }
  return out.sort((x, y) => y.mine.games + y.theirs.games - (x.mine.games + x.theirs.games)).slice(0, limit);
}
