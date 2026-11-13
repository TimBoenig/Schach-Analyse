import { describe, expect, it } from "vitest";

import type { RawGame } from "../../src/domain/metrics/models";
import { buildRanking, comparisonPeriod, groupFairness, type RankInput } from "../../src/domain/players";
import { medianDepths } from "../../src/domain/players/fairness";
import { buildPlayerProfile } from "../../src/domain/profile";
import { buildMoves } from "../profile/fixtures";

const MOVES = buildMoves();

const NOW = Date.now() / 1000;
const pad = (v: number) => String(v).padStart(2, "0");
const day = (daysAgo: number) => {
  const d = new Date((NOW - daysAgo * 86400) * 1000);
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
};

let n = 0;
/** One game of `who` (White) `daysAgo` days ago; analysed when `accuracy` is given. */
function game(who: string, daysAgo: number, { speed = "Rapid", accuracy = 0, blunders = 0, depth = 12 }: { speed?: string; accuracy?: number; blunders?: number; depth?: number } = {}): RawGame {
  n += 1;
  return {
    id: `p${n}`,
    white: who,
    black: `opp${n}`,
    result: n % 2 ? "1-0" : "0-1",
    date: day(daysAgo),
    speed_category: speed,
    white_elo: "1500",
    black_elo: "1500",
    source: "lichess",
    moves_json: (accuracy ? MOVES : []) as never,
    summary_json: (accuracy ? { white: { accuracy, Blunder: blunders }, black: { accuracy: 70, Blunder: 1 }, analysis_depth: depth } : {}) as never,
  };
}
const many = (count: number, make: (i: number) => RawGame) => Array.from({ length: count }, (_, i) => make(i));
const input = (id: string, games: RawGame[], date = "All Time", isMe = false): RankInput => ({ id, name: id, is_me: isMe, usernames: [id], profile: buildPlayerProfile(games, [id], "All Formats", date) });

describe("ranking precision", () => {
  it("treats activity as a count with chance in it and leaves excluded Bullet games out", () => {
    const games = [
      ...many(31, (i) => game("A", i % 25)),
      ...many(30, (i) => game("B", i % 25)),
      // C plays 20 Rapid games plus 40 Bullet games, which the user excludes from statistics.
      ...many(20, (i) => game("C", i % 25)),
      ...many(40, (i) => game("C", i % 25, { speed: "Bullet" })),
    ];
    const ranking = buildRanking([input("A", games), input("B", games), input("C", games)], games, { format: "No Bullet", now: NOW });
    const cell = (id: string) => ranking.rows.find((r) => r.id === id)!.cells.activity;
    expect(cell("C").value).toBe(20);
    // 31 against 30 games is close to a coin flip, not a full 100 against 0.
    expect(Math.abs((cell("A").points as number) - (cell("B").points as number))).toBeLessThan(15);
    expect(cell("C").points).toBeLessThan(15);
  });

  it("keeps the raw accuracy next to the corrected one and warns about uneven analysis depth", () => {
    // Anna mostly plays Rapid and is analysed deeply, Ben mostly Blitz and shallow.
    const games = [
      ...many(16, (i) => game("Anna", i, { accuracy: 84 + (i % 3), depth: 12 })),
      ...many(4, (i) => game("Anna", i, { speed: "Blitz", accuracy: 77 + (i % 3), blunders: 1, depth: 12 })),
      ...many(4, (i) => game("Ben", i, { accuracy: 84 + (i % 3), depth: 9 })),
      ...many(16, (i) => game("Ben", i, { speed: "Blitz", accuracy: 77 + (i % 3), blunders: 1, depth: 9 })),
    ];
    const ranking = buildRanking([input("Anna", games, "All Time", true), input("Ben", games)], games, { now: NOW });
    const acc = (id: string) => ranking.rows.find((r) => r.id === id)!.cells.accuracy;
    // The cell compares corrected values but still says what the profile shows.
    expect(acc("Ben").raw).toBeCloseTo(buildPlayerProfile(games, ["Ben"]).overview.avg_accuracy, 6);
    expect(acc("Ben").value).toBeGreaterThan(acc("Ben").raw as number);
    expect(acc("Anna").value).toBeLessThan(acc("Anna").raw as number);
    expect(ranking.notes.join(" ")).toContain("Die von Ben Partien sind flacher analysiert (Tiefe 9) als deine (Tiefe 12)");
    expect(ranking.period).toBe("All Time");
  });

  it("gives every member the same time-control correction, whoever the group is built around", () => {
    const games = [
      ...many(14, (i) => game("Anna", i, { accuracy: 85, depth: 12 })),
      ...many(6, (i) => game("Anna", i, { speed: "Blitz", accuracy: 78, depth: 12 })),
      ...many(6, (i) => game("Ben", i, { accuracy: 83, depth: 12 })),
      ...many(14, (i) => game("Ben", i, { speed: "Blitz", accuracy: 76, depth: 12 })),
      ...many(10, (i) => game("Cem", i, { accuracy: 80, depth: 9 })),
      ...many(10, (i) => game("Cem", i, { speed: "Blitz", accuracy: 74, depth: 9 })),
      // Dora has too few analysed games to take part in the model.
      ...many(3, (i) => game("Dora", i, { speed: "Blitz", accuracy: 99, depth: 12 })),
    ];
    // League order (me first, then friends) and duel order (me, the friend, the rest).
    const league = groupFairness(games, [["Anna"], ["Ben"], ["Cem"], ["Dora"]], "All Formats", "All Time", 5);
    const duel = groupFairness(games, [["Anna"], ["Cem"], ["Ben"], ["Dora"]], "All Formats", "All Time", 5);
    expect(duel.adjust[1].accuracy).toBeCloseTo(league.adjust[2].accuracy, 6);
    expect(duel.adjust[0].accuracy).toBeCloseTo(league.adjust[0].accuracy, 6);
    expect(league.quality[3]).toEqual([]);
    expect(medianDepths(league.quality)).toEqual([12, 12, 9, null]);
  });

  it("starts the comparison on 90 days and widens until two players have enough analysed games", () => {
    const fresh = [...many(6, (i) => game("Anna", 5 + i, { accuracy: 80 })), ...many(6, (i) => game("Ben", 10 + i, { accuracy: 80 }))];
    expect(comparisonPeriod(fresh, [["Anna"], ["Ben"], ["Cem"]], "All Formats", "Last 90 Days", NOW)).toBe("Last 90 Days");
    // Ben's analysed games are half a year old; unanalysed recent games do not count.
    const stale = [...many(6, (i) => game("Anna", 5 + i, { accuracy: 80 })), ...many(6, (i) => game("Ben", 180 + i, { accuracy: 80 })), ...many(9, (i) => game("Ben", i))];
    expect(comparisonPeriod(stale, [["Anna"], ["Ben"]], "All Formats", "Last 90 Days", NOW)).toBe("Last 365 Days");
  });
});
