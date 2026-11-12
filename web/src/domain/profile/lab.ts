// The interactive side of the statistics: every game reduced to a few facts,
// so the pages can answer questions on the spot ("how do I score with White
// in the evening against stronger players?", "what do blunders cost me?")
// without another trip to the profile worker.
//
// The rules of evidence.ts hold here too: a combination is shown with its
// numbers whenever games exist, but only called better or worse when it has
// enough games and the gap to all other games is larger than chance.

import { MIN_GROUP_GAMES, type ScoreSample, scoreZ, wilson, Z95, Z_MULTI } from "./evidence";
import type { GameFeatures } from "./features";

export type Daypart = "morning" | "midday" | "evening" | "night";
export type OppBand = "weaker" | "even" | "stronger";

/** Rating gap from which an opponent counts as clearly stronger or weaker. */
export const OPP_GAP = 75;

/** One finished game from the player's side, reduced to what the pages ask about. */
export interface GameFact {
  color: "white" | "black";
  speed: string;
  daypart: Daypart | null;
  opp: OppBand | null;
  score: 0 | 0.5 | 1;
  /** Blunders in the game; null when it is not analysed. */
  blunders: number | null;
}

export const DAYPARTS: { key: Daypart; label: string; test: (hour: number) => boolean }[] = [
  { key: "morning", label: "Morgens", test: (h) => h >= 5 && h < 11 },
  { key: "midday", label: "Mittags", test: (h) => h >= 11 && h < 17 },
  { key: "evening", label: "Abends", test: (h) => h >= 17 && h < 22 },
  { key: "night", label: "Nachts", test: (h) => h >= 22 || h < 5 },
];

export const OPP_BANDS: { key: OppBand; label: string }[] = [
  { key: "weaker", label: "Schwächere" },
  { key: "even", label: "Gleich starke" },
  { key: "stronger", label: "Stärkere" },
];

export function gameFacts(feats: GameFeatures[], localHour: (ts: number) => number = (ts) => new Date(ts * 1000).getHours()): GameFact[] {
  const out: GameFact[] = [];
  for (const f of feats) {
    const score = f.score;
    if (score === null) continue;
    const hour = f.time_known && f.played_at ? localHour(f.played_at) : null;
    const diff = f.user_rating && f.opp_rating ? f.opp_rating - f.user_rating : null;
    out.push({
      color: f.rec.user_color as "white" | "black",
      speed: f.rec.speed,
      daypart: hour === null ? null : (DAYPARTS.find((d) => d.test(hour))?.key ?? null),
      opp: diff === null ? null : diff >= OPP_GAP ? "stronger" : diff <= -OPP_GAP ? "weaker" : "even",
      score: score as 0 | 0.5 | 1,
      blunders: f.analyzed ? Number((f.rec.quality_counts as Record<string, number>).Blunder ?? 0) : null,
    });
  }
  return out;
}

// ---------- conditions ----------

export interface ConditionPick {
  color?: "white" | "black" | null;
  speed?: string | null;
  daypart?: Daypart | null;
  opp?: OppBand | null;
}

export const CONDITION_KEYS = ["color", "speed", "daypart", "opp"] as const;

export interface ConditionResult {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** 0..100, null without games. */
  score_pct: number | null;
  /** Score of all other games, the fair comparison for this group. */
  rest_pct: number | null;
  /** 95 % range of the score in percent; null without games. */
  range: [number, number] | null;
  /** 1 clearly better than the rest, -1 clearly worse, 0 within chance, null too few games on one side. */
  verdict: -1 | 0 | 1 | null;
}

const matches = (g: GameFact, pick: ConditionPick) => CONDITION_KEYS.every((k) => !pick[k] || g[k] === pick[k]);

function sample(games: GameFact[]): ScoreSample & { wins: number; draws: number; losses: number } {
  const wins = games.filter((g) => g.score === 1).length;
  const draws = games.filter((g) => g.score === 0.5).length;
  return { games: games.length, wins, draws, losses: games.length - wins - draws, score_pct: games.length ? ((wins + draws / 2) / games.length) * 100 : null };
}

export function conditionResult(all: GameFact[], pick: ConditionPick, z = Z95): ConditionResult {
  const part = sample(all.filter((g) => matches(g, pick)));
  // All other games: the fair comparison, since a total would contain the group itself.
  const rest = sample(all.filter((g) => !matches(g, pick)));
  const enough = part.games >= MIN_GROUP_GAMES && rest.games >= MIN_GROUP_GAMES;
  const gap = scoreZ(part, rest);
  const range = part.games ? wilson(part.wins + part.draws / 2, part.games) : null;
  return {
    games: part.games,
    wins: part.wins,
    draws: part.draws,
    losses: part.losses,
    score_pct: part.score_pct,
    rest_pct: rest.score_pct,
    range: range ? [range[0] * 100, range[1] * 100] : null,
    verdict: !enough ? null : gap >= z ? 1 : gap <= -z ? -1 : 0,
  };
}

/** Values of one condition that occur at all, most games first. */
export function conditionValues<K extends (typeof CONDITION_KEYS)[number]>(all: GameFact[], key: K): NonNullable<GameFact[K]>[] {
  const counts = new Map<NonNullable<GameFact[K]>, number>();
  for (const g of all) {
    const v = g[key];
    if (v) counts.set(v as NonNullable<GameFact[K]>, (counts.get(v as NonNullable<GameFact[K]>) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

/**
 * The single condition or pair of conditions that stands out most from the
 * rest, in the asked direction. Looking through dozens of combinations finds
 * "gaps" by chance, so the stricter multi-comparison bar applies; null when
 * nothing clears it.
 */
export function standoutCondition(all: GameFact[], direction: 1 | -1): { pick: ConditionPick; result: ConditionResult } | null {
  const options: ConditionPick[] = [];
  const single = CONDITION_KEYS.flatMap((k) => conditionValues(all, k).map((v) => ({ [k]: v }) as ConditionPick));
  options.push(...single);
  for (let i = 0; i < single.length; i++) {
    for (let j = i + 1; j < single.length; j++) {
      const [a, b] = [single[i], single[j]];
      if (Object.keys(a)[0] !== Object.keys(b)[0]) options.push({ ...a, ...b });
    }
  }
  let best: { pick: ConditionPick; result: ConditionResult; gap: number } | null = null;
  for (const pick of options) {
    const result = conditionResult(all, pick, Z_MULTI);
    if (result.verdict !== direction || result.score_pct === null || result.rest_pct === null) continue;
    const gap = (result.score_pct - result.rest_pct) * direction;
    if (!best || gap > best.gap) best = { pick, result, gap };
  }
  return best ? { pick: best.pick, result: best.result } : null;
}

// ---------- what blunders cost ----------

export interface BlunderCost {
  /** Analysed games without a blunder, and with at least one. */
  clean: ScoreSample;
  dirty: ScoreSample;
  /** Share of analysed games without a blunder, 0..1. */
  clean_share: number;
  /** True when both groups are big enough and their gap is beyond chance. */
  clear: boolean;
}

export function blunderCost(all: GameFact[]): BlunderCost | null {
  const analysed = all.filter((g) => g.blunders !== null);
  if (!analysed.length) return null;
  const clean = sample(analysed.filter((g) => g.blunders === 0));
  const dirty = sample(analysed.filter((g) => (g.blunders as number) > 0));
  return {
    clean: { games: clean.games, score_pct: clean.score_pct },
    dirty: { games: dirty.games, score_pct: dirty.score_pct },
    clean_share: clean.games / analysed.length,
    clear: clean.games >= MIN_GROUP_GAMES && dirty.games >= MIN_GROUP_GAMES && scoreZ(clean, dirty) >= Z95,
  };
}

/**
 * Points out of 100 games when `share` of them stay free of blunders and both
 * kinds of game keep scoring as they do now. A mixture, not a promise: fewer
 * blunders usually come with better play overall.
 */
export function pointsAtCleanShare(cost: BlunderCost, share: number): number | null {
  if (cost.clean.score_pct === null || cost.dirty.score_pct === null) return null;
  const s = Math.min(1, Math.max(0, share));
  return s * cost.clean.score_pct + (1 - s) * cost.dirty.score_pct;
}
