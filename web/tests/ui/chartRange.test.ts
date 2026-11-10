import { describe, expect, it } from "vitest";

import { clipRange, rangeOptions, ratingSeriesPoints } from "../../src/ui/charts";

const DAY = 86400;
const series = (days: number[]) => days.map((d, i) => ({ label: String(i), value: i, t: 1_700_000_000 + d * DAY }));

describe("chart period chips", () => {
  it("offers only spans shorter than the data and clips back from the newest point", () => {
    const pts = series([0, 50, 100, 210, 300]);
    expect(rangeOptions(pts).map(([l]) => l)).toEqual(["1 M", "3 M", "6 M"]);
    expect(clipRange(pts, 92).map((p) => p.value)).toEqual([3, 4]);
    expect(clipRange(pts, null)).toHaveLength(5);
    expect(rangeOptions(series([0, 10, 20]))).toEqual([]);
    expect(rangeOptions([{ label: "a", value: 1 }, { label: "b", value: 2 }, { label: "c", value: 3 }])).toEqual([]);
  });

  it("adds the year to rating labels once the history spans years", () => {
    const short = ratingSeriesPoints([
      [new Date(2026, 2, 3).getTime() / 1000, 1200],
      [new Date(2026, 4, 3).getTime() / 1000, 1250],
    ]);
    expect(short[0].label).toBe("03.03.");
    const long = ratingSeriesPoints([
      [new Date(2025, 2, 3).getTime() / 1000, 1200],
      [new Date(2026, 2, 3).getTime() / 1000, 1250],
    ]);
    expect(long.map((p) => p.label)).toEqual(["03.25", "03.26"]);
    expect(long[1].t).toBe(new Date(2026, 2, 3).getTime() / 1000);
  });
});
