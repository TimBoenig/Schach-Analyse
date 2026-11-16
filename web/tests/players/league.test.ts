import { describe, expect, it } from "vitest";

import { isBotGame, withoutBots } from "../../src/domain/metrics";
import type { RawGame } from "../../src/domain/metrics/models";
import {
  archetypes,
  buildRanking,
  climbPlan,
  groupRecords,
  pairForecastOf,
  playerStrength,
  probStronger,
  qualityMap,
  type RankInput,
  type Ranking,
  simulateTournament,
  strengthGap,
  whatIf,
} from "../../src/domain/players";
import { pairShift, PLAN_GAMES } from "../../src/domain/players/league";
import { rankOdds } from "../../src/domain/players/strength";
import { toLichessBlitz } from "../../src/domain/profile/fide";
import { buildPlayerProfile } from "../../src/domain/profile";
import { Board } from "../../src/domain/tactics/board";
import { classifyFenPhase, classifyGamePhase } from "../../src/domain/tactics/phase";
import { buildMoves, type Events } from "../profile/fixtures";

const NOW = Date.parse("2026-06-30T12:00:00Z") / 1000;
const pad = (v: number) => String(v).padStart(2, "0");
let seq = 0;

interface Spec {
  user: string;
  opp?: string;
  /** The user's score: 1, 0.5 or 0. */
  score: number;
  oppElo?: number | null;
  ownElo?: number;
  source?: string;
  speed?: string;
  daysAgo?: number;
  /** Ply events for an analysed game (user is White). */
  events?: Events;
  title?: string;
  termination?: string;
  acc?: number;
}

function game(s: Spec): RawGame {
  const d = new Date((NOW - (s.daysAgo ?? 10) * 86400) * 1000);
  const date = `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(seq % 60)}`;
  const opp = s.opp ?? `opp${seq}`;
  const result = s.score === 1 ? "1-0" : s.score === 0 ? "0-1" : "1/2-1/2";
  seq++;
  const analysed = s.events !== undefined;
  return {
    id: `t${seq}`,
    white: s.user,
    black: opp,
    result,
    date,
    white_elo: String(s.ownElo ?? 1500),
    black_elo: s.oppElo === null ? null : String(s.oppElo ?? 1500),
    speed_category: s.speed ?? "Blitz",
    source: s.source ?? "lichess",
    chess960: 0,
    termination_mode: s.termination ?? "",
    pgn: `[White "${s.user}"]\n[Black "${opp}"]\n${s.title ? `[BlackTitle "${s.title}"]\n` : ""}[UTCDate "${date}"]\n[UTCTime "${time}"]\n\n1. e4 ${result}`,
    moves_json: analysed ? buildMoves(s.events) : [],
    summary_json: analysed ? { white: { accuracy: s.acc ?? 80 }, black: { accuracy: 70 }, analysis_status: "completed" } : {},
  } as unknown as RawGame;
}

/** Deterministic results of a player of true strength `theta` (Lichess blitz) against opponents spread around it. */
function career(user: string, theta: number, n: number, { spread = 300, source = "lichess", speed = "Blitz", seed = 1 } = {}): RawGame[] {
  let x = seed;
  const rand = () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: n }, (_, i) => {
    const oppL = theta + (rand() - 0.5) * 2 * spread;
    // The opponent's rating in the game's own pool (inverse of the conversion by bisection).
    let lo = -1000;
    let hi = 4000;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (toLichessBlitz(mid, source, speed) < oppL) lo = mid;
      else hi = mid;
    }
    const e = 1 / (1 + 10 ** ((oppL - theta) / 400));
    const r = rand();
    const score = r < e - 0.04 ? 1 : r < e + 0.04 ? 0.5 : 0;
    return game({ user, score, oppElo: Math.round((lo + hi) / 2), source, speed, daysAgo: 1 + (i % 80) });
  });
}

const input = (id: string, usernames: string[], games: RawGame[], isMe = false): RankInput => ({ id, name: id, is_me: isMe, usernames, profile: buildPlayerProfile(withoutBots(games), usernames) });

describe("phase from a FEN", () => {
  it("matches the board-based phase rule", () => {
    const fens = [
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      "r1bq1rk1/pp3ppp/2n2n2/3p4/3P4/2N2N2/PP3PPP/R2Q1RK1 w - - 0 12",
      "8/5pk1/6p1/8/3R4/6P1/5PK1/3r4 b - - 0 40",
      "4k3/8/8/8/8/8/3Q4/4K3 w - - 0 50",
      "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 30",
    ];
    for (const [i, fen] of fens.entries()) for (const ply of [4, 30]) expect(classifyFenPhase(fen, ply + i)).toBe(classifyGamePhase(new Board(fen), ply + i));
  });
});

describe("bot games", () => {
  it("recognises computers by title, engine name and event, but not human names that end in 'bot'", () => {
    expect(isBotGame(game({ user: "Tim", score: 1, title: "BOT", opp: "maia9" }), "white")).toBe(true);
    expect(isBotGame(game({ user: "Tim", score: 1, opp: "lichess AI level 6", oppElo: null }), "white")).toBe(true);
    expect(isBotGame(game({ user: "Tim", score: 1, opp: "Stockfish" }), "white")).toBe(true);
    expect(isBotGame({ ...game({ user: "Tim", score: 1, opp: "Nelson" }), event: "Play vs Computer" }, "white")).toBe(true);
    expect(isBotGame(game({ user: "Tim", score: 1, opp: "Abbot" }), "white")).toBe(false);
    expect(isBotGame(game({ user: "Tim", score: 1, opp: "robotnik" }), "white")).toBe(false);
  });

  it("never count toward the strength and are reported", () => {
    const human = career("Tim", 1600, 40);
    const bots = Array.from({ length: 30 }, () => game({ user: "Tim", score: 1, opp: "lichess AI level 8", oppElo: 2700 }));
    const a = playerStrength(human, ["Tim"]);
    const b = playerStrength([...human, ...bots], ["Tim"]);
    expect(b.bot_games).toBe(30);
    expect(b.estimate!.value).toBeCloseTo(a.estimate!.value, 9);
  });
});

describe("strength from the player's own games", () => {
  it("recovers a known strength within its own uncertainty and narrows with more games", () => {
    const few = playerStrength(career("Tim", 1700, 30, { seed: 3 }), ["Tim"]).estimate!;
    const many = playerStrength(career("Tim", 1700, 400, { seed: 3 }), ["Tim"]).estimate!;
    expect(Math.abs(many.value - 1700)).toBeLessThan(2.5 * many.se);
    expect(many.se).toBeLessThan(few.se / 2.5);
    // 400 games of results: about ±20 on the scale, not a made-up exact number.
    expect(many.se).toBeGreaterThan(10);
    expect(many.elo_low).toBeLessThan(many.elo);
    expect(many.elo_high).toBeGreaterThan(many.elo);
  });

  it("gives no strength below ten rated games against humans and ignores unrated ones", () => {
    const games = [...career("Tim", 1500, 9), ...Array.from({ length: 5 }, () => game({ user: "Tim", score: 1, oppElo: null }))];
    const r = playerStrength(games, ["Tim"]);
    expect(r).toMatchObject({ estimate: null, rated_games: 9, unrated_games: 5 });
  });

  it("measures Chess.com Rapid and Lichess Blitz players on one scale, with more doubt between pools than within", () => {
    const li = playerStrength(career("A", 1500, 300, { seed: 5 }), ["A"]).estimate!;
    const cc = playerStrength(career("B", 1500, 300, { seed: 5, source: "chesscom", speed: "Rapid" }), ["B"]).estimate!;
    const li2 = playerStrength(career("C", 1500, 300, { seed: 9 }), ["C"]).estimate!;
    expect(Math.abs(li.value - cc.value)).toBeLessThan(3 * strengthGap(li, cc).sd);
    expect(strengthGap(li, cc).sd).toBeGreaterThan(strengthGap(li, li2).sd);
    expect(cc.columns.cc_rapid).toBeCloseTo(1, 6);
  });

  it("keeps two beginners apart below 1400 instead of clamping them together", () => {
    const weak = playerStrength(career("A", 900, 200, { seed: 2, source: "chesscom", speed: "Rapid" }), ["A"]).estimate!;
    const weaker = playerStrength(career("B", 700, 200, { seed: 2, source: "chesscom", speed: "Rapid" }), ["B"]).estimate!;
    expect(weak.value).toBeGreaterThan(weaker.value + 100);
    expect(probStronger(weak, weaker)).toBeGreaterThan(0.95);
    // Shown as two different Elo numbers far below 1400, not one floor value.
    expect(weak.elo - weaker.elo).toBeGreaterThan(100);
    expect(weak.elo).toBeLessThan(1000);
    expect(weaker.elo).toBeGreaterThan(100);
  });

  it("adds move quality: fewer errors than the opponents lift the estimate, by the measured weight", () => {
    // Same results; in the analysed games Tim (White, even plies) gives away less than his opponents, or more.
    // Win chances are White's: a Black error raises them, a White error lowers them.
    const clean: Events = { 9: ["Mistake", 0.65], 15: ["Mistake", 0.8], 20: ["Inaccuracy", 0.75] };
    const sloppy: Events = { 8: ["Mistake", 0.35], 14: ["Mistake", 0.2], 19: ["Inaccuracy", 0.25] };
    const base = career("Tim", 1600, 40, { seed: 4 });
    const with_ = (ev: Events): RawGame[] =>
      base.map((g, i) => (i < 30 ? ({ ...g, moves_json: buildMoves(ev), summary_json: { white: { accuracy: 80 }, black: { accuracy: 80 }, analysis_status: "completed" } } as unknown as RawGame) : g));
    const good = playerStrength(with_(clean), ["Tim"]).estimate!;
    const bad = playerStrength(with_(sloppy), ["Tim"]).estimate!;
    const plain = playerStrength(base, ["Tim"]).estimate!;
    expect(good.quality!.error_ratio).toBeLessThan(1);
    expect(bad.quality!.error_ratio).toBeGreaterThan(1);
    expect(good.value).toBeGreaterThan(plain.value);
    expect(bad.value).toBeLessThan(plain.value);
    // Combining two measurements makes the estimate surer than results alone.
    expect(good.se).toBeLessThan(plain.se);
    // Move quality misses part of practical strength: it helps, but results carry most of the weight.
    expect(good.quality!.weight).toBeGreaterThan(0);
    expect(good.quality!.weight).toBeLessThan(0.5);
  });
});

describe("ranking", () => {
  const games = [...career("Ana", 1800, 60, { seed: 11 }), ...career("Ben", 1650, 60, { seed: 12 }), ...career("Cem", 1550, 60, { seed: 13 }), ...career("Dan", 1400, 60, { seed: 14 })];
  const all = buildRanking(["Ana", "Ben", "Cem", "Dan"].map((n) => input(n, [n], games, n === "Ben")), games, { now: NOW });

  it("never reorders two players when a third is hidden: each strength rests on that player's games alone", () => {
    const without = buildRanking(["Ana", "Ben", "Dan"].map((n) => input(n, [n], games, n === "Ben")), games, { now: NOW });
    for (const id of ["Ana", "Ben", "Dan"]) {
      expect(without.rows.find((r) => r.id === id)!.strength!.value).toBe(all.rows.find((r) => r.id === id)!.strength!.value);
    }
    const order = (r: Ranking) => r.rows.map((x) => x.id).filter((id) => id !== "Cem");
    expect(order(without)).toEqual(order(all));
    expect(all.rows.map((r) => r.id)).toEqual(["Ana", "Ben", "Cem", "Dan"]);
  });

  it("says how sure each place is", () => {
    const close = [...career("X", 1600, 15, { seed: 21 }), ...career("Y", 1610, 15, { seed: 22 })];
    const r = buildRanking([input("X", ["X"], close), input("Y", ["Y"], close)], close);
    // Fifteen games each and ten points apart: either could be first.
    for (const row of r.rows) expect([row.odds!.low, row.odds!.high]).toEqual([1, 2]);
    const clear = rankOdds([all.rows[0].strength!, all.rows[3].strength!], 1);
    expect(clear[0]).toMatchObject({ low: 1, high: 1 });
    expect(clear[0].first).toBeGreaterThan(0.99);
  });

  it("counts a direct game once, like any game, and lets it move a duel forecast only gradually", () => {
    // Ana vs Ben games are part of both careers' samples.
    const duel = Array.from({ length: 12 }, (_, i) => game({ user: "Ana", opp: "Ben", score: i < 9 ? 1 : 0, oppElo: 1650, ownElo: 1800 }));
    const both = [...games, ...duel];
    const ana = playerStrength(both, ["Ana"]).estimate!;
    const ben = playerStrength(both, ["Ben"]).estimate!;
    expect(ana.results.games).toBe(72);
    expect(ben.results.games).toBe(72);
    // 3:0 between friends barely moves the forecast; 30:5 against the odds clearly does.
    const gap = 0;
    const small = pairShift(gap, { games: 3, wins: 3, draws: 0 }).shift;
    const big = pairShift(gap, { games: 35, wins: 30, draws: 0 }).shift;
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(25);
    expect(big).toBeGreaterThan(60);
    expect(pairShift(gap, null).shift).toBe(0);
    const f = pairForecastOf(ana, ben, null)!;
    expect(f.p).toBeGreaterThan(0.5);
    expect(f.low).toBeLessThan(f.p);
    expect(f.high).toBeGreaterThan(f.p);
  });

  it("simulates the tournament from the strengths, the same way every time", () => {
    const t1 = simulateTournament(all, () => null, { runs: 1500 })!;
    const t2 = simulateTournament(all, () => null, { runs: 1500 })!;
    expect(t1.rows).toEqual(t2.rows);
    expect(t1.rows[0].id).toBe("Ana");
    expect(t1.rows.reduce((s, r) => s + r.win, 0)).toBeCloseTo(1, 6);
  });

  it("plans the climb in games and errors from the same model, and the simulator agrees", () => {
    const plan = climbPlan(all, "Ben")!;
    expect(plan.target!.id).toBe("Ana");
    expect(plan.gap).toBeGreaterThan(0);
    expect(plan.gap_elo).toBeGreaterThanOrEqual(0);
    if (plan.points !== null) {
      expect(plan.points).toBeGreaterThan(plan.points_expected);
      expect(whatIf(all, "Ben", plan.points, 0)!.rank).toBe(1);
      expect(whatIf(all, "Ben", plan.points - 0.5, 0)!.rank).toBe(2);
    }
    // At the expected score nothing changes.
    const same = whatIf(all, "Ben", plan.points_expected, 0)!;
    expect(Math.abs(same.value - all.rows[1].strength!.value)).toBeLessThan(5);
    expect(PLAN_GAMES).toBe(20);
    expect(plan.chaser!.id).toBe("Cem");
  });

  it("names no type without enough analysed games and no practice gap within the noise", () => {
    const types = archetypes(all);
    for (const r of all.rows) expect(types[r.id].title).toBe("Noch offen");
    expect(qualityMap(all)).toBeNull();
  });
});

describe("records", () => {
  const member = (id: string, is_me = false) => ({ id, name: is_me ? "Du" : id, is_me, usernames: [is_me ? "Tim" : id] });

  it("only count above a bar, show the runner-up and keep bot games out", () => {
    const tim = Array.from({ length: 7 }, (_, i) => game({ user: "Tim", score: 1, daysAgo: 40 - i }));
    const ida = Array.from({ length: 6 }, (_, i) => game({ user: "Ida", score: 1, daysAgo: 30 - i }));
    const max = Array.from({ length: 5 }, (_, i) => game({ user: "Max", score: 1, daysAgo: 20 - i }));
    // Twenty wins against a bot are no streak.
    const bot = Array.from({ length: 20 }, (_, i) => game({ user: "Max", score: 1, opp: "lichess AI level 3", oppElo: null, daysAgo: 10 - i / 10 }));
    // An upset: 1500 beats 1800 (same pool), and a small one that misses the bar.
    const upset = [game({ user: "Ida", score: 1, ownElo: 1500, oppElo: 1800, daysAgo: 3 }), game({ user: "Max", score: 1, ownElo: 1500, oppElo: 1650, daysAgo: 2 })];
    const rec = groupRecords([member("ich", true), member("Ida"), member("Max")], [...tim, ...ida, ...max, ...bot, ...upset]);
    const of = (k: string) => rec.find((r) => r.key === k)!;
    expect(of("streak")).toMatchObject({ holder: { id: "ich" }, value: 7, text: "7 Siege in Folge", runner_up: { id: "Ida" } });
    expect(of("upset")).toMatchObject({ holder: { id: "Ida" }, value: 300, runner_up: null });
    // Nobody reached a comeback or a quick mate: listed as open with the bar.
    expect(of("comeback")).toMatchObject({ holder: null, text: "noch offen" });
    expect(of("mate").bar).toContain("25");
  });

  it("finds the longest run of wins against one friend", () => {
    const g = [...Array.from({ length: 4 }, (_, i) => game({ user: "Tim", opp: "Ida", score: 1, daysAgo: 9 - i })), game({ user: "Tim", opp: "Ida", score: 0, daysAgo: 4 })];
    const rec = groupRecords([member("ich", true), member("Ida")], g);
    expect(rec.find((r) => r.key === "duel")).toMatchObject({ holder: { id: "ich" }, value: 4, detail: expect.stringContaining("gegen Ida") });
  });
});
