import { describe, expect, it } from "vitest";

import {
  blunderCost,
  buildPlayerProfile,
  conditionResult,
  type GameFact,
  nextMilestone,
  PACE_DAYS,
  pointsAtCleanShare,
  ratingForSkill,
  ratingJourney,
  standoutCondition,
  STRENGTH_MAX,
  STRENGTH_MIN,
  strengthMap,
  typicalSkillScores,
} from "../../src/domain/profile";
import { profileGames } from "./fixtures";

const fact = (p: Partial<GameFact>): GameFact => ({ color: "white", speed: "Blitz", daypart: "evening", opp: "even", score: 1, blunders: 0, ...p });
const many = (n: number, p: Partial<GameFact>) => Array.from({ length: n }, () => fact(p));

describe("game facts", () => {
  it("carries one fact per finished game with colour, result and blunders", () => {
    const profile = buildPlayerProfile(profileGames(3, 2), ["Tim"]);
    expect(profile.facts).toHaveLength(5);
    expect(profile.facts.filter((f) => f.score === 0)).toHaveLength(3);
    // THROWN_WIN games hold one blunder by the player, the clean wins none.
    expect(profile.facts.map((f) => f.blunders).sort()).toEqual([0, 0, 1, 1, 1]);
    expect(profile.facts.every((f) => f.color === "white" && f.opp === "even")).toBe(true);
  });
});

describe("condition finder", () => {
  // 30 games with White at 80 %, 30 with Black at 30 %.
  const games = [...many(24, { color: "white" }), ...many(6, { color: "white", score: 0 }), ...many(9, { color: "black" }), ...many(21, { color: "black", score: 0 })];

  it("compares a group with all other games, not with a total that contains it", () => {
    const r = conditionResult(games, { color: "white" });
    expect(r).toMatchObject({ games: 30, wins: 24, losses: 6, score_pct: 80, rest_pct: 30, verdict: 1 });
    expect(r.range![0]).toBeLessThan(80);
    expect(r.range![1]).toBeGreaterThan(80);
    expect(conditionResult(games, { color: "black" }).verdict).toBe(-1);
  });

  it("gives no verdict below the minimum sample and none inside chance", () => {
    const few = [...many(4, { daypart: "night" }), ...many(40, { daypart: "evening", score: 0 })];
    expect(conditionResult(few, { daypart: "night" })).toMatchObject({ games: 4, score_pct: 100, verdict: null });
    const even = [...many(11, { speed: "Rapid" }), ...many(9, { speed: "Rapid", score: 0 }), ...many(10, {}), ...many(10, { score: 0 })];
    expect(conditionResult(even, { speed: "Rapid" }).verdict).toBe(0);
    expect(conditionResult(even, { speed: "Bullet" })).toMatchObject({ games: 0, score_pct: null, range: null, verdict: null });
  });

  it("finds the combination that stands out and stays silent on noise", () => {
    expect(standoutCondition(games, 1)?.pick).toEqual({ color: "white" });
    expect(standoutCondition(games, -1)?.pick).toEqual({ color: "black" });
    const noise = [...many(10, { color: "white" }), ...many(9, { color: "white", score: 0 }), ...many(9, { color: "black" }), ...many(10, { color: "black", score: 0 })];
    expect(standoutCondition(noise, 1)).toBeNull();
  });
});

describe("blunder cost", () => {
  it("splits analysed games by blunders and mixes the two scores for a share", () => {
    const games = [...many(15, {}), ...many(5, { score: 0 }), ...many(4, { blunders: 2 }), ...many(16, { blunders: 1, score: 0 }), ...many(7, { blunders: null })];
    const cost = blunderCost(games)!;
    expect(cost).toMatchObject({ clean: { games: 20, score_pct: 75 }, dirty: { games: 20, score_pct: 20 }, clean_share: 0.5, clear: true });
    expect(pointsAtCleanShare(cost, 0.5)).toBeCloseTo(47.5);
    expect(pointsAtCleanShare(cost, 1)).toBe(75);
    expect(pointsAtCleanShare(cost, 2)).toBe(75);
  });

  it("is null without analysed games and not clear on a handful", () => {
    expect(blunderCost(many(5, { blunders: null }))).toBeNull();
    expect(blunderCost([...many(3, {}), ...many(3, { blunders: 1, score: 0 })])!.clear).toBe(false);
  });
});

describe("skill strength", () => {
  it("reads the typical score of a rating back as that rating", () => {
    for (const rating of [1000, 1500, 2000]) {
      const typical = typicalSkillScores(rating);
      for (const key of ["opening", "endgame", "tactics", "safety"]) expect(Math.abs(ratingForSkill(key, typical[key])!.rating - rating)).toBeLessThanOrEqual(10);
    }
  });

  it("caps at the ends of the scale and skips skills without a rising reference", () => {
    expect(ratingForSkill("endgame", 0)).toEqual({ rating: STRENGTH_MIN, capped: -1 });
    expect(ratingForSkill("endgame", 100)).toEqual({ rating: STRENGTH_MAX, capped: 1 });
    expect(ratingForSkill("defense", 50)).toBeNull();
    expect(ratingForSkill("time", 50)).toBeNull();
    const skill = (key: string, score: number, sample = 20) => ({ key, name: key, score, grade: "", detail: "", sample, reliable: true });
    const map = strengthMap([skill("opening", 40), skill("endgame", 80), skill("time", 90), skill("tactics", 70, 0)]);
    expect(map.map((s) => s.key)).toEqual(["endgame", "opening"]);
  });
});

describe("rating journey", () => {
  const DAY = 86400;
  const now = 1_800_000_000;
  const climb = (perDay: number, days = 60): [number, number][] => Array.from({ length: days }, (_, i) => [now - (days - i) * DAY, Math.round(1500 + i * perDay)] as [number, number]);

  it("measures the pace and the days to the goal while the line points up", () => {
    const j = ratingJourney(climb(1), 1650, now)!;
    expect(j).toMatchObject({ start: 1500, current: 1559, peak: 1559, goal: 1650, reached: false });
    expect(j.per_month).toBeCloseTo(30, 0);
    expect(j.eta_days).toBeGreaterThan(80);
    expect(j.eta_days).toBeLessThan(100);
    expect(j.progress).toBeCloseTo(59 / 150, 2);
  });

  it("gives no arrival time on a flat or falling line, too little data or a goal far away", () => {
    expect(ratingJourney(climb(0), 1600, now)!.eta_days).toBeNull();
    expect(ratingJourney(climb(-1), 1600, now)!.eta_days).toBeNull();
    expect(ratingJourney(climb(1, 8), 1600, now)).toMatchObject({ per_month: null, eta_days: null });
    expect(ratingJourney(climb(0.2), 2400, now)!.eta_days).toBeNull();
    // Old games outside the pace window do not count towards it.
    const old = climb(1).map(([t, r]) => [t - (PACE_DAYS + 70) * DAY, r] as [number, number]);
    expect(ratingJourney(old, 1700, now)!.per_month).toBeNull();
    expect(ratingJourney([], 1600, now)).toBeNull();
  });

  it("marks a reached goal and proposes the next real step otherwise", () => {
    expect(ratingJourney(climb(1), 1550, now)).toMatchObject({ reached: true, progress: 1, eta_days: null });
    expect(ratingJourney(climb(1), null, now)!.goal).toBe(1600);
    expect(nextMilestone(1610)).toBe(1650);
    expect(nextMilestone(1640)).toBe(1700);
    expect(nextMilestone(1650)).toBe(1700);
  });
});
