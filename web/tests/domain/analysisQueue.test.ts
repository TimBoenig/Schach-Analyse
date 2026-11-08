// Queue order: explicit requests first, otherwise the newest played games.
import { describe, expect, it } from "vitest";

import { mergeQueue, pickBackgroundGames, type BackgroundGame } from "../../src/domain/analysisQueue";

const played: Record<string, number | null> = { old: 1, mid: 2, new: 3, newest: 4, undated: null };
const at = (id: string) => played[id];

describe("analysis queue order", () => {
  it("analyses the newest played games first, undated ones last", () => {
    const { queued } = mergeQueue({ queued: [], add: ["old", "undated", "new", "mid"], priority: new Set(), playedAt: at });
    expect(queued).toEqual(["new", "mid", "old", "undated"]);
  });

  it("merges a later batch by date instead of appending it", () => {
    const first = mergeQueue({ queued: [], add: ["old", "mid"], priority: new Set(), playedAt: at });
    const { queued } = mergeQueue({ ...first, add: ["newest"], playedAt: at });
    expect(queued).toEqual(["newest", "mid", "old"]);
  });

  it("keeps explicit requests ahead of the background games, the latest request first", () => {
    let q = mergeQueue({ queued: [], add: ["new", "mid"], priority: new Set(), playedAt: at });
    q = mergeQueue({ ...q, add: ["old"], front: true, playedAt: at });
    q = mergeQueue({ ...q, add: ["undated"], front: true, playedAt: at });
    q = mergeQueue({ ...q, add: ["newest"], playedAt: at });
    expect(q.queued).toEqual(["undated", "old", "newest", "new", "mid"]);
    expect([...q.priority]).toEqual(["undated", "old"]);
  });

  it("never queues the game in analysis again and drops duplicates", () => {
    const { queued } = mergeQueue({ queued: ["mid"], add: ["new", "mid", "new"], priority: new Set(), playedAt: at, current: "new" });
    expect(queued).toEqual(["mid"]);
  });
});

describe("background analysis selection", () => {
  const g = (id: string, p: Partial<BackgroundGame>): BackgroundGame => ({ id, completed: false, bullet: false, own: false, friend: false, ...p });
  const games = [
    g("mine", { own: true }),
    g("mineDone", { own: true, completed: true }),
    g("mineBullet", { own: true, bullet: true }),
    g("vsFriend", { own: true, friend: true }),
    g("friend", { friend: true }),
    g("stranger", {}),
  ];

  it.each([
    [{ own: true, friends: false, skipBullet: false }, ["mine", "mineBullet", "vsFriend"]],
    [{ own: false, friends: true, skipBullet: false }, ["friend"]],
    [{ own: true, friends: true, skipBullet: true }, ["mine", "vsFriend", "friend"]],
    [{ own: false, friends: false, skipBullet: false }, []],
  ])("queues only unanalysed games of the enabled groups (%o)", (opts, want) => {
    expect(pickBackgroundGames(games, opts)).toEqual(want);
  });
});
