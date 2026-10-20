// Local persistence and the last-writer-wins merge behind cross-device sync.
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { analyzeGameTactics } from "../../src/domain/tactics";
import { parsePgnText } from "../../src/domain/pgn";
import { deleteGame, getGame, getSetting, listAllGameRecords, listGames, putGames, resetDbConnection, setSetting } from "../../src/storage/db";
import { fromStoredGame, toStoredGame } from "../../src/storage/rows";
import { mergeRecords } from "../../src/storage/sync";

const PGN = `[Event "Test"]\n[White "Me"]\n[Black "Opp"]\n[Result "1-0"]\n[TimeControl "180+2"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0\n`;

beforeEach(async () => {
  await resetDbConnection();
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase("schach-analyse");
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
});

describe("rows", () => {
  it("round-trips a game and derives speed, termination and status", () => {
    const game = parsePgnText(PGN)[0];
    const row = toStoredGame(game);
    expect(row.id).toBe(game.game_id);
    expect(row.speed_category).toBe("Blitz");
    expect(row.termination_mode).toBeTruthy();
    expect(row.summary_json.analysis_status).toBe("not_started");
    // Unanalysed games skip the tactics replay (bulk-import performance).
    expect(row.summary_json.white?.tactics).toBeUndefined();
    const back = fromStoredGame(row);
    expect(back.moves.map((m) => m.san)).toEqual(game.moves.map((m) => m.san));
    expect(back.metadata.headers.White).toBe("Me");
  });

  it("stores tactics once moves are analysed", () => {
    const game = parsePgnText(PGN)[0];
    game.moves.forEach((m) => {
      m.eval_before_cp = 0;
      m.classification = "Best";
    });
    const row = toStoredGame(game);
    expect(row.summary_json.white?.tactics).toEqual(analyzeGameTactics(row.moves_json, "white", "1-0", "Blitz"));
  });
});

describe("IndexedDB storage", () => {
  it("lists live games newest first and keeps tombstones for sync", async () => {
    const a = { ...toStoredGame(parsePgnText(PGN)[0], 100), id: "a" };
    const b = { ...toStoredGame(parsePgnText(PGN)[0], 200), id: "b" };
    await putGames([a, b]);
    expect((await listGames()).map((g) => g.id)).toEqual(["b", "a"]);
    await deleteGame("a");
    expect(await getGame("a")).toBeUndefined();
    expect((await listGames()).map((g) => g.id)).toEqual(["b"]);
    const tomb = (await listAllGameRecords()).find((g) => g.id === "a")!;
    expect(tomb.deleted).toBe(true);
    expect(tomb.moves_json).toEqual([]);
  });

  it("persists settings with a fallback", async () => {
    expect(await getSetting("usernames", ["x"])).toEqual(["x"]);
    await setSetting("usernames", ["Me"]);
    expect(await getSetting("usernames", [])).toEqual(["Me"]);
  });
});

describe("mergeRecords", () => {
  const rec = (id: string, updated_at: number) => ({ id, updated_at });
  const map = (...r: { id: string; updated_at: number }[]) => new Map(r.map((x) => [x.id, x]));

  it("takes the newer side and pushes only local changes since the last push", () => {
    const local = map(rec("same", 5), rec("localNewer", 9), rec("remoteNewer", 3), rec("onlyLocalOld", 1), rec("onlyLocalNew", 20));
    const remote = map(rec("same", 5), rec("localNewer", 4), rec("remoteNewer", 8), rec("onlyRemote", 2));
    const { toLocal, toRemote } = mergeRecords(local, remote, 10);
    expect(toLocal.map((r) => r.id).sort()).toEqual(["onlyRemote", "remoteNewer"]);
    expect(toRemote.map((r) => r.id).sort()).toEqual(["localNewer", "onlyLocalNew"]);
  });
});
