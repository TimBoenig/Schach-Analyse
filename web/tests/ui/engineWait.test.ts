import { describe, expect, it } from "vitest";

import { engineLoadText } from "../../src/ui/EngineWait";

describe("engine download text", () => {
  it.each([
    [{ state: "idle", loaded: 0, total: 0 }, null],
    [{ state: "ready", loaded: 100, total: 100 }, null],
    // No size from the server: no made-up percentage.
    [{ state: "loading", loaded: 5_000_000, total: 0 }, "Caissa wird einmalig geladen …"],
    [{ state: "loading", loaded: 30_000_000, total: 75_703_872 }, "Caissa wird einmalig geladen (39 %) …"],
    // Never "100 %" while the engine is not usable yet.
    [{ state: "loading", loaded: 75_703_872, total: 75_703_872 }, "Caissa wird einmalig geladen (99 %) …"],
  ] as const)("%o", (load, text) => {
    expect(engineLoadText(load)).toBe(text);
  });

  it("names the connection when the download failed", () => {
    expect(engineLoadText({ state: "failed", loaded: 0, total: 0 })).toMatch(/nicht geladen.*Internetverbindung/);
  });
});
