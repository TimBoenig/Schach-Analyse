import { describe, expect, it } from "vitest";

import { parseHash, toHash, type Route } from "../../src/ui/router";

describe("router", () => {
  it("opens the start page by default and keeps the game list reachable", () => {
    expect(parseHash("")).toEqual({ view: "home" });
    expect(parseHash("#/unbekannt")).toEqual({ view: "home" });
    const routes: Route[] = [
      { view: "home" },
      { view: "games" },
      { view: "games", import: true },
      { view: "settings" },
      { view: "board" },
      { view: "players" },
      { view: "players", tab: "rangliste" },
      { view: "players", playerId: "max-2" },
      // FENs contain slashes and spaces; they must survive the hash round trip.
      { view: "board", fen: "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3" },
    ];
    for (const r of routes) expect(parseHash(toHash(r))).toEqual(r);
  });
});
