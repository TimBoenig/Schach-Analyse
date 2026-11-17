// Which rating pool a game belongs to. The platforms draw the lines
// differently; a game filed under the wrong pool puts a foreign rating into a
// rating line.
import { describe, expect, it } from "vitest";

import { detectSpeedCategory, hasRatingPool, UNTIMED } from "../../src/domain/metrics/speed";

describe("detectSpeedCategory", () => {
  it.each([
    // PGN files: the generic limits.
    ["15", null, undefined, "UltraBullet"],
    ["60+0", null, undefined, "Bullet"],
    ["180+2", null, undefined, "Blitz"],
    ["600", null, undefined, "Rapid"],
    ["1800", null, undefined, "Classical"],
    ["40/7200", null, undefined, "Classical"],
    ["1/86400", null, undefined, "Daily"],
    ["-", "Rated Bullet game", undefined, "Bullet"],
    [null, "Casual correspondence game", undefined, "Daily"],
    // Chess.com rates everything from ten minutes up as rapid and has no ultrabullet.
    ["1800", "Live Chess", "chesscom", "Rapid"],
    ["7200+60", "Live Chess", "chesscom", "Rapid"],
    ["40/7200", "Live Chess", "chesscom", "Rapid"],
    ["15+0.3", "Live Chess", "chesscom", "Bullet"],
    ["300+5", "Live Chess", "chesscom", "Blitz"],
    ["1/259200", "Let's Play!", "chesscom", "Daily"],
    // Lichess: blitz ends at eight minutes, rapid at 25; the event names the pool.
    ["480+0", null, "lichess", "Rapid"],
    ["300+5", null, "lichess", "Rapid"],
    ["1500+0", null, "lichess", "Classical"],
    ["300+3", "Rated Blitz game", "lichess", "Blitz"],
    ["600+0", "Hourly Rapid Arena", "lichess", "Rapid"],
    ["2 days per move", "Rated correspondence game", "lichess", "Daily"],
    // No clock at all: never guessed into a pool.
    ["-", "Play vs Coach", "chesscom", UNTIMED],
    [null, null, undefined, UNTIMED],
    ["?", "Vereinsmeisterschaft", "file", UNTIMED],
  ])("%j / %j on %j -> %s", (tc, event, source, expected) => {
    expect(detectSpeedCategory(tc, event, source)).toBe(expected);
  });

  it("knows which categories have a rating pool", () => {
    expect([UNTIMED, "", null, "Blitz", "Daily"].map(hasRatingPool)).toEqual([false, false, false, true, true]);
  });
});
