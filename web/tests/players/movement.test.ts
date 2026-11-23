import { describe, expect, it } from "vitest";

import { advanceSnapshots, movements, SNAPSHOT_GAP_MS, snapshotOf } from "../../src/domain/players";

const snap = (at: number, rows: Record<string, [number, number]>) => ({ at, rows: Object.fromEntries(Object.entries(rows).map(([id, [rank, elo]]) => [id, { rank, elo }])) });

describe("movements", () => {
  it("counts places and Elo since the last visit", () => {
    const before = snap(0, { me: [3, 1000], a: [1, 1200], b: [2, 1100] });
    const now = snap(1, { me: [1, 1250], a: [2, 1190], b: [3, 1090] });
    expect(movements(before, now)).toEqual({
      me: { places: 2, elo: 250, isNew: false },
      a: { places: -1, elo: -10, isNew: false },
      b: { places: -1, elo: -10, isNew: false },
    });
  });

  it("moves nobody when a friend is hidden or added (places among those present both times)", () => {
    const before = snap(0, { me: [2, 1000], a: [1, 1200], b: [3, 900] });
    const hidden = snap(1, { me: [1, 1000], b: [2, 900] }); // a hidden: me rises on paper only
    expect(movements(before, hidden).me.places).toBe(0);
    const added = snap(1, { me: [3, 1000], a: [1, 1200], b: [4, 900], c: [2, 1100] });
    const m = movements(before, added);
    expect([m.me.places, m.b.places]).toEqual([0, 0]);
    expect(m.c).toEqual({ places: null, elo: null, isNew: true });
  });

  it("shows no 'new' flags without an earlier visit", () => {
    expect(movements(null, snap(1, { me: [1, 1000] })).me).toEqual({ places: null, elo: null, isNew: false });
  });
});

describe("snapshots", () => {
  it("leaves unranked players out", () => {
    const s = snapshotOf([{ id: "a", rank: 1, strength: { elo: 1200 } }, { id: "b", rank: null, strength: null }], 5);
    expect(Object.keys(s.rows)).toEqual(["a"]);
  });

  it("keeps the last visit as reference across reloads and rolls over after a break", () => {
    const first = snap(0, { me: [2, 1000] });
    let pair = advanceSnapshots({ current: null, previous: null }, first);
    expect(pair).toEqual({ current: first, previous: null });
    const reload = snap(1000, { me: [2, 1005] });
    pair = advanceSnapshots(pair, reload);
    expect(pair).toEqual({ current: reload, previous: null });
    const later = snap(SNAPSHOT_GAP_MS + 1000, { me: [1, 1100] });
    pair = advanceSnapshots(pair, later);
    expect(pair).toEqual({ current: later, previous: reload });
    // a reload after that keeps comparing against the same earlier visit
    const again = snap(later.at + 60_000, { me: [1, 1101] });
    expect(advanceSnapshots(pair, again).previous).toBe(reload);
  });
});
