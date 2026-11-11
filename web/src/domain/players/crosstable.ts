// The group's crosstable: every pair's direct games in one grid, like the
// table of a round-robin tournament, and what stands out in it (your hardest
// and your favourite opponent, the closest rivalry, running streaks).
//
// Scores between two players are facts; whether one is truly the stronger in
// a pairing is judged like the battle's direct-encounter round (pairEstimate),
// so "clear" is only said at SURE_P.

import type { Outcome, RawGame } from "../metrics/models";
import { pairEstimate } from "./battle";
import { SURE_P } from "./compare";
import { headToHead, type HeadToHead } from "./h2h";

export interface CrossMember {
  id: string;
  name: string;
  is_me: boolean;
  usernames: string[];
}

export interface CrossCell {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** Points of the row player. */
  points: number;
  score_pct: number | null;
  /** Chance that the row player is truly the stronger one in this pairing (null without games). */
  p_row: number | null;
  /** Current run from the row player's view, e.g. three wins in a row (null below two). */
  streak: { kind: Outcome; count: number } | null;
  /** Newest first, from the row player's view (at most five). */
  last: Outcome[];
}

export interface Crosstable {
  members: { id: string; name: string; is_me: boolean }[];
  /** cells[row][col]; null on the diagonal. */
  cells: (CrossCell | null)[][];
  /** Each member's points in all direct games inside the group. */
  totals: { points: number; games: number; score_pct: number | null }[];
  total_games: number;
}

/** Pairings need this many games before they are named as hardest or favourite opponent. */
export const MIN_PAIR_GAMES = 5;
// A rivalry needs a few more games and stays close: within this many points of 50 %.
const MIN_RIVALRY_GAMES = 6;
const CLOSE_PCT = 15;

const outcome = (score: number): Outcome => (score === 1 ? "win" : score === 0 ? "loss" : "draw");

function cellOf(h: HeadToHead): CrossCell {
  const last = h.recent.slice(0, 5).map((g) => outcome(g.score));
  let streak: CrossCell["streak"] = null;
  if (h.recent.length) {
    const kind = outcome(h.recent[0].score);
    let count = 0;
    while (count < h.recent.length && outcome(h.recent[count].score) === kind) count++;
    if (count >= 2) streak = { kind, count };
  }
  return {
    games: h.games,
    wins: h.wins,
    draws: h.draws,
    losses: h.losses,
    points: h.wins + h.draws / 2,
    score_pct: h.score_pct,
    p_row: pairEstimate(h)?.p ?? null,
    streak,
    last,
  };
}

const flipOutcome = (o: Outcome): Outcome => (o === "win" ? "loss" : o === "loss" ? "win" : "draw");

function mirror(c: CrossCell): CrossCell {
  return {
    games: c.games,
    wins: c.losses,
    draws: c.draws,
    losses: c.wins,
    points: c.games - c.points,
    score_pct: c.score_pct === null ? null : 100 - c.score_pct,
    p_row: c.p_row === null ? null : 1 - c.p_row,
    streak: c.streak ? { kind: flipOutcome(c.streak.kind), count: c.streak.count } : null,
    last: c.last.map(flipOutcome),
  };
}

/** Every pair's direct games inside the filters (each pair is counted once and mirrored). */
export function buildCrosstable(members: CrossMember[], games: RawGame[], format = "All Formats", date = "All Time"): Crosstable {
  const n = members.length;
  const cells: (CrossCell | null)[][] = members.map(() => new Array<CrossCell | null>(n).fill(null));
  let total = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = cellOf(headToHead(games, members[i].usernames, members[j].usernames, format, date));
      cells[i][j] = c;
      cells[j][i] = mirror(c);
      total += c.games;
    }
  }
  const totals = cells.map((row) => {
    const games = row.reduce((s, c) => s + (c?.games ?? 0), 0);
    const points = row.reduce((s, c) => s + (c?.points ?? 0), 0);
    return { points, games, score_pct: games ? (points / games) * 100 : null };
  });
  return { members: members.map(({ id, name, is_me }) => ({ id, name, is_me })), cells, totals, total_games: total };
}

export interface CrossHighlight {
  kind: "nemesis" | "favorite" | "rivalry" | "streak";
  a: { id: string; name: string; is_me: boolean };
  b: { id: string; name: string; is_me: boolean };
  /** The pairing from a's side. */
  cell: CrossCell;
  /** The lead is beyond chance (SURE_P); always false for rivalries and streaks. */
  clear: boolean;
}

/**
 * What stands out: your hardest and your favourite opponent (from
 * MIN_PAIR_GAMES games on), the closest rivalry with the most games, and the
 * longest winning run going on right now.
 */
export function crossHighlights(t: Crosstable): CrossHighlight[] {
  const out: CrossHighlight[] = [];
  const me = t.members.findIndex((m) => m.is_me);
  const pair = (i: number, j: number) => ({ a: t.members[i], b: t.members[j], cell: t.cells[i][j] as CrossCell });
  if (me >= 0) {
    const mine = t.cells[me]
      .map((c, j) => ({ c, j }))
      .filter((x): x is { c: CrossCell; j: number } => x.c !== null && x.c.games >= MIN_PAIR_GAMES && x.c.score_pct !== null);
    const worst = [...mine].sort((x, y) => (x.c.score_pct as number) - (y.c.score_pct as number) || y.c.games - x.c.games)[0];
    if (worst && (worst.c.score_pct as number) < 50) {
      out.push({ kind: "nemesis", ...pair(me, worst.j), clear: (worst.c.p_row ?? 0.5) <= 1 - SURE_P });
    }
    const best = [...mine].sort((x, y) => (y.c.score_pct as number) - (x.c.score_pct as number) || y.c.games - x.c.games)[0];
    if (best && (best.c.score_pct as number) > 50) {
      out.push({ kind: "favorite", ...pair(me, best.j), clear: (best.c.p_row ?? 0.5) >= SURE_P });
    }
  }
  let rival: { i: number; j: number; c: CrossCell } | null = null;
  let streak: { i: number; j: number; c: CrossCell } | null = null;
  for (let i = 0; i < t.members.length; i++) {
    for (let j = i + 1; j < t.members.length; j++) {
      const c = t.cells[i][j] as CrossCell;
      if (c.games >= MIN_RIVALRY_GAMES && c.score_pct !== null && Math.abs(c.score_pct - 50) <= CLOSE_PCT) {
        if (!rival || c.games > rival.c.games || (c.games === rival.c.games && Math.abs(c.score_pct - 50) < Math.abs((rival.c.score_pct as number) - 50))) {
          rival = { i, j, c };
        }
      }
      // A winning run counts from the winner's side.
      for (const [a, b] of [
        [i, j],
        [j, i],
      ]) {
        const s = (t.cells[a][b] as CrossCell).streak;
        if (s && s.kind === "win" && s.count >= 3 && (!streak || s.count > (streak.c.streak as { count: number }).count)) {
          streak = { i: a, j: b, c: t.cells[a][b] as CrossCell };
        }
      }
    }
  }
  if (rival) out.push({ kind: "rivalry", ...pair(rival.i, rival.j), clear: false });
  if (streak) out.push({ kind: "streak", ...pair(streak.i, streak.j), clear: false });
  return out;
}
