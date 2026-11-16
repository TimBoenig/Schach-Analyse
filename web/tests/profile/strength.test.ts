import { describe, expect, it } from "vitest";

import { GameFeatures, MoveEvent } from "../../src/domain/profile/features";
import type { GameRecord } from "../../src/domain/metrics/models";
import {
  buildPlayerProfile,
  ELO_PER_LN_ERRORS,
  ELO_MIN,
  type GamePair,
  MIN_STRENGTH_GAMES,
  performanceRating,
  STRENGTH_MIN,
  strengthMap,
  lichessBlitzToElo,
  toElo,
  toLichessBlitz,
} from "../../src/domain/profile";
import { buildMoves, gameRow } from "./fixtures";

describe("Elo conversion", () => {
  it("maps each platform and speed through the survey to the same Elo", () => {
    // One survey row: Chess.com blitz 1500 = bullet 1385 = rapid 1655 = Lichess blitz 1755 = Lichess rapid 1905.
    for (const [rating, source, speed] of [
      [1500, "chesscom", "Blitz"],
      [1385, "chesscom", "Bullet"],
      [1655, "chesscom", "Rapid"],
      [1755, "lichess", "Blitz"],
      [1905, "lichess", "Rapid"],
    ] as const) {
      expect(toElo(rating, source, speed)).toBe(1655);
    }
  });

  it("gives every beginner an own value instead of one floor", () => {
    const values = [300, 500, 700, 900, 1100, 1300].map((r) => toElo(r, "chesscom", "Rapid"));
    // The shown scale is Chess.com rapid, so these read back as themselves.
    expect(values).toEqual([300, 500, 700, 900, 1100, 1300]);
    const lichess = [700, 900, 1100, 1300].map((r) => toElo(r, "lichess", "Blitz"));
    for (let i = 1; i < lichess.length; i++) expect(lichess[i]).toBeGreaterThan(lichess[i - 1] + 100);
    expect(toElo(-500, "chesscom", "Rapid")).toBe(ELO_MIN);
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

describe("skill strength as Elo", () => {
  const anchor = toLichessBlitz(1500, "chesscom", "Blitz"); // 1755, prior on the Lichess scale
  const anchorElo = toElo(1500, "chesscom", "Blitz"); // 1655

  it("places a player who errs like the opponents at the opponents' level", () => {
    const m = strengthMap(pairs(40, 3, 3), anchor)!;
    expect(m.opponents_elo).toBe(anchorElo);
    for (const s of [...m.skills, m.overall!]) expect(Math.abs(s.rating - anchorElo)).toBeLessThanOrEqual(s.margin);
  });

  it("does not care how many errors the engine finds, only the ratio", () => {
    // A shallower engine that misses half the errors on both sides must give the same estimate.
    const deep = strengthMap(pairs(40, 4, 6), anchor)!;
    const shallow = strengthMap(pairs(40, 2, 3), anchor)!;
    expect(shallow.overall!.rating).toBe(deep.overall!.rating);
    expect(shallow.overall!.rating).toBeGreaterThan(anchorElo);
  });

  it("reads half the opponents' errors as about 849 · ln 2 Lichess points above them once the data is plentiful", () => {
    const m = strengthMap(pairs(300, 2, 4), anchor)!;
    const full = ELO_PER_LN_ERRORS * Math.log(2);
    expect(m.overall!.error_ratio).toBeCloseTo(0.5, 1);
    const top = lichessBlitzToElo(anchor + full);
    expect(m.overall!.rating).toBeGreaterThan(top - 80);
    expect(m.overall!.rating).toBeLessThanOrEqual(top + 10);
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

  it("stays finite when one side never blunders and caps at the lowest shown Elo", () => {
    const clean = strengthMap(pairs(60, 3, 3, 1500, [0, 12]), anchor)!;
    const safety = clean.skills.find((s) => s.key === "safety")!;
    expect(Number.isFinite(safety.rating)).toBe(true);
    expect(safety.rating).toBeGreaterThan(anchorElo);
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
    expect(rc.elo).toBe(1200);
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
