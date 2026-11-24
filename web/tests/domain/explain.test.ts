// Concrete move explanations: motifs of the opponent's reply and of the better move.
import { describe, expect, it } from "vitest";

import { explainMove, explainMoveDetailed } from "../../src/domain/explain";
import { setLangNow } from "../../src/i18n";
import { EN } from "../../src/i18n/en";

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

  it("says what a quiet engine move is about", () => {
    expect(explainMove({ fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", uci: "e2e4", bestPv: ["e2e4"], replyPv: ["e7e5"] })).toEqual(["Mit e4 besetzt du das Zentrum."]);
  });

  // Black's knight on g4 threatens Ne3, forking queen d1 and rook f1.
  const FORK_THREAT = "6k1/5pp1/7p/8/6n1/8/PP4PP/3Q1R1K w - - 0 1";

  it("says which fork a good move prevented and marks it on the board", () => {
    const res = explainMoveDetailed({ fenBefore: FORK_THREAT, uci: "d1d2", bestPv: ["d1d2"], replyPv: [], classification: "Best" });
    expect(res.lines).toEqual(["Du verhinderst damit eine Springergabel auf e3 (Ne3) gegen deine Dame und deinen Turm."]);
    expect(res.arrows).toEqual([{ from: "g4", to: "e3", by: "opp" }]);
    expect(res.squares).toEqual(["e3"]);
  });

  it("calls out an ignored threat and the move that would have stopped it", () => {
    const text = explainMove({ fenBefore: FORK_THREAT, uci: "a2a3", bestPv: ["d1d2"], replyPv: ["g4e3", "d1d2", "e3f1"], classification: "Mistake" });
    expect(text[0]).toMatch(/^Du hast die Drohung übersehen: Dein Gegner antwortet Ne3 und greift mit einer Gabel deine Dame und deinen Turm/);
    expect(text[1]).toBe("Besser war Qd2: Damit verhinderst du eine Springergabel auf e3 (Ne3).");
  });

  it.each([
    ["own fork", "r3k2r/ppp2ppp/8/3N4/8/8/PPP2PPP/R3K2R w KQkq - 0 1", "d5c7", "Mit Nxc7+ greifst du mit einer Springergabel seinen König und seinen Turm gleichzeitig an."],
    ["saved piece", "rnbqkbnr/pppp1ppp/8/8/4p3/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 3", "f3d4", "Du bringst deinen Springer in Sicherheit: Auf f3 war er angegriffen und nicht ausreichend gedeckt."],
    ["prevented mate", "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3", "g7g6", "Du verhinderst damit das drohende Matt durch Qxf7#."],
    ["mate threat", "6k1/5ppp/8/8/8/P7/R4PPP/6K1 w - - 0 1", "a2c2", "Du drohst Matt mit Rc8#."],
    ["recapture", "rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2", "d8d5", "Du schlägst zurück und gleichst das Material wieder aus."],
    ["castling", "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4", "e1g1", "Du rochierst: Dein König steht sicherer und dein Turm kommt ins Spiel."],
  ])("explains what a good move does: %s", (_name, fenBefore, uci, expected) => {
    expect(explainMove({ fenBefore, uci, bestPv: [uci], replyPv: [], classification: "Best" })[0]).toBe(expected);
  });

  it("does not claim a prevented threat when the move only gives check", () => {
    // Qd8+ postpones Ne3 but does not stop it.
    const text = explainMove({ fenBefore: FORK_THREAT, uci: "d1d8", bestPv: ["d1d8"], replyPv: [], classification: "Good" });
    expect(text.join(" ")).not.toContain("verhinderst");
  });
});

describe("explainMove: causes without a tactic", () => {
  const err = (fenBefore: string, uci: string, extra: Partial<Parameters<typeof explainMove>[0]> = {}) =>
    explainMove({ fenBefore, uci, bestPv: [], replyPv: [], classification: "Mistake", ...extra }).join(" ");

  it.each([
    ["king shield pawn leaves", "r2q1rk1/ppp2ppp/2n5/8/8/2N5/PPP2PPP/R2Q1RK1 w - - 0 1", "g2g4", /Schutzbauer deinen König \(g2\)/],
    ["queen trade into an endgame", "r2q2k1/ppp2ppp/8/8/8/8/PPP2PPP/R2Q2K1 w - - 0 1", "d1d8", /Damentausch führt in ein Endspiel/],
    ["new isolated pawns", "4k3/8/8/8/1p6/2P5/3P4/4K3 w - - 0 1", "c3b4", /Dein Bauer auf (b4|d2) hat keine Nachbarbauern mehr/],
    ["castling right lost", "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4", "e1e2", /Recht zu rochieren/],
  ])("%s", (_name, fen, uci, expected) => {
    expect(err(fen, uci, uci === "d1d8" ? { replyPv: ["a8d8"] } : {})).toMatch(expected);
  });

  it("names the missed promotion", () => {
    const text = err("8/4P3/8/8/8/8/k7/4K3 w - - 0 1", "e1d1", { bestPv: ["e7e8q"], replyPv: ["a2b3"] });
    expect(text).toContain("umgewandelt");
  });

  it("describes how the position shifted and what the better move does when nothing concrete is found", () => {
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const lines = explainMove({ fenBefore: start, uci: "a2a3", bestPv: ["e2e4"], replyPv: [], classification: "Inaccuracy", winBefore: 0.75, winAfter: 0.5 });
    expect(lines).toEqual(["Die Stellung war für dich klar besser, jetzt ist sie ausgeglichen.", "Besser war e4: Damit besetzt du das Zentrum."]);
    setLangNow("en", EN);
    try {
      expect(explainMove({ fenBefore: start, uci: "a2a3", bestPv: ["e2e4"], replyPv: [], classification: "Inaccuracy", winBefore: 0.75, winAfter: 0.5 })).toEqual([
        "The position was clearly better for you, now it is even.",
        "Better was e4: with it you take the centre.",
      ]);
    } finally {
      setLangNow("de");
    }
  });
});
