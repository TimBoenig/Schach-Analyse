// Time-range filtering: played date over save time, custom ranges and the
// mirrored "period before" used by the start page comparison.
import { describe, expect, it } from "vitest";

import { trFilter } from "../../src/domain/i18n";
import { dateWindow, extractGameTimestamp, matchesFilters, previousDateFilter, rangeFilter } from "../../src/domain/metrics";

const NOW = Date.UTC(2026, 9, 22, 12) / 1000;
const DAY = 86400;

const game = (over: Record<string, unknown>) => ({ white: "Tim", black: "Opp", ...over });

describe("date filter", () => {
  it("uses the date the game was played, not when it was imported", () => {
    // Imported today (timestamp = now) but played in spring: not "last 30 days".
    const old = game({ timestamp: NOW, date: "2026.04.03", pgn: '[UTCDate "2026.04.03"]\n[UTCTime "19:30:00"]' });
    expect(extractGameTimestamp(old)).toBe(Date.UTC(2026, 3, 3, 19, 30) / 1000);
    expect(matchesFilters(old, "white", "All Colors", "All Formats", "All Sources", "Last 30 Days", NOW)).toBe(false);
    expect(matchesFilters(old, "white", "All Colors", "All Formats", "All Sources", "This Year", NOW)).toBe(true);
    // Without any date the save time is all there is.
    const undated = game({ timestamp: NOW - 2 * DAY, date: "????.??.??" });
    expect(matchesFilters(undated, "white", "All Colors", "All Formats", "All Sources", "Last 7 Days", NOW)).toBe(true);
  });

  it("treats a range as [start, end) and rejects broken ranges", () => {
    const start = NOW - 14 * DAY;
    const f = rangeFilter(start, NOW);
    const at = (ts: number) => matchesFilters(game({ timestamp: ts }), "white", "All Colors", "All Formats", "All Sources", f, NOW);
    expect([at(start - 1), at(start), at(NOW - 1), at(NOW)]).toEqual([false, true, true, false]);
    // Open end: everything since the start.
    expect(dateWindow(rangeFilter(start, null))).toEqual({ start, end: null });
    const broken = rangeFilter(NOW, start);
    expect(matchesFilters(game({ timestamp: NOW }), "white", "All Colors", "All Formats", "All Sources", broken, NOW)).toBe(false);
  });

  it.each([
    ["Last 30 Days", NOW - 60 * DAY, NOW - 30 * DAY],
    [rangeFilter(NOW - 10 * DAY, NOW - 3 * DAY), NOW - 17 * DAY, NOW - 10 * DAY],
  ])("mirrors %s into the equally long period before", (filter, start, end) => {
    expect(previousDateFilter(filter, NOW)).toBe(rangeFilter(start, end));
  });

  it("has no period before 'All Time'", () => {
    expect(previousDateFilter("All Time", NOW)).toBeNull();
  });

  it("labels presets and custom ranges in German", () => {
    expect(trFilter("Last 14 Days")).toBe("Letzte 14 Tage");
    // End is exclusive: midnight after 22.10. shows as 22.10.
    const r = rangeFilter(new Date(2026, 8, 1).getTime() / 1000, new Date(2026, 9, 23).getTime() / 1000);
    expect(trFilter(r)).toBe("01.09.2026 – 22.10.2026");
  });
});
