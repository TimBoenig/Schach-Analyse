// Two "devices" sharing one fake Supabase table: pull/merge/push round trips.
import "fake-indexeddb/auto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";

import { parsePgnText } from "../../src/domain/pgn";
import { deleteGame, getSetting, listGames, putGames, resetDbConnection, setSetting } from "../../src/storage/db";
import { toStoredGame } from "../../src/storage/rows";
import { syncWith } from "../../src/storage/sync";

interface Row {
  user_id: string;
  kind: string;
  id: string;
  data: unknown;
  updated_at: number;
  deleted: boolean;
  server_seq: number;
}

/** Just enough of supabase-js for sync_records: select…gt…order…limit and upsert. */
function fakeServer() {
  const rows: Row[] = [];
  let seq = 0;
  const client = {
    from: () => ({
      select: () => {
        let min = 0;
        let lim = 1000;
        const q = {
          gt: (_c: string, v: number) => ((min = v), q),
          order: () => q,
          limit: (n: number) => ((lim = n), q),
          then: (res: (v: { data: Row[]; error: null }) => void) =>
            res({ data: rows.filter((r) => r.server_seq > min).sort((a, b) => a.server_seq - b.server_seq).slice(0, lim), error: null }),
        };
        return q;
      },
      upsert: async (batch: Omit<Row, "server_seq">[]) => {
        for (const b of batch) {
          const i = rows.findIndex((r) => r.user_id === b.user_id && r.kind === b.kind && r.id === b.id);
          const row = { ...b, data: JSON.parse(JSON.stringify(b.data)), server_seq: ++seq };
          if (i >= 0) rows[i] = row;
          else rows.push(row);
        }
        return { error: null };
      },
    }),
  };
  return { rows, client: client as unknown as SupabaseClient };
}

async function wipeDevice() {
  await resetDbConnection();
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase("schach-analyse");
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}

const PGN = `[Event "Sync"]\n[White "Me"]\n[Black "Opp"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0\n`;

beforeEach(wipeDevice);

describe("syncWith", () => {
  it("brings games and settings to a new device and propagates deletions", async () => {
    const server = fakeServer();
    // Device A: one game, one setting.
    const game = toStoredGame(parsePgnText(PGN)[0]);
    await putGames([game]);
    await setSetting("usernames", ["Me"]);
    expect(await syncWith(server.client, "u1")).toEqual({ pulled: 0, pushed: 2 });
    expect(server.rows.map((r) => r.kind).sort()).toEqual(["game", "setting"]);
    expect(server.rows.every((r) => r.user_id === "u1")).toBe(true);
    // Sync state never leaves the device.
    expect(server.rows.some((r) => r.id.startsWith("sync."))).toBe(false);

    // A second round has nothing to do.
    expect(await syncWith(server.client, "u1")).toEqual({ pulled: 0, pushed: 0 });

    // Device B starts empty and receives everything.
    await wipeDevice();
    expect(await syncWith(server.client, "u1")).toEqual({ pulled: 2, pushed: 0 });
    expect((await listGames()).map((g) => g.id)).toEqual([game.id]);
    expect(await getSetting("usernames", [])).toEqual(["Me"]);

    // B deletes the game; the tombstone reaches the server.
    await deleteGame(game.id);
    expect((await syncWith(server.client, "u1")).pushed).toBe(1);
    expect(server.rows.find((r) => r.id === game.id)?.deleted).toBe(true);
  });

  it("keeps the newer copy when both devices changed a record", async () => {
    const server = fakeServer();
    await setSetting("usernames", ["Old"]);
    await syncWith(server.client, "u1");
    // Another device wrote a newer value directly on the server.
    const row = server.rows.find((r) => r.id === "usernames")!;
    row.data = ["Newer"];
    row.updated_at = Date.now() + 60_000;
    row.server_seq = 999;
    await syncWith(server.client, "u1");
    expect(await getSetting("usernames", [])).toEqual(["Newer"]);
  });
});
