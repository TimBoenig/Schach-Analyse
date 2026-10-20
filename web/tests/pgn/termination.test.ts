import { describe, expect, it } from "vitest";

import { parsePgnText } from "../../src/domain/pgn";
import { ReplayBoard, detectTermination } from "../../src/domain/termination";

const H = (extra: Record<string, string>) => ({ White: "Alice", Black: "Bob", ...extra });

describe("detectTermination", () => {
  it("detects checkmate from the board even when the header result disagrees", () => {
    const pgn = '[Event "Test"]\n[White "Player1"]\n[Black "Player2"]\n[Result "1-0"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
    const meta = parsePgnText(pgn)[0].metadata;
    expect([meta.termination_mode, meta.termination_description]).toEqual([
      "checkmate",
      "Player1 gewinnt durch Schachmatt",
    ]);
  });

  it.each([
    [{ Result: "1/2-1/2" }, "k7/1R6/1K6/8/8/8/8/8 b - - 0 1", "stalemate", "Remis durch Patt"],
    [{ Result: "1/2-1/2" }, "8/8/4k3/8/8/2B5/4K3/8 w - - 0 1", "insufficient_material", "Remis durch ungenügendes Material"],
    [{ Result: "1/2-1/2" }, "8/8/4k3/8/8/2R5/4K3/8 w - - 120 80", "fifty_moves", "Remis durch 50-Züge-Regel"],
  ])("detects board states %#", (headers, fen, mode, desc) => {
    expect(detectTermination(H(headers), [], fen)).toEqual([mode, desc]);
  });

  it("detects knight vs knight as sufficient material (python-chess rule)", () => {
    expect(detectTermination(H({ Result: "1/2-1/2" }), [], "8/8/4k3/3n4/8/2N5/4K3/8 w - - 0 1")[0]).toBe("agreed_draw");
  });

  it("detects threefold repetition and a repetition claimable with the next move", () => {
    const shuffle = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"].map((uci) => ({
      uci,
      ply: 0,
      time_left: null,
    }));
    expect(detectTermination(H({ Result: "1/2-1/2" }), shuffle)[0]).toBe("threefold_repetition");
    // After 7 plies Black can claim: f6g8 would reach the start position a third time.
    expect(detectTermination(H({ Result: "1/2-1/2" }), shuffle.slice(0, 7))[0]).toBe("threefold_repetition");
    expect(detectTermination(H({ Result: "1/2-1/2" }), shuffle.slice(0, 5))[0]).toBe("agreed_draw");
  });

  it.each([
    [{ Result: "1-0", Termination: "Alice won by resignation" }, "resignation", "Alice gewinnt durch Aufgabe"],
    [{ Result: "0-1", Termination: "Time forfeit" }, "timeout", "Bob gewinnt durch Zeitüberschreitung"],
    [
      { Result: "1/2-1/2", Termination: "Game drawn by timeout vs insufficient material" },
      "timeout_insufficient",
      "Remis durch Zeitüberschreitung (ungenügendes Material)",
    ],
    [{ Result: "1-0", Termination: "Alice won - game abandoned" }, "abandonment", "Alice gewinnt – Partie abgebrochen"],
    [{ Result: "1/2-1/2", Termination: "Game drawn by agreement" }, "agreed_draw", "Remis durch Einigung"],
    [{ Result: "1-0" }, "resignation", "Alice gewinnt durch Aufgabe"],
    [{ Result: "1/2-1/2" }, "agreed_draw", "Remis durch Einigung"],
    [{ Result: "*" }, "unterminated", "Partie nicht beendet"],
  ])("maps headers %j", (headers, mode, desc) => {
    expect(detectTermination(H(headers), [])).toEqual([mode, desc]);
  });

  it.each([
    ["0-1", "timeout", "Time forfeit"],
    ["1-0", "abandonment", "Alice won - game abandoned"],
    ["1/2-1/2", "threefold_repetition", "Game drawn by repetition"],
  ])("re-detects stored German descriptions (%s)", (result, mode, termination) => {
    const [, desc] = detectTermination(H({ Result: result, Termination: termination }), []);
    expect(detectTermination(H({ Result: result, Termination: desc }), [])[0]).toBe(mode);
  });

  it("falls back to a zero clock as timeout, with the desktop app's ply parity", () => {
    const moves = [
      { uci: "e2e4", ply: 0, time_left: 0 },
      { uci: "e7e5", ply: 1, time_left: 5 },
    ];
    expect(detectTermination(H({ Result: "1-0" }), moves)).toEqual(["timeout", "Alice gewinnt durch Zeitüberschreitung"]);
  });
});

describe("ReplayBoard", () => {
  it("rejects illegal UCI moves and stray promotion suffixes", () => {
    const board = new ReplayBoard();
    expect(() => board.pushUci("e2e5")).toThrow();
    expect(() => board.pushUci("e2e4q")).toThrow();
    board.pushUci("e2e4");
    board.pushUci("0000");
    expect(board.fen()).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2");
  });
});
