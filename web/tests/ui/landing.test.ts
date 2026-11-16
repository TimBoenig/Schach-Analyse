import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";

import { PUZZLE_FEN, PUZZLE_HINT } from "../../src/ui/landingPuzzle";
import { parseHash, toHash } from "../../src/ui/router";

describe("landing page", () => {
  it("has its own short address for the social-media bio link", () => {
    expect(parseHash("#/hallo")).toEqual({ view: "landing" });
    expect(toHash({ view: "landing" })).toBe("#/hallo");
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
