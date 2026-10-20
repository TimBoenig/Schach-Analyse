import { describe, expect, it } from "vitest";

import { lineScoreWhite } from "../../src/domain/analyzer";
import { accClass, monthLabel, outcomeFor, shortOpening } from "../../src/ui/labels";

describe("game list labels", () => {
  it.each([
    ["1-0", "white", "win"],
    ["1-0", "black", "loss"],
    ["0-1", "black", "win"],
    ["1/2-1/2", "white", "draw"],
    ["*", "white", null],
    ["1-0", null, null],
  ] as const)("outcome of %s for %s is %s", (result, color, expected) => {
    expect(outcomeFor(result, color)).toBe(expected);
  });

  it("groups by German month and tolerates unknown dates", () => {
    expect(monthLabel("2026.03.14")).toBe("März 2026");
    expect(monthLabel("2026.??.??")).toBe("Ohne Datum");
    expect(monthLabel("")).toBe("Ohne Datum");
  });

  it("keeps the opening family and main variation only", () => {
    expect(shortOpening("Italian Game: Classical Variation, Greco Gambit, Moeller-Therkatz Attack")).toBe(
      "Italian Game: Classical Variation",
    );
    expect(shortOpening(null)).toBe("");
  });

  it("colours accuracy by band", () => {
    expect([accClass(92), accClass(75), accClass(60), accClass(30), accClass(null)]).toEqual([
      "acc-high",
      "acc-mid",
      "acc-low",
      "acc-bad",
      "",
    ]);
  });
});

describe("engine line display", () => {
  // Engine scores are side-to-move relative; the UI shows White's perspective.
  it("flips scores when Black is to move", () => {
    const black = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const white = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    expect(lineScoreWhite(black, { cp: 40, mate: null })).toEqual({ cp: -40, mate: null });
    expect(lineScoreWhite(black, { cp: null, mate: 3 })).toEqual({ cp: null, mate: -3 });
    expect(lineScoreWhite(white, { cp: 25, mate: null })).toEqual({ cp: 25, mate: null });
  });
});
