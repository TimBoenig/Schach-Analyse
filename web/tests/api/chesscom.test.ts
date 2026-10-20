import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetThrottle } from "../../src/api/base";
import { extractGameId, getGameById, getLastGames, getUserGamesByDate, getUserProfile } from "../../src/api/chesscom";
import { json, mockFetch } from "./helpers";

const ARCHIVE = "https://api.chess.com/pub/player/user/games/2023/10";

beforeEach(() => {
  resetThrottle();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chess.com API", () => {
  it("returns the newest games across archives", async () => {
    mockFetch((url) =>
      url.pathname.endsWith("/archives")
        ? json({ archives: [ARCHIVE] })
        : json({
            games: [
              { url: "https://www.chess.com/game/live/1000", end_time: 1000 },
              { url: "https://www.chess.com/game/live/2000", end_time: 2000 },
            ],
          }),
    );
    const games = await getLastGames("user", 1);
    expect(games.map((g) => g.url)).toEqual(["https://www.chess.com/game/live/2000"]);
  });

  it("finds a game by id in the user's archives", async () => {
    mockFetch((url) =>
      url.pathname.endsWith("/archives")
        ? json({ archives: [ARCHIVE] })
        : json({ games: [{ url: "https://www.chess.com/game/live/123456", pgn: "test_pgn" }] }),
    );
    expect((await getGameById("123456", "user"))?.pgn).toBe("test_pgn");
    expect(await getGameById("123456", null)).toBeNull();
  });

  it("keeps only games that ended on the requested UTC day", async () => {
    const day = Date.UTC(2023, 9, 5) / 1000;
    const calls = mockFetch(() =>
      json({ games: [{ end_time: day - 1 }, { end_time: day }, { end_time: day + 86399 }, { end_time: day + 86400 }] }),
    );
    const games = await getUserGamesByDate("user", new Date(2023, 9, 5));
    expect(calls[0].url.pathname).toBe("/pub/player/user/games/2023/10");
    expect(games.map((g) => g.end_time)).toEqual([day, day + 86399]);
  });

  it("normalizes profile and stats", async () => {
    mockFetch((url) =>
      url.pathname.endsWith("/stats")
        ? json({
            chess_bullet: { last: { rating: 3200 }, best: { rating: 3350 }, record: { win: 500, loss: 100, draw: 50 } },
            chess_blitz: { last: { rating: 3150 }, best: { rating: 3220 }, record: { win: 400, loss: 80, draw: 40 } },
            tactics: { highest: { rating: 3400 } },
          })
        : json({ username: "hikaru", title: "GM", avatar: "https://example.com/a.jpg", joined: 123456789 }),
    );
    const prof = await getUserProfile("Hikaru ");
    expect(prof).toMatchObject({
      platform: "chesscom",
      username: "hikaru",
      title: "GM",
      bullet: { rating: 3200, peak: 3350, games: 650 },
      blitz: { rating: 3150 },
      puzzle: { rating: 3400 },
      total_games: 650 + 520,
      record: { win: 900, loss: 180, draw: 90 },
    });
    expect(prof?.win_rate).toBeCloseTo((900 / 1170) * 100);
  });

  it("degrades to empty results on HTTP errors and malformed JSON", async () => {
    mockFetch((url) => (url.pathname.endsWith("/archives") ? new Response("nope", { status: 200 }) : json({}, 500)));
    expect(await getLastGames("user")).toEqual([]);
    expect(await getUserProfile("user")).toBeNull();
  });

  it.each([
    ["https://www.chess.com/game/live/123456", "123456"],
    ["https://www.chess.com/live/game/42", "42"],
    ["https://www.chess.com/game/daily/777?x=1", "777"],
    ["https://www.chess.com/member/hikaru", null],
  ])("extracts the game id from %s", (url, id) => {
    expect(extractGameId(url)).toBe(id);
  });
});
