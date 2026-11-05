// Tracked players in storage: hiding survives a reload, re-adding shows a
// player again and loading all friends carries on past a broken account.
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("../../src/api/import", () => ({
  importLichessGames: vi.fn(async (username: string) => {
    calls.push(username);
    if (username === "kaputt") throw new Error("404");
    return { result: { found: 2, imported: 2, already_known: 0, skipped: [] }, games: [] };
  }),
  importChesscomGames: vi.fn(async (username: string) => {
    calls.push(`cc:${username}`);
    throw new Error("umbenannt");
  }),
}));

const { addPlayer, importAllPlayers, importPlayerGames, loadPlayers, updatePlayer } = await import("../../src/app/players");
const { resetDbConnection } = await import("../../src/storage/db");

beforeEach(async () => {
  calls.length = 0;
  await resetDbConnection();
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase("schach-analyse");
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
});

describe("hiding tracked players", () => {
  it("stores the hidden flag and shows a player again when they are added once more", async () => {
    const lena = await addPlayer({ accounts: [{ source: "lichess", username: "Lena" }], friend: true });
    expect(lena.hidden).toBe(false);
    await updatePlayer(lena.id, { hidden: true });
    expect((await loadPlayers())[0]).toMatchObject({ id: lena.id, friend: true, hidden: true });

    await addPlayer({ accounts: [{ source: "chesscom", username: "lena" }], friend: false });
    const [again] = await loadPlayers();
    expect(again).toMatchObject({ hidden: false, friend: true });
    expect(again.accounts).toHaveLength(2);
  });

  it("loads every online friend and reports the ones that failed", async () => {
    for (const username of ["Lena", "kaputt", "Ole"]) await addPlayer({ accounts: [{ source: "lichess", username }], friend: true });
    await addPlayer({ accounts: [{ source: "other", username: "Vereinsmeister" }], friend: true });
    const steps: string[] = [];
    const res = await importAllPlayers(await loadPlayers(), { onProgress: (s) => steps.push(s) });
    expect(calls).toEqual(["Lena", "kaputt", "Ole"]);
    expect(res).toEqual({ imported: 4, failed: ["kaputt"] });
    expect(steps[0]).toBe("Lade Lena (1/3) …");
    const stamped = (await loadPlayers()).filter((p) => p.imported_at !== null).map((p) => p.name);
    expect(stamped).toEqual(["Lena", "Ole"]);
  });

  it("keeps the working account of a player when another one fails", async () => {
    const p = await addPlayer({ accounts: [{ source: "chesscom", username: "alt" }, { source: "lichess", username: "Lena" }], friend: true });
    const res = await importPlayerGames(p);
    expect(calls).toEqual(["cc:alt", "Lena"]);
    expect([res.result.imported, res.failed]).toEqual([2, [{ source: "chesscom", username: "alt" }]]);
    const only = await addPlayer({ accounts: [{ source: "chesscom", username: "weg" }], friend: false });
    await expect(importPlayerGames(only)).rejects.toThrow("umbenannt");
  });
});
