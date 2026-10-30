import { describe, expect, it } from "vitest";

import { moveVerdict } from "../../src/ui/labels";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const BLACK = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

describe("moveVerdict", () => {
  it("calls an engine-equal move the best move, never just good", () => {
    expect(moveVerdict({ move_number: 1, fen_before: START, san: "e4", classification: "Best" })).toBe("1. e4 ist der beste Zug.");
  });

  it("numbers black moves with an ellipsis and names errors plainly", () => {
    expect(moveVerdict({ move_number: 1, fen_before: BLACK, san: "f6", classification: "Blunder" })).toBe("Autsch, 1... f6 ist ein Patzer.");
    expect(moveVerdict({ move_number: 1, fen_before: BLACK, san: "a6", classification: "Inaccuracy" })).toBe("1... a6 ist ungenau.");
  });
});
