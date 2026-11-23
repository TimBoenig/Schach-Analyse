import { describe, expect, it } from "vitest";

import type { RawGame } from "../../src/domain/metrics";
import { Board, moveToUci } from "../../src/domain/tactics/board";
import { compareTrophies, evaluateTrophies, nextTrophies, STAT_KEYS, TIERS, TROPHIES } from "../../src/domain/trophies";
import { emptyMove, type Classification, type MoveData } from "../../src/domain/types";

const ME = ["Tim"];
const pad = (n: number) => String(n).padStart(2, "0");

/** UTC header values for a local wall-clock time, so the tests hold in any time zone. */
function stamp(y: number, m: number, d: number, h = 12, mi = 0): string {
  const dt = new Date(y, m - 1, d, h, mi);
  return `${dt.getUTCFullYear()}.${pad(dt.getUTCMonth() + 1)}.${pad(dt.getUTCDate())} ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:00`;
}

interface Opts {
  sans?: string[];
  fen?: string;
  user?: "white" | "black";
  result?: string;
  mode?: string;
  when?: [number, number, number, number?];
  opp?: string;
  oppElo?: number;
  myElo?: number;
  speed?: string;
  source?: string;
  opening?: string;
  title?: string;
  /** Analysed: every move is "Best" except the given ones (ply index → [class, White win chance after]). */
  events?: Record<number, [Classification, number]> | null;
  accuracy?: number;
  brilliants?: number;
}

const SHUFFLE = Array.from({ length: 12 }, () => ["Nf3", "Nf6", "Ng1", "Ng8"]).flat();

let counter = 0;
function game(o: Opts = {}): RawGame {
  const { sans = SHUFFLE, user = "white", speed = "Rapid", source = "chesscom" } = o;
  const result = o.result ?? (user === "white" ? "1-0" : "0-1");
  const board = new Board(o.fen);
  const analyzed = o.events !== undefined && o.events !== null;
  let wp = 0.5;
  const moves: MoveData[] = sans.map((san, i) => {
    const mv = board.parseSan(san);
    const [cls, after] = analyzed ? (o.events![i] ?? (["Best", wp] as [Classification, number])) : (["", wp] as [Classification, number]);
    const md = emptyMove({
      ply: i + 1,
      move_number: Math.floor(i / 2) + 1,
      san: board.san(mv),
      uci: moveToUci(mv),
      fen_before: board.fen(),
      classification: cls,
      win_chance_before: wp,
      win_chance_after: after,
      time_spent: 2,
      time_left: 100 - i,
    });
    board.push(mv);
    wp = after;
    return md;
  });
  const counts: Record<string, number> = { accuracy: o.accuracy ?? 80, Brilliant: o.brilliants ?? 0 };
  if (analyzed) {
    moves.forEach((m, i) => {
      if ((i % 2 === 0) === (user === "white")) counts[m.classification] = (counts[m.classification] ?? 0) + 1;
    });
  }
  const [y, mo, d, h] = o.when ?? [2026, 6, 1, 12];
  const utc = stamp(y, mo, d, h ?? 12);
  const [white, black] = user === "white" ? ["Tim", o.opp ?? "Gegner"] : [o.opp ?? "Gegner", "Tim"];
  const [myElo, oppElo] = [String(o.myElo ?? 1500), String(o.oppElo ?? 1500)];
  const id = `g${++counter}`;
  return {
    id,
    white,
    black,
    result,
    date: utc.slice(0, 10),
    white_elo: user === "white" ? myElo : oppElo,
    black_elo: user === "white" ? oppElo : myElo,
    speed_category: speed,
    opening: o.opening ?? "Italian Game",
    source,
    chess960: 0,
    termination_mode: o.mode ?? (moves.length && moves[moves.length - 1].san.endsWith("#") ? "checkmate" : "resignation"),
    pgn: `[White "${white}"]\n[Black "${black}"]\n[Result "${result}"]\n[UTCDate "${utc.slice(0, 10)}"]\n[UTCTime "${utc.slice(11)}"]\n${o.title ? `[${user === "white" ? "Black" : "White"}Title "${o.title}"]\n` : ""}\n*`,
    moves_json: moves,
    summary_json: analyzed ? { white: { ...counts }, black: { ...counts }, analysis_status: "completed" } : { analysis_status: "not_started" },
  } as RawGame;
}

const unlocked = (games: RawGame[], opts?: { rivals?: string[] }) =>
  new Set(evaluateTrophies(games, ME, opts).states.filter((s) => s.unlocked).map((s) => s.def.id));
const stateOf = (games: RawGame[], id: string, opts?: { rivals?: string[] }) => evaluateTrophies(games, ME, opts).states.find((s) => s.def.id === id)!;

describe("catalog", () => {
  it("has 60+ unique trophies on all five tiers, each tied to a computed stat", () => {
    expect(TROPHIES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(TROPHIES.map((t) => t.id)).size).toBe(TROPHIES.length);
    for (const tier of TIERS) expect(TROPHIES.filter((t) => t.tier === tier).length, tier).toBeGreaterThanOrEqual(5);
    expect(TROPHIES.some((t) => t.quirky)).toBe(true);
    expect(TROPHIES.some((t) => t.secret)).toBe(true);
    for (const t of TROPHIES) {
      expect(STAT_KEYS, t.id).toContain(t.stat);
      expect(t.goal, t.id).toBeGreaterThan(0);
      expect(t.name.length * t.about.length, t.id).toBeGreaterThan(0);
    }
  });

  it("ladders get harder: for one stat, a higher tier never asks for less", () => {
    const rank = new Map(TIERS.map((t, i) => [t, i]));
    const byStat = new Map<string, typeof TROPHIES>();
    for (const t of TROPHIES) if (!t.below) byStat.set(t.stat, [...(byStat.get(t.stat) ?? []), t]);
    for (const [stat, list] of byStat) {
      for (const a of list) for (const b of list) {
        if (rank.get(a.tier)! < rank.get(b.tier)!) expect(a.goal, `${stat}: ${a.id} vs ${b.id}`).toBeLessThanOrEqual(b.goal);
      }
    }
  });
});

describe("counting games", () => {
  it("counts only the player's own finished games and ignores computers for human trophies", () => {
    const games = [
      game({ result: "1-0" }),
      game({ result: "1/2-1/2" }),
      game({ result: "*" }),
      game({ result: "1-0", opp: "lichess AI level 3" }),
      { ...game(), white: "Anna", black: "Ben" } as RawGame,
    ];
    const r = evaluateTrophies(games, ME);
    expect(r.games).toBe(2);
    const u = unlocked(games);
    expect(u.has("first-win")).toBe(true);
    expect(u.has("first-draw")).toBe(true);
    expect(u.has("machine-smasher")).toBe(true);
    expect(stateOf(games, "ten-wins").value).toBe(1);
  });

  it("reads win streaks in time order, and a draw ends a streak", () => {
    const win = (day: number) => game({ when: [2026, 6, day, 12] });
    const draw = (day: number) => game({ when: [2026, 6, day, 12], result: "1/2-1/2" });
    // stored out of order: by time it is 1, 2, 5, 6, 7 (five wins), a draw, then 9, 10
    const games = [win(5), win(6), win(7), draw(8), win(9), win(10), win(1), win(2)];
    expect(stateOf(games, "winning-streak").value).toBe(5);
    expect(stateOf(games, "winning-streak").unlocked).toBe(true);
    expect(stateOf(games, "unstoppable").unlocked).toBe(false);
    expect(stateOf([win(1), win(2), draw(3), win(4), win(5)], "hat-trick").unlocked).toBe(false);
  });
});

describe("days and times", () => {
  it("counts consecutive days across a month change and the busiest day", () => {
    const games = [
      ...[29, 30, 31].map((d) => game({ when: [2026, 5, d] })),
      game({ when: [2026, 6, 1] }),
      game({ when: [2026, 6, 1] }),
      game({ when: [2026, 6, 3] }),
    ];
    expect(stateOf(games, "sticking-with-it").value).toBe(4);
    expect(stateOf(games, "sticking-with-it").unlocked).toBe(true);
    expect(stateOf(games, "regular").value).toBe(5);
    expect(stateOf(games, "board-fever").value).toBe(2);
  });

  it("rewards night, dawn, Friday the 13th and holiday games by local time", () => {
    const games = [
      game({ when: [2026, 6, 2, 2] }),
      game({ when: [2026, 6, 3, 6] }),
      game({ when: [2026, 11, 13, 12] }), // a Friday
      game({ when: [2026, 12, 24, 18] }),
    ];
    const u = unlocked(games);
    for (const id of ["night-owl", "early-bird", "friday-13", "holiday-moves"]) expect(u.has(id), id).toBe(true);
    // a game on a normal Friday, in the afternoon, earns none of them
    const plain = unlocked([game({ when: [2026, 11, 20, 15] })]);
    for (const id of ["night-owl", "early-bird", "friday-13", "holiday-moves"]) expect(plain.has(id), id).toBe(false);
  });
});

describe("special moves", () => {
  const win = (o: Opts) => game({ ...o, mode: undefined });

  it("recognises mates by piece and the famous short ones", () => {
    const scholar = win({ sans: ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7"] });
    const fool = win({ user: "black", sans: ["f3", "e5", "g4", "Qh4"] });
    const u = unlocked([scholar, fool]);
    expect(u.has("first-mate")).toBe(true);
    expect(u.has("short-work")).toBe(true);
    expect(stateOf([scholar], "scholars-mate").unlocked).toBe(true);
    expect(stateOf([scholar], "fools-mate").unlocked).toBe(false);
    expect(stateOf([fool], "fools-mate").unlocked).toBe(true);
    expect(stateOf([fool], "scholars-mate").unlocked).toBe(false);
  });

  it("tells a smothered mate from an ordinary knight mate", () => {
    const smothered = win({ fen: "6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1", sans: ["Nf7"] });
    expect(stateOf([smothered], "smothered-mate").unlocked).toBe(true);
    expect(stateOf([smothered], "knight-mate").unlocked).toBe(true);
    // same knight mate, but the black king has an empty square next to it
    const plain = win({ fen: "7k/6p1/8/6N1/8/8/8/6K1 w - - 0 1", sans: ["Nf7", "Kg8", "Ne5"], result: "1/2-1/2" });
    expect(stateOf([plain], "smothered-mate").unlocked).toBe(false);
  });

  it("finds a mate by castling, en passant, promotion and under-promotion", () => {
    const castle = win({ fen: "2rkr3/2p1p3/8/8/8/8/8/R3K3 w Q - 0 1", sans: ["O-O-O"] });
    expect(stateOf([castle], "castling-mate").unlocked).toBe(true);
    expect(stateOf([castle], "long-way").unlocked).toBe(true);
    const ep = win({ fen: "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", sans: ["exd6"], result: "1/2-1/2" });
    expect(stateOf([ep], "in-passing").unlocked).toBe(true);
    // a plain pawn capture is no en passant
    const normal = win({ fen: "4k3/8/3p4/4P3/8/8/8/4K3 w - - 0 1", sans: ["exd6"], result: "1/2-1/2" });
    expect(stateOf([normal], "in-passing").unlocked).toBe(false);
    const promo = win({ fen: "7k/P7/8/8/8/8/8/K7 w - - 0 1", sans: ["a8=N"], result: "1/2-1/2" });
    expect(stateOf([promo], "pawn-to-queen").unlocked).toBe(true);
    expect(stateOf([promo], "underpromotion").unlocked).toBe(true);
    const queen = win({ fen: "7k/P7/8/8/8/8/8/K7 w - - 0 1", sans: ["a8=Q"], result: "1/2-1/2" });
    expect(stateOf([queen], "underpromotion").unlocked).toBe(false);
    const promoMate = win({ fen: "k7/7P/1K6/8/8/8/8/8 w - - 0 1", sans: ["h8=Q"] });
    expect(stateOf([promoMate], "promotion-mate").unlocked).toBe(true);
  });

  it("detects the odd openings by the first moves of the player's own colour", () => {
    expect(stateOf([game({ sans: ["g4", "d5"] })], "grob-moment").unlocked).toBe(true);
    expect(stateOf([game({ sans: ["b4", "e5"] })], "orangutan").unlocked).toBe(true);
    expect(stateOf([game({ sans: ["e4", "e5", "Ke2", "Nf6"] })], "bongcloud").unlocked).toBe(true);
    expect(stateOf([game({ sans: ["e4", "e5", "Nf3", "Nf6"] })], "bongcloud").unlocked).toBe(false);
    // the same moves played by the opponent are not the player's choice
    expect(stateOf([game({ user: "black", sans: ["g4", "d5"] })], "grob-moment").unlocked).toBe(false);
  });
});

describe("quality of play", () => {
  it("needs an analysis, and enough moves, before accuracy counts", () => {
    const analysed = game({ events: {}, accuracy: 96 });
    expect(stateOf([analysed], "almost-machine").unlocked).toBe(true);
    expect(stateOf([analysed], "clean-work").unlocked).toBe(true);
    expect(stateOf([analysed], "flawless").unlocked).toBe(true);
    expect(stateOf([analysed], "nearly-perfect").unlocked).toBe(false);
    // the same accuracy in a short game, or without an analysis, earns nothing
    const short = game({ sans: SHUFFLE.slice(0, 20), events: {}, accuracy: 99 });
    expect(unlocked([short]).has("perfection")).toBe(false);
    expect(unlocked([game({ accuracy: 99 })]).has("almost-machine")).toBe(false);
    expect(stateOf([game()], "first-analysis").unlocked).toBe(false);
  });

  it("a blunder spoils the clean game and ends the blunder-free streak", () => {
    const spoiled = game({ events: { 4: ["Blunder", 0.4] }, accuracy: 90, when: [2026, 6, 6] });
    expect(stateOf([spoiled], "flawless").unlocked).toBe(false);
    expect(stateOf([spoiled], "clean-work").unlocked).toBe(true);
    const clean = (day: number) => game({ events: {}, when: [2026, 6, day] });
    const games = [...[1, 2, 3, 4, 5].map(clean), spoiled, ...[7, 8, 9].map(clean)];
    expect(stateOf(games, "steady-stand").value).toBe(5);
  });

  it("counts comebacks by the lowest win chance of a won game, in the player's view", () => {
    // White (the player) falls to 5 % and still wins
    const comeback = game({ events: { 10: ["Blunder", 0.05], 30: ["Best", 0.9] } });
    expect(stateOf([comeback], "risen-again").unlocked).toBe(true);
    expect(stateOf([comeback], "like-a-miracle").unlocked).toBe(false);
    // as Black the same White-perspective numbers mean the opposite
    const blackWins = game({ user: "black", events: { 10: ["Best", 0.95] } });
    expect(stateOf([blackWins], "risen-again").unlocked).toBe(true);
    expect(stateOf([blackWins], "like-a-miracle").unlocked).toBe(false);
    expect(stateOf([blackWins], "resurrection").unlocked).toBe(false);
    // losing from a won position is its own trophy
    const thrown = game({ result: "0-1", events: { 10: ["Best", 0.97], 30: ["Blunder", 0.1] } });
    expect(stateOf([thrown], "snatching-defeat").unlocked).toBe(true);
    expect(stateOf([comeback], "snatching-defeat").unlocked).toBe(false);
  });

  it("counts brilliant moves in total and per game, and wins despite blunders", () => {
    const events: Record<number, [Classification, number]> = {};
    [2, 4, 6, 8, 10].forEach((i) => (events[i] = ["Blunder", 0.5]));
    const chaos = game({ events, brilliants: 3 });
    expect(stateOf([chaos], "triple-brilliance").unlocked).toBe(true);
    expect(stateOf([chaos], "chaos-champion").unlocked).toBe(true);
    expect(stateOf([chaos], "fireworks").unlocked).toBe(true);
    expect(stateOf([chaos, game({ events: {}, brilliants: 1 })], "shower-of-sparks").value).toBe(4);
  });
});

describe("opponents and ratings", () => {
  it("measures the rating gap and the highest opponent beaten from wins only", () => {
    const games = [
      game({ myElo: 1200, oppElo: 1450 }),
      game({ myElo: 1200, oppElo: 2300, result: "0-1" }), // a loss against a giant is no trophy
    ];
    expect(stateOf(games, "davids-sling").unlocked).toBe(true);
    expect(stateOf(games, "fall-of-the-titan").unlocked).toBe(false);
    expect(stateOf(games, "beat-1800").unlocked).toBe(false);
  });

  it("takes a peak rating only from a rating pool with enough games", () => {
    const few = Array.from({ length: 4 }, () => game({ myElo: 1900 }));
    expect(stateOf(few, "tournament-strong").unlocked).toBe(false);
    const enough = [...few, game({ myElo: 1850 })];
    expect(stateOf(enough, "tournament-strong").unlocked).toBe(true);
    // ratings of two pools are never mixed into one
    const split = [...few, game({ myElo: 1850, speed: "Blitz" })];
    expect(stateOf(split, "tournament-strong").unlocked).toBe(false);
  });

  it("finds a grandmaster from the PGN title, not from the name", () => {
    expect(stateOf([game({ title: "GM", source: "lichess" })], "kingslayer").unlocked).toBe(true);
    expect(stateOf([game({ title: "GM", result: "0-1" })], "kingslayer").unlocked).toBe(false);
    expect(stateOf([game({ opp: "GM_Fan" })], "kingslayer").unlocked).toBe(false);
  });

  it("counts duels only against the given friends, never against the player's own accounts", () => {
    const games = [
      game({ opp: "Lena", when: [2026, 6, 1] }),
      game({ opp: "lena", when: [2026, 6, 2] }),
      game({ opp: "Max", when: [2026, 6, 3] }),
      game({ opp: "Tim2", when: [2026, 6, 4] }),
      game({ opp: "Stranger", when: [2026, 6, 5] }),
    ];
    expect(unlocked(games).has("duel-won")).toBe(false);
    const r = { rivals: ["Lena", "Max", "Tim"] };
    expect(stateOf(games, "duel-won", r).unlocked).toBe(true);
    expect(stateOf(games, "friend-group-terror", r).value).toBe(2);
    expect(stateOf(games, "nemesis", r).value).toBe(2);
    expect(stateOf(games, "table-champion", r).value).toBe(3);
  });

  it("platforms and time controls", () => {
    const games = [game({ source: "lichess", speed: "Blitz" }), game({ source: "chesscom", speed: "Bullet" }), game({ speed: "Rapid", source: "chesscom" })];
    const u = unlocked(games);
    expect(u.has("globetrotter")).toBe(true);
    expect(u.has("all-rounder")).toBe(true);
    expect(u.has("bullet-time")).toBe(true);
  });
});

describe("how games end", () => {
  it("separates timeouts won and lost, stalemate and repetition", () => {
    const games = [
      game({ mode: "timeout" }),
      game({ mode: "timeout", result: "0-1" }),
      game({ mode: "stalemate", result: "1/2-1/2" }),
      game({ mode: "repetition", result: "1/2-1/2" }),
    ];
    const u = unlocked(games);
    for (const id of ["flag-thief", "tick-tock", "stalemate", "deja-vu"]) expect(u.has(id), id).toBe(true);
    // a win on time in a handful of moves is nobody's short work
    expect(stateOf([game({ mode: "timeout", sans: ["e4", "e5"] })], "short-work").unlocked).toBe(false);
  });

  it("wins on the last seconds count only when the clock was running", () => {
    const g = game();
    const moves = g.moves_json as MoveData[];
    moves[moves.length - 2].time_left = 2;
    expect(stateOf([g], "last-second").unlocked).toBe(true);
    expect(stateOf([game()], "last-second").unlocked).toBe(false);
  });
});

describe("progress and comparison", () => {
  it("reports progress toward a count goal and names the nearest trophies", () => {
    // seven wins, each followed by a draw so no streak trophy is closer
    const games = Array.from({ length: 14 }, (_, i) => game({ when: [2026, 6, i + 1], result: i % 2 ? "1/2-1/2" : "1-0" }));
    const s = stateOf(games, "ten-wins");
    expect(s.unlocked).toBe(false);
    expect(s.progress).toBeCloseTo(0.7);
    const report = evaluateTrophies(games, ME);
    expect(nextTrophies(report)[0].def.id).toBe("ten-wins");
    expect(report.points).toBe(report.states.filter((x) => x.unlocked).reduce((n, x) => n + { common: 5, uncommon: 10, rare: 25, epic: 50, legendary: 100 }[x.def.tier], 0));
  });

  it("links a game that shows a one-game trophy", () => {
    const g = game({ mode: "timeout" });
    expect(stateOf([g], "flag-thief").game).toBe(g.id);
    expect(stateOf([g], "ten-wins").game).toBeUndefined();
  });

  it("sorts every trophy to exactly one of both / only me / only them / neither", () => {
    const mine = evaluateTrophies([game(), game({ mode: "timeout" })], ME);
    const theirs = evaluateTrophies([game(), game({ result: "1/2-1/2" })], ME);
    const c = compareTrophies(mine, theirs);
    expect(c.both).toContain("first-win");
    expect(c.onlyA).toContain("flag-thief");
    expect(c.onlyB).toContain("first-draw");
    expect(c.neither).toContain("board-legend");
    expect(c.both.length + c.onlyA.length + c.onlyB.length + c.neither.length).toBe(TROPHIES.length);
  });

  it("an empty collection is empty, not broken", () => {
    const r = evaluateTrophies([], ME);
    expect(r.unlocked).toBe(0);
    expect(r.games).toBe(0);
    expect(nextTrophies(r)).toEqual([]);
  });
});
