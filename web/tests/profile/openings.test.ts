import { describe, expect, it } from "vitest";
import { buildOpeningInsights, buildPlayerProfile, extractFeatures } from "../../src/domain/profile";
import { buildMoves, gameRow } from "./fixtures";

// White (the user) blunders with 4. c3 (ply 6): still inside the opening phase.
const EARLY_BLUNDER = buildMoves({ 6: ["Blunder", 0.2] });
const CLEAN = buildMoves({});

const pad = (n: number) => String(n).padStart(2, "0");
const row = (id: string, moves = CLEAN, opts: Parameters<typeof gameRow>[2] = {}) =>
  gameRow(id, moves, { utc: `2026.06.${pad(Number(id.replace(/\D/g, "")) + 1)} 18:00:00`, ...opts });

describe("opening insights", () => {
  it("groups the repertoire per colour and names the best and worst opening", () => {
    const rows = [
      row("i0", CLEAN, { result: "1-0", opening: "Italian Game: Giuoco Piano" }),
      row("i1", CLEAN, { result: "1-0", opening: "Italian Game: Giuoco Piano" }),
      row("i2", CLEAN, { result: "1/2-1/2", opening: "Italian Game" }),
      row("s3", CLEAN, { result: "0-1", opening: "Sicilian Defense: Najdorf Variation" }),
      row("s4", CLEAN, { result: "0-1", opening: "Sicilian Defense: Najdorf Variation" }),
      row("s5", CLEAN, { result: "1-0", opening: "Sicilian Defense" }),
      row("b6", CLEAN, { result: "0-1", userWhite: false, opening: "Italian Game" }),
    ];
    const o = buildOpeningInsights(rows.map((r) => extractFeatures(r, r.white === "Tim" ? "white" : "black")));

    expect(o.white.map((l) => [l.name, l.games, l.wins, l.draws, l.losses])).toEqual([
      ["Italian Game", 3, 2, 1, 0],
      ["Sicilian Defense", 3, 1, 0, 2],
    ]);
    const italian = o.white[0];
    expect(italian.score_pct).toBeCloseTo(83.33, 1);
    expect(italian.variations).toEqual([{ name: "Italian Game: Giuoco Piano", games: 2 }]);
    // Newest game first, linked by id.
    expect(italian.recent.map((g) => g.id)).toEqual(["i2", "i1", "i0"]);
    expect(o.black.map((l) => [l.name, l.color, l.score_pct])).toEqual([["Italian Game", "black", 100]]);

    // 3 wins and a draw out of 6 games.
    expect(o.white_first).toEqual([{ san: "e4", games: 6, score_pct: (3.5 / 6) * 100 }]);
    expect(o.black_vs).toEqual([
      { san: "e4", games: 1, score_pct: 100, replies: [{ san: "e5", games: 1, score_pct: 100 }] },
    ]);

    expect(o.facts).toContain("Stärkste Eröffnung mit Weiß: Italienische Partie mit 83 % der Punkte aus 3 Partien.");
    expect(o.facts).toContain(
      "Schwächste Eröffnung mit Weiß: Sizilianische Verteidigung mit nur 33 % der Punkte aus 3 Partien.",
    );
  });

  it("measures the first error and the position after the opening", () => {
    const rows = [0, 1, 2, 3, 4].map((i) => row(`e${i}`, EARLY_BLUNDER, { result: "0-1" }));
    const o = buildOpeningInsights(rows.map((r) => extractFeatures(r, "white")));
    const line = o.white[0];
    expect(line.analyzed).toBe(5);
    expect(line.first_error_move).toBe(4);
    expect(line.wp_after_opening).toBeCloseTo(20, 5);
    expect(o.wp_after_opening).toBeCloseTo(20, 5);
    expect(o.facts[0]).toBe("Nach der Eröffnung stehst du im Schnitt schon schlechter (Gewinnchance 20 %).");
    expect(o.facts).toContain("Italienische Partie (Weiß): Dein erster schwerer Fehler kommt im Schnitt schon in Zug 4.");
  });

  it("is part of the profile even before any game is analyzed", () => {
    const unanalyzed = buildMoves({}).map((m) => ({ ...m, classification: "" as const }));
    const r = row("u0", unanalyzed, { accuracy: 0 });
    const p = buildPlayerProfile([r], ["Tim"]);
    expect(p.analyzed_games).toBe(0);
    expect(p.openings?.white.map((l) => [l.name, l.games, l.analyzed, l.wp_after_opening])).toEqual([
      ["Italian Game", 1, 0, null],
    ]);
  });
});
