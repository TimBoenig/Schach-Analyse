import { describe, expect, it } from "vitest";

import { activeIn, extendLine, fullLine, lineMoveNumber, mergeLine, resumeLine, startLine, threatFen } from "../../src/ui/sideLines";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function line(base: number, ucis: string[], pending: string[] = []) {
  let l = startLine(base, START);
  for (const u of ucis) l = extendLine(l, u, []);
  return { ...l, pending };
}

describe("side lines (move tree)", () => {
  it("keeps the longest version of a line and drops repeats of its start", () => {
    const short = line(0, ["e2e4"]);
    const long = line(0, ["e2e4", "e7e5", "g1f3"]);
    let kept = mergeLine([], short);
    kept = mergeLine(kept, long);
    expect(kept.map((l) => l.sans)).toEqual([["e4", "e5", "Nf3"]]);
    // Going back into the line and leaving again must not add a copy.
    expect(mergeLine(kept, line(0, ["e2e4", "e7e5"]))).toBe(kept);
    // A different branch is a second line.
    expect(mergeLine(kept, line(0, ["d2d4"]))).toHaveLength(2);
  });

  it("stores not yet played engine moves with the line and resumes at any move", () => {
    const picked = line(0, ["e2e4"], ["e7e5", "g1f3", "b8c6"]);
    expect(fullLine(picked).sans).toEqual(["e4", "e5", "Nf3", "Nc6"]);
    const kept = mergeLine([], picked);
    const back = resumeLine(kept[0], 1);
    expect(back.sans).toEqual(["e4", "e5"]);
    expect(back.pending).toEqual(["g1f3", "b8c6"]);
    expect(activeIn(kept, back)).toEqual({ line: kept[0], ply: 1 });
  });

  it("stops at an illegal engine move instead of storing a broken line", () => {
    expect(fullLine(line(0, ["e2e4"], ["e2e4", "e7e5"])).sans).toEqual(["e4"]);
  });

  it("numbers moves like a score sheet", () => {
    const l = line(0, ["e2e4", "e7e5", "g1f3"]);
    expect([0, 1, 2].map((k) => lineMoveNumber(l, k))).toEqual(["1.", null, "2."]);
    const fromBlack = extendLine(startLine(1, l.fens[1]), "e7e5", []);
    expect(lineMoveNumber(fromBlack, 0)).toBe("1…");
  });
});

describe("threat mode", () => {
  it("passes the move to the other side and clears en passant", () => {
    const fen = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2";
    expect(threatFen(fen)).toBe("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2");
  });

  it("has no threat while in check", () => {
    expect(threatFen("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3")).toBeNull();
  });
});
