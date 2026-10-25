// Concrete move explanations: motifs of the opponent's reply and of the better move.
import { describe, expect, it } from "vitest";

import { explainMove } from "../../src/domain/explain";

describe("explainMove", () => {
  it("names the fork the opponent's reply sets up", () => {
    // Black ignores the knight on d5; Nc7+ forks king and rook.
    const text = explainMove({
      fenBefore: "r3k2r/ppp2ppp/8/3N4/8/8/PPP2PPP/R3K2R b KQkq - 0 1",
      uci: "h7h6",
      bestPv: ["e8d8"],
      replyPv: ["d5c7", "e8d8", "c7a8"],
    });
    expect(text[0]).toContain("Gabel");
    expect(text[0]).toContain("deinen König");
    expect(text[0]).toContain("deinen Turm");
  });

  it("reports a free piece taken and the better move", () => {
    // White's bishop goes to an attacked, undefended square.
    const text = explainMove({
      fenBefore: "rnbqkbnr/ppp2ppp/8/3pp3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3",
      uci: "f1a6",
      bestPv: ["e4d5"],
      replyPv: ["b8a6"],
    });
    expect(text.join(" ")).toMatch(/schlägt mit Nxa6 deinen ungedeckten Läufer/);
    expect(text.join(" ")).toContain("Besser war");
  });

  it("explains an allowed mate with the mating line", () => {
    const text = explainMove({
      fenBefore: "6k1/p4ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1",
      uci: "a7a6",
      bestPv: ["h7h6"],
      replyPv: ["d1d8"],
      mateAfter: 1,
    });
    expect(text[0]).toBe("Danach kann dein Gegner in 1 Zug mattsetzen: 2. Rd8#.");
  });

  it("stays silent for the engine's own move", () => {
    expect(explainMove({ fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", uci: "e2e4", bestPv: ["e2e4"], replyPv: ["e7e5"] })).toEqual([]);
  });
});
