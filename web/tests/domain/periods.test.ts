import { describe, expect, it } from "vitest";

import { PAGE_PERIODS, settleByCount, settlePeriod } from "../../src/domain/periods";

const NOW = Date.parse("2026-11-13T12:00:00Z") / 1000;
const daysAgo = (d: number) => NOW - d * 86400;

describe("default periods", () => {
  it("never starts a page on the whole history", () => {
    expect(Object.values(PAGE_PERIODS).every((p) => ["Last 14 Days", "Last 30 Days", "Last 90 Days"].includes(p))).toBe(true);
  });

  it("keeps the preferred span when it holds enough games and widens step by step otherwise", () => {
    const recent = Array.from({ length: 12 }, (_, i) => daysAgo(i + 1));
    expect(settleByCount("Last 30 Days", recent, 10, NOW)).toBe("Last 30 Days");
    // A break from chess: the last games are two months old.
    const pause = Array.from({ length: 12 }, (_, i) => daysAgo(60 + i));
    expect(settleByCount("Last 30 Days", pause, 10, NOW)).toBe("Last 90 Days");
    // Only an old import: a year is not enough either, so everything is shown.
    const old = Array.from({ length: 12 }, (_, i) => daysAgo(500 + i));
    expect(settleByCount("Last 30 Days", [...old, null], 10, NOW)).toBe("All Time");
    // Too few games anywhere still ends on "All Time" instead of an empty page.
    expect(settleByCount("Last 90 Days", [daysAgo(3)], 10, NOW)).toBe("All Time");
  });

  it("hands each span's start to the check, null for the whole history", () => {
    const seen: [string, number | null][] = [];
    settlePeriod("Last 90 Days", (start, period) => (seen.push([period, start]), false), NOW);
    expect(seen.map(([p]) => p)).toEqual(["Last 90 Days", "Last 365 Days", "All Time"]);
    expect(seen[0][1]).toBe(daysAgo(90));
    expect(seen[2][1]).toBeNull();
  });
});
