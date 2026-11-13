// The board's own geometry: what slides where, where arrows snap, which king is in check.
import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";

import {
  arrowGeometry,
  carryPieces,
  checkedKing,
  readPlacement,
  screenPos,
  snapTarget,
  squareAtFraction,
  type PlacedPiece,
} from "../../src/ui/board/geometry";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function counter(from = 100) {
  let n = from;
  return () => n++;
}

function placed(fen: string): PlacedPiece[] {
  const next = counter(1);
  return [...readPlacement(fen)].map(([square, piece]) => ({ id: next(), piece, square }));
}

function after(fen: string, ...sans: string[]): string {
  const c = new Chess(fen);
  for (const s of sans) c.move(s);
  return c.fen();
}

describe("board placement and squares", () => {
  it("reads every piece of a position and ignores junk", () => {
    const p = readPlacement(START);
    expect(p.size).toBe(32);
    expect([p.get("e1"), p.get("d8"), p.get("a2"), p.get("h7")]).toEqual(["K", "q", "P", "p"]);
    expect(readPlacement("9x9/zz").size).toBe(0);
    expect(readPlacement("").size).toBe(0);
  });

  it.each([
    [false, 0.01, 0.01, "a8"],
    [false, 0.99, 0.99, "h1"],
    [true, 0.01, 0.01, "h1"],
    [true, 0.99, 0.99, "a8"],
    [false, 0.5, 0.5, "e4"],
    [false, 1.2, 0.5, null],
  ] as const)("flipped=%s, point (%s, %s) is %s", (flipped, x, y, sq) => {
    expect(squareAtFraction(x, y, flipped)).toBe(sq);
    if (sq) {
      const [c, r] = screenPos(sq, flipped);
      expect(squareAtFraction((c + 0.5) / 8, (r + 0.5) / 8, flipped)).toBe(sq);
    }
  });
});

describe("pieces keep their identity between positions", () => {
  it("slides only the moved piece and drops a captured one", () => {
    const prev = placed(START);
    const id = (list: PlacedPiece[], sq: string) => list.find((p) => p.square === sq)?.id;
    const e4 = carryPieces(prev, readPlacement(after(START, "e4")), counter());
    expect(id(e4, "e4")).toBe(id(prev, "e2"));
    expect(e4.every((p) => p.id < 100)).toBe(true);

    const fen = after(START, "e4", "d5");
    const before = carryPieces(placed(fen), readPlacement(fen), counter());
    const taken = carryPieces(before, readPlacement(after(fen, "exd5")), counter());
    expect(taken).toHaveLength(31);
    expect(id(taken, "d5")).toBe(id(before, "e4"));
  });

  it("moves king and rook together when castling", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    const prev = placed(fen);
    const next = carryPieces(prev, readPlacement(after(fen, "O-O")), counter());
    const id = (list: PlacedPiece[], sq: string) => list.find((p) => p.square === sq)?.id;
    expect(id(next, "g1")).toBe(id(prev, "e1"));
    expect(id(next, "f1")).toBe(id(prev, "h1"));
  });

  it("gives each of two knights its own move and lets a promotion appear new", () => {
    const fen = "4k3/1P6/8/8/8/8/8/1N2K1N1 w - - 0 1";
    const prev = placed(fen);
    const id = (list: PlacedPiece[], sq: string) => list.find((p) => p.square === sq)?.id;
    const next = carryPieces(prev, readPlacement(after(fen, "Nf3")), counter());
    expect(id(next, "f3")).toBe(id(prev, "g1"));
    expect(id(next, "b1")).toBe(id(prev, "b1"));
    const promoted = carryPieces(prev, readPlacement(after(fen, "b8=Q+")), counter());
    expect(id(promoted, "b8")).toBe(100);
  });

  it("gives a piece dropped by hand a new identity, so it does not slide again", () => {
    const prev = placed(START);
    const next = carryPieces(prev, readPlacement(after(START, "Nf3")), counter(), new Set(["f3"]));
    expect(next.find((p) => p.square === "f3")?.id).toBe(100);
    expect(next).toHaveLength(32);
  });
});

describe("arrows", () => {
  it("snaps a drawn arrow to the nearest queen line or knight jump", () => {
    // From e2 (screen column 4, row 6) towards a point between e4 and f4 that is closer to f4.
    expect(snapTarget("e2", 5.4, 4.5, false)).toBe("f4");
    expect(snapTarget("e2", 4.5, 4.4, false)).toBe("e4");
    expect(snapTarget("g1", 5.6, 5.4, false)).toBe("f3");
    expect(snapTarget("g1", 6.5, 7.5, false)).toBe("g1");
  });

  it("draws knight moves as an L and points straight arrows at the square centre", () => {
    const knight = arrowGeometry("g1", "f3", false, 0.2);
    expect(knight.shaft).toHaveLength(3);
    expect(knight.shaft[1]).toEqual([6.5, 5.5]);
    const straight = arrowGeometry("e2", "e4", false, 0.2);
    expect(straight.shaft).toHaveLength(2);
    const [tipX, tipY] = straight.head[0];
    expect(tipX).toBeCloseTo(4.5);
    expect(Math.abs(tipY - 4.5)).toBeLessThan(0.1);
    // The shaft stops where the head begins, so a translucent arrow has no darker overlap.
    expect(straight.shaft[1][1]).toBeGreaterThan(tipY);
  });
});

describe("check highlight", () => {
  it("agrees with chess.js on positions from real play", () => {
    const fens: string[] = [];
    const games = [
      ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"],
      ["f3", "e5", "g4", "Qh4#"],
      ["e4", "d5", "exd5", "Qxd5", "Nc3", "Qe5+", "Be2", "Bg4", "d4", "Bxe2", "Qxe2", "Qxe2+", "Ngxe2"],
      ["d4", "e6", "c4", "Bb4+", "Nc3", "Nf6", "Qc2", "O-O", "a3", "Bxc3+", "Qxc3", "Ne4", "Qc2", "Qh4", "g3", "Nxg3", "fxg3", "Qxg3+", "hxg3"],
    ];
    for (const g of games) {
      const c = new Chess();
      for (const s of g) {
        c.move(s);
        fens.push(c.fen());
      }
    }
    fens.push("8/8/8/8/8/2k5/1p6/K7 w - - 0 1", "4k3/8/8/8/8/8/3n4/4K3 w - - 0 1", "4k3/8/8/b7/8/8/8/4K3 w - - 0 1", "4k3/8/8/8/1b6/2P5/8/4K3 w - - 0 1");
    for (const fen of fens) {
      const c = new Chess(fen, { skipValidation: true });
      const white = fen.split(" ")[1] === "w";
      const expected = c.inCheck() ? c.findPiece({ type: "k", color: white ? "w" : "b" })[0] : null;
      expect(checkedKing(readPlacement(fen), white), fen).toBe(expected);
    }
  });
});
