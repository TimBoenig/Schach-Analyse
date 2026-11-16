// Stored games that an earlier version filed wrongly are put right at start.
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { repairGames } from "../../src/app/repairGames";
import { parsePgnText } from "../../src/domain/pgn";
import { UNTIMED } from "../../src/domain/metrics/speed";
import { gameExists, listAllGameRecords, listGames, putGames, resetDbConnection } from "../../src/storage/db";
import { toStoredGame } from "../../src/storage/rows";

const MOVES = "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0";
const pgn = (headers: Record<string, string>, moves = MOVES) =>
  `${Object.entries({ White: "Me", Black: "Opp", Result: "1-0", ...headers })
    .map(([k, v]) => `[${k} "${v}"]`)
    .join("\n")}\n\n${moves}\n`;

const stored = (headers: Record<string, string>, wrongSpeed?: string, moves?: string) => {
  const row = toStoredGame(parsePgnText(pgn(headers, moves))[0]);
  return wrongSpeed ? { ...row, speed_category: wrongSpeed } : row;
};

beforeEach(async () => {
  await resetDbConnection();
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase("schach-analyse");
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
});

describe("repairGames", () => {
  it("moves games to the pool their platform rates them in and removes double records", async () => {
    const coach = stored({ Event: "Play vs Coach", Site: "Chess.com", TimeControl: "-", Link: "https://www.chess.com/game/live/1" }, "Blitz");
    const halfHour = stored({ Event: "Live Chess", Site: "Chess.com", TimeControl: "1800", Link: "https://www.chess.com/game/live/2" }, "Classical");
    const fine = stored({ Event: "Live Chess", Site: "Chess.com", TimeControl: "600", Link: "https://www.chess.com/game/live/3" });
    const oldSite = stored({ Event: "Rated Blitz game", Site: "https://lichess.org/Ab3dEf9h", TimeControl: "300+3" });
    const newSite = stored({ Event: "Rated Blitz game", Site: "https://lichess.org/game/Ab3dEf9h", TimeControl: "300+3" });
    await putGames([coach, halfHour, fine, oldSite, newSite]);

    expect(await repairGames()).toEqual({ refiled: 2, duplicates: 1 });

    const live = await listGames();
    const speedOf = (id: string) => live.find((g) => g.id === id)?.speed_category;
    expect([speedOf(coach.id), speedOf(halfHour.id), speedOf(fine.id)]).toEqual([UNTIMED, "Rapid", "Rapid"]);
    expect(live.filter((g) => g.source === "lichess")).toHaveLength(1);
    // The removed copy stays as a tombstone so the deletion reaches other devices.
    expect((await listAllGameRecords()).filter((g) => g.deleted)).toHaveLength(1);
    // A second run finds nothing left to do.
    expect(await repairGames()).toEqual({ refiled: 0, duplicates: 0 });
  });
});

describe("gameExists", () => {
  it("recognises a stored platform game under a changed PGN, but not a longer copy of it", async () => {
    await putGames([stored({ Event: "Rated Blitz game", Site: "https://lichess.org/Ab3dEf9h", TimeControl: "300+3" })]);
    const again = parsePgnText(pgn({ Event: "Rated Blitz game", Site: "https://lichess.org/game/Ab3dEf9h", TimeControl: "300+3" }))[0];
    const other = parsePgnText(pgn({ Event: "Rated Blitz game", Site: "https://lichess.org/game/Zz3dEf9h", TimeControl: "300+3" }))[0];
    const shorter = parsePgnText(pgn({ Event: "Rated Blitz game", Site: "https://lichess.org/Qq3dEf9h", TimeControl: "300+3" }, "1. e4 e5 *"))[0];
    await putGames([toStoredGame(shorter)]);
    const grown = parsePgnText(pgn({ Event: "Rated Blitz game", Site: "https://lichess.org/Qq3dEf9h", TimeControl: "300+3" }, "1. e4 e5 2. Nf3 Nc6 *"))[0];
    expect(await gameExists(again.game_id)).toBe(false);
    expect(await Promise.all([again, other, grown].map((g) => gameExists(g.game_id, g)))).toEqual([true, false, false]);
  });
});
