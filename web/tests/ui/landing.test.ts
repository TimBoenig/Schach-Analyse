import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";

import { MIN_GAMES, MIN_REPEATS, readSample, SAMPLE_STEPS } from "../../src/ui/landing/patternSample";
import { PUZZLE_FEN, PUZZLE_HINT } from "../../src/ui/landingPuzzle";
import { parseHash, toHash } from "../../src/ui/router";

describe("landing page", () => {
  it("has its own short address for the social-media bio link", () => {
    expect(parseHash("#/hello")).toEqual({ view: "landing" });
    expect(parseHash("#/hallo")).toEqual({ view: "landing" });
    expect(toHash({ view: "landing" })).toBe("#/hello");
  });

  it("asks a puzzle with exactly one mating move, which is the hint", () => {
    const g = new Chess(PUZZLE_FEN);
    const mates = g.moves({ verbose: true }).filter((m) => {
      const t = new Chess(PUZZLE_FEN);
      t.move(m);
      return t.isCheckmate();
    });
    expect(mates.map((m) => ({ from: m.from, to: m.to }))).toEqual([{ ...PUZZLE_HINT }]);
  });
});

describe("landing pattern example", () => {
  it("misleads after one game and settles on the endgame pattern only with enough games", () => {
    const one = readSample(1);
    expect(one.share.opening).toBe(1);
    expect(one.pattern).toBeNull();
    // Below the evidence floor Lucena names no pattern, whatever the counts say.
    expect(readSample(MIN_GAMES - 1).pattern).toBeNull();
    const all = readSample(SAMPLE_STEPS[SAMPLE_STEPS.length - 1]);
    expect(all.games).toHaveLength(SAMPLE_STEPS[SAMPLE_STEPS.length - 1]);
    expect(all.share.endgame).toBeGreaterThan(all.share.middlegame);
    expect(all.share.middlegame).toBeGreaterThan(all.share.opening);
    expect(all.pattern?.motif).toBe("Turmendspiel nicht gehalten");
    expect(all.pattern!.games).toBeGreaterThanOrEqual(MIN_REPEATS);
  });
});
