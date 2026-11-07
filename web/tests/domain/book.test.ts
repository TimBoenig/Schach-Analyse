// Opening names: the book build names each position after the line that ends
// there, and stored games are re-labelled from the book.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";

import { buildBookData } from "../../scripts/build-book.mjs";
import { type BookData, bookKey, openingOf, relabelBookMoves } from "../../src/domain/book";
import { emptyMove } from "../../src/domain/types";

const TSV = [
  "eco\tname\tpgn",
  "B00\tKing's Pawn Game\t1. e4",
  "B20\tSicilian Defense\t1. e4 c5",
  "B33\tSicilian Defense: Lasker-Pelikan Variation, Sveshnikov Variation, Peresypkin's Sacrifice\t1. e4 c5 2. Nf3 Nc6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 e5 6. Ndb5 d6 7. Bg5 a6 8. Na3 b5 9. Bxf6 gxf6 10. Nd5 f5 11. Bd3 Be6 12. Qh5",
  "C50\tItalian Game\t1. e4 e5 2. Nf3 Nc6 3. Bc4",
  "C50\tItalian Game: Giuoco Piano\t1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5",
].join("\n");

function fensOf(sans: string[]): string[] {
  const b = new Chess();
  return [b.fen(), ...sans.map((s) => (b.move(s), b.fen()))];
}

const book = (() => {
  const dir = mkdtempSync(join(tmpdir(), "book-"));
  writeFileSync(join(dir, "x.tsv"), TSV);
  return buildBookData(dir) satisfies BookData;
})();

describe("opening book", () => {
  it("names in-between positions after the last named position, not after deeper lines", () => {
    const name = (sans: string[]) => openingOf(book, fensOf(sans))?.name;
    expect(name(["e4"])).toBe("King's Pawn Game");
    expect(name(["e4", "c5"])).toBe("Sicilian Defense");
    expect(name(["e4", "c5", "Nf3", "Nc6", "d4"])).toBe("Sicilian Defense");
    expect(name(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"])).toBe("Italian Game: Giuoco Piano");
    // After leaving the book the game keeps its last opening name.
    expect(openingOf(book, fensOf(["e4", "e5", "Nf3", "Nc6", "Bc4", "h6", "d3"]))).toMatchObject({ eco: "C50", name: "Italian Game", index: 5 });
    // The start position is no opening.
    expect(book[bookKey(new Chess().fen())]).toBeUndefined();
  });

  it("re-labels the book moves of a stored game and reports the corrected opening", () => {
    const sans = ["e4", "c5", "Nf3"];
    const fens = fensOf(sans);
    const moves = sans.map((san, i) => {
      const uci = new Chess(fens[i]).move(san).lan;
      return emptyMove({ san, uci, fen_before: fens[i], is_book_move: i < 2, eco: "B33", opening_name: "Sicilian Defense: Lasker-Pelikan Variation" });
    });
    expect(relabelBookMoves(moves, book)).toEqual({ eco: "B20", name: "Sicilian Defense" });
    expect(moves.map((m) => m.opening_name)).toEqual(["King's Pawn Game", "Sicilian Defense", "Sicilian Defense: Lasker-Pelikan Variation"]);
    // Nothing left to fix: no write needed.
    expect(relabelBookMoves(moves, book)).toBeNull();
  });
});
