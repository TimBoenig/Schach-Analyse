import { describe, expect, it } from "vitest";

import { nearestIndex, timeTicks, valueScale } from "../../src/ui/viz/scale";

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime() / 1000;

describe("value axis", () => {
  it.each([
    [[812, 869, 790], [775, 800, 825, 850, 875, 900]],
    [[61.2, 78.9], [50, 60, 70, 80, 90]],
    [[0.2, 0.9], [0, 0.25, 0.5, 0.75, 1]],
  ])("frames %j with round numbers", (values, ticks) => {
    const s = valueScale(values);
    expect(s.ticks).toEqual(ticks);
    expect(s.min).toBe(ticks[0]);
    expect(s.max).toBe(ticks[ticks.length - 1]);
  });

  it("never leaves the bounds it is given", () => {
    const s = valueScale([92, 99.5], 4, { lo: 0, hi: 100 });
    expect(s.max).toBe(100);
    expect(s.ticks[s.ticks.length - 1]).toBeLessThanOrEqual(100);
  });

  it("keeps a narrow series inside a span of at least the asked width", () => {
    // 73..78 would fill the whole height; with a span of 20 it stays a gentle line.
    expect(valueScale([73, 78], 4, { lo: 0, hi: 100, minSpan: 20 })).toEqual({ min: 65, max: 90, ticks: [65, 70, 75, 80, 85, 90] });
    // Close to the upper bound the window slides down instead of leaving the scale.
    expect(valueScale([96, 99], 4, { lo: 0, hi: 100, minSpan: 20 })).toEqual({ min: 80, max: 100, ticks: [80, 85, 90, 95, 100] });
    // A wide series is left alone.
    expect(valueScale([40, 90], 4, { lo: 0, hi: 100, minSpan: 20 }).min).toBeLessThanOrEqual(40);
  });

  it("gives a flat series a band and an empty one a default", () => {
    const flat = valueScale([850, 850]);
    expect(flat.min).toBeLessThan(850);
    expect(flat.max).toBeGreaterThan(850);
    expect(valueScale([])).toEqual({ min: 0, max: 1, ticks: [0, 1] });
  });
});

describe("time axis", () => {
  it("labels a few weeks by day, on Mondays once days get crowded", () => {
    expect(timeTicks(at(2026, 3, 1), at(2026, 3, 5), 8).map((t) => t.label)).toEqual(["1.03.", "2.03.", "3.03.", "4.03.", "5.03."]);
    // 2 and 9 March 2026 are Mondays.
    expect(timeTicks(at(2026, 3, 1), at(2026, 3, 29), 5).map((t) => t.label)).toEqual(["2.03.", "9.03.", "16.03.", "23.03."]);
  });

  it("labels months by name and every January by its year", () => {
    expect(timeTicks(at(2025, 10, 15), at(2026, 3, 20), 8).map((t) => t.label)).toEqual(["Nov", "Dez", "2026", "Feb", "Mär"]);
  });

  it("thins long histories to quarters, half-years and years on calendar boundaries", () => {
    expect(timeTicks(at(2025, 2, 10), at(2026, 3, 20), 6).map((t) => t.label)).toEqual(["Apr", "Jul", "Okt", "2026"]);
    expect(timeTicks(at(2020, 5, 1), at(2026, 11, 1), 8).map((t) => t.label)).toEqual(["2021", "2022", "2023", "2024", "2025", "2026"]);
  });

  it("returns nothing for an empty span", () => {
    expect(timeTicks(at(2026, 3, 1), at(2026, 3, 1), 5)).toEqual([]);
    expect(timeTicks(at(2026, 3, 2), at(2026, 3, 1), 5)).toEqual([]);
  });
});

describe("nearest point", () => {
  it.each([
    [-5, 0],
    [4, 0],
    [6, 1],
    [10, 1],
    [29, 2],
    [500, 3],
  ])("finds the point closest to x=%i", (x, index) => {
    expect(nearestIndex([0, 10, 30, 100], x)).toBe(index);
  });

  it("has no answer without points", () => {
    expect(nearestIndex([], 3)).toBe(-1);
  });
});
