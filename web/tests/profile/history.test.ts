import { describe, expect, it } from "vitest";

import { accuracyHistory, bucketFor, bucketLabel, bucketStart, dayStart, defaultRange, localDay, rangeChoices, ratingHistory, type DayRow, type RatingSeries } from "../../src/domain/profile/history";

const DAY = 86400;
/** Noon of a local day, so the tests do not depend on the machine's time zone. */
const noon = (day: string, hours = 0) => dayStart(day) + 12 * 3600 + hours * 3600;

describe("rating history", () => {
  const series: RatingSeries = [
    [noon("2026-03-01"), 800],
    [noon("2026-03-01", 1), 812],
    [noon("2026-03-01", 2), 790],
    [noon("2026-03-04"), 805],
    [noon("2026-06-10"), 870],
    [noon("2026-06-10", 3), 861],
  ];

  it("keeps one closing value per day and counts the day's games", () => {
    const h = ratingHistory(series, null)!;
    expect(h.points.map((p) => [p.day, p.value, p.games])).toEqual([
      ["2026-03-01", 790, 3],
      ["2026-03-04", 805, 1],
      ["2026-06-10", 861, 2],
    ]);
    expect(h.points[0].t).toBe(noon("2026-03-01", 2));
    expect({ first: h.first, last: h.last, change: h.change, games: h.games }).toEqual({ first: 790, last: 861, change: 71, games: 6 });
    // Peak and low count every game, also the 870 in the middle of the last day.
    expect(h.peak).toEqual({ t: noon("2026-06-10"), value: 870 });
    expect(h.low).toEqual({ t: noon("2026-03-01", 2), value: 790 });
  });

  it("counts the span back from the newest game, not from today", () => {
    const h = ratingHistory(series, 100)!;
    expect(h.points.map((p) => p.day)).toEqual(["2026-03-04", "2026-06-10"]);
    expect(h.change).toBe(56);
    expect(ratingHistory(series, 1)!.points).toHaveLength(1);
  });

  it("sorts unsorted input and ignores entries without a rating or a date", () => {
    const h = ratingHistory([[noon("2026-02-02"), 900], [0, 700], [noon("2026-02-01"), 0], [noon("2026-01-30"), 880]], null)!;
    expect(h.points.map((p) => p.value)).toEqual([880, 900]);
    expect(ratingHistory([], null)).toBeNull();
    expect(ratingHistory([[0, 0]], 30)).toBeNull();
  });
});

describe("accuracy history", () => {
  const rows = (entries: [string, number | null, number, number?][]): DayRow[] => entries.map(([day, avg_accuracy, games, analyzed]) => ({ day, avg_accuracy, games, analyzed }));

  it.each([
    [1, "day"],
    [45, "day"],
    [46, "week"],
    [200, "week"],
    [201, "month"],
    [1100, "month"],
    [1101, "quarter"],
  ] as const)("draws a span of %i days in %ss", (span, bucket) => {
    expect(bucketFor(span)).toBe(bucket);
  });

  it.each([
    ["2026-03-12", "day", "2026-03-12"],
    // 12 March 2026 is a Thursday; its week starts on Monday the 9th.
    ["2026-03-12", "week", "2026-03-09"],
    // A week can start in the month (and year) before.
    ["2026-01-01", "week", "2025-12-29"],
    ["2026-03-12", "month", "2026-03-01"],
    ["2026-03-12", "quarter", "2026-01-01"],
    ["2026-12-31", "quarter", "2026-10-01"],
  ] as const)("puts %s into the %s starting %s", (day, bucket, start) => {
    expect(bucketStart(day, bucket)).toBe(start);
  });

  it("weights every analysed game once, whatever day it was played", () => {
    // One game at 90 and four at 60 are 66 on average, not 75.
    const h = accuracyHistory(rows([["2026-03-09", 90, 1, 1], ["2026-03-10", 60, 6, 4]]), null)!;
    expect(h.bucket).toBe("day");
    expect(h.games).toBe(5);
    expect(h.average).toBeCloseTo(66);
    expect(h.points.map((p) => [p.key, p.value, p.games])).toEqual([["2026-03-09", 90, 1], ["2026-03-10", 60, 4]]);
  });

  it("groups a long history into months and a short span of it into weeks", () => {
    const data = rows([
      ["2025-01-10", 70, 2, 2],
      ["2025-01-20", 80, 2, 2],
      ["2025-02-03", 60, 1, 1],
      ["2026-03-02", 74, 3, 3],
      ["2026-03-05", 78, 1, 1],
      ["2026-03-12", 82, 2, 2],
    ]);
    const all = accuracyHistory(data, null)!;
    expect(all.bucket).toBe("month");
    expect(all.points.map((p) => [p.key, Math.round(p.value), p.games])).toEqual([["2025-01-01", 75, 4], ["2025-02-01", 60, 1], ["2026-03-01", 77, 6]]);
    const recent = accuracyHistory(data, 92)!;
    expect(recent.points.map((p) => p.key)).toEqual(["2026-03-02", "2026-03-05", "2026-03-12"]);
    expect(recent.games).toBe(6);
    const half = accuracyHistory([...data, ...rows([["2025-12-01", 71, 2, 2]])], 183)!;
    expect(half.bucket).toBe("week");
    expect(half.points.map((p) => [p.key, p.games])).toEqual([["2025-12-01", 2], ["2026-03-02", 4], ["2026-03-09", 2]]);
  });

  it("leaves out days without an analysed game and reads old rows without the count", () => {
    const h = accuracyHistory(rows([["2026-03-01", null, 5], ["2026-03-02", 80, 2], ["2026-03-03", 70, 3, 0]]), null)!;
    expect(h.points.map((p) => [p.key, p.games])).toEqual([["2026-03-02", 2]]);
    expect(accuracyHistory(rows([["2026-03-01", null, 5]]), null)).toBeNull();
    expect(accuracyHistory([], 30)).toBeNull();
  });
});

describe("history spans", () => {
  it("offers only spans shorter than the history, and always everything", () => {
    expect(rangeChoices(3).map((r) => r.key)).toEqual(["all"]);
    expect(rangeChoices(40).map((r) => r.key)).toEqual(["1m", "all"]);
    expect(rangeChoices(2000).map((r) => r.key)).toEqual(["1m", "3m", "6m", "1y", "all"]);
  });

  it("opens on the last year where the history is longer, else on everything", () => {
    expect(defaultRange(rangeChoices(2000)).key).toBe("1y");
    expect(defaultRange(rangeChoices(200)).key).toBe("all");
  });

  it.each([
    ["2026-03-12", "day", "12. Mär 2026"],
    ["2026-03-09", "week", "Woche ab 9. Mär 2026"],
    ["2026-03-01", "month", "Mär 2026"],
    ["2026-10-01", "quarter", "Q4 2026"],
  ] as const)("labels %s as a %s", (key, bucket, label) => {
    expect(bucketLabel(key, bucket)).toBe(label);
  });

  it("maps days and timestamps onto each other in local time", () => {
    expect(localDay(dayStart("2026-03-12"))).toBe("2026-03-12");
    expect(localDay(dayStart("2026-03-12") + DAY - 1)).toBe("2026-03-12");
  });
});
