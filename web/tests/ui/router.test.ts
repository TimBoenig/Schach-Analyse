import { describe, expect, it } from "vitest";

import { parseHash, toHash, type Route } from "../../src/ui/router";

describe("router", () => {
  it("opens the start page by default and keeps the game list reachable", () => {
    expect(parseHash("")).toEqual({ view: "home" });
    expect(parseHash("#/unbekannt")).toEqual({ view: "home" });
    const routes: Route[] = [{ view: "home" }, { view: "games" }, { view: "games", import: true }, { view: "settings" }];
    for (const r of routes) expect(parseHash(toHash(r))).toEqual(r);
  });
});
