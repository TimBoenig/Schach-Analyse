// Two "devices" sharing one fake Supabase table: pull/merge/push round trips.
import "fake-indexeddb/auto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";

import { parsePgnText } from "../../src/domain/pgn";
import { deleteGame, getSetting, listGames, putGames, resetDbConnection, setSetting } from "../../src/storage/db";
import type { StoredGame } from "../../src/domain/types";
import { fromCloudGame, toCloudGame } from "../../src/storage/compact";
import { fromStoredGame, toStoredGame } from "../../src/storage/rows";
import { syncWith } from "../../src/storage/sync";
import { buildMoves, gameRow } from "../profile/fixtures";

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

describe("compact cloud games", () => {
  /** A game from the fixture line with full engine data like a real analysis. */
  function analysedGame(): StoredGame {
    const fixture = buildMoves({ 15: ["Blunder", 0.85], 16: ["Mistake", 0.6] });
    const row = gameRow("g-compact", fixture, { user: "Me" });
    // Positions, plies and clocks as the PGN parser makes them; analysis from the fixture.
    const parsed = parsePgnText(row.pgn as string)[0].moves;
    const moves = fixture.map((f, i) => ({
      ...f,
      ...parsed[i],
      classification: f.classification,
      best_move: f.best_move,
      eval_before_cp: f.eval_before_cp,
      eval_after_cp: f.eval_after_cp,
      win_chance_before: f.win_chance_before,
      win_chance_after: f.win_chance_after,
    })).map((m, i) => ({
      ...m,
      pv: [m.best_move!, "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6", "e1g1", "f8e7", "f1e1"],
      multi_pvs: [
        { pv: [m.best_move!, "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6"], cp: 30 + i, mate: null, depth: 14, pv_san: "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6" },
        { pv: [m.uci, "c7c5", "g1f3", "d7d6", "d2d4", "c5d4", "f3d4", "g8f6"], cp: 10 - i, mate: null, depth: 14, pv_san: "1. d4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6" },
      ],
      candidate_continuations: ["1. e4 e5 2. Nf3", "1. d4 d5 2. c4"],
      explanation: "Erste Wahl der Engine.",
      is_book_move: i < 4,
      book_exit_move: i === 4,
    }));
    return toStoredGame(fromStoredGame({ ...(row as unknown as StoredGame), moves_json: moves, summary_json: JSON.parse(row.summary_json as string) }));
  }

  it("uploads a fraction of the analysis and restores what profile and review need", async () => {
    const game = analysedGame();
    const cloud = await toCloudGame(game);
    expect(cloud.moves_json).toBeUndefined();
    expect(cloud.moves_c?.enc).toBe("gz");
    expect(JSON.stringify(cloud).length).toBeLessThan(JSON.stringify(game).length / 4);

    const back = await fromCloudGame(cloud, { id: game.id, updated_at: 5, deleted: false });
    expect(back.moves_json).toHaveLength(game.moves_json.length);
    back.moves_json.forEach((m, i) => {
      const o = game.moves_json[i];
      expect([m.uci, m.san, m.fen_before, m.classification, m.best_move, m.eval_after_cp, m.win_chance_after, m.is_book_move, m.book_exit_move]).toEqual([
        o.uci, o.san, o.fen_before, o.classification, o.best_move, o.eval_after_cp, o.win_chance_after, o.is_book_move, o.book_exit_move,
      ]);
      // Engine lines keep first move and score: enough for judgedLoss.
      expect(m.multi_pvs.map((l) => [l.pv[0], l.cp])).toEqual(o.multi_pvs.map((l) => [l.pv[0], l.cp]));
      expect(m.pv).toEqual(o.pv.slice(0, 8));
    });
    // Tactics are recomputed from the moves on arrival.
    expect(back.summary_json.white?.tactics).toEqual(game.summary_json.white?.tactics);
    expect(back.summary_json.analysis_status).toBe("completed");
  });

  it("keeps the game but drops analysis that does not fit its PGN", async () => {
    const game = analysedGame();
    const cloud = await toCloudGame(game);
    cloud.pgn = cloud.pgn.replace("Nf3", "Nc3");
    const back = await fromCloudGame(cloud, { id: game.id, updated_at: 5, deleted: false });
    expect(back.moves_json).toEqual([]);
    expect(back.summary_json.analysis_status).toBe("not_started");
  });

  it("syncs compact games between devices, reads old full records and keeps richer local moves", async () => {
    const server = fakeServer();
    const game = analysedGame();
    await putGames([game]);
    await syncWith(server.client, "u1");
    expect((server.rows[0].data as Record<string, unknown>).moves_c).toBeDefined();

    // Device B gets a working analysed game from the compact copy.
    await wipeDevice();
    await syncWith(server.client, "u1");
    const [onB] = await listGames();
    expect(onB.moves_json.filter((m) => m.classification === "Blunder")).toHaveLength(1);
    expect(onB.summary_json.analysis_status).toBe("completed");

    // A record written by an older version (full moves) still loads.
    const legacy = server.rows[0];
    legacy.data = { ...game, updated_at: undefined, moves_json: game.moves_json };
    legacy.updated_at = Date.now() + 1000;
    legacy.server_seq = 500;
    await wipeDevice();
    await syncWith(server.client, "u1");
    expect((await listGames())[0].moves_json[0].multi_pvs[0].pv.length).toBeGreaterThan(1);

    // A newer compact copy of the same analysis does not replace the full local lines.
    const newer = { ...server.rows[0], data: await toCloudGame(game), updated_at: Date.now() + 5000, server_seq: 600 };
    server.rows[0] = newer;
    await syncWith(server.client, "u1");
    const local = (await listGames())[0];
    expect(local.updated_at).toBe(newer.updated_at);
    expect(local.moves_json[0].multi_pvs[0].pv.length).toBeGreaterThan(1);
  });

  it("re-uploads old full records once in compact form", async () => {
    const server = fakeServer();
    const game = analysedGame();
    await putGames([game]);
    await syncWith(server.client, "u1");
    // Pretend the row was uploaded by an older version.
    server.rows[0].data = { ...game, moves_json: game.moves_json };
    await setSetting("sync.compact", 0);
    await syncWith(server.client, "u1");
    expect((server.rows[0].data as Record<string, unknown>).moves_json).toBeUndefined();
    expect(await syncWith(server.client, "u1")).toEqual({ pulled: 0, pushed: 0 });
  });
});
