// One platform game keeps one record, whatever its PGN looks like.
import { describe, expect, it } from "vitest";

import { duplicateGameIds, platformGameKey } from "../../src/domain/gameKey";
import type { StoredGame } from "../../src/domain/types";

const lichess = (site: string) => ({ source: "lichess", pgn: `[Event "Rated Blitz game"]\n[Site "${site}"]\n\n1. e4 *` });

describe("platformGameKey", () => {
  it.each([
    [lichess("https://lichess.org/Ab3dEf9h"), "lichess:Ab3dEf9h"],
    // Lichess changed the header; the game is the same.
    [lichess("https://lichess.org/game/Ab3dEf9h"), "lichess:Ab3dEf9h"],
    // Links copied from the board carry the colour or the player's token.
    [lichess("https://lichess.org/Ab3dEf9h/black"), "lichess:Ab3dEf9h"],
    [lichess("https://lichess.org/Ab3dEf9hXy12"), "lichess:Ab3dEf9h"],
    [{ source: "chesscom", pgn: `[Site "Chess.com"]\n[Link "https://www.chess.com/game/live/123456"]\n\n1. e4 *` }, "chesscom:live/123456"],
    [{ source: "chesscom", pgn: `[Site "Chess.com"]\n[Link "https://www.chess.com/game/daily/123456"]\n\n1. e4 *` }, "chesscom:daily/123456"],
    [{ source: "file", pgn: `[Site "Hamburg"]\n\n1. e4 *` }, null],
    [{ source: "chesscom", pgn: "" }, null],
  ])("%#", (game, key) => {
    expect(platformGameKey(game)).toBe(key);
  });
});

describe("duplicateGameIds", () => {
  const row = (id: string, site: string, extra: Partial<StoredGame> = {}) =>
    ({ id, ...lichess(site), moves_json: Array(40).fill({}), summary_json: {}, updated_at: 1, ...extra }) as unknown as StoredGame;

  it("keeps the analysed copy of a game stored twice and leaves other games alone", () => {
    const games = [
      row("a", "https://lichess.org/Ab3dEf9h"),
      row("b", "https://lichess.org/game/Ab3dEf9h", { summary_json: { analysis_status: "completed" } }),
      row("c", "https://lichess.org/Zz3dEf9h"),
      { id: "file-1", source: "file", pgn: `[Site "?"]\n\n1. e4 *` } as StoredGame,
      { id: "file-2", source: "file", pgn: `[Site "?"]\n\n1. e4 *` } as StoredGame,
    ];
    expect(duplicateGameIds(games)).toEqual(["a"]);
  });

  it("prefers the copy with more moves (a running game imported again), whatever the order", () => {
    const early = row("early", "https://lichess.org/Ab3dEf9h", { moves_json: Array(12).fill({}) as never, summary_json: { analysis_status: "completed" } });
    const late = row("late", "https://lichess.org/Ab3dEf9h", { moves_json: Array(58).fill({}) as never });
    expect(duplicateGameIds([early, late])).toEqual(["early"]);
    expect(duplicateGameIds([late, early])).toEqual(["early"]);
  });

  it("decides the same on every device when the copies are equal", () => {
    const a = row("a", "https://lichess.org/Ab3dEf9h");
    const b = row("b", "https://lichess.org/game/Ab3dEf9h");
    expect(duplicateGameIds([a, b])).toEqual(["b"]);
    expect(duplicateGameIds([b, a])).toEqual(["b"]);
  });
});
