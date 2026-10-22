// Start page: period comparison, weekly/daily trends and the activity calendar.
import { describe, expect, it } from "vitest";

import { rangeFilter } from "../../src/domain/metrics";
import {
  activityCalendar,
  buildPlayerProfile,
  comparePeriods,
  dailyActivity,
  focusNotes,
  trendOf,
} from "../../src/domain/profile";
import { profileGames } from "./fixtures";

const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000;
const MAY = rangeFilter(day(2026, 5, 1), day(2026, 6, 1));
const JUNE = rangeFilter(day(2026, 6, 1), day(2026, 7, 1));

describe("comparePeriods", () => {
  // May: 8 games with a thrown win each; June: 8 clean wins.
  const games = profileGames(8, 8);
  const may = buildPlayerProfile(games, ["Tim"], "All Formats", MAY);
  const june = buildPlayerProfile(games, ["Tim"], "All Formats", JUNE);

  it("reports the better month as progress, with fewer blunders counting as up", () => {
    const cmp = comparePeriods(june, may);
    const k = Object.fromEntries(cmp.kpis.map((x) => [x.key, x]));
    expect(k.games.value).toBe(8);
    expect(k.games.previous).toBe(8);
    expect(k.score.delta).toBe(100);
    expect(trendOf(k.score)).toBe("up");
    expect(k.blunders.delta).toBeLessThan(0);
    expect(trendOf(k.blunders)).toBe("up");
    expect(cmp.declined).toEqual([]);
    expect(focusNotes(june, cmp).some((n) => n.startsWith("Weniger Patzer"))).toBe(true);
    // The other way round it is a decline.
    const back = comparePeriods(may, june);
    expect(trendOf(back.kpis.find((x) => x.key === "blunders")!)).toBe("down");
  });

  it("has no deltas without a previous period", () => {
    const cmp = comparePeriods(june, null);
    expect(cmp.kpis.every((k) => k.delta === null)).toBe(true);
    expect(cmp.skills.every((s) => s.previous === null)).toBe(true);
  });

  it("adds weekly and daily trend rows keyed by local Monday and day", () => {
    const weekly = june.trends.weekly as { week: string; games: number }[];
    expect(weekly.reduce((s, w) => s + w.games, 0)).toBe(8);
    for (const w of weekly) expect(new Date(`${w.week}T12:00:00`).getDay()).toBe(1);
    expect((june.trends.daily as unknown[]).length).toBe(8);
  });
});

describe("activity calendar", () => {
  it("counts the player's games per day and lays them out Monday-first", () => {
    const games = [
      ...profileGames(0, 2),
      { white: "Anna", black: "Bert", result: "1-0", date: "2026.06.01", pgn: "" },
    ];
    const daily = dailyActivity(games, ["Tim"]);
    expect(daily.map((d) => [d.day, d.games, d.score_pct])).toEqual([
      ["2026-06-01", 1, 100],
      ["2026-06-02", 1, 100],
    ]);
    // 2026-06-03 is a Wednesday: the last column runs Monday 1st to Sunday 7th.
    const cal = activityCalendar(daily, "2026-06-03", 4);
    expect(cal).toHaveLength(4);
    expect(cal.every((c) => c.length === 7)).toBe(true);
    const last = cal[3];
    expect(last[0].day).toBe("2026-06-01");
    expect(last.map((d) => d.games)).toEqual([1, 1, 0, 0, 0, 0, 0]);
    expect(last.map((d) => d.future)).toEqual([false, false, false, true, true, true, true]);
  });
});
