// The friends group seen as a league, on top of the ranking: who would win a
// tournament between you, what kind of player each one is, what it takes to
// climb a place, and who plays better (or worse) than the results show.
//
// Everything is computed from the ranking's estimates with their uncertainty,
// so the same rules hold as everywhere else in the comparison: the rating
// plays no part, and nothing is claimed from a gap that chance could explain.

import { Z_ONE } from "../profile/evidence";
import { BATTLE_ROUNDS } from "./battle";
import { type Estimate, forecastScore, probBetter, qualityChance } from "./compare";
import type { HeadToHead } from "./h2h";
import { type RankFactor, type Ranking, type RankRow, rescore } from "./ranking";

const estOf = (r: RankRow, key: string): Estimate | null => {
  const c = r.cells[key];
  return c && c.value !== null && c.se !== null ? { value: c.value, se: c.se } : null;
};

// Results against everyone and activity say nothing about how two players
// compare in their own play; the direct games enter the forecast separately.
const PAIR_SKIP = new Set(["h2h", "activity"]);

/** Weighted chance that A is the better player, from every rating-free factor both have. */
export function pairQuality(ranking: Ranking, aId: string, bId: string): number | null {
  const a = ranking.rows.find((r) => r.id === aId);
  const b = ranking.rows.find((r) => r.id === bId);
  if (!a || !b || a === b) return null;
  return qualityChance(
    ranking.factors
      .filter((f) => f.weight > 0 && !PAIR_SKIP.has(f.key))
      .map((f) => {
        const ea = estOf(a, f.key);
        const eb = estOf(b, f.key);
        return { key: f.key, p: ea && eb ? probBetter(ea, eb, f.higher_is_better) : null };
      }),
  );
}

const NO_GAMES = { games: 0, wins: 0, draws: 0 };

/** A's expected score against B (0..1) with its 80 % band, the same model as the duel forecast. */
export function pairForecast(ranking: Ranking, aId: string, bId: string, h2h: Pick<HeadToHead, "games" | "wins" | "draws"> | null) {
  return forecastScore(pairQuality(ranking, aId, bId), h2h ?? NO_GAMES);
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

/** Small seeded generator, so the same group always gets the same numbers. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * A round-robin tournament between all ranked players, played many times over.
 * Every game is drawn from the pair's forecast (their play compared without
 * the rating, plus their direct games), so the chances say who would most
 * likely come out on top if you all met tonight.
 */
export function simulateTournament(
  ranking: Ranking,
  h2hOf: (aId: string, bId: string) => Pick<HeadToHead, "games" | "wins" | "draws"> | null,
  { rounds = 2, runs = TOURNAMENT_RUNS }: { rounds?: number; runs?: number } = {},
): Tournament | null {
  const members = ranking.rows.filter((r) => r.overall !== null);
  const n = members.length;
  if (n < 3) return null;
  const records: { i: number; j: number; h: Pick<HeadToHead, "games" | "wins" | "draws"> | null }[] = [];
  let draws = 0;
  let played = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const h = h2hOf(members[i].id, members[j].id);
      records.push({ i, j, h });
      if (h) {
        draws += h.draws;
        played += h.games;
      }
    }
  }
  const drawRate = (draws + TYPICAL_DRAWS * DRAW_PRIOR) / (played + DRAW_PRIOR);
  const pairs = records.map(({ i, j, h }) => {
    const p = pairForecast(ranking, members[i].id, members[j].id, h).p;
    // A draw cannot be likelier than twice the weaker side's expected score.
    const draw = Math.min(drawRate, 2 * Math.min(p, 1 - p));
    return { i, j, p, win: p - draw / 2, draw };
  });

  const rand = mulberry32(hash(members.map((m) => m.id).join("|")));
  const wins = new Array<number>(n).fill(0);
  const podium = new Array<number>(n).fill(0);
  const pts = new Array<number>(n).fill(0);
  for (let run = 0; run < runs; run++) {
    pts.fill(0);
    for (const pr of pairs) {
      for (let r = 0; r < rounds; r++) {
        const x = rand();
        if (x < pr.win) pts[pr.i] += 1;
        else if (x < pr.win + pr.draw) {
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
  const expected = new Array<number>(n).fill(0);
  for (const pr of pairs) {
    expected[pr.i] += pr.p * rounds;
    expected[pr.j] += (1 - pr.p) * rounds;
  }
  const rows = members
    .map((m, i) => ({ id: m.id, name: m.name, is_me: m.is_me, win: wins[i] / runs, podium: podium[i] / runs, expected: expected[i] }))
    .sort((a, b) => b.win - a.win || b.expected - a.expected);
  return { rows, runs, rounds, games_each: rounds * (n - 1), draw_rate: drawRate };
}

// ---------- player types ----------

export interface Archetype {
  /** e.g. "Endspiel-Ass"; "Allrounder" without a standout area, "Neu dabei" without enough data. */
  title: string;
  /** Battle round the title comes from (null for the generic titles). */
  area: string | null;
  /** Average points in that round (0..100). */
  points: number | null;
  /** Clearly weakest area (label), null when none is far behind. */
  weak: string | null;
}

/** Average points from which an area defines a player: clearly better than most of the group. */
export const ARCHETYPE_P = 65;
const WEAK_P = 35;

function roundPoints(r: RankRow): { key: string; label: string; crown: string; pts: number }[] {
  return BATTLE_ROUNDS.map((def) => {
    const pts = def.factors.map((k) => r.cells[k]?.points).filter((v): v is number => v !== null && v !== undefined);
    return pts.length ? { key: def.key, label: def.label, crown: def.crown, pts: pts.reduce((a, b) => a + b, 0) / pts.length } : null;
  }).filter((x): x is { key: string; label: string; crown: string; pts: number } => x !== null);
}

/**
 * What kind of player each one is inside this group: the area they stand out
 * in. A title says what sets someone apart, so each one goes to one player
 * only: the strongest claim wins it, the others take their next standout area
 * or stay generic.
 */
export function archetypes(ranking: Ranking): Record<string, Archetype> {
  const out: Record<string, Archetype> = {};
  const claims: { id: string; key: string; crown: string; pts: number }[] = [];
  for (const r of ranking.rows) {
    const rounds = roundPoints(r);
    if (r.overall === null || !rounds.length) {
      out[r.id] = { title: "Neu dabei", area: null, points: null, weak: null };
      continue;
    }
    const best = rounds.reduce((a, b) => (b.pts > a.pts ? b : a));
    const worst = rounds.reduce((a, b) => (b.pts < a.pts ? b : a));
    const weak = worst.pts <= WEAK_P && worst !== best ? worst.label : null;
    out[r.id] = { title: best.pts >= 50 ? "Allrounder" : "Herausforderer", area: null, points: best.pts, weak };
    for (const x of rounds) if (x.pts >= ARCHETYPE_P) claims.push({ id: r.id, ...x });
  }
  const taken = new Set<string>();
  const named = new Set<string>();
  // Stable sort: on equal points the better placed player (earlier row) wins.
  for (const c of claims.sort((a, b) => b.pts - a.pts)) {
    if (taken.has(c.key) || named.has(c.id)) continue;
    taken.add(c.key);
    named.add(c.id);
    out[c.id] = { ...out[c.id], title: c.crown, area: c.key, points: c.pts };
  }
  return out;
}

// ---------- climbing a place ----------

export interface Lever {
  key: string;
  label: string;
  from: number;
  to: number;
  /** Change needed, in the factor's own unit (negative for blunders). */
  delta: number;
  /** The change in units of how far apart the group is here: smaller is easier. */
  effort: number;
}

export interface ClimbPlan {
  rank: number | null;
  overall: number | null;
  /** Player directly above (null: already first). */
  target: { id: string; name: string; rank: number; overall: number } | null;
  /** Overall points missing to them. */
  gap: number;
  /** Single changes that would each be enough to pass them, easiest first. */
  levers: Lever[];
  /**
   * Accuracy, blunders and results improved together, each by the same
   * effort, just far enough to pass. Shown when no single change is enough,
   * or next to a single big step when the combination keeps every part
   * doable (null otherwise, or when even all three at their limit fall short).
   */
  combo: Lever[] | null;
  /** Player directly below and the easiest single change that would let them pass. */
  chaser: { id: string; name: string; gap: number; lever: Lever | null } | null;
}

/**
 * Effort is measured in "group spreads" (how far apart the group usually is
 * in that factor): up to SMALL_EFFORT a change is a small step, beyond
 * LARGE_EFFORT a big one.
 */
export const SMALL_EFFORT = 0.6;
export const LARGE_EFFORT = 1.5;

// Largest change worth suggesting per factor; beyond it a lever is no plan.
const MAX_STEP: Record<string, number> = { expectation: 25, accuracy: 15, blunders: 2, h2h: 60 };
const DEFAULT_STEP = 45;
// Levers that are no change of play: activity is a habit, the rating counts 0.
const NO_LEVER = new Set(["activity", "rating", "score"]);

function spread(ranking: Ranking, key: string): number {
  const vals = ranking.rows.map((r) => estOf(r, key)).filter((e): e is Estimate => e !== null);
  if (!vals.length) return 1;
  const mean = vals.reduce((s, e) => s + e.value, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, e) => s + (e.value - mean) ** 2, 0) / vals.length);
  const se = vals.reduce((s, e) => s + e.se, 0) / vals.length;
  return Math.max(sd, se, 1e-6);
}

function leverFor(ranking: Ranking, who: RankRow, rival: RankRow, f: RankFactor): Lever | null {
  const est = estOf(who, f.key);
  if (!est || f.weight <= 0 || NO_LEVER.has(f.key)) return null;
  const dir = f.higher_is_better ? 1 : -1;
  // Accuracy, skills and scores end at 100, blunders at 0.
  const room = dir > 0 ? (["expectation"].includes(f.key) ? Infinity : 100 - est.value) : est.value;
  const limit = Math.min(MAX_STEP[f.key] ?? DEFAULT_STEP, room);
  if (!(limit > 0)) return null;
  const passes = (step: number) => {
    const m = rescore(ranking, who.id, { [f.key]: est.value + dir * step });
    const a = m?.get(who.id);
    const b = m?.get(rival.id);
    return a !== null && a !== undefined && b !== null && b !== undefined && a > b;
  };
  if (!passes(limit)) return null;
  let lo = 0;
  let hi = limit;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (passes(mid)) hi = mid;
    else lo = mid;
  }
  return { key: f.key, label: f.label, from: est.value, to: est.value + dir * hi, delta: dir * hi, effort: hi / spread(ranking, f.key) };
}

const levers = (ranking: Ranking, who: RankRow, rival: RankRow) =>
  ranking.factors
    .map((f) => leverFor(ranking, who, rival, f))
    .filter((l): l is Lever => l !== null)
    .sort((a, b) => a.effort - b.effort);

// The three things a player works on directly; the skills come from the same moves.
const COMBO_KEYS = ["accuracy", "blunders", "expectation"];

function comboFor(ranking: Ranking, who: RankRow, rival: RankRow): Lever[] | null {
  const parts = COMBO_KEYS.map((key) => {
    const f = ranking.factors.find((x) => x.key === key);
    const est = estOf(who, key);
    if (!f || !est || f.weight <= 0) return null;
    const dir = f.higher_is_better ? 1 : -1;
    const room = dir > 0 ? (key === "expectation" ? Infinity : 100 - est.value) : est.value;
    const limit = Math.min(MAX_STEP[key] ?? DEFAULT_STEP, room);
    return limit > 0 ? { f, est, dir, limit, unit: spread(ranking, key) } : null;
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  if (parts.length < 2) return null;
  // Every part moves by the same number of "group spreads", capped at its limit.
  const stepOf = (p: (typeof parts)[number], t: number) => Math.min(p.limit, t * p.unit);
  const passes = (t: number) => {
    const m = rescore(ranking, who.id, Object.fromEntries(parts.map((p) => [p.f.key, p.est.value + p.dir * stepOf(p, t)])));
    const a = m?.get(who.id);
    const b = m?.get(rival.id);
    return a !== null && a !== undefined && b !== null && b !== undefined && a > b;
  };
  let hi = Math.max(...parts.map((p) => p.limit / p.unit));
  if (!passes(hi)) return null;
  let lo = 0;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (passes(mid)) hi = mid;
    else lo = mid;
  }
  return parts.map((p) => {
    const step = stepOf(p, hi);
    return { key: p.f.key, label: p.f.label, from: p.est.value, to: p.est.value + p.dir * step, delta: p.dir * step, effort: step / p.unit };
  });
}

/** What it takes to pass the player above, and how safe the place is from the one below. */
export function climbPlan(ranking: Ranking, id: string, limit = 4): ClimbPlan | null {
  const ranked = ranking.rows.filter((r) => r.overall !== null);
  const i = ranked.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const me = ranked[i];
  const mine = me.overall as number;
  const above = ranked.slice(0, i).reverse().find((r) => (r.overall as number) > mine) ?? null;
  const below = ranked.slice(i + 1).find((r) => (r.overall as number) < mine) ?? null;
  const single = above ? levers(ranking, me, above).slice(0, limit) : [];
  const easiest = single[0]?.effort ?? Infinity;
  const combo = above && easiest > LARGE_EFFORT ? comboFor(ranking, me, above) : null;
  return {
    rank: me.rank,
    overall: me.overall,
    target: above ? { id: above.id, name: above.name, rank: above.rank as number, overall: above.overall as number } : null,
    gap: above ? (above.overall as number) - mine : 0,
    levers: single,
    combo: combo && (!single.length || Math.max(...combo.map((l) => l.effort)) <= LARGE_EFFORT) ? combo : null,
    chaser: below ? { id: below.id, name: below.name, gap: mine - (below.overall as number), lever: levers(ranking, below, me)[0] ?? null } : null,
  };
}

// ---------- play quality against results ----------

export type Quadrant = "strong" | "fighter" | "unlucky" | "growing";

export interface MapPoint {
  id: string;
  name: string;
  is_me: boolean;
  /** Accuracy (time-control fair), with standard error. */
  x: number;
  x_se: number;
  /** Points above the Elo expectation per game, in percent points. */
  y: number;
  y_se: number;
  /** Corner the player sits in; null while within one standard error of the middle. */
  quadrant: Quadrant | null;
}

export interface QualityMap {
  points: MapPoint[];
  x_mean: number;
  y_mean: number;
  /** Names without both values. */
  missing: string[];
  /** Players clearly scoring more (or less) than their play suggests, one German sentence each. */
  findings: { id: string; kind: "fighter" | "unlucky"; text: string }[];
}

/**
 * Accuracy against results over the expectation: a player far above the group
 * in results but not in accuracy wins more than the moves suggest (practical
 * strength, fighting spirit), one far above in accuracy but not in results
 * leaves points on the board. The corner is only named beyond one standard
 * error on both axes, a finding only beyond a one-sided 95 % bar on both.
 */
export function qualityMap(ranking: Ranking): QualityMap | null {
  const points: MapPoint[] = [];
  const missing: string[] = [];
  for (const r of ranking.rows) {
    const x = estOf(r, "accuracy");
    const y = estOf(r, "expectation");
    if (!x || !y) {
      missing.push(r.name);
      continue;
    }
    points.push({ id: r.id, name: r.name, is_me: r.is_me, x: x.value, x_se: x.se, y: y.value, y_se: y.se, quadrant: null });
  }
  if (points.length < 3) return null;
  const x_mean = points.reduce((s, p) => s + p.x, 0) / points.length;
  const y_mean = points.reduce((s, p) => s + p.y, 0) / points.length;
  const findings: QualityMap["findings"] = [];
  for (const p of points) {
    const dx = (p.x - x_mean) / p.x_se;
    const dy = (p.y - y_mean) / p.y_se;
    if (Math.abs(dx) >= 1 && Math.abs(dy) >= 1) {
      p.quadrant = dx > 0 ? (dy > 0 ? "strong" : "unlucky") : dy > 0 ? "fighter" : "growing";
    }
    const who = p.is_me ? "Du" : p.name;
    if (dy >= Z_ONE && dx <= -Z_ONE) {
      findings.push({
        id: p.id,
        kind: "fighter",
        text: p.is_me
          ? "Du holst klar mehr Punkte, als deine Genauigkeit erwarten lässt: praktisch stark, du kämpfst und stellst Probleme."
          : `${who} holt klar mehr Punkte, als die Genauigkeit erwarten lässt: praktisch stark, ${who} kämpft und stellt Probleme.`,
      });
    } else if (dx >= Z_ONE && dy <= -Z_ONE) {
      findings.push({
        id: p.id,
        kind: "unlucky",
        text: p.is_me
          ? "Du spielst genauer als die Gruppe, holst aber weniger Punkte als erwartet: da bleiben Punkte liegen, oft bei der Verwertung oder auf der Uhr."
          : `${who} spielt genauer als die Gruppe, holt aber weniger Punkte als erwartet: da bleiben Punkte liegen, oft bei der Verwertung oder auf der Uhr.`,
      });
    }
  }
  return { points, x_mean, y_mean, missing, findings };
}
