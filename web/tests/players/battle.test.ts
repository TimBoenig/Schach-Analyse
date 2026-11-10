import { describe, expect, it } from "vitest";

import { buildBattle, chase, crowns, FACTOR_WEIGHTS, headToHead, RANK_FACTORS, type Ranking, type RankRow, rivalOf } from "../../src/domain/players";

function row(id: string, cells: Record<string, [number, number, number?]>, overall: number | null = null, isMe = false): RankRow {
  return {
    id,
    name: id,
    is_me: isMe,
    rank: null,
    overall,
    games: 50,
    analyzed: 30,
    source: "lichess",
    breakdown: [],
    missing: [],
    cells: Object.fromEntries(Object.entries(cells).map(([k, [value, se, points]]) => [k, { value, se, rank: null, points: points ?? null, note: "" }])),
  };
}
const ranking = (rows: RankRow[]): Ranking => ({ factors: RANK_FACTORS, rows, rating_speed: "Blitz", notes: [] });
const h2h = (wins: number, draws: number, losses: number) => ({ ...headToHead([], [], []), games: wins + draws + losses, wins, draws, losses });

describe("weights", () => {
  it("add up to 100 % and give the rating and raw points nothing", () => {
    expect(Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9);
    expect([FACTOR_WEIGHTS.rating, FACTOR_WEIGHTS.score]).toEqual([0, 0]);
    expect(RANK_FACTORS.find((f) => f.key === "rating")!.weight).toBe(0);
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

  it("hands out crowns, names the rival and what is missing to the next place", () => {
    const rows = [
      row("Lena", { accuracy: [80, 1, 90], tactics: [60, 5, 85], endgame: [50, 5, 40] }, 70),
      row("Tim", { accuracy: [75, 1, 50], tactics: [55, 5, 60], endgame: [60, 5, 70] }, 60, true),
      row("Max", { accuracy: [70, 1, 10], tactics: [50, 5, 5], endgame: [55, 5, 40] }, 30),
    ];
    rows[1].breakdown = [
      { key: "accuracy", points: 50, share: 40, value: 20, room: 20 },
      { key: "endgame", points: 70, share: 30, value: 21, room: 9 },
      { key: "tactics", points: 60, share: 30, value: 18, room: 12 },
    ];
    const rk = ranking(rows);
    const c = crowns(rk);
    expect(c.find((x) => x.key === "precision")).toMatchObject({ holder_name: "Lena", clear: true });
    expect(c.find((x) => x.key === "endgame")).toMatchObject({ holder_name: "Tim", clear: false });
    expect(rivalOf(rk, "Tim")!.id).toBe("Lena");
    const ch = chase(rk, "Tim")!;
    expect(ch).toMatchObject({ target: { id: "Lena" }, gap: 10, lead: 30, below: { id: "Max" } });
    expect(ch.levers.map((l) => l.key)).toEqual(["accuracy", "tactics", "endgame"]);
    expect(chase(rk, "Lena")!.target).toBeNull();
  });
});
