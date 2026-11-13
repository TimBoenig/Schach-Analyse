// Time-control fairness for comparing players' move quality.
//
// Everyone plays less accurately in Blitz than in Rapid and blunders more in
// Bullet. Comparing raw averages therefore rewards whoever happens to play
// slower games: a friend with mostly Rapid games looks 5–8 points more
// accurate than one with mostly Blitz games of exactly the same strength.
//
// The fix is a two-way additive model fitted on every analyzed game of the
// compared players: value = player level + time-control effect. The
// time-control effects are estimated *within* the group (alternating least
// squares), so a strong player who only plays Rapid does not make Rapid look
// easy: the model separates who plays from what is played. A time control
// needs games from at least two players and MIN_GROUP_GAMES games before it
// gets an effect, and every effect is shrunk toward 0 by SPEED_PRIOR_GAMES
// games, so a thin time control cannot move anyone far. Each player's value is
// then corrected by the average effect of their own games.

import { filterGames } from "../metrics/filters";
import { parseSummary, type RawGame } from "../metrics/models";
import { detectSpeedCategory } from "../metrics/speed";
import { MIN_GROUP_GAMES } from "../profile/evidence";

export interface QualityGame {
  speed: string;
  accuracy: number;
  blunders: number;
  /** Engine depth of the analysis (null for games analysed before it was stored). */
  depth: number | null;
}

export interface SpeedAdjust {
  /** Accuracy points to add to the player's raw average. */
  accuracy: number;
  /** Blunders per game to add to the player's raw average. */
  blunders: number;
}

export interface SpeedFairness {
  /** One entry per player, in input order. */
  adjust: SpeedAdjust[];
  /** Estimated effect per time control (relative to the group's mix). */
  speeds: Record<string, { accuracy: number; blunders: number; games: number }>;
  /** True when at least two time controls entered the model. */
  applied: boolean;
}

// An effect from n games is shrunk by n / (n + SPEED_PRIOR_GAMES).
const SPEED_PRIOR_GAMES = 3;
const ITERATIONS = 40;
// Share of the correction added to the standard error: the effects are estimates too.
export const ADJUST_SE_SHARE = 0.3;

function speedOf(g: RawGame): string {
  if (g.chess960) return "Chess960";
  return (g.speed_category || "").trim() || detectSpeedCategory(g.time_control, g.event) || "Other";
}

/** The player's analyzed games with time control, accuracy and blunders (same filters as the profiles). */
export function qualityGames(games: RawGame[], usernames: string[], format = "All Formats", date = "All Time"): QualityGame[] {
  const out: QualityGame[] = [];
  for (const [g, color] of filterGames(games, usernames, "All Colors", format, "All Sources", date)) {
    const summary = parseSummary(g.summary_json) as Record<string, unknown> | null;
    const side = (summary?.[color] ?? null) as Record<string, unknown> | null;
    const accuracy = Number(side?.accuracy ?? 0);
    if (!side || !Number.isFinite(accuracy) || accuracy <= 0) continue;
    const depth = Number(summary?.analysis_depth);
    out.push({ speed: speedOf(g), accuracy, blunders: Number(side.Blunder ?? 0) || 0, depth: Number.isFinite(depth) && depth > 0 ? depth : null });
  }
  return out;
}

function fit(players: QualityGame[][], value: (g: QualityGame) => number, eligible: Set<string>): Map<string, number> {
  const effect = new Map<string, number>([...eligible].map((s) => [s, 0]));
  const level = players.map(() => 0);
  for (let it = 0; it < ITERATIONS; it++) {
    players.forEach((gs, i) => {
      if (!gs.length) return;
      level[i] = gs.reduce((sum, g) => sum + value(g) - (effect.get(g.speed) ?? 0), 0) / gs.length;
    });
    const sum = new Map<string, number>();
    const n = new Map<string, number>();
    players.forEach((gs, i) =>
      gs.forEach((g) => {
        if (!eligible.has(g.speed)) return;
        sum.set(g.speed, (sum.get(g.speed) ?? 0) + value(g) - level[i]);
        n.set(g.speed, (n.get(g.speed) ?? 0) + 1);
      }),
    );
    let mean = 0;
    let total = 0;
    for (const s of eligible) {
      const e = (sum.get(s) ?? 0) / ((n.get(s) ?? 0) + SPEED_PRIOR_GAMES);
      effect.set(s, e);
      mean += e * (n.get(s) ?? 0);
      total += n.get(s) ?? 0;
    }
    // Effects are relative to the group's own mix of time controls.
    if (total) for (const s of eligible) effect.set(s, (effect.get(s) as number) - mean / total);
  }
  return effect;
}

/** Corrections that take each player's mix of time controls out of accuracy and blunders. */
export function speedFairness(players: QualityGame[][]): SpeedFairness {
  const games = new Map<string, number>();
  const who = new Map<string, Set<number>>();
  players.forEach((gs, i) =>
    gs.forEach((g) => {
      games.set(g.speed, (games.get(g.speed) ?? 0) + 1);
      if (!who.has(g.speed)) who.set(g.speed, new Set());
      (who.get(g.speed) as Set<number>).add(i);
    }),
  );
  // Only a time control several players share separates "who" from "what".
  const eligible = new Set([...games.keys()].filter((s) => (games.get(s) as number) >= MIN_GROUP_GAMES && (who.get(s) as Set<number>).size >= 2));
  const none = { adjust: players.map(() => ({ accuracy: 0, blunders: 0 })), speeds: {}, applied: false };
  if (eligible.size < 2) return none;
  const acc = fit(players, (g) => g.accuracy, eligible);
  const bl = fit(players, (g) => g.blunders, eligible);
  const adjust = players.map((gs) => {
    if (!gs.length) return { accuracy: 0, blunders: 0 };
    const mean = (m: Map<string, number>) => gs.reduce((sum, g) => sum + (m.get(g.speed) ?? 0), 0) / gs.length;
    return { accuracy: -mean(acc), blunders: -mean(bl) };
  });
  const speeds = Object.fromEntries([...eligible].map((s) => [s, { accuracy: acc.get(s) as number, blunders: bl.get(s) as number, games: games.get(s) as number }]));
  return { adjust, speeds, applied: true };
}

/**
 * Time-control corrections for a whole group, the one set the league and the
 * duel page share, so a player's corrected accuracy reads the same on both.
 * Players with fewer than `minAnalyzed` analysed games stay out of the model
 * (their games would only add noise to the time-control effects).
 */
export function groupFairness(games: RawGame[], members: string[][], format: string, date: string, minAnalyzed: number): SpeedFairness & { quality: QualityGame[][] } {
  const quality = members.map((names) => {
    const q = qualityGames(games, names, format, date);
    return q.length >= minAnalyzed ? q : [];
  });
  return { ...speedFairness(quality), quality };
}

// Depth gap (median engine depth between two players) from which the
// comparison warns: a few plies change which moves count as errors.
export const DEPTH_GAP = 3;

/** Median analysis depth per player (null without stored depths). */
export function medianDepths(quality: QualityGame[][]): (number | null)[] {
  return quality.map((gs) => {
    const d = gs.map((g) => g.depth).filter((v): v is number => v !== null).sort((a, b) => a - b);
    if (!d.length) return null;
    const mid = Math.floor(d.length / 2);
    return d.length % 2 ? d[mid] : (d[mid - 1] + d[mid]) / 2;
  });
}

export const FAIRNESS_NOTE =
  "Genauigkeit und Patzer sind nach Bedenkzeit bereinigt: in Blitz spielt jeder ungenauer als in Schnellschach, deshalb zählt nur, wie gut jemand in seiner Bedenkzeit spielt, nicht welche er wählt.";
