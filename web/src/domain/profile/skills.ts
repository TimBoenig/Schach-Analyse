// Skill scoring 0-100 for the player profile (port of src/backend/analysis/profile/skills.py).
//
// Each skill maps a raw metric onto 0..100 between a "weak" and a "strong" anchor.
// The anchors are simple, club-player oriented reference points so the scores stay
// explainable in the UI ("why is my endgame 48?") instead of being an opaque model.

import { pct } from "../metrics/accumulators";
import type { GameFeatures } from "./features";
import type { SkillScore } from "./models";
import { fmt, pyRound, stdev } from "./num";

type Dict = Record<string, any>;

// Minimum evidence before a skill is used for strengths/weaknesses.
export const MIN_GAMES = 5;
export const MIN_PHASE_MOVES = 40;
export const MIN_SITUATIONS = 3;
// Games this short (own moves after the book) say little about steadiness: a
// resignation after a few moves reads as 95 % or 40 % accuracy at random.
export const MIN_CONSISTENCY_MOVES = 10;

// Evidence (in units of each skill's `sample`) at which the measurement and the
// prior count half each. A 0..100 score from a few situations swings wildly
// (one thrown win reads as 0 % conversion), so until enough evidence exists the
// score is blended with what is typical for the player's rating (or 50 without
// one). This shrinkage gives a better estimate of the true skill than the raw
// value and keeps the radar from jumping between 0 and 100.
export const PRIOR_WEIGHT: Record<string, number> = {
  opening: 40,
  middlegame: 40,
  endgame: 40,
  tactics: 6,
  safety: 120,
  conversion: 3,
  defense: 3,
  time: 150,
  consistency: 5,
};
// Uncertainty (score points) of a skill without any evidence; shrinks with 1/sqrt(n).
const PRIOR_MARGIN = 30;

/** Linear map of value onto 0..100 where `weak`->0 and `strong`->100 (either direction). */
export function scale(value: number, weak: number, strong: number): number {
  if (strong === weak) return 50;
  const t = (value - weak) / (strong - weak);
  return pyRound(Math.max(0, Math.min(1, t)) * 100, 1);
}

export function gradeFor(score: number): string {
  if (score >= 80) return "Sehr stark";
  if (score >= 65) return "Stark";
  if (score >= 50) return "Solide";
  if (score >= 35) return "Ausbaufähig";
  return "Schwach";
}

export const SKILL_NAMES: Record<string, string> = {
  opening: "Eröffnung",
  middlegame: "Mittelspiel",
  endgame: "Endspiel",
  tactics: "Taktisches Sehen",
  safety: "Figurensicherheit",
  conversion: "Vorteilsverwertung",
  defense: "Verteidigung",
  time: "Zeitmanagement",
  consistency: "Konstanz",
};

function skill(
  key: string,
  score: number,
  detail: string,
  sample: number,
  reliable: boolean,
  grade?: string,
): SkillScore {
  return {
    key,
    name: SKILL_NAMES[key],
    score,
    grade: grade ?? gradeFor(score),
    detail,
    sample,
    reliable,
  };
}

// The scoring formulas are shared with the rating benchmarks, so "typical for
// your rating" is measured with exactly the same yardstick as the player.
export const phaseScore = (acc: number, seriousPer100: number) =>
  pyRound(0.75 * scale(acc, 55, 95) + 0.25 * scale(seriousPer100, 8, 0), 1);
export const tacticsScore = (punishRate: number, takeRate: number, missesPerGame: number) =>
  pyRound(0.5 * scale(punishRate, 0.35, 0.9) + 0.3 * scale(takeRate, 0.5, 0.95) + 0.2 * scale(missesPerGame, 1.5, 0.1), 1);
export const safetyScore = (blunderPer100: number, hungPerGame: number) =>
  pyRound(0.6 * scale(blunderPer100, 5.0, 0.3) + 0.4 * scale(hungPerGame, 1.5, 0.1), 1);
export const conversionScore = (convPct: number) => scale(convPct, 20, 90);
export const defenseScore = (comebackPct: number) => scale(comebackPct, 5, 50);
export const consistencyScore = (spread: number) => scale(spread, 18, 5);

function phaseSkill(key: string, stats: Dict, feats: GameFeatures[]): SkillScore {
  const acc: number = stats.phase_stats?.accuracies?.[key] ?? 0;
  let moves = 0;
  let serious = 0;
  for (const f of feats) {
    for (const m of f.moves) {
      if (m.phase !== key) continue;
      if (!m.is_book) moves += 1;
      if (m.is_serious_error) serious += 1;
    }
  }
  const per100 = moves ? (serious / moves) * 100 : 0;
  const score = phaseScore(acc, per100);
  const detail = moves
    ? `${fmt(acc, 1)} % Genauigkeit, ${fmt(per100, 1)} Fehler/Patzer pro 100 Züge`
    : "Noch keine analysierten Züge in dieser Phase";
  return skill(key, score, detail, moves, moves >= MIN_PHASE_MOVES);
}

/** Compute all skill scores from aggregated stats plus move-level features. */
export function computeSkills(stats: Dict, feats: GameFeatures[]): SkillScore[] {
  const analyzed = feats.filter((f) => f.analyzed);
  const n = analyzed.length;
  const skills = (["opening", "middlegame", "endgame"] as const).map((p) =>
    phaseSkill(p, stats, analyzed),
  );

  // Tactical vision: punishing opponent errors and taking hanging material.
  const chances = analyzed.reduce((s, f) => s + f.punish_chances, 0);
  const punished = analyzed.reduce((s, f) => s + f.punished, 0);
  const hanging: Dict = stats.hanging_stats ?? {};
  const oppCap: number = hanging.opponent_hanging_captured ?? 0;
  const oppMiss: number = hanging.opponent_hanging_missed ?? 0;
  const punishRate = chances ? punished / chances : 0;
  const takeRate = oppCap + oppMiss ? oppCap / (oppCap + oppMiss) : punishRate;
  const misses = analyzed.reduce(
    (s, f) => s + f.moves.filter((m) => m.classification === "Miss").length,
    0,
  );
  const tacticScore = tacticsScore(punishRate, takeRate, n ? misses / n : 0);
  skills.push(
    skill(
      "tactics",
      tacticScore,
      `${fmt(pct(punished, chances), 0)} % der gegnerischen Fehler bestraft ` +
        `(${punished}/${chances}), ${misses} verpasste Chancen`,
      chances,
      chances >= MIN_SITUATIONS * 2,
    ),
  );

  // Piece safety: blunders per 100 moves and hung pieces per game.
  const userMoves = analyzed.reduce((s, f) => s + f.user_move_count, 0);
  const blunders = analyzed.reduce(
    (s, f) => s + f.moves.filter((m) => m.classification === "Blunder").length,
    0,
  );
  const blunderRate = userMoves ? (blunders / userMoves) * 100 : 0;
  const hungPerGame = n ? (hanging.total_hung ?? 0) / n : 0;
  const safety = safetyScore(blunderRate, hungPerGame);
  skills.push(
    skill(
      "safety",
      safety,
      `${fmt(blunderRate, 1)} Patzer pro 100 Züge, ` +
        `${fmt(hungPerGame, 2)} eingestellte Figuren pro Partie`,
      userMoves,
      n >= MIN_GAMES,
    ),
  );

  const adv: Dict = stats.advantage_stats ?? {};
  const hadWin: number = adv.had_winning_advantage ?? 0;
  const conv: number = adv.conversion_rate ?? 0;
  skills.push(
    skill(
      "conversion",
      conversionScore(conv),
      `${fmt(conv, 0)} % der klar gewonnenen Stellungen (+3) auch gewonnen ` +
        `(${adv.converted_advantage ?? 0}/${hadWin})`,
      hadWin,
      hadWin >= MIN_SITUATIONS,
    ),
  );

  const hadLose: number = adv.had_losing_position ?? 0;
  const comeback: number = adv.comeback_rate ?? 0;
  skills.push(
    skill(
      "defense",
      defenseScore(comeback),
      `${fmt(comeback, 0)} % der klar verlorenen Stellungen (-3) noch gehalten oder gedreht ` +
        `(${adv.comeback_drawn_or_won ?? 0}/${hadLose})`,
      hadLose,
      hadLose >= MIN_SITUATIONS,
    ),
  );

  skills.push(timeSkill(stats, analyzed));

  const accs = analyzed
    .filter((f) => f.moves.filter((m) => !m.is_book).length >= MIN_CONSISTENCY_MOVES)
    .map((f) => f.rec.game_acc)
    .filter((a) => a > 0);
  const spread = accs.length >= 2 ? stdev(accs) : 0;
  skills.push(
    skill(
      "consistency",
      consistencyScore(spread),
      `Genauigkeit schwankt um ±${fmt(spread, 1)} Prozentpunkte von Partie zu Partie`,
      accs.length,
      accs.length >= MIN_GAMES,
    ),
  );
  return skills;
}

function timeSkill(stats: Dict, analyzed: GameFeatures[]): SkillScore {
  const timeS: Dict = stats.time_stats ?? {};
  if (!timeS.has_clock_data) {
    return skill(
      "time",
      50,
      "Die Partien enthalten keine Uhrzeiten (z. B. reine PGN ohne %clk).",
      0,
      false,
      "Keine Uhrdaten",
    );
  }
  const tt: Dict = timeS.time_trouble ?? {};
  const losses: number = stats.losses ?? 0;
  const timeLosses: number = tt.total_time_losses ?? 0;
  const timeLossShare = losses ? timeLosses / losses : 0;
  let panic: number = tt.panic_multiplier ?? 1;
  // 0 means "no blunders at all" (no ratio to compute) - treat as neutral 1x.
  panic = panic === Infinity ? 4 : panic || 1;
  const troubleGames = analyzed.filter((f) => f.moves.some((m) => m.in_time_trouble)).length;
  const troubleShare = analyzed.length ? troubleGames / analyzed.length : 0;
  const score = pyRound(
    0.4 * scale(timeLossShare, 0.4, 0) +
      0.3 * scale(panic, 3, 1) +
      0.3 * scale(troubleShare, 0.6, 0.1),
    1,
  );
  return skill(
    "time",
    score,
    `${timeLosses} Niederlagen durch Zeit, in ${fmt(troubleShare * 100, 0)} % der Partien ` +
      `in Zeitnot, Patzerrisiko in Zeitnot ${fmt(panic, 1)}×`,
    (tt.trouble_moves ?? 0) + (tt.normal_moves ?? 0),
    analyzed.length >= MIN_GAMES,
  );
}

/**
 * Blend each measured skill with its prior (the rating-typical score, else 50)
 * by the evidence behind it, and attach the remaining uncertainty. Call after
 * `withTypical` so the prior is known; skills without data stay untouched.
 */
export function settleSkills(skills: SkillScore[]): SkillScore[] {
  return skills.map((s) => {
    const k = PRIOR_WEIGHT[s.key];
    if (!k || s.sample <= 0) return { ...s, raw_score: s.score, margin: null };
    const prior = s.typical ?? 50;
    const w = s.sample / (s.sample + k);
    const score = pyRound(w * s.score + (1 - w) * prior, 1);
    return {
      ...s,
      raw_score: s.score,
      score,
      grade: gradeFor(score),
      margin: Math.round(PRIOR_MARGIN * Math.sqrt(k / (s.sample + k))),
    };
  });
}
