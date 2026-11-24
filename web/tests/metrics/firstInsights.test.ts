import { describe, expect, it } from "vitest";

import { firstFinding, firstThoughts, openingFamily } from "../../src/domain/firstInsights";
import type { GameAnalysis, MoveData } from "../../src/domain/types";
import { onboardPath, onboardPhases } from "../../src/ui/stage/script";

let seq = 0;
const game = (white: string, black: string, result: string, extra: Record<string, unknown> = {}): GameAnalysis =>
  ({
    game_id: `g${seq++}`,
    metadata: { white, black, result, time_control: "600", event: "", headers: {}, date: `2026.11.${String(10 + seq).padStart(2, "0")}`, opening: null, speed_category: "rapid", ...extra },
    moves: [],
    summary: {},
  }) as unknown as GameAnalysis;

describe("Lucena's thoughts while games arrive", () => {
  it("says nothing it cannot back with enough games", () => {
    expect(firstThoughts([game("tim", "a", "1-0"), game("b", "tim", "0-1")], "tim")).toEqual([]);
    expect(firstThoughts([game("x", "y", "1-0")], "tim")).toEqual([]);
  });

  it("names the most played opening family, the points per colour, the longest streak and the most frequent opponent", () => {
    const games = [
      ...Array.from({ length: 5 }, () => game("tim", "rival", "1-0", { opening: "Italian Game: Two Knights Defense" })),
      ...Array.from({ length: 5 }, () => game("other", "tim", "1/2-1/2", { opening: "Sicilian Defense" })),
    ];
    expect(firstThoughts(games, "Tim")).toEqual([
      "Am häufigsten auf dem Brett: Italian Game, in 5 Partien.",
      "Mit Weiß holst du 100 % der Punkte, mit Schwarz 50 %.",
      "Deine längste Siegesserie hier: 5 Partien am Stück.",
      "Gegen rival hast du 5-mal gespielt. Dein häufigster Gegner.",
    ]);
    expect(openingFamily("Queen's Gambit Declined, Exchange")).toBe("Queen's Gambit Declined");
  });
});

const move = (fen: string, san: string, cls: MoveData["classification"], before: number, after: number, best: string | null = null): MoveData =>
  ({ move_number: 1, fen_before: fen, san, classification: cls, win_chance_before: before, win_chance_after: after, best_move: best }) as unknown as MoveData;

describe("first finding after the engine's first pass", () => {
  it("waits for a finished game", () => {
    expect(firstFinding([game("tim", "a", "1-0")], "tim")).toBeNull();
  });

  it("counts the user's mistakes and finds the move that cost the most, from the user's side", () => {
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const g = game("anna", "tim", "1-0");
    g.summary = { analysis_status: "completed", black: { accuracy: 71.6, Blunder: 2, Mistake: 1 }, white: { accuracy: 90, Blunder: 0, Mistake: 0 } } as never;
    // White's own drop must not count; Black's blunder (White-perspective 0.4 -> 0.9) is a 50-point loss for Black.
    g.moves = [move(start, "e4", "Blunder", 0.5, 0.1), move(afterE4, "f6", "Blunder", 0.4, 0.9, "e7e5")];
    const f = firstFinding([g], "tim");
    expect(f).toEqual({
      analysed: 1,
      blunders: 2,
      mistakes: 1,
      bestGame: { gameId: g.game_id, opponent: "anna", accuracy: 72 },
      costliest: { gameId: g.game_id, opponent: "anna", ply: 2, moveNumber: 1, white: false, san: "f6", better: "e5", why: [], before: 60, after: 10 },
    });
  });
});

describe("progress line of the first start", () => {
  const path = onboardPath("chesscom");
  const st = { phase: "idle" as const, found: 0, pass: null, passDone: false };

  it("names four parts with an account and two without", () => {
    expect(onboardPhases(path, 0, st).list.map((p) => p.label)).toEqual(["Konto", "Partien", "Analyse", "Rundgang"]);
    expect(onboardPhases(onboardPath("none"), 0, st).list.map((p) => p.label)).toEqual(["Konto", "Rundgang"]);
  });

  it("fills the games and analysis parts with real progress, also while the tour runs", () => {
    const busy = onboardPhases(path, path.indexOf("import"), { ...st, phase: "busy", found: 42 });
    expect(busy.at).toBe(1);
    expect(busy.list[0].fill).toBe(1);
    expect(busy.list[1]).toEqual({ label: "Partien", fill: 0, busy: true, detail: "42" });
    const tour = onboardPhases(path, path.indexOf("analysis") + 1, { phase: "done", found: 80, pass: { fraction: 0.25, games: 80 }, passDone: false });
    expect(tour.at).toBe(3);
    expect(tour.list[2]).toEqual({ label: "Analyse", fill: 0.25, detail: "25 %" });
  });
});
