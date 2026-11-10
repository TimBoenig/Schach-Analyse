// Battles between two players of the friends group, and the competitive
// extras of the ranking (rival, the chase for the next place, category crowns).
//
// A battle is fought in rounds, one per area of the game. Each round is won by
// whoever is *probably* better there (the same chance-of-being-better as the
// ranking, from the ranking's estimates with their uncertainty), so a lucky
// week cannot win a round and a 0,2-point gap stays a draw. The rating plays
// no part: every round is measured from results against the opponents'
// strength or from the players' own moves.

import { type Estimate, normalCdf, probBetter, SURE_P } from "./compare";
import type { HeadToHead } from "./h2h";
import type { Ranking, RankRow } from "./ranking";
import { FACTOR_WEIGHTS } from "./weights";

/** Chance from which a round counts as won ("knapp"); EDGE/SURE make it "deutlich"/"klar". */
export const ROUND_P = 0.65;
const CLEAR_P = 0.8;

export interface RoundDef {
  key: string;
  label: string;
  /** Title of the group's best player in this round. */
  crown: string;
  factors: string[];
}

export const BATTLE_ROUNDS: RoundDef[] = [
  { key: "results", label: "Ergebnisse", crown: "Punktesammler", factors: ["expectation"] },
  { key: "precision", label: "Präzision", crown: "Präzisionsmaschine", factors: ["accuracy"] },
  { key: "blunders", label: "Fehlervermeidung", crown: "Fels in der Brandung", factors: ["blunders"] },
  { key: "opening", label: "Eröffnung", crown: "Eröffnungsprofi", factors: ["opening"] },
  { key: "tactics", label: "Mittelspiel & Taktik", crown: "Taktik-Ass", factors: ["middlegame", "tactics"] },
  { key: "endgame", label: "Endspiel & Technik", crown: "Endspiel-Ass", factors: ["endgame", "conversion", "defense"] },
  { key: "nerves", label: "Nerven & Uhr", crown: "Nervenstark", factors: ["safety", "time"] },
  { key: "h2h", label: "Direkte Duelle", crown: "Duell-Champion", factors: ["h2h"] },
];

export type Side = "a" | "b";

export interface BattleFactor {
  key: string;
  a: number | null;
  b: number | null;
  /** Chance that A is truly better here. */
  p_a: number | null;
}

export interface BattleRound {
  key: string;
  label: string;
  /** Share of the battle in percent (from the factor weights). */
  weight: number;
  /** Chance that A is truly better in this round (null without data on both sides). */
  p_a: number | null;
  winner: Side | "draw" | null;
  /** How sure the win is: "knapp" (65 %), "deutlich" (80 %), "klar" (95 %). */
  margin: "knapp" | "deutlich" | "klar" | null;
  factors: BattleFactor[];
}

export interface Battle {
  a: { id: string; name: string };
  b: { id: string; name: string };
  rounds: BattleRound[];
  wins_a: number;
  wins_b: number;
  draws: number;
  /** A's share of the battle strength (0..100): weighted average chance of being better. */
  power_a: number | null;
  /** Side ahead in the battle (by rounds, then strength), null when level. */
  leader: Side | null;
  /** Round that tips the battle most (biggest weighted lead), null without one. */
  decisive: string | null;
  /** One German sentence summing up the battle. */
  verdict: string;
}

const estOf = (r: RankRow, key: string): Estimate | null => {
  const c = r.cells[key];
  return c && c.value !== null && c.se !== null ? { value: c.value, se: c.se } : null;
};

function marginOf(p: number): BattleRound["margin"] {
  const lead = Math.max(p, 1 - p);
  if (lead >= SURE_P) return "klar";
  if (lead >= CLEAR_P) return "deutlich";
  if (lead >= ROUND_P) return "knapp";
  return null;
}

/**
 * The direct-encounter round needs the pair's own games: the group-wide h2h
 * cell mixes games against everyone. A's chance of being truly better is the
 * chance their true score against B is above 50 %.
 */
function pairEstimate(h: HeadToHead | null | undefined): { a: number; p: number } | null {
  if (!h || !h.games) return null;
  const pts = h.wins + h.draws / 2;
  // +1/+2 keeps a 2:0 from looking certain.
  const p = (pts + 1) / (h.games + 2);
  const se = Math.sqrt((p * (1 - p)) / h.games);
  return { a: (pts / h.games) * 100, p: normalCdf((p - 0.5) / se) };
}

/** Two players from the ranking, round by round. `h2h` is A's record against B. */
export function buildBattle(ranking: Ranking, aId: string, bId: string, h2h?: HeadToHead | null): Battle | null {
  const ra = ranking.rows.find((r) => r.id === aId);
  const rb = ranking.rows.find((r) => r.id === bId);
  if (!ra || !rb || ra === rb) return null;
  const higher = new Map(ranking.factors.map((f) => [f.key, f.higher_is_better]));
  const total = BATTLE_ROUNDS.reduce((s, r) => s + r.factors.reduce((t, k) => t + (FACTOR_WEIGHTS[k] ?? 0), 0), 0);

  const rounds: BattleRound[] = BATTLE_ROUNDS.map((def) => {
    const factors: BattleFactor[] = def.factors.map((key) => {
      if (key === "h2h") {
        const pe = pairEstimate(h2h);
        return { key, a: pe?.a ?? null, b: pe ? 100 - pe.a : null, p_a: pe?.p ?? null };
      }
      const ea = estOf(ra, key);
      const eb = estOf(rb, key);
      return { key, a: ea?.value ?? null, b: eb?.value ?? null, p_a: ea && eb ? probBetter(ea, eb, higher.get(key) ?? true) : null };
    });
    let wsum = 0;
    let psum = 0;
    for (const f of factors) {
      if (f.p_a === null) continue;
      const w = FACTOR_WEIGHTS[f.key] ?? 1;
      wsum += w;
      psum += w * f.p_a;
    }
    const p = wsum ? psum / wsum : null;
    const margin = p === null ? null : marginOf(p);
    const winner: BattleRound["winner"] = p === null ? null : margin === null ? "draw" : p > 0.5 ? "a" : "b";
    const weight = (def.factors.reduce((t, k) => t + (FACTOR_WEIGHTS[k] ?? 0), 0) / total) * 100;
    return { key: def.key, label: def.label, weight, p_a: p, winner, margin, factors };
  });

  const fought = rounds.filter((r) => r.p_a !== null);
  const wins_a = fought.filter((r) => r.winner === "a").length;
  const wins_b = fought.filter((r) => r.winner === "b").length;
  const draws = fought.filter((r) => r.winner === "draw").length;
  const w = fought.reduce((s, r) => s + r.weight, 0);
  const power_a = w ? (fought.reduce((s, r) => s + r.weight * (r.p_a as number), 0) / w) * 100 : null;
  const leader: Side | null = wins_a !== wins_b ? (wins_a > wins_b ? "a" : "b") : power_a !== null && Math.abs(power_a - 50) >= 2 ? (power_a > 50 ? "a" : "b") : null;
  const tipping = fought
    .filter((r) => r.winner === leader)
    .map((r) => ({ r, lead: r.weight * Math.abs((r.p_a as number) - 0.5) }))
    .sort((x, y) => y.lead - x.lead)[0];

  const name = (s: Side) => (s === "a" ? ra.name : rb.name);
  let verdict: string;
  if (!fought.length) verdict = "Für eine Battle fehlen noch Daten: beide brauchen analysierte Partien oder Partien gegeneinander.";
  else if (!leader) verdict = `Ausgeglichen: ${wins_a}:${wins_b} Runden, keiner ist insgesamt vorn.`;
  else {
    const [mine, theirs] = leader === "a" ? [wins_a, wins_b] : [wins_b, wins_a];
    const how = mine - theirs >= 3 ? "klar" : mine > theirs ? "knapp" : "nach Stärke";
    verdict = `${name(leader)} gewinnt ${how} mit ${mine}:${theirs} Runden${tipping ? `, entschieden in „${tipping.r.label}“` : ""}.`;
  }
  return {
    a: { id: ra.id, name: ra.name },
    b: { id: rb.id, name: rb.name },
    rounds,
    wins_a,
    wins_b,
    draws,
    power_a,
    leader,
    decisive: tipping?.r.key ?? null,
    verdict,
  };
}

// ---------- competitive extras ----------

export interface Crown {
  key: string;
  label: string;
  title: string;
  holder_id: string;
  holder_name: string;
  /** Average points in the round's factors (0..100). */
  points: number;
  /** The lead over the runner-up is not just noise. */
  clear: boolean;
}

/** The group's best player in each battle round, with a title to hold. */
export function crowns(ranking: Ranking): Crown[] {
  const out: Crown[] = [];
  for (const def of BATTLE_ROUNDS) {
    const scored = ranking.rows
      .map((r) => {
        const pts = def.factors.map((k) => r.cells[k]?.points).filter((v): v is number => v !== null && v !== undefined);
        return { r, pts: pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : null };
      })
      .filter((x): x is { r: RankRow; pts: number } => x.pts !== null)
      .sort((a, b) => b.pts - a.pts);
    if (scored.length < 2) continue;
    const [top, next] = scored;
    if (top.pts === next.pts) continue;
    out.push({
      key: def.key,
      label: def.label,
      title: def.crown,
      holder_id: top.r.id,
      holder_name: top.r.name,
      points: top.pts,
      // Points are chances of being better: 80 against 50 needs a real gap.
      clear: top.pts >= CLEAR_P * 100,
    });
  }
  return out;
}

export interface Chase {
  /** Player directly above (null: already first). */
  target: { id: string; name: string; rank: number } | null;
  /** Overall points missing to the player above. */
  gap: number;
  /** Lead over the player directly below (null: last). */
  lead: number | null;
  below: { id: string; name: string } | null;
  /** Factors with the most overall points still to win, biggest first. */
  levers: { key: string; label: string; room: number }[];
}

/** What separates a player from the next place, and where the points are. */
export function chase(ranking: Ranking, id: string): Chase | null {
  const ranked = ranking.rows.filter((r) => r.overall !== null);
  const i = ranked.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const me = ranked[i];
  const above = ranked.slice(0, i).reverse().find((r) => (r.overall as number) > (me.overall as number)) ?? null;
  const below = ranked.slice(i + 1).find((r) => (r.overall as number) < (me.overall as number)) ?? null;
  const label = new Map(ranking.factors.map((f) => [f.key, f.label]));
  return {
    target: above ? { id: above.id, name: above.name, rank: above.rank as number } : null,
    gap: above ? (above.overall as number) - (me.overall as number) : 0,
    lead: below ? (me.overall as number) - (below.overall as number) : null,
    below: below ? { id: below.id, name: below.name } : null,
    levers: [...me.breakdown]
      .filter((c) => c.room >= 1)
      .sort((a, b) => b.room - a.room)
      .slice(0, 3)
      .map((c) => ({ key: c.key, label: label.get(c.key) ?? c.key, room: c.room })),
  };
}

/** The friend closest to a player in the overall score: the natural opponent for a battle. */
export function rivalOf(ranking: Ranking, id: string): RankRow | null {
  const me = ranking.rows.find((r) => r.id === id);
  if (!me) return null;
  const others = ranking.rows.filter((r) => r.id !== id);
  if (!others.length) return null;
  if (me.overall === null) return others[0];
  return others.reduce((best, r) => {
    const d = (x: RankRow) => (x.overall === null ? Infinity : Math.abs(x.overall - (me.overall as number)));
    return d(r) < d(best) ? r : best;
  });
}
