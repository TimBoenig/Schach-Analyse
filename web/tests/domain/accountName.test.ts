import { describe, expect, it } from "vitest";

import { accountNameFor } from "../../src/domain/accountName";

const g = (source: string, white: string, black: string) => ({ source, white, black });

describe("accountNameFor", () => {
  const games = [
    g("chesscom", "Timbojoo", "a"),
    g("chesscom", "b", "timbojoo"),
    g("lichess", "Timbojo", "c"),
    g("chesscom", "Timbojo", "d"), // one odd game must not outvote the real account
    g("chesscom", "friend", "e"),
  ];

  it("prefers the own name that plays most stored games on the site over a wrong remembered name", () => {
    // The bug: the Lichess name was remembered for chess.com, so new games were fetched for a stranger.
    expect(accountNameFor("chesscom", games, ["Timbojo", "Timbojoo"], "Timbojo")).toBe("Timbojoo");
    expect(accountNameFor("lichess", games, ["Timbojo", "Timbojoo"], "Timbojoo")).toBe("Timbojo");
  });

  it("falls back to the remembered name when no stored game decides", () => {
    expect(accountNameFor("chesscom", [], ["Timbojoo"], " Timbojoo ")).toBe("Timbojoo");
    expect(accountNameFor("chesscom", [g("chesscom", "friend", "x")], ["me"], null)).toBe("");
  });
});
