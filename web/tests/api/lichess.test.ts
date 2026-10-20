import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetThrottle } from "../../src/api/base";
import { LichessAPI } from "../../src/api/lichess";
import { json, mockFetch } from "./helpers";

beforeEach(() => {
  resetThrottle();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LichessAPI", () => {
  it.each([
    ["https://lichess.org/abcd1234", "abcd1234"],
    ["https://lichess.org/abcd1234/white", "abcd1234"],
    ["https://lichess.org/abcd1234/black/", "abcd1234"],
    ["https://lichess.org/abcd1234efgh", "abcd1234"],
    ["https://lichess.org/abc", ""],
    ["https://example.com/abcd1234", ""],
    ["", ""],
  ])("extracts the game id from %j", (url, id) => {
    expect(new LichessAPI().extractGameId(url)).toBe(id);
  });

  it("streams NDJSON games with clocks and normalizes them", async () => {
    const line = (id: string, extra: object) =>
      JSON.stringify({
        id,
        players: { white: { user: { name: "UserW" }, rating: 1800 }, black: { user: { name: "UserB" }, rating: 1700 } },
        createdAt: 1_700_000_000_123,
        speed: "blitz",
        pgn: "1. e4 e5",
        ...extra,
      });
    const calls = mockFetch(() => new Response(`${line("g1", { winner: "white", status: "mate" })}\n\nnot json\n${line("g2", { status: "draw" })}\n`));
    const games = await new LichessAPI({ token: "lip_secret" }).getUserGames("UserW", 5);

    expect(games).toEqual([
      {
        white: { username: "UserW", rating: 1800, result: "win" },
        black: { username: "UserB", rating: 1700, result: "checkmated" },
        time_class: "blitz",
        end_time: 1_700_000_000,
        pgn: "1. e4 e5",
        url: "https://lichess.org/g1",
      },
      expect.objectContaining({ url: "https://lichess.org/g2", white: expect.objectContaining({ result: "agreed" }) }),
    ]);
    const { url, init } = calls[0];
    expect(url.searchParams.get("clocks")).toBe("true");
    expect(url.searchParams.get("max")).toBe("5");
    expect(init?.headers).toEqual({ Accept: "application/x-ndjson", Authorization: "Bearer lip_secret" });
  });

  it("exports a single game and returns null on errors", async () => {
    mockFetch(() =>
      json({
        id: "testid12",
        pgn: "1. e4 e5 1-0",
        players: { white: { user: { name: "Player1" }, rating: 1500 }, black: { user: { name: "Player2" }, rating: 1400 } },
      }),
    );
    expect(await new LichessAPI().getGameById("testid12")).toEqual({
      pgn: "1. e4 e5 1-0",
      id: "testid12",
      white: "Player1",
      black: "Player2",
      white_rating: 1500,
      black_rating: 1400,
    });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    expect(await new LichessAPI().getGameById("nonexistent")).toBeNull();
  });

  it("normalizes the user profile", async () => {
    mockFetch(() =>
      json({
        username: "MagnusCarlsen",
        title: "GM",
        createdAt: 1300000000000,
        url: "https://lichess.org/@/MagnusCarlsen",
        perfs: { bullet: { rating: 2900, games: 500 }, blitz: { rating: 3050, games: 2000 }, puzzle: { rating: 2600, games: 400 } },
        count: { all: 3020, win: 2100, loss: 620, draw: 300 },
        profile: { country: "NO" },
      }),
    );
    const prof = await new LichessAPI().getUserProfile("MagnusCarlsen");
    expect(prof).toMatchObject({
      platform: "lichess",
      username: "MagnusCarlsen",
      title: "GM",
      bullet: { rating: 2900, games: 500 },
      blitz: { rating: 3050 },
      rapid: { rating: undefined, games: 0 },
      puzzle: { rating: 2600 },
      total_games: 3020,
      country: "NO",
      record: { win: 2100, loss: 620, draw: 300 },
    });
  });

  it("aborts with the caller's signal instead of returning empty data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => {
            const fail = () => reject(new DOMException("aborted", "AbortError"));
            if (init.signal?.aborted) fail();
            init.signal?.addEventListener("abort", fail);
          }),
      ),
    );
    const controller = new AbortController();
    const pending = new LichessAPI().getUserGames("x", 1, { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    await expect(pending).rejects.toBeDefined();
  });
});
