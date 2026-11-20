// Battles between two players of the friends group, and the competitive
// extras of the ranking (rival, category crowns).
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
import { t } from "../../i18n";

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
  { key: "results", label: t("Ergebnisse"), crown: t("Punktesammler"), factors: ["expectation"] },
  { key: "precision", label: t("Präzision"), crown: t("Präzisionsmaschine"), factors: ["accuracy"] },
  { key: "blunders", label: t("Fehlervermeidung"), crown: t("Fels in der Brandung"), factors: ["blunders"] },
  { key: "opening", label: t("Eröffnung"), crown: t("Eröffnungsprofi"), factors: ["opening"] },
  { key: "tactics", label: t("Mittelspiel & Taktik"), crown: t("Taktik-Ass"), factors: ["middlegame", "tactics"] },
  { key: "endgame", label: t("Endspiel & Technik"), crown: t("Endspiel-Ass"), factors: ["endgame", "conversion", "defense"] },
  { key: "nerves", label: t("Nerven & Uhr"), crown: t("Nervenstark"), factors: ["safety", "time"] },
  { key: "h2h", label: t("Direkte Duelle"), crown: t("Duell-Champion"), factors: ["h2h"] },
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
export function pairEstimate(h: Pick<HeadToHead, "games" | "wins" | "draws"> | null | undefined): { a: number; p: number } | null {
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
  const total = BATTLE_ROUNDS.reduce((s, r) => s + r.factors.reduce((tk, k) => tk + (FACTOR_WEIGHTS[k] ?? 0), 0), 0);

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
    const weight = (def.factors.reduce((tk, k) => tk + (FACTOR_WEIGHTS[k] ?? 0), 0) / total) * 100;
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
  if (!fought.length) verdict = t("Für eine Battle fehlen noch Daten: beide brauchen analysierte Partien oder Partien gegeneinander.");
  else if (!leader) verdict = t("Ausgeglichen: {wins_a}:{wins_b} Runden, keiner ist insgesamt vorn.", { wins_a, wins_b });
  else {
    const [mine, theirs] = leader === "a" ? [wins_a, wins_b] : [wins_b, wins_a];
    const how = mine - theirs >= 3 ? t("klar") : mine > theirs ? t("knapp") : t("nach Stärke");
    verdict = t("{name} gewinnt {how} mit {mine}:{theirs} Runden{4}.", { name: name(leader), how, mine, theirs, 4: tipping ? t(", entschieden in „{label}“", { label: tipping.r.label }) : "" });
    // Rounds count wins only; the strength bar weighs every round, open ones
    // included. When the two disagree, say so instead of leaving a 51:49 bar
    // next to a verdict for the other side unexplained.
    // Compared as shown on the bar (rounded), so a bar reading 50:50 never triggers it.
    const shownA = power_a === null ? 50 : Math.round(power_a);
    const strongerSide: Side | null = shownA === 50 ? null : shownA > 50 ? "a" : "b";
    if (strongerSide && strongerSide !== leader) {
      const share = strongerSide === "a" ? shownA : 100 - shownA;
      verdict += t(" Über alle Runden gewogen, auch die offenen, liegt aber {name} knapp vorn ({share}:{2}).", { name: name(strongerSide), share, 2: 100 - share });
    }
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

/** The friend closest to a player in strength: the natural opponent for a battle. */
export function rivalOf(ranking: Ranking, id: string): RankRow | null {
  const me = ranking.rows.find((r) => r.id === id);
  if (!me) return null;
  const others = ranking.rows.filter((r) => r.id !== id);
  if (!others.length) return null;
  const mine = me.strength?.value;
  if (mine === undefined) return others[0];
  const d = (x: RankRow) => (x.strength ? Math.abs(x.strength.value - mine) : Infinity);
  return others.reduce((best, r) => (d(r) < d(best) ? r : best));
}
