import { describe, expect, it } from "vitest";
import type { RawGame } from "../../src/domain/metrics/models";
import { qualityGames, speedFairness } from "../../src/domain/players/fairness";

let n = 0;
// One analyzed game of `who` (always White) in a time control with given accuracy and blunders.
function game(who: string, speed: string, accuracy: number, blunders: number): RawGame {
  n += 1;
  return {
    id: `g${n}`,
    white: who,
    black: `opp${n}`,
    result: "1-0",
    speed_category: speed,
    summary_json: { white: { accuracy, Blunder: blunders }, black: { accuracy: 70, Blunder: 1 } } as never,
  };
}

// Blitz costs everyone 8 accuracy points and one blunder per game against Rapid.
const play = (who: string, level: number, rapid: number, blitz: number): RawGame[] => [
  ...Array.from({ length: rapid }, (_, i) => game(who, "Rapid", level + (i % 3) - 1, i % 4 === 0 ? 1 : 0)),
  ...Array.from({ length: blitz }, (_, i) => game(who, "Blitz", level - 8 + (i % 3) - 1, i % 4 === 0 ? 2 : 1)),
];

describe("speedFairness", () => {
  it("removes the time-control mix so equally strong players come out equal", () => {
    const games = [...play("anna", 85, 18, 2), ...play("ben", 85, 2, 18)];
    const a = qualityGames(games, ["anna"]);
    const b = qualityGames(games, ["ben"]);
    const mean = (gs: typeof a, k: "accuracy" | "blunders") => gs.reduce((s, g) => s + g[k], 0) / gs.length;
    // Raw averages flatter Anna, who mostly plays the slower games.
    const rawGap = mean(a, "accuracy") - mean(b, "accuracy");
    expect(rawGap).toBeGreaterThan(5);
    const f = speedFairness([a, b]);
    expect(f.applied).toBe(true);
    const accA = mean(a, "accuracy") + f.adjust[0].accuracy;
    const accB = mean(b, "accuracy") + f.adjust[1].accuracy;
    // Effects are shrunk a little toward 0, so most (not all) of the gap goes.
    expect(Math.abs(accA - accB)).toBeLessThan(0.35 * rawGap);
    const blA = mean(a, "blunders") + f.adjust[0].blunders;
    const blB = mean(b, "blunders") + f.adjust[1].blunders;
    expect(Math.abs(blA - blB)).toBeLessThan(0.35);
    expect(f.speeds.Blitz.accuracy).toBeLessThan(f.speeds.Rapid.accuracy);
  });

  it("keeps a real gap when both play the same mix", () => {
    const games = [...play("anna", 88, 10, 10), ...play("ben", 80, 10, 10)];
    const f = speedFairness([qualityGames(games, ["anna"]), qualityGames(games, ["ben"])]);
    expect(Math.abs(f.adjust[0].accuracy - f.adjust[1].accuracy)).toBeLessThan(0.5);
  });

  it("does nothing when a time control is played by one player only", () => {
    const games = [...play("anna", 85, 20, 0), ...play("ben", 85, 0, 20)];
    const f = speedFairness([qualityGames(games, ["anna"]), qualityGames(games, ["ben"])]);
    expect(f.applied).toBe(false);
    expect(f.adjust).toEqual([
      { accuracy: 0, blunders: 0 },
      { accuracy: 0, blunders: 0 },
    ]);
  });
});
