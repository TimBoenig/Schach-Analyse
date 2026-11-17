// Devices sharing one fake Supabase table: pull/merge/push round trips, and the
// ways a round can go wrong (slow, interrupted, a broken record, two writers).
import "fake-indexeddb/auto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parsePgnText } from "../../src/domain/pgn";
import { deleteGame, getSetting, listGames, putGames, resetDbConnection, setSetting } from "../../src/storage/db";
import type { StoredGame } from "../../src/domain/types";
import { fromCloudGame, toCloudGame } from "../../src/storage/compact";
import { fromStoredGame, toStoredGame } from "../../src/storage/rows";
import { syncWith, tuning } from "../../src/storage/sync";
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

interface Request {
  op: "select" | "upsert";
  columns: string;
  ids: string[] | null;
}

/** Whether a select asks for the record's data (and not only its header). */
const wantsData = (r: Request) => r.columns.split(",").includes("data");

/** One column of a select, including PostgREST's `alias:data->a->0->>b` path form. */
function project(r: Row, columns: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns.split(",")) {
    const [alias, path] = col.includes(":") ? col.split(":") : [col, col];
    const parts = path.split(/->>?/);
    let v: unknown = (r as unknown as Record<string, unknown>)[parts[0]];
    for (const p of parts.slice(1)) v = v == null ? null : (v as Record<string, unknown>)[p];
    out[alias] = parts.length > 1 ? (v == null ? null : String(v)) : v;
  }
  return JSON.parse(JSON.stringify(out));
}

/**
 * Just enough of supabase-js for sync_records: select with eq/in/gt/order/limit and
 * upsert. `maxRows` is the server's own cap; `hooks` and `fail` let a test act
 * while a round is in flight.
 */
function fakeServer(maxRows = 1000) {
  const rows: Row[] = [];
  const log: Request[] = [];
  const hooks: { onSelect?: (r: Request) => Promise<void> | void } = {};
  const fail: { select?: (r: Request) => boolean; upsert?: (ids: string[]) => boolean } = {};
  let seq = 0;
  const client = {
    from: () => ({
      select: (columns: string) => {
        const filters: ((r: Row) => boolean)[] = [];
        let ids: string[] | null = null;
        let limit = Infinity;
        const q = {
          eq: (c: string, v: unknown) => (filters.push((r) => (r as unknown as Record<string, unknown>)[c] === v), q),
          in: (_c: string, v: string[]) => ((ids = v), filters.push((r) => v.includes(r.id)), q),
          gt: (c: string, v: number) => (filters.push((r) => (r as unknown as Record<string, number>)[c] > v), q),
          order: () => q,
          limit: (n: number) => ((limit = n), q),
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            (async () => {
              const request: Request = { op: "select", columns, ids };
              log.push(request);
              await hooks.onSelect?.(request);
              if (fail.select?.(request)) return { data: null, error: { message: "Failed to fetch" } };
              const picked = rows
                .filter((r) => filters.every((f) => f(r)))
                .sort((a, b) => a.server_seq - b.server_seq)
                .slice(0, Math.min(limit, maxRows));
              return { data: picked.map((r) => project(r, columns)), error: null };
            })().then(res, rej),
        };
        return q;
      },
      upsert: async (batch: Omit<Row, "server_seq">[]) => {
        const ids = batch.map((b) => b.id);
        log.push({ op: "upsert", columns: "", ids });
        if (fail.upsert?.(ids)) return { data: null, error: { message: "Failed to fetch" } };
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
  return { rows, log, hooks, fail, client: client as unknown as SupabaseClient };
}

async function wipeDevice() {
  await resetDbConnection();
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase("schach-analyse");
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}

const PGN = `[Event "Sync"]\n[White "Me"]\n[Black "Opp"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0\n`;

/** An unanalysed game; every `n` is another game (the id comes from the PGN). */
const plainGame = (n: number) => toStoredGame(parsePgnText(PGN.replace('"Sync"', `"Sync ${n}"`))[0]);

/** A game from the fixture line with full engine data like a real analysis. */
function analysedGame(id = "g-compact"): StoredGame {
  const fixture = buildMoves({ 15: ["Blunder", 0.85], 16: ["Mistake", 0.6] });
  const row = gameRow(id, fixture, { user: "Me" });
  // Positions, plies and clocks as the PGN parser makes them; analysis from the fixture.
  const parsed = parsePgnText(row.pgn as string)[0].moves;
  const moves = fixture
    .map((f, i) => ({
      ...f,
      ...parsed[i],
      classification: f.classification,
      best_move: f.best_move,
      eval_before_cp: f.eval_before_cp,
      eval_after_cp: f.eval_after_cp,
      win_chance_before: f.win_chance_before,
      win_chance_after: f.win_chance_after,
    }))
    .map((m, i) => ({
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

const analysed = (g: StoredGame) => g.moves_json.some((m) => m.classification);

const defaults = { ...tuning };
beforeEach(async () => {
  await wipeDevice();
  tuning.retryDelayMs = 0;
});
afterEach(() => Object.assign(tuning, defaults));

describe("syncWith", () => {
  it("brings games and settings to a new device and propagates deletions", async () => {
    const server = fakeServer();
    // Device A: one game, one setting.
    const game = toStoredGame(parsePgnText(PGN)[0]);
    await putGames([game]);
    await setSetting("usernames", ["Me"]);
    expect(await syncWith(server.client, "u1")).toMatchObject({ pulled: 0, pushed: 2, failed: 0 });
    expect(server.rows.map((r) => r.kind).sort()).toEqual(["game", "setting"]);
    expect(server.rows.every((r) => r.user_id === "u1")).toBe(true);
    // Sync state never leaves the device.
    expect(server.rows.some((r) => r.id.startsWith("sync."))).toBe(false);

    // A second round has nothing to do.
    expect(await syncWith(server.client, "u1")).toMatchObject({ pulled: 0, pushed: 0, failed: 0 });

    // Device B starts empty and receives everything.
    await wipeDevice();
    expect(await syncWith(server.client, "u1")).toMatchObject({ pulled: 2, pushed: 0, failed: 0 });
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
    expect(await syncWith(server.client, "u1")).toMatchObject({ pulled: 0, pushed: 0 });
  });
});

describe("a round that does not run undisturbed", () => {
  /** Puts `games` on the server through a first device and leaves this device empty. */
  async function seedServer(server: ReturnType<typeof fakeServer>, games: StoredGame[]) {
    await putGames(games);
    await syncWith(server.client, "u1");
    await wipeDevice();
  }

  it("uploads an analysis that finishes while the round is downloading", async () => {
    const server = fakeServer();
    await seedServer(server, [plainGame(1)]);
    const finished = analysedGame("g-finished");
    // The analysis completes after the round has looked at the local games.
    server.hooks.onSelect = async (r) => {
      if (!wantsData(r)) return;
      server.hooks.onSelect = undefined;
      await putGames([finished]);
    };
    await syncWith(server.client, "u1");
    expect(server.rows.some((r) => r.id === finished.id)).toBe(false);
    // The next round, however soon, picks it up.
    await syncWith(server.client, "u1");
    const online = server.rows.find((r) => r.id === finished.id);
    expect((online?.data as Record<string, unknown>).moves_c).toBeDefined();
  });

  it("does not replace a game that was analysed here while its newer online copy was downloading", async () => {
    const server = fakeServer();
    const finished = analysedGame();
    // Unanalysed copy from long ago; the analysis is still to come.
    const waiting: StoredGame = {
      ...finished,
      moves_json: finished.moves_json.map((m) => ({ ...m, classification: "" })),
      summary_json: { analysis_status: "not_started" },
      updated_at: 5,
    };
    await putGames([waiting], { touch: false });
    await syncWith(server.client, "u1");
    // Another device re-filed the game: a newer copy online, still unanalysed.
    const row = server.rows.find((r) => r.id === waiting.id)!;
    row.updated_at = Date.now() - 1000;
    row.server_seq = 900;
    // Meanwhile the analysis finishes here, after the round decided to download that copy.
    server.hooks.onSelect = async (r) => {
      if (!wantsData(r)) return;
      server.hooks.onSelect = undefined;
      await putGames([finished]);
    };
    await syncWith(server.client, "u1");
    const [local] = await listGames();
    expect(analysed(local)).toBe(true);
    expect(local.updated_at).toBeGreaterThan(row.updated_at);
    // And it reaches the server afterwards.
    await syncWith(server.client, "u1");
    expect((server.rows.find((r) => r.id === waiting.id)!.data as Record<string, unknown>).moves_c).toBeDefined();
  });

  it("never lets a newer copy without analysis replace the analysed one, on either side", async () => {
    const server = fakeServer();
    const game = analysedGame();
    await putGames([game]);
    await syncWith(server.client, "u1");

    // A re-filing or re-import stamps the game as changed but leaves the analysis out.
    const stripped: StoredGame = { ...game, moves_json: game.moves_json.map((m) => ({ ...m, classification: "" })), summary_json: { analysis_status: "not_started" } };
    await putGames([stripped]);
    await syncWith(server.client, "u1");

    const online = server.rows.find((r) => r.id === game.id)!.data as { moves_c?: unknown; summary_json: { analysis_status: string } };
    expect(online.moves_c).toBeDefined();
    expect(online.summary_json.analysis_status).toBe("completed");
    expect(analysed((await listGames())[0])).toBe(true);
  });

  it("one record that cannot be read is reported and retried, the rest arrives", async () => {
    const server = fakeServer();
    const games = [plainGame(1), plainGame(2), plainGame(3)];
    await seedServer(server, games);
    const broken = server.rows[1];
    const good = broken.data;
    broken.data = null;

    const report = await syncWith(server.client, "u1");
    expect(report).toMatchObject({ pulled: 2, failed: 1 });
    expect(await listGames()).toHaveLength(2);

    // The position did not move on, so the repaired record comes with the next round.
    broken.data = good;
    expect(await syncWith(server.client, "u1")).toMatchObject({ pulled: 1, failed: 0 });
    expect(await listGames()).toHaveLength(3);
  });

  it("splits a download the server refuses until only the bad record is left", async () => {
    tuning.fetchChunk = 4;
    const server = fakeServer();
    await seedServer(server, Array.from({ length: 10 }, (_, i) => plainGame(i)));
    const poison = server.rows[6].id;
    server.fail.select = (r) => wantsData(r) && Boolean(r.ids?.includes(poison));

    expect(await syncWith(server.client, "u1")).toMatchObject({ pulled: 9, failed: 1 });
    expect((await listGames()).some((g) => g.id === poison)).toBe(false);

    server.fail.select = undefined;
    expect(await syncWith(server.client, "u1")).toMatchObject({ pulled: 1, failed: 0 });
    expect(await listGames()).toHaveLength(10);
  });

  it("splits an upload the server refuses and sends the refused record again next round", async () => {
    tuning.pushItems = 4;
    const server = fakeServer();
    const games = Array.from({ length: 10 }, (_, i) => plainGame(i));
    await putGames(games);
    const poison = games[3].id;
    server.fail.upsert = (ids) => ids.includes(poison);

    expect(await syncWith(server.client, "u1")).toMatchObject({ pushed: 9, failed: 1 });
    expect(server.rows.filter((r) => r.kind === "game")).toHaveLength(9);

    // Nothing changed on the device since, yet the refused record is not forgotten.
    server.fail.upsert = undefined;
    expect(await syncWith(server.client, "u1")).toMatchObject({ pushed: 1, failed: 0 });
    expect(server.rows.filter((r) => r.kind === "game")).toHaveLength(10);
  });

  it("stops quickly when the server cannot be reached, and the next round starts clean", async () => {
    tuning.fetchChunk = 2;
    const server = fakeServer();
    await seedServer(server, Array.from({ length: 6 }, (_, i) => plainGame(i)));
    server.fail.select = () => true;
    server.log.length = 0;
    await expect(syncWith(server.client, "u1")).rejects.toThrow(/Failed to fetch/);
    // One header request and its retries, nothing like a request per record.
    expect(server.log.length).toBeLessThanOrEqual(3);

    server.fail.select = undefined;
    expect(await syncWith(server.client, "u1")).toMatchObject({ pulled: 6, failed: 0 });
  });

  it("does not split a download into pieces when the whole server is down", async () => {
    tuning.fetchChunk = 8;
    const server = fakeServer();
    await seedServer(server, Array.from({ length: 8 }, (_, i) => plainGame(i)));
    // Headers arrive, then the connection drops while the games are fetched.
    server.hooks.onSelect = (r) => {
      if (wantsData(r)) server.fail.select = () => true;
    };
    server.log.length = 0;
    await expect(syncWith(server.client, "u1")).rejects.toThrow(/Failed to fetch/);
    expect(server.log.length).toBeLessThan(10);
  });

  it("reads every page even when the server hands out fewer rows than asked for", async () => {
    const server = fakeServer(3);
    await seedServer(server, Array.from({ length: 8 }, (_, i) => plainGame(i)));
    expect(await syncWith(server.client, "u1")).toMatchObject({ pulled: 8, failed: 0 });
    expect(await listGames()).toHaveLength(8);
  });

  it("downloads no game data and sends nothing when nothing changed", async () => {
    const server = fakeServer();
    await putGames(Array.from({ length: 5 }, (_, i) => plainGame(i)));
    await syncWith(server.client, "u1");
    server.log.length = 0;

    expect(await syncWith(server.client, "u1")).toMatchObject({ pulled: 0, pushed: 0, failed: 0 });
    expect(server.log.some((r) => r.op === "upsert" || wantsData(r))).toBe(false);
  });

  it("a full round sends games the server never received, an ordinary one does not look for them", async () => {
    const server = fakeServer();
    await putGames([plainGame(1)]);
    await syncWith(server.client, "u1");
    // Saved on this device, but its timestamp lies before the last upload and no
    // upload ever happened (a lost write from an earlier version, a restored server).
    await putGames([{ ...plainGame(2), updated_at: 5 }], { touch: false });
    expect(await syncWith(server.client, "u1")).toMatchObject({ pushed: 0 });
    expect(await syncWith(server.client, "u1", { full: true })).toMatchObject({ pushed: 1 });
    expect(server.rows.filter((r) => r.kind === "game")).toHaveLength(2);
  });

  it("a full round gives back analysis an earlier round could not read", async () => {
    const server = fakeServer();
    const game = analysedGame();
    await seedServer(server, [game]);
    const good = server.rows[0].data;
    const moves = (good as { moves_c: { data: string } }).moves_c;
    server.rows[0].data = { ...(good as object), moves_c: { ...moves, data: "###" } };

    await syncWith(server.client, "u1");
    expect(analysed((await listGames())[0])).toBe(false);
    server.rows[0].data = good;
    // An ordinary round does not ask again, so a game that can never be read is not downloaded every time.
    await syncWith(server.client, "u1");
    expect(analysed((await listGames())[0])).toBe(false);
    await syncWith(server.client, "u1", { full: true });
    expect(analysed((await listGames())[0])).toBe(true);
  });
});
