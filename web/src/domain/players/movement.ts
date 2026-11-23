// What changed in the league since the last visit: places won or lost and Elo
// gained or lost. Only reads the ranking's finished numbers, it calculates no
// strength itself.
//
// A snapshot is kept per filter (format + period), because another period
// shows other values and would look like movement that never happened.

export interface SnapshotRow {
  rank: number;
  elo: number;
}

export interface Snapshot {
  at: number;
  rows: Record<string, SnapshotRow>;
}

/** The newest snapshot and the one a visit before it, which movement is measured against. */
export interface SnapshotPair {
  current: Snapshot | null;
  previous: Snapshot | null;
}

/** A visit within this time is the same visit (a reload, a filter change back and forth). */
export const SNAPSHOT_GAP_MS = 6 * 3600 * 1000;

export interface Movement {
  /** Places gained (positive) or lost (negative) among the players present both times; null when new. */
  places: number | null;
  /** Shown Elo change since then; null when new. */
  elo: number | null;
  isNew: boolean;
}

export function snapshotOf(rows: { id: string; rank: number | null; strength: { elo: number } | null }[], at: number): Snapshot {
  const out: Snapshot["rows"] = {};
  for (const r of rows) if (r.rank !== null && r.strength) out[r.id] = { rank: r.rank, elo: r.strength.elo };
  return { at, rows: out };
}

/**
 * Starts a new "last visit" only after a real break, so reloading the page
 * does not wipe out the movement that was just shown. While the current
 * snapshot is fresh it is refreshed in place (new games, same visit).
 */
export function advanceSnapshots(pair: SnapshotPair, next: Snapshot, gap = SNAPSHOT_GAP_MS): SnapshotPair {
  if (!pair.current) return { current: next, previous: null };
  if (next.at - pair.current.at >= gap) return { current: next, previous: pair.current };
  return { current: next, previous: pair.previous };
}

/**
 * Movement of every player in `now` against `before`. Places are counted
 * among the players that were in both, so hiding or adding a friend moves
 * nobody; a player missing before is "new".
 */
export function movements(before: Snapshot | null, now: Snapshot): Record<string, Movement> {
  const out: Record<string, Movement> = {};
  const ids = Object.keys(now.rows);
  const common = before ? ids.filter((id) => id in before.rows) : [];
  const placeAmong = (rows: Snapshot["rows"], id: string) => common.filter((o) => rows[o].rank < rows[id].rank).length + 1;
  for (const id of ids) {
    if (!before || !(id in before.rows)) {
      out[id] = { places: null, elo: null, isNew: Boolean(before) };
      continue;
    }
    out[id] = { places: placeAmong(before.rows, id) - placeAmong(now.rows, id), elo: now.rows[id].elo - before.rows[id].elo, isNew: false };
  }
  return out;
}
