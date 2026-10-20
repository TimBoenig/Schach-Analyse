import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetThrottle } from "../../src/api/base";
import { importChesscomGames, importLichessGames, importPgnText, isPendingAnalysis } from "../../src/api/import";
import { CHESS960_UNSUPPORTED } from "../../src/domain/pgn";
import { json, mockFetch } from "./helpers";

const GAME_A = '[White "Tim"]\n[Black "A"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0';
const GAME_B = '[White "B"]\n[Black "Tim"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1';
const GAME_960 =
  '[White "C"]\n[Black "Tim"]\n[Result "*"]\n[Variant "Chess960"]\n[FEN "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w HFhf - 0 1"]\n\n1. e4 *';

beforeEach(() => {
  resetThrottle();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Simulates the caller's store: ids saved via onBatch become "existing". */
function store() {
  const ids = new Set<string>();
  return { ids, exists: (id: string) => ids.has(id), save: (games: { game_id: string }[]) => games.forEach((g) => ids.add(g.game_id)) };
}

describe("importPgnText", () => {
  it("returns every new game once and is a no-op on re-import", async () => {
    const db = store();
    const first = await importPgnText(`${GAME_A}\n\n${GAME_A}\n\n${GAME_B}`, db.exists, "file");
    expect(first.result).toEqual({ found: 3, imported: 2, already_known: 1, skipped: [] });
    db.save(first.games);

    const again = await importPgnText(`${GAME_A}\n\n${GAME_B}`, db.exists);
    expect([again.result.imported, again.result.already_known, again.games]).toEqual([0, 2, []]);
  });

  it("reports Chess960 games as skipped", async () => {
    const batch = await importPgnText(`${GAME_960}\n\n${GAME_A}`, () => false);
    expect(batch.games).toHaveLength(1);
    expect(batch.result.skipped.map((s) => s.reason)).toEqual([CHESS960_UNSUPPORTED]);
  });
});

describe("importChesscomGames", () => {
  it("fetches the newest months first, skips variants and hands out batches", async () => {
    const archives = [1, 2, 3].map((m) => `https://api.chess.com/pub/player/tim/games/2026/0${m}`);
    const calls = mockFetch((url) =>
      url.pathname.endsWith("/archives")
        ? json({ archives })
        : json({ games: [{ pgn: GAME_A, rules: "chess" }, { pgn: GAME_B, rules: "crazyhouse" }, { rules: "chess" }] }),
    );
    const db = store();
    const progress = vi.fn();
    const batch = await importChesscomGames("Tim", db.exists, 2, { onProgress: progress, onBatch: db.save });

    expect(calls.map((c) => c.url.href)).toEqual([
      "https://api.chess.com/pub/player/tim/games/archives",
      archives[2],
      archives[1],
    ]);
    expect(batch.result).toMatchObject({ found: 2, imported: 1, already_known: 1 });
    expect(batch.games[0].metadata.source).toBe("chesscom");
    expect(db.ids.size).toBe(1);
    expect(progress.mock.calls).toEqual([
      [1, 2, "Lade Partien 2026/03 …"],
      [2, 2, "Lade Partien 2026/02 …"],
    ]);
  });

  it("keeps the months fetched before a cancel", async () => {
    const controller = new AbortController();
    const archives = [1, 2].map((m) => `https://api.chess.com/pub/player/tim/games/2026/0${m}`);
    mockFetch((url) => {
      if (url.pathname.endsWith("/archives")) return json({ archives });
      return json({ games: [{ pgn: url.pathname.endsWith("02") ? GAME_A : GAME_B }] });
    });
    const batch = await importChesscomGames("tim", () => false, null, {
      signal: controller.signal,
      onBatch: () => controller.abort(),
    });
    expect(batch.games.map((g) => g.metadata.white)).toEqual(["Tim"]);
  });
});

describe("importLichessGames", () => {
  it("imports the NDJSON games with lichess as source", async () => {
    mockFetch(() => new Response(JSON.stringify({ id: "x", pgn: GAME_B }) + "\n"));
    const batch = await importLichessGames("Tim", () => false, 10);
    expect(batch.games.map((g) => [g.metadata.white, g.metadata.source])).toEqual([["B", "lichess"]]);
  });
});

describe("isPendingAnalysis", () => {
  it.each([
    [null, true],
    ["not json", true],
    [JSON.stringify({ analysis_status: "paused" }), true],
    [JSON.stringify({ analysis_status: "completed" }), false],
    [{ analysis_status: "completed" as const }, false],
  ])("%j -> %s", (summary, pending) => {
    expect(isPendingAnalysis(summary)).toBe(pending);
  });
});
