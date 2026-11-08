import { describe, expect, it } from "vitest";

import { sectionOf, STAT_SECTIONS } from "../../src/ui/StatsLayout";

describe("statistics sections", () => {
  it("give every statistic exactly one home, so search never points to two pages", () => {
    const cards = Object.values(STAT_SECTIONS).flatMap((secs) => secs.flatMap((s) => s.cards));
    expect(new Set(cards).size).toBe(cards.length);
    for (const secs of Object.values(STAT_SECTIONS)) {
      const ids = secs.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(sectionOf("insights", "gewohnheiten").cards).toContain("Tageszeit");
    // Errors live with the move ratings, not with the results.
    expect(sectionOf("moves", "fehler").cards).toContain("Fehler-Landkarte");
  });
});
