// Full export, restore parsing, coach answer merging and the CSV for spreadsheets.
import { describe, expect, it } from "vitest";

import {
  buildFullExport,
  COACH_ANSWER_LIMIT,
  gamesCsv,
  mergeCoachAnswers,
  parseBackup,
  type SavedCoachAnswer,
} from "../../src/domain/export";
import { rangeFilter } from "../../src/domain/metrics";
import type { StoredGame } from "../../src/domain/types";
import { buildMoves, gameRow, profileGames, THROWN_WIN } from "../profile/fixtures";

const NOW = Date.UTC(2026, 6, 1);
const games = profileGames(4, 4) as unknown as StoredGame[];
const answer = (key: string, created_at: number, text = "Bericht"): SavedCoachAnswer => ({ key, title: key, text, created_at });

const settings = [
  { key: "usernames", value: ["Tim"], updated_at: 1 },
  { key: "sync.lastSeq", value: 9, updated_at: 1 },
  { key: "training.log", value: { "2026-06-30": { done: 5, correct: 4, by_category: {} } }, updated_at: 1 },
  { key: "ui.theme", value: "dark", updated_at: 1 },
];

function exportFor(dateFilter: string) {
  return buildFullExport({
    games,
    usernames: ["Tim"],
    dateFilter,
    settings,
    coachAnswers: [answer("game:x", 1), answer("report:8", 2)],
    today: "2026-07-01",
    now: NOW,
  });
}

describe("buildFullExport", () => {
  it("holds games, analysis, statistics, training and coach answers, and survives JSON", () => {
    const data = exportFor("All Time");
    expect(data.scope).toMatchObject({ games_total: 8, games_exported: 8, games_analyzed: 8, from: null, to: null });
    expect(Object.keys(data.reviews)).toHaveLength(8);
    expect(data.reviews.t0.key_moments.length).toBeGreaterThan(0);
    expect(data.profile?.total_games).toBe(8);
    expect(data.profile?.statistics.total).toBe(8);
    expect(data.profile?.openings).not.toBeNull();
    expect(data.training.log["2026-06-30"].done).toBe(5);
    expect(data.training.summary?.week.done).toBe(5);
    expect(data.coach.answers.map((a) => a.key)).toEqual(["report:8", "game:x"]);
    // Sync bookkeeping stays on the device; training has its own section.
    expect(data.settings.map((s) => s.key)).toEqual(["usernames", "ui.theme"]);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it("limits games and profile to the chosen period", () => {
    const data = exportFor(rangeFilter(Date.UTC(2026, 5, 1) / 1000, Date.UTC(2026, 6, 1) / 1000));
    expect(data.scope).toMatchObject({ games_exported: 4, from: "2026-06-01", to: "2026-07-01" });
    expect(data.games.every((g) => g.id.startsWith("c"))).toBe(true);
    expect(data.profile?.overview.wins).toBe(4);
  });
});

describe("parseBackup", () => {
  it("restores what the export wrote", () => {
    const back = parseBackup(JSON.stringify(exportFor("All Time")));
    expect(back.games).toHaveLength(8);
    expect(back.settings.map((s) => s.key).sort()).toEqual(["training.log", "ui.theme", "usernames"]);
    expect(back.coachAnswers).toHaveLength(2);
  });

  it("reads a version 1 file (games only) and rejects other JSON", () => {
    const v1 = parseBackup(JSON.stringify({ format: "schach-analyse-backup", version: 1, games: [games[0], { id: 5 }] }));
    expect(v1.games.map((g) => g.id)).toEqual(["t0"]);
    expect(v1.settings).toEqual([]);
    expect(() => parseBackup('{"foo": 1}')).toThrow();
    expect(() => parseBackup("not json")).toThrow();
  });
});

describe("mergeCoachAnswers", () => {
  it("keeps the newer answer per key, newest first, within the limit", () => {
    const merged = mergeCoachAnswers([answer("a", 1, "alt"), answer("b", 5)], [answer("a", 7, "neu")]);
    expect(merged.map((a) => [a.key, a.text])).toEqual([
      ["a", "neu"],
      ["b", "Bericht"],
    ]);
    const many = Array.from({ length: COACH_ANSWER_LIMIT + 5 }, (_, i) => answer(`k${i}`, i));
    expect(mergeCoachAnswers([], many)).toHaveLength(COACH_ANSWER_LIMIT);
  });
});

describe("gamesCsv", () => {
  it("writes one row per game from the player's side, Excel-ready", () => {
    const asBlack = gameRow("b1", buildMoves(THROWN_WIN), { userWhite: false, result: "1-0", opening: 'Sizilianisch; "Drache"' });
    const csv = gamesCsv([asBlack as unknown as StoredGame], ["Tim"]);
    expect(csv.startsWith("﻿")).toBe(true);
    const [header, row] = csv.slice(1).trim().split("\r\n").map((l) => l.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/));
    const col = (name: string) => row[header.indexOf(name)];
    expect(col("Deine Farbe")).toBe("Schwarz");
    expect(col("Dein Ergebnis")).toBe("Niederlage");
    expect(col("Gegner")).toBe("Gegner");
    // THROWN_WIN: White blunders at ply 15, Black (the player) at ply 16.
    expect(col("Patzer")).toBe("1");
    expect(col("Deine Genauigkeit")).toBe("80");
    expect(col("Eröffnung")).toBe('"Sizilianisch; ""Drache"""');
  });
});
