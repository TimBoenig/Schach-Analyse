import { describe, expect, it } from "vitest";

import { buildBattle, FACTOR_WEIGHTS, headToHead, RANK_FACTORS, type Ranking, type RankRow, rivalOf, type StrengthEstimate } from "../../src/domain/players";

/** A minimal strength at a value of the common scale (only `value` matters for the rival). */
const strengthAt = (value: number) => ({ value, se: 30, columns: { li_blitz: 1 } }) as unknown as StrengthEstimate;

function row(id: string, cells: Record<string, [number, number]>, overall: number | null = null, isMe = false): RankRow {
  return {
    id,
    name: id,
    is_me: isMe,
    rank: null,
    strength: overall === null ? null : strengthAt(overall),
    odds: null,
    games: 50,
    analyzed: 30,
    rated_games: 50,
    bot_games: 0,
    source: "lichess",
    cells: Object.fromEntries(Object.entries(cells).map(([k, [value, se]]) => [k, { value, se, rank: null, note: "" }])),
  };
}
const ranking = (rows: RankRow[]): Ranking => ({ factors: RANK_FACTORS, period: "All Time", rows, rating_speed: "Blitz", speed_effects: {}, notes: [] });
const h2h = (wins: number, draws: number, losses: number) => ({ ...headToHead([], [], []), games: wins + draws + losses, wins, draws, losses });

describe("weights", () => {
  it("add up to 100 % and give the rating and raw points nothing", () => {
    expect(Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9);
    expect([FACTOR_WEIGHTS.rating, FACTOR_WEIGHTS.score]).toEqual([0, 0]);
  });
});

describe("battle", () => {
  const r = ranking([
    // Tim: much lower rating, clearly better accuracy and endgame, equal tactics.
    row("Tim", { rating: [1100, 60], accuracy: [84, 1], endgame: [70, 3], tactics: [55, 8], blunders: [1.2, 0.1] }, null, true),
    row("Lena", { rating: [1900, 60], accuracy: [76, 1], endgame: [50, 3], tactics: [56, 8], blunders: [1.21, 0.1] }),
  ]);

  it("wins rounds by the chance of being better, ignores the rating and keeps noise a draw", () => {
    const b = buildBattle(r, "Tim", "Lena", h2h(1, 0, 2))!;
    const round = (k: string) => b.rounds.find((x) => x.key === k)!;
    expect(round("precision")).toMatchObject({ winner: "a", margin: "klar" });
    expect(round("endgame").winner).toBe("a");
    expect(round("tactics").winner).toBe("draw");
    expect(round("blunders").winner).toBe("draw");
    // No data on either side: the round is not fought at all.
    expect(round("opening")).toMatchObject({ p_a: null, winner: null });
    // 1:2 from three games is not proof Lena is better.
    expect(round("h2h").winner).toBe("draw");
    expect(round("h2h").factors[0].a).toBeCloseTo(33.33, 1);
    expect(b.rounds.some((x) => x.factors.some((f) => f.key === "rating"))).toBe(false);
    expect(b).toMatchObject({ wins_a: 2, wins_b: 0, leader: "a", decisive: "precision" });
    expect(b.verdict).toContain("Tim gewinnt");
    expect(b.rounds.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(100, 6);
    // A clear series in the direct games does win that round.
    expect(buildBattle(r, "Tim", "Lena", h2h(0, 1, 11))!.rounds.find((x) => x.key === "h2h")!.winner).toBe("b");
    // Swapping sides mirrors the battle.
    const back = buildBattle(r, "Lena", "Tim")!;
    expect([back.wins_a, back.wins_b, back.leader]).toEqual([0, 2, "b"]);
    expect(buildBattle(r, "Tim", "Tim")).toBeNull();
  });

  it("says so when the round count and the weighted strength point to different players", () => {
    // Tim is slightly ahead in the heavy rounds (all still open), Lena clearly wins two light ones.
    const split = ranking([
      row("Tim", { expectation: [5, 4], accuracy: [80, 1], blunders: [1.0, 0.2], opening: [40, 3], endgame: [40, 3] }, null, true),
      row("Lena", { expectation: [3, 4], accuracy: [79.5, 1], blunders: [1.07, 0.2], opening: [70, 3], endgame: [70, 3] }),
    ]);
    const b = buildBattle(split, "Tim", "Lena")!;
    expect([b.wins_a, b.wins_b, b.leader]).toEqual([0, 2, "b"]);
    expect(b.power_a!).toBeGreaterThan(51);
    expect(b.verdict).toMatch(/^Lena gewinnt .* liegt aber Tim knapp vorn \(5\d:4\d\)\.$/);
  });

  it("names the friend closest in strength as the rival", () => {
    const rk = ranking([row("Lena", {}, 1700), row("Tim", {}, 1640, true), row("Max", {}, 1500), row("Ida", {}, null)]);
    expect(rivalOf(rk, "Tim")!.id).toBe("Lena");
    expect(rivalOf(rk, "Max")!.id).toBe("Tim");
  });
});
