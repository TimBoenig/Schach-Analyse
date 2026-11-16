import { describe, expect, it } from "vitest";

import { glanzzuege, nextStop, stopsOf } from "../../src/domain/moveJump";
import type { Classification, MoveData } from "../../src/domain/types";

/** Alternating white/black moves from move 1; only the fields the jump logic reads. */
function game(classes: Classification[]): MoveData[] {
  return classes.map(
    (classification, k) =>
      ({
        classification,
        san: `m${k + 1}`,
        move_number: Math.floor(k / 2) + 1,
        fen_before: `8/8/8/8/8/8/8/8 ${k % 2 ? "b" : "w"} - - 0 1`,
      }) as MoveData,
  );
}

describe("report jumps", () => {
  const moves = game(["Book", "Brilliant", "Great", "Best", "Brilliant", "Blunder", "Great", "Brilliant"]);

  it("finds the moves of a class per side as board positions", () => {
    expect(stopsOf(moves, ["Brilliant"])).toEqual([2, 5, 8]);
    expect(stopsOf(moves, ["Brilliant"], "black")).toEqual([2, 8]);
    expect(stopsOf(moves, ["Brilliant"], "white")).toEqual([5]);
    expect(stopsOf(moves, ["Miss"], "white")).toEqual([]);
  });

  it("walks through the stops on repeated clicks and starts over after the last", () => {
    const stops = [2, 5, 8];
    expect(nextStop(stops, 0)).toBe(2);
    expect(nextStop(stops, 2)).toBe(5);
    expect(nextStop(stops, 6)).toBe(8);
    expect(nextStop(stops, 8)).toBe(2);
    expect(nextStop([], 3)).toBeNull();
  });

  it("lists brilliant and great moves in game order with the side's move label", () => {
    expect(glanzzuege(moves).map((g) => [g.stop, g.side, g.classification, g.label])).toEqual([
      [2, "black", "Brilliant", "1... m2"],
      [3, "white", "Great", "2. m3"],
      [5, "white", "Brilliant", "3. m5"],
      [7, "white", "Great", "4. m7"],
      [8, "black", "Brilliant", "4... m8"],
    ]);
  });
});
