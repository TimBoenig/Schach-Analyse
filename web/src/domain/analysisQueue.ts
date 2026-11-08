// Order of the analysis queue. Games the user asked for explicitly ("analyse
// this game") go first; everything else runs newest played game first, because
// recent games say the most about the current form. Headless and pure.

export interface QueueOrderInput {
  /** Current queue. */
  queued: string[];
  /** Games to add. */
  add: string[];
  /** Add as explicit requests in front of everything else. */
  front?: boolean;
  /** Explicit requests still waiting (kept in front, in their order). */
  priority: ReadonlySet<string>;
  /** Played time in ms per game; null or missing = unknown date (goes last). */
  playedAt: (id: string) => number | null | undefined;
  /** Never queued again (the game in analysis right now). */
  current?: string | null;
}

export interface QueueOrder {
  queued: string[];
  priority: Set<string>;
}

/** New queue after adding games: explicit requests first, then newest played first. */
export function mergeQueue({ queued, add, front = false, priority, playedAt, current = null }: QueueOrderInput): QueueOrder {
  const adding = [...new Set(add)].filter((id) => id !== current);
  const prio = new Set(front ? adding : []);
  // Earlier explicit requests stay ahead of the background games, behind the new ones.
  for (const id of queued) if (priority.has(id) && !prio.has(id)) prio.add(id);
  const all = [...new Set([...queued, ...adding])].filter((id) => id !== current);
  const head = [...prio].filter((id) => all.includes(id));
  const rest = all.filter((id) => !prio.has(id));
  const time = (id: string) => playedAt(id) ?? null;
  // Stable sort: equal dates keep the order they were added in.
  const sorted = rest
    .map((id, i) => ({ id, i, t: time(id) }))
    .sort((a, b) => {
      if (a.t !== b.t) {
        if (a.t === null) return 1;
        if (b.t === null) return -1;
        return b.t - a.t;
      }
      return a.i - b.i;
    })
    .map((x) => x.id);
  return { queued: [...head, ...sorted], priority: new Set(head) };
}

// ---- background analysis when the app opens ----

export interface BackgroundGame {
  id: string;
  completed: boolean;
  bullet: boolean;
  /** One of the user's own games. */
  own: boolean;
  /** A game of a friend (the user did not play in it). */
  friend: boolean;
}

export interface BackgroundOptions {
  own: boolean;
  friends: boolean;
  skipBullet: boolean;
}

/**
 * Games the background analysis should queue: every unanalysed game of the
 * enabled groups. A game against a friend counts as an own game, so turning
 * friends off never holds back the user's own games.
 */
export function pickBackgroundGames(games: BackgroundGame[], { own, friends, skipBullet }: BackgroundOptions): string[] {
  if (!own && !friends) return [];
  return games
    .filter((g) => !g.completed && !(skipBullet && g.bullet) && ((own && g.own) || (friends && g.friend && !g.own)))
    .map((g) => g.id);
}
