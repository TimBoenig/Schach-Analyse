// The friends group seen as a league, on top of the ranking: who would win a
// tournament between you, what each player is good at, what it takes to climb
// a place, and who scores more (or less) than their moves suggest.
//
// Everything reads the players' strength estimates (strength.ts) with their
// uncertainty: each player measured on the same absolute scale from their own
// games, so adding or hiding a friend never reorders the others, and nothing
// is claimed from a gap that chance could explain.

import { lichessBlitzToElo } from "../profile/fide";
import { normalCdf } from "./compare";
import { type HeadToHead } from "./h2h";
import type { Ranking, RankRow } from "./ranking";
import {
  type Area,
  AREAS,
  gaussian,
  hashText,
  mulberry32,
  probStronger,
  projectedStrength,
  RESULT_QUALITY_RHO,
  type StrengthEstimate,
  strengthGap,
  strengthSampler,
} from "./strength";

const C = Math.LN10 / 400;
const logistic = (d: number) => 1 / (1 + 10 ** (-d / 400));
type Record3 = Pick<HeadToHead, "games" | "wins" | "draws">;

// ---------- pair forecast ----------

/**
 * How much two particular players may play above or below their strength gap
 * against each other (prior SD, Elo): style matchups exist in chess but are
 * small. With it, the direct games move a forecast by n / (n + ~48) of their
 * surprise: 10 games about a sixth, 50 games about half. A 3:0 between
 * friends is mostly luck, a 30:5 is not.
 */
export const PAIR_SD = 50;
// Two-sided 80 % band: a range people can read as "likely".
const BAND_Z = 1.2816;
// Gauss–Hermite nodes and weights for a standard normal (5 points).
const GH: [number, number][] = [
  [0, 0.5333333],
  [1.3556262, 0.2220759],
  [-1.3556262, 0.2220759],
  [2.8569700, 0.0112574],
  [-2.8569700, 0.0112574],
];

export interface PairForecast {
  /** A's expected score against B (0..1), uncertainty averaged in. */
  p: number;
  /** 80 % band of A's true expected score. */
  low: number;
  high: number;
  /** Expected score from the strength gap alone (before the direct games). */
  start: number | null;
  /** Elo the direct games add to A's side for this pairing (0 without games). */
  shift: number;
  /** Chance that A is the stronger player overall. */
  stronger: number | null;
}

/** The direct games as an extra pairing effect, shrunk with PAIR_SD. Returns Elo shift and its variance. */
export function pairShift(gap: number, h: Record3 | null): { shift: number; variance: number } {
  const n = h?.games ?? 0;
  const e = logistic(gap);
  const info = n * C * C * e * (1 - e) + 1 / PAIR_SD ** 2;
  if (!h || !n) return { shift: 0, variance: PAIR_SD ** 2 };
  const pts = h.wins + h.draws / 2;
  return { shift: (C * (pts - n * e)) / info, variance: 1 / info };
}

/** A's expected score against B: their strength gap plus a shrunk pairing effect from the direct games. */
export function pairForecastOf(a: StrengthEstimate | null, b: StrengthEstimate | null, h: Record3 | null): PairForecast | null {
  if (!a || !b) return null;
  const gap = strengthGap(a, b);
  const pair = pairShift(gap.mean, h);
  const mean = gap.mean + pair.shift;
  const sd = Math.sqrt(gap.sd ** 2 + pair.variance);
  const p = GH.reduce((s, [x, w]) => s + w * logistic(mean + sd * x), 0);
  return { p, low: logistic(mean - BAND_Z * sd), high: logistic(mean + BAND_Z * sd), start: logistic(gap.mean), shift: pair.shift, stronger: probStronger(a, b) };
}

const rowOf = (ranking: Ranking, id: string) => ranking.rows.find((r) => r.id === id) ?? null;

/** A's expected score against B in this ranking (null when either has no strength). */
export function pairForecast(ranking: Ranking, aId: string, bId: string, h2h: Record3 | null): PairForecast | null {
  return pairForecastOf(rowOf(ranking, aId)?.strength ?? null, rowOf(ranking, bId)?.strength ?? null, h2h);
}

// ---------- tournament ----------

export interface TournamentRow {
  id: string;
  name: string;
  is_me: boolean;
  /** Chance to win the tournament (shared first places split the win). */
  win: number;
  /** Chance to finish in the top three. */
  podium: number;
  /** Expected points over the whole tournament. */
  expected: number;
}

export interface Tournament {
  rows: TournamentRow[];
  runs: number;
  /** 2 = everyone plays everyone twice (once with each colour). */
  rounds: number;
  games_each: number;
  /** Draw share used per game: the group's own games, pulled toward a typical share. */
  draw_rate: number;
}

export const TOURNAMENT_RUNS = 5000;
// Online games between club players end drawn about this often; the group's own
// direct games move the share, each counting like one of DRAW_PRIOR games.
const TYPICAL_DRAWS = 0.08;
const DRAW_PRIOR = 30;

/**
 * A round-robin tournament between all ranked players, played many times.
 * Each run first draws everyone's true strength from their estimate (so an
 * uncertain player sometimes is far better or worse than estimated), then
 * every game from the pair's expected score. The chances therefore carry both
 * the luck of the games and how little is known about each player.
 */
export function simulateTournament(
  ranking: Ranking,
  h2hOf: (aId: string, bId: string) => Record3 | null,
  { rounds = 2, runs = TOURNAMENT_RUNS }: { rounds?: number; runs?: number } = {},
): Tournament | null {
  const members = ranking.rows.filter((r): r is RankRow & { strength: StrengthEstimate } => r.strength !== null);
  const n = members.length;
  if (n < 3) return null;
  const pairs: { i: number; j: number; shift: number; shiftSd: number }[] = [];
  let draws = 0;
  let played = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const h = h2hOf(members[i].id, members[j].id);
      if (h) {
        draws += h.draws;
        played += h.games;
      }
      const ps = pairShift(members[i].strength.value - members[j].strength.value, h);
      pairs.push({ i, j, shift: ps.shift, shiftSd: Math.sqrt(ps.variance) });
    }
  }
  const drawRate = (draws + TYPICAL_DRAWS * DRAW_PRIOR) / (played + DRAW_PRIOR);

  const rand = mulberry32(hashText(members.map((m) => m.id).join("|")));
  const sample = strengthSampler(
    members.map((m) => m.strength),
    rand,
  );
  const z = gaussian(rand);
  const wins = new Array<number>(n).fill(0);
  const podium = new Array<number>(n).fill(0);
  const expected = new Array<number>(n).fill(0);
  const pts = new Array<number>(n).fill(0);
  for (let run = 0; run < runs; run++) {
    const theta = sample();
    pts.fill(0);
    for (const pr of pairs) {
      const p = logistic(theta[pr.i] - theta[pr.j] + pr.shift + pr.shiftSd * z());
      // A draw cannot be likelier than twice the weaker side's expected score.
      const draw = Math.min(drawRate, 2 * Math.min(p, 1 - p));
      const win = p - draw / 2;
      expected[pr.i] += (p * rounds) / runs;
      expected[pr.j] += ((1 - p) * rounds) / runs;
      for (let r = 0; r < rounds; r++) {
        const x = rand();
        if (x < win) pts[pr.i] += 1;
        else if (x < win + draw) {
          pts[pr.i] += 0.5;
          pts[pr.j] += 0.5;
        } else pts[pr.j] += 1;
      }
    }
    const best = Math.max(...pts);
    const top = pts.filter((v) => v === best).length;
    for (let i = 0; i < n; i++) {
      if (pts[i] === best) wins[i] += 1 / top;
      if (pts.filter((v) => v > pts[i]).length < 3) podium[i]++;
    }
  }
  const rows = members
    .map((m, i) => ({ id: m.id, name: m.name, is_me: m.is_me, win: wins[i] / runs, podium: podium[i] / runs, expected: expected[i] }))
    .sort((a, b) => b.win - a.win || b.expected - a.expected);
  return { rows, runs, rounds, games_each: rounds * (n - 1), draw_rate: drawRate };
}

// ---------- strengths and player types ----------

export const AREA_LABEL: Record<Area, string> = {
  opening: "Eröffnung",
  middlegame: "Mittelspiel",
  endgame: "Endspiel",
  tactics: "Taktik",
  safety: "Figurensicherheit",
};

const AREA_TITLE: Record<Area, string> = {
  opening: "Eröffnungsprofi",
  middlegame: "Mittelspiel-Stratege",
  endgame: "Endspiel-Techniker",
  tactics: "Taktiker",
  safety: "Fels in der Brandung",
};

export interface Archetype {
  /** e.g. "Endspiel-Techniker"; "Allrounder" when no part stands out, "Noch offen" without enough data. */
  title: string;
  /** Area the title comes from (null for the generic titles). */
  area: Area | null;
  /** How far that area sits above the player's own level, in Elo. */
  offset: number | null;
  /** Clearly weakest area (label), null when none is clearly behind. */
  weak: string | null;
  /** Results clearly above ("fighter") or below ("unlucky") what the moves show. */
  practice: "fighter" | "unlucky" | null;
}

/** An Allrounder needs this many parts measured, each to within this standard error (Elo). */
const ALLROUND_AREAS = 4;
const ALLROUND_SE = 90;

/**
 * What kind of player each one is: the part of the game that stands out
 * against the player's *own* level (one-sided 95 %). It is the player's own
 * profile, not a contest, so two friends can both be endgame technicians and
 * hiding a third never changes anyone's title.
 */
export function archetypes(ranking: Ranking): Record<string, Archetype> {
  const out: Record<string, Archetype> = {};
  for (const r of ranking.rows) {
    const s = r.strength;
    const practice = s ? practiceGap(s)?.kind ?? null : null;
    if (!s || !s.areas.length) {
      out[r.id] = { title: "Noch offen", area: null, offset: null, weak: null, practice };
      continue;
    }
    const up = s.areas.filter((a) => a.stands_out === 1).sort((a, b) => b.offset / b.offset_se - a.offset / a.offset_se)[0];
    const down = s.areas.filter((a) => a.stands_out === -1).sort((a, b) => a.offset / a.offset_se - b.offset / b.offset_se)[0];
    const sharp = s.areas.filter((a) => a.offset_se <= ALLROUND_SE).length >= ALLROUND_AREAS;
    if (up) out[r.id] = { title: AREA_TITLE[up.key], area: up.key, offset: up.offset, weak: down ? AREA_LABEL[down.key] : null, practice };
    else out[r.id] = { title: sharp && !down ? "Allrounder" : "Noch offen", area: null, offset: null, weak: down ? AREA_LABEL[down.key] : null, practice };
  }
  return out;
}

export interface AreaCell {
  /** Elo number for display; value/se on the common scale. */
  value: number;
  se: number;
  offset: number;
  stands_out: -1 | 0 | 1;
}

export interface AreaLeader {
  area: Area;
  id: string;
  name: string;
  /** Chance the leader is truly better in this area than each other player (the smallest of them). */
  p: number;
}

/** Every player's parts of the game, and per part the group's best when the lead is clear (80 % against everyone). */
export function areaTable(ranking: Ranking): { cells: Record<string, Partial<Record<Area, AreaCell>>>; leaders: AreaLeader[] } {
  const cells: Record<string, Partial<Record<Area, AreaCell>>> = {};
  for (const r of ranking.rows) {
    cells[r.id] = {};
    for (const a of r.strength?.areas ?? []) cells[r.id][a.key] = { value: a.value, se: a.se, offset: a.offset, stands_out: a.stands_out };
  }
  const leaders: AreaLeader[] = [];
  for (const area of AREAS) {
    const have = ranking.rows.filter((r) => cells[r.id][area]);
    if (have.length < 2) continue;
    const top = have.reduce((a, b) => ((cells[b.id][area] as AreaCell).value > (cells[a.id][area] as AreaCell).value ? b : a));
    const t = cells[top.id][area] as AreaCell;
    // The players' own strength errors are shared by all their areas but differ between players, so they stay in.
    const p = Math.min(
      ...have
        .filter((r) => r !== top)
        .map((r) => {
          const o = cells[r.id][area] as AreaCell;
          return normalCdf((t.value - o.value) / Math.hypot(t.se, o.se));
        }),
    );
    if (p >= 0.8) leaders.push({ area, id: top.id, name: top.name, p });
  }
  return { cells, leaders };
}

// ---------- results against move quality ----------

/**
 * Results-based strength minus move-quality strength for one player, with the
 * standard error of that difference (their noise is correlated, which narrows
 * it). A clear positive gap: the player scores more than the moves suggest
 * (practical strength, fighting); negative: points are left on the board.
 */
export function practiceGap(s: StrengthEstimate): { gap: number; se: number; kind: "fighter" | "unlucky" | null } | null {
  if (!s.quality) return null;
  const a = s.results.se;
  const b = Math.hypot(s.quality.se, s.quality.k_sd);
  const se = Math.sqrt(Math.max(a * a + b * b - 2 * RESULT_QUALITY_RHO * a * s.quality.se, 1));
  const gap = s.results.value - s.quality.value;
  const z = gap / se;
  return { gap, se, kind: z >= 1.645 ? "fighter" : z <= -1.645 ? "unlucky" : null };
}

export interface MapPoint {
  id: string;
  name: string;
  is_me: boolean;
  /** Strength from move quality (common scale) with standard error. */
  x: number;
  x_se: number;
  /** Strength from results with standard error. */
  y: number;
  y_se: number;
  kind: "fighter" | "unlucky" | null;
  gap: number;
}

export interface QualityMap {
  points: MapPoint[];
  /** Names without both values. */
  missing: string[];
  /** Players clearly scoring more (or less) than their play suggests, one German sentence each. */
  findings: { id: string; kind: "fighter" | "unlucky"; text: string }[];
}

/** Results against move quality, both on the same scale: on the diagonal, a player scores what the moves are worth. */
export function qualityMap(ranking: Ranking): QualityMap | null {
  const points: MapPoint[] = [];
  const missing: string[] = [];
  for (const r of ranking.rows) {
    const s = r.strength;
    const g = s ? practiceGap(s) : null;
    if (!s || !s.quality || !g) {
      missing.push(r.name);
      continue;
    }
    points.push({ id: r.id, name: r.name, is_me: r.is_me, x: s.quality.value, x_se: Math.hypot(s.quality.se, s.quality.k_sd), y: s.results.value, y_se: s.results.se, kind: g.kind, gap: g.gap });
  }
  if (!points.length) return null;
  const findings: QualityMap["findings"] = [];
  for (const p of points) {
    if (!p.kind) continue;
    const gap = Math.round(Math.abs(p.gap) / 10) * 10;
    const who = p.is_me ? "Du" : p.name;
    findings.push({
      id: p.id,
      kind: p.kind,
      text:
        p.kind === "fighter"
          ? p.is_me
            ? `Du holst klar mehr Punkte, als deine Züge wert sind (etwa ${gap} Elo): praktisch stark, du kämpfst und stellst Probleme.`
            : `${who} holt klar mehr Punkte, als die Züge wert sind (etwa ${gap} Elo): praktisch stark, ${who} kämpft und stellt Probleme.`
          : p.is_me
            ? `Deine Züge sind etwa ${gap} Elo mehr wert, als deine Ergebnisse zeigen: da bleiben Punkte liegen, oft bei der Verwertung oder auf der Uhr.`
            : `Die Züge von ${who} sind etwa ${gap} Elo mehr wert, als die Ergebnisse zeigen: da bleiben Punkte liegen, oft bei der Verwertung oder auf der Uhr.`,
    });
  }
  return { points, missing, findings };
}

// ---------- climbing a place ----------

/** Games ahead the climb plan and the simulator count with. */
export const PLAN_GAMES = 20;
// More than this cut in errors per move is no plan anymore.
const MAX_ERROR_CUT = 0.5;

export interface ClimbPlan {
  rank: number | null;
  /** Player directly above (null: already first). */
  target: { id: string; name: string; rank: number } | null;
  /** Elo missing to them on the common scale (estimates). */
  gap: number;
  /** The same gap as the difference of the shown Elo numbers. */
  gap_elo: number;
  /** Chance you are already the stronger one (the gap is within the uncertainty). */
  p_already: number | null;
  /** Points from the next PLAN_GAMES games at your usual opponents' level that would pass them (null: not even all of them). */
  points: number | null;
  /** Points you would expect from those games at your current strength. */
  points_expected: number;
  /** Share fewer errors per move (0..1) that alone would pass them (null without move quality or beyond MAX_ERROR_CUT). */
  error_cut: number | null;
  /** Player directly below: the gap, and the points from PLAN_GAMES games that would let them pass you. */
  chaser: { id: string; name: string; gap: number; gap_elo: number; p_ahead: number; points: number | null } | null;
}

const eloOf = (v: number) => lichessBlitzToElo(v);
const expectedPoints = (s: StrengthEstimate, games: number) => games * logistic(s.value - s.results.avg_opp);

/** Smallest score out of `games` (in half points) that lifts `s` above `target`; null if none does. */
function pointsToPass(s: StrengthEstimate, target: number, games = PLAN_GAMES): number | null {
  for (let pts = 0; pts <= games; pts += 0.5) if (projectedStrength(s, games, pts) > target) return pts;
  return null;
}

/** What it takes to pass the player above, and how safe the place is from the one below. */
export function climbPlan(ranking: Ranking, id: string): ClimbPlan | null {
  const ranked = ranking.rows.filter((r): r is RankRow & { strength: StrengthEstimate } => r.strength !== null);
  const i = ranked.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const me = ranked[i];
  const s = me.strength;
  const above = ranked.slice(0, i).reverse().find((r) => r.strength.value > s.value) ?? null;
  const below = ranked.slice(i + 1).find((r) => r.strength.value < s.value) ?? null;
  let errorCut: number | null = null;
  if (above && s.quality && s.quality.weight > 0.02) {
    let lo = 0;
    let hi = MAX_ERROR_CUT;
    if (projectedStrength(s, 0, 0, hi) > above.strength.value) {
      for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2;
        if (projectedStrength(s, 0, 0, mid) > above.strength.value) hi = mid;
        else lo = mid;
      }
      errorCut = hi;
    }
  }
  return {
    rank: me.rank,
    target: above ? { id: above.id, name: above.name, rank: above.rank as number } : null,
    gap: above ? above.strength.value - s.value : 0,
    gap_elo: above ? eloOf(above.strength.value) - eloOf(s.value) : 0,
    p_already: above ? probStronger(s, above.strength) : null,
    points: above ? pointsToPass(s, above.strength.value) : null,
    points_expected: expectedPoints(s, PLAN_GAMES),
    error_cut: errorCut,
    chaser: below
      ? { id: below.id, name: below.name, gap: s.value - below.strength.value, gap_elo: eloOf(s.value) - eloOf(below.strength.value), p_ahead: probStronger(s, below.strength), points: pointsToPass(below.strength, s.value) }
      : null,
  };
}

/**
 * Strength and place of one player if their next PLAN_GAMES games brought
 * `points` and they made `errorCut` fewer errors per move; everyone else stays
 * as they are (only this player's own estimate changes, as in real life).
 */
export function whatIf(ranking: Ranking, id: string, points: number, errorCut: number): { value: number; rank: number; passed: string[] } | null {
  const me = ranking.rows.find((r) => r.id === id);
  if (!me?.strength) return null;
  const value = projectedStrength(me.strength, PLAN_GAMES, points, errorCut);
  const others = ranking.rows.filter((r) => r.id !== id && r.strength);
  return {
    value,
    rank: 1 + others.filter((r) => (r.strength as StrengthEstimate).value > value).length,
    passed: others.filter((r) => (r.strength as StrengthEstimate).value > me.strength!.value && (r.strength as StrengthEstimate).value < value).map((r) => r.name),
  };
}

export { expectedPoints };
