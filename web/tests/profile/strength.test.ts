import { describe, expect, it } from "vitest";

import { GameFeatures, MoveEvent } from "../../src/domain/profile/features";
import type { GameRecord } from "../../src/domain/metrics/models";
import {
  buildPlayerProfile,
  ELO_PER_LN_ERRORS,
  FIDE_FLOOR,
  type GamePair,
  MIN_STRENGTH_GAMES,
  performanceRating,
  STRENGTH_MIN,
  strengthMap,
  toFide,
} from "../../src/domain/profile";
import { buildMoves, gameRow } from "./fixtures";

describe("FIDE conversion", () => {
  it("maps each platform and speed through the survey to the same FIDE value", () => {
    // One survey row: Chess.com blitz 1500 = bullet 1385 = rapid 1655 = Lichess blitz 1755 = Lichess rapid 1905 = FIDE 1740.
    for (const [rating, source, speed] of [
      [1500, "chesscom", "Blitz"],
      [1385, "chesscom", "Bullet"],
      [1655, "chesscom", "Rapid"],
      [1755, "lichess", "Blitz"],
      [1905, "lichess", "Rapid"],
    ] as const) {
      expect(toFide(rating, source, speed)).toEqual({ rating: 1740, extrapolated: false, as_is: false });
    }
    // A Lichess number is not a Chess.com number: the same 1800 is ~100 FIDE points apart.
    expect(toFide(1800, "chesscom", "Blitz").rating - toFide(1800, "lichess", "Blitz").rating).toBeGreaterThan(80);
  });

  it("never goes below the FIDE floor and flags the part below the survey", () => {
    expect(toFide(400, "chesscom", "Rapid")).toEqual({ rating: FIDE_FLOOR, extrapolated: true, as_is: false });
    const low = toFide(1000, "chesscom", "Rapid");
    expect(low.extrapolated).toBe(true);
    expect(low.rating).toBeGreaterThan(FIDE_FLOOR);
    expect(low.rating).toBeLessThan(1660);
    // PGN files carry over-the-board ratings and stay as they are.
    expect(toFide(1873, "file", "Classical")).toEqual({ rating: 1873, extrapolated: false, as_is: true });
  });

  it("rises with the rating on every column", () => {
    for (const [source, speed] of [["chesscom", "Blitz"], ["chesscom", "Rapid"], ["lichess", "Classical"], ["lichess", "Bullet"]]) {
      let prev = 0;
      for (let r = 600; r <= 2900; r += 50) {
        const f = toFide(r, source, speed).rating;
        expect(f).toBeGreaterThanOrEqual(prev);
        prev = f;
      }
    }
  });
});

// Synthetic analysed games: each side loses `perMove` winning chance (percent
// points) per move on average in every phase. Like real games most moves cost
// little and a few cost a lot, which is what makes a handful of games noisy.
const hash = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const record = { game_acc: 80, speed: "Blitz", raw_game: { source: "chesscom" } } as unknown as GameRecord;
function side(i: number, perMove: number, oppRating: number, blunderEvery = 0): GameFeatures {
  const f = new GameFeatures(record, `g${i}`, null, "", 1500, oppRating, false);
  let ply = 0;
  for (const phase of ["opening", "middlegame", "endgame"]) {
    for (let k = 0; k < 10; k++) {
      const big = hash(i, ply) < 0.08;
      const loss = (big ? (perMove * 0.7) / 0.08 : (perMove * 0.3) / 0.92) / 100;
      const blunder = blunderEvery > 0 && (ply + i) % blunderEvery === 0;
      f.moves.push(new MoveEvent(ply, ply + 1, "e4", "e2e4", "", blunder ? "Blunder" : "Good", phase, 0.5, 0.5 - loss, null, null, null, false, false, false, ply));
      ply += 1;
    }
  }
  f.punish_chances = 4;
  f.punished = 2 + (i % 3);
  return f;
}
const pairs = (n: number, own: number, opp: number, oppRating = 1500, blunders: [number, number] = [0, 0]): GamePair[] =>
  Array.from({ length: n }, (_, i) => ({ own: side(i, own, oppRating, blunders[0]), opp: side(i + 1000, opp, 1500, blunders[1]) }));

describe("skill strength on the FIDE scale", () => {
  const anchor = toFide(1500, "chesscom", "Blitz").rating; // 1740

  it("places a player who errs like the opponents at the opponents' FIDE level", () => {
    const m = strengthMap(pairs(40, 3, 3), anchor)!;
    expect(m.opponents_fide).toBe(anchor);
    for (const s of [...m.skills, m.overall!]) expect(Math.abs(s.rating - anchor)).toBeLessThanOrEqual(s.margin);
  });

  it("does not care how many errors the engine finds, only the ratio", () => {
    // A shallower engine that misses half the errors on both sides must give the same estimate.
    const deep = strengthMap(pairs(40, 4, 6), anchor)!;
    const shallow = strengthMap(pairs(40, 2, 3), anchor)!;
    expect(shallow.overall!.rating).toBe(deep.overall!.rating);
    expect(shallow.overall!.rating).toBeGreaterThan(anchor);
  });

  it("reads half the opponents' errors as about 450 · ln 2 above them once the data is plentiful", () => {
    const m = strengthMap(pairs(300, 2, 4), anchor)!;
    const full = ELO_PER_LN_ERRORS * Math.log(2);
    expect(m.overall!.error_ratio).toBeCloseTo(0.5, 1);
    expect(m.overall!.rating - anchor).toBeGreaterThan(full - 60);
    expect(m.overall!.rating - anchor).toBeLessThanOrEqual(full + 10);
    expect(m.overall!.reliable).toBe(true);
  });

  it("keeps a few games close to the player's own rating with a wide margin", () => {
    const few = strengthMap(pairs(MIN_STRENGTH_GAMES, 2, 4), anchor)!;
    const many = strengthMap(pairs(300, 2, 4), anchor)!;
    expect(few.overall!.rating).toBeLessThan(many.overall!.rating);
    expect(few.overall!.margin).toBeGreaterThan(many.overall!.margin);
    expect(few.skills.every((s) => !s.reliable)).toBe(true);
  });

  it("needs a minimum of rated, analysed games", () => {
    expect(strengthMap(pairs(MIN_STRENGTH_GAMES - 1, 2, 4), anchor)).toBeNull();
    expect(strengthMap(pairs(20, 2, 4, 0), anchor)).toBeNull();
  });

  it("stays finite when one side never blunders and caps at the FIDE floor", () => {
    const clean = strengthMap(pairs(60, 3, 3, 1500, [0, 12]), anchor)!;
    const safety = clean.skills.find((s) => s.key === "safety")!;
    expect(Number.isFinite(safety.rating)).toBe(true);
    expect(safety.rating).toBeGreaterThan(anchor);
    // Weak opponents and far more errors: below the scale, said as such.
    const weak = strengthMap(pairs(300, 12, 2, 400), null)!;
    expect(weak.overall!.capped).toBe(-1);
    expect(weak.overall!.rating).toBe(STRENGTH_MIN);
  });
});

describe("rating context against the right games", () => {
  const moves = buildMoves({});
  const row = (id: string, day: number, source: string, own: string, opp: string, result: string) => ({
    ...gameRow(id, moves, { result, utc: `2026.06.${String(day).padStart(2, "0")} 18:00:00` }),
    source,
    white_elo: own,
    black_elo: opp,
  });

  it("takes performance and average opponent from the shown rating's platform only", () => {
    const games = [
      row("c1", 1, "chesscom", "1200", "1200", "1-0"),
      row("c2", 2, "chesscom", "1205", "1250", "0-1"),
      row("c3", 3, "chesscom", "1200", "1150", "1-0"),
      // Lichess ratings run ~400 higher; mixing them in inflated "Ø Gegner" and performance.
      row("l1", 4, "lichess", "1620", "1700", "1-0"),
      row("l2", 5, "lichess", "1630", "1650", "1-0"),
    ];
    const rc = buildPlayerProfile(games, ["Tim"]).rating!;
    expect(rc.source).toBe("chesscom");
    expect(rc.line_games).toBe(3);
    expect(rc.avg_opponent).toBe(1200);
    expect(rc.performance).toBe(performanceRating([{ opp: 1200, score: 1 }, { opp: 1250, score: 0 }, { opp: 1150, score: 1 }]));
    expect(rc.rated_games).toBe(5);
    expect(rc.fide).toBe(toFide(1200, "chesscom", "Rapid").rating);
  });

  it("measures 'typical' on the opponents of the same games once there are enough", () => {
    const few = buildPlayerProfile(Array.from({ length: 5 }, (_, i) => row(`f${i}`, i + 1, "chesscom", "1500", "1500", "1-0")), ["Tim"]).rating!;
    expect(few.reference).toBe("estimate");
    const games = Array.from({ length: 12 }, (_, i) => ({
      ...row(`o${i}`, i + 1, "chesscom", "1500", "1500", "1-0"),
      summary_json: JSON.stringify({ white: { accuracy: 80 }, black: { accuracy: 71 }, analysis_status: "completed" }),
    }));
    const p = buildPlayerProfile(games, ["Tim"]);
    expect(p.rating!.reference).toBe("opponents");
    expect(p.rating!.reference_games).toBe(12);
    expect(p.rating!.typical_accuracy).toBeCloseTo(71, 0);
    expect(p.skills.find((s) => s.key === "opening")!.typical_from).toBe("opponents");
    // Conversion mirrors the player's own defence, so it keeps the table reference.
    expect(p.skills.find((s) => s.key === "conversion")!.typical_from).toBe("table");
  });
});
