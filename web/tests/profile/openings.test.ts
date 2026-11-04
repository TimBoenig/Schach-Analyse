import { describe, expect, it } from "vitest";
import { buildOpeningInsights, buildPlayerProfile, extractFeatures, type GameFeatures } from "../../src/domain/profile";
import { buildMoves, gameRow, LINE } from "./fixtures";

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

    // Three games per opening are no evidence for a best or worst opening.
    expect(o.facts.some((f) => f.startsWith("Stärkste") || f.startsWith("Schwächste"))).toBe(false);
  });

  it("names the best and worst opening once enough games show a clear gap", () => {
    const rows = [];
    for (let i = 0; i < 10; i++) {
      const utc = `2026.07.${pad(i + 1)} 18:00:00`;
      rows.push(gameRow(`i${i}`, CLEAN, { utc, result: i < 8 ? "1-0" : "1/2-1/2", opening: "Italian Game" }));
      rows.push(gameRow(`s${i}`, CLEAN, { utc: utc.replace("18:", "20:"), result: i < 2 ? "1-0" : "0-1", opening: "Sicilian Defense" }));
    }
    const o = buildOpeningInsights(rows.map((r) => extractFeatures(r, "white")));
    expect(o.facts).toContain("Stärkste Eröffnung mit Weiß: Italienische Partie mit 90 % der Punkte aus 10 Partien.");
    expect(o.facts).toContain("Schwächste Eröffnung mit Weiß: Sizilianische Verteidigung mit nur 20 % der Punkte aus 10 Partien.");
  });

  it("measures the first error and the position after the opening", () => {
    const rows = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => row(`e${i}`, EARLY_BLUNDER, { result: "0-1" }));
    const o = buildOpeningInsights(rows.map((r) => extractFeatures(r, "white")));
    const line = o.white[0];
    expect(line.analyzed).toBe(10);
    expect(line.first_error_move).toBe(4);
    expect(line.wp_after_opening).toBeCloseTo(20, 5);
    expect(o.wp_after_opening).toBeCloseTo(20, 5);
    expect(o.facts).toContain("Nach der Eröffnung stehst du im Schnitt schon schlechter (Gewinnchance 20 %).");
    // The same wrong move in every game is the most concrete finding of all.
    expect(o.facts[0]).toBe(
      "Nach 1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 spielst du oft 4. c3, das war in 10 von 10 Partien ein Fehler. Besser ist 4. Nc3.",
    );
    expect(o.facts).toContain("Italienische Partie (Weiß): Dein erster schwerer Fehler kommt im Schnitt schon in Zug 4.");
  });

  it("builds the own opening tree with results, typical line and the moves that keep going wrong", () => {
    const sicilian = (f: GameFeatures) => {
      f.opening_line = ["e4", "c5", "Nf3", "d6"].map((san) => ({ san, uci: "", classification: "Best", best_move: null, is_book: true }));
      return f;
    };
    const feats = [
      ...[0, 1, 2, 3, 4].map((i) => extractFeatures(row(`b${i}`, EARLY_BLUNDER, { result: i < 3 ? "0-1" : "1-0" }), "white")),
      ...[5, 6].map((i) => sicilian(extractFeatures(row(`s${i}`, CLEAN, { result: "1/2-1/2" }), "white"))),
      extractFeatures(row("o7", CLEAN, { result: "1-0", userWhite: false }), "black"),
    ];
    const o = buildOpeningInsights(feats);
    const { white, black } = o.tree;

    expect(white.games).toBe(7);
    const e4 = white.children[0];
    expect([e4.san, e4.user, e4.games]).toEqual(["e4", true, 7]);
    // Opponent replies: how the player scored against each, most common first.
    expect(e4.children.map((c) => [c.san, c.user, c.games, c.wins, c.draws, c.losses])).toEqual([
      ["e5", false, 5, 2, 0, 3],
      ["c5", false, 2, 0, 2, 0],
    ]);

    // 4. c3 was a blunder in all five games: a leak, with the engine's move instead.
    const c3 = white.children[0].children[0].children[0].children[0].children[0].children[0].children[0];
    expect([c3.san, c3.judged, c3.errors, c3.leak, c3.better]).toEqual(["c3", 5, 5, true, "Nc3"]);
    expect(o.tree.leaks.map((l) => [l.color, l.path.join(" "), l.better])).toEqual([
      ["white", "e4 e5 Nf3 Nc6 Bc4 Bc5 c3", "Nc3"],
    ]);
    // Five games are enough to flag the move in the tree, not for a headline finding.
    expect(o.facts.some((f) => f.includes("spielst du oft"))).toBe(false);

    // A line from one game only is not expanded: it is that game, not a repertoire.
    expect(black.games).toBe(1);
    expect(black.children[0].children).toEqual([]);

    // The typical line follows the moves most games share.
    expect(o.white[0].line).toEqual(LINE.slice(0, 10));
    expect(o.white[0].fen.split(" ")[1]).toBe("w");
  });

  it("does not call a move a leak from four games", () => {
    const feats = [0, 1, 2, 3].map((i) => extractFeatures(row(`b${i}`, EARLY_BLUNDER), "white"));
    const o = buildOpeningInsights(feats);
    expect(o.tree.leaks).toEqual([]);
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
