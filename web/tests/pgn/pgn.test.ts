import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { md5 } from "../../src/domain/md5";
import {
  CHESS960_UNSUPPORTED,
  VARIANT_UNSUPPORTED,
  detectSpeedCategory,
  parseClk,
  parsePgnText,
  parsePgnTextDetailed,
} from "../../src/domain/pgn";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string) => readFileSync(here(p), "utf-8");

// Generated with the desktop app's PGNParser (python-chess) from the same
// inputs; guards that game ids stay identical across desktop and web.
const parity = JSON.parse(read("./fixtures/python_parity.json")) as Record<
  string,
  { game_id: string; pgn_content: string; metadata: Record<string, unknown>; moves: Record<string, unknown>[] }[]
>;

const SAMPLE_PGN_CHESSCOM = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2023.10.01"]
[Round "-"]
[White "Player1"]
[Black "Player2"]
[Result "1-0"]
[WhiteElo "1500"]
[BlackElo "1400"]
[TimeControl "600"]
[ECO "C65"]
[Termination "Normal"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. O-O Be7 5. Re1 b5 6. Bb3 d6 7. c3 O-O 1-0`;

const SAMPLE_PGN_LICHESS = `[Event "Rated Blitz game"]
[Site "https://lichess.org/abcd1234"]
[Date "2023.10.01"]
[White "LichessPlayer1"]
[Black "LichessPlayer2"]
[Result "0-1"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 0-1`;

const SAMPLE_PGN_FILE = `[Event "Local Game"]
[Site "?"]
[Date "2023.10.01"]
[White "LocalPlayer1"]
[Black "LocalPlayer2"]
[Result "1/2-1/2"]

1. e4 e5 2. Nf3 Nf6 1/2-1/2`;

describe("md5", () => {
  // Expected values from python: hashlib.md5(text.encode("utf-8")).hexdigest()
  it.each([
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["The quick brown fox jumps over the lazy dog", "9e107d9d372bb6826bd81d3542a419d6"],
    ["Weiß gewinnt – äöü", "3b56f178964535d827929d098a74f53a"],
  ])("hashes UTF-8 like hashlib (%j)", (input, expected) => {
    expect(md5(input)).toBe(expected);
  });

  it("handles inputs spanning several 64-byte blocks", () => {
    expect(md5("a".repeat(1000))).toBe("cabe45dcc9ae5b66ba86600cca6b8ba8");
  });
});

describe("python-chess parity", () => {
  for (const [file, expectedGames] of Object.entries(parity)) {
    it(`reproduces ids, export and moves for ${file}`, () => {
      const games = parsePgnText(read(file === "test.pgn" ? "../../../test.pgn" : `./fixtures/${file}`));
      expect(games).toHaveLength(expectedGames.length);
      games.forEach((g, i) => {
        const exp = expectedGames[i];
        expect(g.pgn_content).toBe(exp.pgn_content);
        expect(g.game_id).toBe(exp.game_id);
        expect(g.metadata).toEqual(exp.metadata);
        // best_eval_* are always null at parse time and optional in the web model.
        const expMoves = exp.moves.map(({ best_eval_cp, best_eval_mate, ...rest }) => {
          expect([best_eval_cp, best_eval_mate]).toEqual([null, null]);
          return rest;
        });
        expect(g.moves).toEqual(expMoves);
      });
    });
  }
});

describe("parsePgnText", () => {
  it("parses metadata, source and speed of the sample games", () => {
    const games = parsePgnText([SAMPLE_PGN_CHESSCOM, SAMPLE_PGN_LICHESS, SAMPLE_PGN_FILE].join("\n\n"));
    expect(games.map((g) => [g.metadata.white, g.metadata.source])).toEqual([
      ["Player1", "chesscom"],
      ["LichessPlayer1", "lichess"],
      ["LocalPlayer1", "file"],
    ]);
    const meta = games[0].metadata;
    expect([meta.white_elo, meta.black_elo, meta.time_control, meta.eco, meta.termination, meta.speed_category]).toEqual([
      "1500",
      "1400",
      "600",
      "C65",
      "Normal",
      "Rapid",
    ]);
    expect(games[0].moves[6]).toMatchObject({ san: "O-O", uci: "e1g1", move_number: 4, ply: 6 });
  });

  it.each(["", "This is not a PGN"])("returns no games for %j", (text) => {
    expect(parsePgnText(text)).toEqual([]);
  });

  it("derives time_spent from consecutive clocks and the TimeControl base", () => {
    const pgn =
      '[Event "Test"]\n[White "W"]\n[Black "B"]\n[TimeControl "600"]\n[Result "*"]\n\n' +
      "1. e4 { [%clk 0:09:56] } 1... e5 { [%clk 0:10:00] } 2. Nf3 { [%clk 0:09:30] } *";
    const moves = parsePgnText(pgn)[0].moves;
    expect(moves.map((m) => [m.time_left, m.time_spent])).toEqual([
      [596, 4],
      [600, 0],
      [570, 26],
    ]);
  });

  it("ignores malformed clocks instead of producing garbage deltas", () => {
    const pgn = '[White "W"]\n[Black "B"]\n[Result "*"]\n\n1. e4 { [%clk 0:99:00] } 1... e5 { [%clk 0:10:00] } *';
    const moves = parsePgnText(pgn)[0].moves;
    expect(moves.map((m) => [m.time_left, m.time_spent])).toEqual([
      [null, null],
      [600, null],
    ]);
  });

  it("supports chess.com daily time controls", () => {
    const pgn =
      '[Event "Daily Game"]\n[White "W"]\n[Black "B"]\n[TimeControl "1/259200"]\n[Result "*"]\n\n' +
      "1. e4 { [%clk 71:59:00] } 1... e5 *";
    const game = parsePgnText(pgn)[0];
    expect(game.metadata.speed_category).toBe("Daily");
    expect(game.moves[0].time_spent).toBe(60);
  });

  it("rejects Chess960 and other variants with a German message", () => {
    const chess960 =
      '[Event "960"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n[Variant "Chess960"]\n' +
      '[FEN "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w HFhf - 0 1"]\n\n1. e4 e5 *';
    const crazyhouse = '[White "C"]\n[Black "D"]\n[Variant "Crazyhouse"]\n[Result "*"]\n\n1. e4 e5 *';
    const x960 = '[White "E"]\n[Black "F"]\n[Result "*"]\n[FEN "rkrbbqnn/pppppppp/8/8/8/8/PPPPPPPP/RKRBBQNN w KQkq - 0 1"]\n\n1. e4 *';

    expect(() => parsePgnText(chess960)).toThrow(CHESS960_UNSUPPORTED);
    const detailed = parsePgnTextDetailed([chess960, crazyhouse, x960, SAMPLE_PGN_FILE].join("\n\n"));
    expect(detailed.games.map((g) => g.metadata.white)).toEqual(["LocalPlayer1"]);
    expect(detailed.skipped).toEqual([
      { index: 0, white: "A", black: "B", reason: CHESS960_UNSUPPORTED },
      { index: 1, white: "C", black: "D", reason: VARIANT_UNSUPPORTED },
      { index: 2, white: "E", black: "F", reason: CHESS960_UNSUPPORTED },
    ]);
  });
});

describe("parseClk", () => {
  it.each([null, "", "Some unrelated comment", "[%clk 0:99:00]", "[%clk 0:00:99]", "[%clk 0:99:00.5]"])(
    "returns no clock for %j",
    (comment) => {
      expect(parseClk(comment)).toEqual([null, null]);
    },
  );

  it("parses the first clock of a comment", () => {
    expect(parseClk("[%clk 0:09:56.1]")).toEqual(["0:09:56.1", 9 * 60 + 56.1]);
    expect(parseClk("[%clk 1:23:45]")).toEqual(["1:23:45", 3600 + 23 * 60 + 45]);
    expect(parseClk("blabla [%clk 0:00:10] extra [%clk 0:00:05]")).toEqual(["0:00:10", 10]);
  });
});

describe("detectSpeedCategory", () => {
  it.each([
    ["15", null, "UltraBullet"],
    ["60+0", null, "Bullet"],
    ["180+2", null, "Blitz"],
    ["600", null, "Rapid"],
    ["1800", null, "Classical"],
    ["40/7200", null, "Classical"],
    ["1/86400", null, "Daily"],
    ["-", "Rated Bullet game", "Bullet"],
    [null, "Casual correspondence game", "Daily"],
    [null, null, "Blitz"],
  ])("%j / %j -> %s", (tc, event, expected) => {
    expect(detectSpeedCategory(tc, event)).toBe(expected);
  });
});
