import { describe, expect, it } from "vitest";

import { checkPosition, effectiveCastling, parseEditorFen, positionFromFen, setPiece, START_FEN, toFen } from "../../src/domain/positionEditor";

const problems = (fen: string) => checkPosition(positionFromFen(fen));

describe("position editor", () => {
  it("round-trips the starting position", () => {
    expect(toFen(positionFromFen(START_FEN))).toBe(START_FEN);
  });

  it("only keeps castling rights that king and rook still allow", () => {
    const pos = positionFromFen("r3k2r/8/8/8/8/8/8/R3K1N1 w KQkq - 0 1");
    expect(effectiveCastling(pos)).toEqual({ K: false, Q: true, k: true, q: true });
    expect(toFen(pos).split(" ")[2]).toBe("Qkq");
    expect(toFen(positionFromFen("4k3/8/8/8/8/8/8/4K3 w KQkq - 0 1")).split(" ")[2]).toBe("-");
  });

  it("accepts a legal endgame and reports each kind of impossible position", () => {
    expect(problems("8/8/8/4k3/8/4K3/4P3/8 w - - 0 1")).toEqual([]);
    expect(problems("8/8/8/8/8/4K3/8/8 w - - 0 1")).toEqual(["no-black-king"]);
    expect(problems("8/8/8/8/8/8/8/8 w - - 0 1")).toEqual(["no-white-king", "no-black-king"]);
    expect(problems("k7/8/8/8/8/8/8/KK6 w - - 0 1")).toEqual(["many-white-kings"]);
    expect(problems("k6P/8/8/8/8/8/8/4K3 w - - 0 1")).toEqual(["pawn-on-edge"]);
    expect(problems("8/8/8/8/3kK3/8/8/8 w - - 0 1")).toEqual(["kings-touch"]);
    // Black is in check by the rook but it is White's turn: Black would have had to answer it.
    expect(problems("4k3/8/8/8/8/8/8/4RK2 w - - 0 1")).toEqual(["opponent-in-check"]);
    expect(problems("4k3/8/8/8/8/8/8/4RK2 b - - 0 1")).toEqual([]);
    expect(problems("4k3/pppppppp/p7/8/8/8/8/4K3 w - - 0 1")).toEqual(["too-many-black-pawns"]);
  });

  it("keeps one king per side when a king is placed again", () => {
    const pieces = setPiece(positionFromFen("4k3/8/8/8/8/8/8/4K3 w - - 0 1").pieces, "a1", "K");
    expect([...pieces].filter(([, p]) => p === "K")).toEqual([["a1", "K"]]);
  });

  it("reads typed FEN strictly on the board and loosely elsewhere", () => {
    expect(parseEditorFen("8/8/8/8/8/8/8/8")?.turn).toBe("w");
    expect(parseEditorFen("  4k3/8/8/8/8/8/8/4K3 b - - 5 40 ")?.turn).toBe("b");
    expect(parseEditorFen("4k3/8/8/8/8/8/8")).toBeNull();
    expect(parseEditorFen("4k4/8/8/8/8/8/8/4K3")).toBeNull();
    expect(parseEditorFen("4k3/8/8/8/8/8/8/4K3 x")).toBeNull();
    expect(parseEditorFen("hello")).toBeNull();
  });
});
