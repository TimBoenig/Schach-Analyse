// Port of the aggregation tests in tests/backend/test_stats_worker.py
// (StatsWorker._calculate_stats delegates to calculate_stats).

import { describe, expect, it } from "vitest";
import {
  calculateStats,
  classifyTermination,
  getDrillDownItems,
  MAX_DRILL_DOWN_ITEMS,
  type RawGame,
} from "../../src/domain/metrics";
import { emptyMove } from "../../src/domain/types";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function dummy(id: string, over: Partial<RawGame> = {}): RawGame {
  return {
    id,
    white: "PlayerA",
    black: "PlayerB",
    result: "1-0",
    speed_category: "Blitz",
    chess960: 0,
    source: "chess.com",
    timestamp: Date.now() / 1000,
    summary_json: null,
    termination: null,
    termination_mode: null,
    ...over,
  };
}

describe("calculateStats filters", () => {
  const games = [
    dummy("g1", { black: "Opponent1", result: "1-0" }),
    dummy("g2", { white: "Opponent2", black: "PlayerA", result: "1-0" }),
    dummy("g3", { black: "Opponent3", result: "0-1" }),
  ];

  it.each([
    ["All Colors", 3, 1, 2],
    ["White", 2, 1, 1],
    ["Black", 1, 0, 1],
  ])("color filter %s", (filter, total, wins, losses) => {
    const s = calculateStats(games, ["PlayerA"], filter);
    expect([s.total, s.wins, s.losses]).toEqual([total, wins, losses]);
  });

  it.each([
    ["Blitz", 1],
    ["Rapid", 1],
    ["Freestyle (Chess960)", 1],
  ])("format filter %s keeps Chess960 separate", (filter, total) => {
    const fmtGames = [
      dummy("g1", { speed_category: "Blitz" }),
      dummy("g2", { speed_category: "Rapid" }),
      dummy("g3", { speed_category: "Blitz", chess960: 1 }),
    ];
    expect(calculateStats(fmtGames, ["PlayerA"], "All Colors", filter).total).toBe(total);
  });

  it.each(["Chess.com", "Lichess", "File"])("source filter %s", (filter) => {
    const srcGames = [
      dummy("g1", { source: "chesscom" }),
      dummy("g2", { source: "lichess" }),
      dummy("g3", { source: "file" }),
    ];
    expect(calculateStats(srcGames, ["PlayerA"], "All Colors", "All Formats", filter).total).toBe(1);
  });

  it("date filter drops old games", () => {
    const old = dummy("old", { timestamp: Date.now() / 1000 - 40 * 86400 });
    const fresh = dummy("new");
    const s = calculateStats([old, fresh], ["PlayerA"], "All Colors", "All Formats", "All Sources", "Last 30 Days");
    expect(s.total).toBe(1);
  });
});

describe("calculateStats aggregation", () => {
  it("buckets draw terminations", () => {
    const modes = [
      "threefold_repetition",
      "stalemate",
      "agreed_draw",
      "timeout_insufficient",
      "insufficient_material",
      "fifty_moves",
    ];
    const s = calculateStats(
      modes.map((m, i) => dummy(`g${i}`, { result: "1/2-1/2", termination_mode: m })),
      ["PlayerA"],
    );
    expect(s.draws).toBe(6);
    expect(s.draw_term_counts).toEqual({
      "3-Fold Repetition": 1,
      Agreement: 1,
      Stalemate: 1,
      "Insufficient vs Timeout": 1,
      "Insufficient Material": 1,
      "50-Move Rule": 1,
    });
  });

  it("aggregates formats and time trouble", () => {
    const bullet = dummy("g1", { speed_category: "Bullet", result: "1-0" });
    bullet.moves_json = [
      emptyMove({ ply: 0, fen_before: START, time_spent: 1.2, time_left: 55, classification: "Best", is_book_move: true }),
      emptyMove({
        ply: 2,
        fen_before: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
        time_spent: 14,
        time_left: 10, // <= 15s in Bullet -> time trouble
        classification: "Blunder",
      }),
    ];
    const blitz = dummy("g2", { speed_category: "Blitz", result: "0-1", termination_mode: "timeout" });
    const ts = calculateStats([bullet, blitz], ["PlayerA"]).time_stats;

    expect(ts.has_clock_data).toBe(true);
    expect(ts.total_timed_moves).toBe(2);
    expect(ts.formats.Bullet).toMatchObject({ games: 1, wins: 1, losses: 0 });
    expect(ts.formats.Blitz).toMatchObject({ games: 1, wins: 0, losses: 1, time_losses: 1 });
    expect(ts.time_trouble).toMatchObject({
      normal_moves: 1,
      normal_blunders: 0,
      trouble_moves: 1,
      trouble_blunders: 1,
      total_time_losses: 1,
    });
  });

  it("computes advantage conversion, throws and comebacks", () => {
    const one = (san: string, cp: number, wp: number) => [
      emptyMove({
        ply: 0,
        san,
        fen_before: START,
        eval_before_cp: cp,
        win_chance_before: wp,
        win_chance_after: wp,
        classification: "Best",
      }),
    ];
    const games = [
      dummy("g1", { result: "1-0", moves_json: one("e4", 350, 0.85) }), // converted
      dummy("g2", { result: "0-1", moves_json: one("d4", 400, 0.9) }), // thrown
      dummy("g3", { result: "1-0", moves_json: one("Nf3", -350, 0.1) }), // comeback win
    ];
    const adv = calculateStats(games, ["PlayerA"]).advantage_stats;
    expect(adv).toMatchObject({
      had_winning_advantage: 2,
      converted_advantage: 1,
      thrown_losses: 1,
      conversion_rate: 50,
      throw_rate: 50,
      had_losing_position: 1,
      comeback_drawn_or_won: 1,
      comeback_wins: 1,
      comeback_rate: 100,
    });
  });

  it("indexes drill-down occurrences", () => {
    const game: RawGame = {
      id: "drill_game_1",
      white: "Hero",
      black: "Rival",
      black_elo: "1850",
      result: "0-1",
      date: "2026.10.18",
      speed_category: "Blitz",
      opening: "Van't Kruijs Opening",
      moves_json: [
        emptyMove({
          ply: 1,
          move_number: 1,
          san: "Ba6",
          uci: "f1a6",
          fen_before: START,
          eval_before_cp: 50,
          eval_after_cp: -200,
          win_chance_before: 0.55,
          win_chance_after: 0.3,
          classification: "Blunder",
        }),
        emptyMove({
          ply: 2,
          move_number: 1,
          san: "e5",
          uci: "e7e5",
          fen_before: "rnbqkbnr/pppppppp/B7/8/8/8/PPPPPPPP/RNBQK1NR b KQkq - 1 1",
          eval_before_cp: -200,
          win_chance_before: 0.3,
          win_chance_after: 0.3,
          classification: "Best",
        }),
      ],
    };
    const stats = calculateStats([game], ["Hero"]);

    const blunders = getDrillDownItems(stats, "blunders");
    expect(blunders).toHaveLength(1);
    expect(blunders[0]).toMatchObject({
      game_id: "drill_game_1",
      opponent: "Rival",
      opponent_elo: "1850",
      san: "Ba6",
      classification: "Blunder",
      eval_drop: 250,
    });

    expect(getDrillDownItems(stats, "hung_pieces")).toHaveLength(1);
    const bishops = getDrillDownItems(stats, "hung_pieces", "bishop");
    expect(bishops).toHaveLength(1);
    expect(bishops[0]).toMatchObject({ piece_name: "bishop", square: "a6", game_id: "drill_game_1" });

    const vant = getDrillDownItems(stats, "openings", "Van't Kruijs Opening");
    expect(vant).toHaveLength(1);
    expect(vant[0]).toMatchObject({ game_id: "drill_game_1", is_game: true });

    const clean: RawGame = {
      id: "drill_game_2",
      white: "Hero",
      black: "Opponent",
      result: "1-0",
      date: "2026.10.18",
      speed_category: "Rapid",
      opening: "Sicilian Defense",
      summary_json: JSON.stringify({ white: { accuracy: 92, Blunder: 0 } }),
    };
    const stats2 = calculateStats([game, clean], ["Hero"]);
    const cleanList = getDrillDownItems(stats2, "clean_games");
    expect(cleanList).toHaveLength(1);
    expect(cleanList[0]).toMatchObject({
      game_id: "drill_game_2",
      classification: "Clean Game",
      is_game: true,
    });
    // Case-insensitive opening lookup
    expect(getDrillDownItems(stats2, "openings", "sicilian defense")[0].game_id).toBe("drill_game_2");
  });

  it("caps drill-down lists but keeps full counters", () => {
    const many: RawGame[] = Array.from({ length: MAX_DRILL_DOWN_ITEMS + 100 }, (_, i) => ({
      id: `clean_game_${i}`,
      white: "Hero",
      black: "Opponent",
      result: "1-0",
      date: "2026.10.18",
      speed_category: "Rapid",
      opening: "Italian Game",
      summary_json: { white: { accuracy: 95, Blunder: 0, acpl: 0, move_count: 0, accuracies: [], win_percents: [] } },
    }));
    const stats = calculateStats(many, ["Hero"]);
    expect(getDrillDownItems(stats, "clean_games")).toHaveLength(MAX_DRILL_DOWN_ITEMS);
    expect(stats.clean_games).toBe(MAX_DRILL_DOWN_ITEMS + 100);
    expect(getDrillDownItems(stats, "openings", "italian game")).toHaveLength(MAX_DRILL_DOWN_ITEMS);
  });
});

describe("classifyTermination", () => {
  it.each([
    [{ termination: "Partie remis durch dreifache Stellungswiederholung" }, true, ["Draw", "3-Fold Repetition"]],
    [{ termination: "Remis durch ungenügendes Material" }, true, ["Draw", "Insufficient Material"]],
    [{ termination: "Remis: Zeit und ungenügendes Material" }, true, ["Draw", "Insufficient vs Timeout"]],
    [{ termination: "Game drawn by 50-move rule" }, true, ["Draw", "50-Move Rule"]],
    [{ termination: "Stalemate" }, false, ["Resignation", null]],
    [{ termination: "Weiß gewinnt durch Schachmatt" }, false, ["Checkmate", null]],
    [{ termination: "Schwarz gewinnt durch Zeitüberschreitung" }, false, ["Time", null]],
    [{ termination: "won by resignation" }, false, ["Resignation", null]],
    [{ termination: "", pgn: "1. f3 e5 2. g4 Qh4#" }, false, ["Checkmate", null]],
    [{ termination_mode: "abandonment" }, false, ["Abandon", null]],
  ] as const)("%o (draw=%s)", (game, isDraw, expected) => {
    expect(classifyTermination(game, isDraw)).toEqual(expected);
  });
});
