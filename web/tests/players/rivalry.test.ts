import { describe, expect, it } from "vitest";

import { buildCrosstable, crossHighlights, duelInsights, groupMomentum, groupRecords, openingPreview } from "../../src/domain/players";
import type { RawGame } from "../../src/domain/metrics";
import type { PlayerProfile } from "../../src/domain/profile";
import type { MoveData } from "../../src/domain/types";
import { buildMoves, PUNISHED, THROWN_WIN } from "../profile/fixtures";

const DAY = 86400;
const NOW = Date.parse("2026-06-30T12:00:00Z") / 1000;
const pad = (n: number) => String(n).padStart(2, "0");

interface Spec {
  white: string;
  black: string;
  result: "1-0" | "0-1" | "1/2-1/2";
  days: number;
  speed?: string;
  acc?: [number, number];
  blunders?: [number, number];
  elo?: [number, number];
  moves?: MoveData[];
  termination?: string;
}

let seq = 0;
function game(s: Spec): RawGame {
  const at = new Date((NOW - s.days * DAY) * 1000);
  const date = `${at.getUTCFullYear()}.${pad(at.getUTCMonth() + 1)}.${pad(at.getUTCDate())}`;
  const time = `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:00`;
  const side = (i: 0 | 1) => ({ accuracy: s.acc?.[i], Blunder: s.blunders?.[i] ?? 0 });
  return {
    id: `g${++seq}`,
    white: s.white,
    black: s.black,
    result: s.result,
    date,
    white_elo: String(s.elo?.[0] ?? 1500),
    black_elo: String(s.elo?.[1] ?? 1500),
    speed_category: s.speed ?? "Blitz",
    source: "lichess",
    chess960: 0,
    opening: "Italian Game",
    termination_mode: s.termination ?? "",
    pgn: `[White "${s.white}"]\n[Black "${s.black}"]\n[Result "${s.result}"]\n[UTCDate "${date}"]\n[UTCTime "${time}"]\n\n1. e4 ${s.result}`,
    moves_json: JSON.stringify(s.moves ?? buildMoves()),
    summary_json: JSON.stringify(s.acc ? { white: side(0), black: side(1), analysis_status: "completed" } : {}),
  } as unknown as RawGame;
}

const member = (id: string, is_me = false) => ({ id, name: is_me ? "Du" : id, is_me, usernames: [is_me ? "Tim" : id] });

describe("crosstable", () => {
  // Tim beats Ida 5 times in a row, loses to Max 1:5, Max and Ida are level.
  const games = [
    ...[10, 9, 8, 7, 6].map((d) => game({ white: "Tim", black: "Ida", result: "1-0", days: d })),
    ...[20, 19, 18, 17, 16].map((d) => game({ white: "Max", black: "Tim", result: "1-0", days: d })),
    game({ white: "Tim", black: "Max", result: "1-0", days: 15 }),
    ...[30, 29, 28].map((d) => game({ white: "Max", black: "Ida", result: "1-0", days: d })),
    ...[27, 26, 25].map((d) => game({ white: "Ida", black: "Max", result: "1-0", days: d })),
    // Draws keep the pairing close.
    game({ white: "Ida", black: "Max", result: "1/2-1/2", days: 24 }),
  ];
  const t = buildCrosstable([member("ich", true), member("Max"), member("Ida")], games);

  it("counts each pairing once and mirrors it, with points, runs and totals", () => {
    const [me, max, ida] = [0, 1, 2];
    expect(t.cells[me][me]).toBeNull();
    expect(t.cells[me][max]).toMatchObject({ games: 6, wins: 1, losses: 5, points: 1, last: ["win", "loss", "loss", "loss", "loss"] });
    expect(t.cells[max][me]).toMatchObject({ games: 6, wins: 5, losses: 1, points: 5, last: ["loss", "win", "win", "win", "win"] });
    expect(t.cells[me][ida]).toMatchObject({ points: 5, streak: { kind: "win", count: 5 } });
    expect(t.cells[ida][me]).toMatchObject({ points: 0, streak: { kind: "loss", count: 5 } });
    expect((t.cells[me][max]!.p_row as number) + (t.cells[max][me]!.p_row as number)).toBeCloseTo(1, 9);
    expect(t.total_games).toBe(18);
    expect(t.totals.map((x) => [x.points, x.games])).toEqual([
      [6, 11],
      [8.5, 13],
      [3.5, 12],
    ]);
  });

  it("names your hardest and favourite opponent, the closest rivalry and the longest run", () => {
    const h = crossHighlights(t);
    const of = (kind: string) => h.find((x) => x.kind === kind)!;
    expect([of("nemesis").b.id, of("nemesis").cell.points]).toEqual(["Max", 1]);
    expect([of("favorite").b.id, of("favorite").clear]).toEqual(["Ida", true]);
    // 1:5 from six games is not yet proof that Max is the better one.
    expect(of("nemesis").clear).toBe(false);
    expect([of("rivalry").a.id, of("rivalry").b.id, of("rivalry").cell.games]).toEqual(["Max", "Ida", 7]);
    expect([of("streak").a.id, of("streak").cell.streak]).toEqual(["ich", { kind: "win", count: 5 }]);
    // Three games against Max: too few for a nemesis, but his three wins in a row are a run.
    const few = buildCrosstable([member("ich", true), member("Max")], games.slice(5, 8));
    expect(crossHighlights(few).map((x) => [x.kind, x.a.id])).toEqual([["streak", "Max"]]);
  });
});

describe("form", () => {
  it("corrects accuracy for the time control and only calls a trend that passes the test", () => {
    const games: RawGame[] = [];
    // Tim: 60 to 31 days ago Blitz at ~78, the last 30 days Rapid at ~84.
    for (let i = 0; i < 14; i++) games.push(game({ white: "Tim", black: "X", result: "1-0", days: 60 - i * 2, acc: [77 + (i % 3), 70], speed: "Blitz" }));
    for (let i = 0; i < 14; i++) games.push(game({ white: "Tim", black: "X", result: i < 12 ? "1-0" : "0-1", days: 28 - i * 2, acc: [83 + (i % 3), 70], speed: "Rapid" }));
    // Ida: steady, plays little lately.
    for (let i = 0; i < 12; i++) games.push(game({ white: "Ida", black: "X", result: "1/2-1/2", days: 80 - i * 4, acc: [80 + (i % 2), 70] }));
    const members = [member("ich", true), member("Ida")];
    const raw = groupMomentum(members, games, { now: NOW });
    const tim = raw.find((r) => r.id === "ich")!;
    expect(tim).toMatchObject({ trend: "up", last: ["win", "win", "win", "loss", "loss"], streak: { kind: "loss", count: 2 } });
    expect(tim.recent.games).toBe(14);
    expect(tim.weeks).toHaveLength(12);
    expect(tim.weeks.every((w) => w.accuracy === null || (w.accuracy > 70 && w.accuracy < 90))).toBe(true);
    // Rapid is six points easier in this group: corrected, nothing is left of the "progress".
    const fair = groupMomentum(members, games, { now: NOW, effects: { Rapid: { accuracy: 3 }, Blitz: { accuracy: -3 } } });
    expect(fair.find((r) => r.id === "ich")!.trend).toBe("flat");
    // Ida's recent window is empty: no trend at all, not "flat".
    expect(raw.find((r) => r.id === "Ida")).toMatchObject({ trend: null, streak: { kind: "draw", count: 12 } });
  });
});

describe("records", () => {
  it("keeps each record with its game and gives ties to whoever set it first", () => {
    // 52 plies: 26 moves each, long enough for an accuracy record.
    const long = [...buildMoves(), ...buildMoves()];
    // 26 plies; White falls to 10 % and comes back.
    const comeback = buildMoves({ 15: ["Blunder", 0.1], 16: ["Best", 0.1], 20: ["Blunder", 0.9] });
    const games = [
      game({ white: "Tim", black: "X", result: "1-0", days: 50, acc: [92.5, 60], elo: [1500, 1700], moves: long }),
      game({ white: "Ida", black: "X", result: "1-0", days: 40, acc: [92.5, 60], moves: long }),
      game({ white: "Ida", black: "X", result: "1-0", days: 39, acc: [88, 60], elo: [1500, 1900], moves: comeback }),
      game({ white: "Ida", black: "X", result: "1-0", days: 38, acc: [70, 60], blunders: [1, 0], moves: long }),
      game({ white: "Tim", black: "X", result: "1-0", days: 30, acc: [80, 60], termination: "timeout", moves: buildMoves().slice(0, 12) }),
      game({ white: "Tim", black: "X", result: "0-1", days: 20, acc: [75, 80], moves: long }),
    ];
    const rec = groupRecords([member("ich", true), member("Ida")], games);
    const of = (key: string) => rec.find((r) => r.key === key);
    // Same 92,5 %: Tim set it ten days earlier.
    expect(of("best_game")).toMatchObject({ holder: { id: "ich", is_me: true }, value: 92.5, text: "92,5 %" });
    expect(of("comeback")).toMatchObject({ holder: { id: "Ida" }, text: "aus 10 % gewonnen" });
    expect(of("upset")).toMatchObject({ holder: { id: "Ida" }, value: 400 });
    expect(of("streak")).toMatchObject({ holder: { id: "Ida" }, value: 3, text: "3 Siege in Folge" });
    // Ida's run without a blunder ends with her third game; Tim's three games are all clean.
    expect(of("clean")).toMatchObject({ holder: { id: "ich" }, value: 3 });
    // The six-move win on time is no knockout: the quickest real win is the comeback.
    expect(of("quick")).toMatchObject({ holder: { id: "Ida" }, value: 13, game_id: games[2].id });
    expect(of("brilliant")).toBeUndefined();
  });
});

describe("duel analysis", () => {
  // Tim against Lena: Lena wins the first eight (Tim throws a won game away
  // each time), then Tim wins four in a row where Lena blunders.
  const lost = Array.from({ length: 8 }, (_, i) => game({ white: "Tim", black: "Lena", result: "0-1", days: 40 - i, acc: [70 + (i % 3), 86], moves: buildMoves(THROWN_WIN) }));
  const won = Array.from({ length: 4 }, (_, i) => game({ white: "Tim", black: "Lena", result: "1-0", days: 20 - i, acc: [72 + (i % 2), 84], moves: buildMoves(PUNISHED) }));
  // Their other games, at the usual accuracy.
  const others = [
    ...Array.from({ length: 12 }, (_, i) => game({ white: "Tim", black: "X", result: "1-0", days: 60 - i, acc: [84 + (i % 4), 70] })),
    ...Array.from({ length: 12 }, (_, i) => game({ white: "Lena", black: "Y", result: "1-0", days: 60 - i, acc: [85 + (i % 3), 70] })),
  ];
  const d = duelInsights([...lost, ...won, ...others], ["Tim"], ["Lena"], "Lena");

  it("tells the story of the duel: balance, run, who errs first and where games tip", () => {
    expect(d.games).toHaveLength(12);
    expect(d.balance.slice(-5)).toEqual([-8, -7, -6, -5, -4]);
    expect(d.streak).toEqual({ who: "me", count: 4 });
    // In THROWN_WIN Lena errs first (ply 15) before Tim throws the game away.
    expect(d.first_error).toEqual({ me: 0, them: 12 });
    // Lena's blunder (move 8) still counts to the opening, Tim's throw-away (move 9) to the middlegame.
    expect(d.decisive).toEqual([
      { phase: "opening", me: 0, them: 4 },
      { phase: "middlegame", me: 8, them: 0 },
      { phase: "endgame", me: 0, them: 0 },
    ]);
    expect(d.accuracy.my_change).toBe("worse");
    expect(d.accuracy.their_change).toBeNull();
    expect(d.facts).toEqual([
      "Gegen Lena spielst du klar ungenauer als sonst: 71,4 statt 85,5 % Genauigkeit.",
      "Den ersten groben Fehler macht meistens Lena (12 von 12 Partien): Stellungen lange spannend halten lohnt sich.",
      "Deine Niederlagen gegen Lena kippen meist im Mittelspiel (8 von 8).",
    ]);
    // Four wins are too few to say where they are decided.
    expect(d.facts.some((f) => f.startsWith("Deine Siege"))).toBe(false);
  });

  it("previews the likely openings with both records and only calls a clear edge", () => {
    const choice = (san: string, games: number, score: number) => ({ san, games, score_pct: score });
    const profile = (o: Record<string, unknown>) => ({ openings: { white: [], black: [], white_first: [], black_vs: [], white_vs: [], ...o } }) as unknown as PlayerProfile;
    const me = profile({
      white_first: [choice("e4", 40, 55), choice("d4", 10, 50)],
      white_vs: [{ ...choice("e4", 40, 55), replies: [choice("c5", 20, 30), choice("e5", 20, 70)] }],
    });
    const them = profile({
      black: [{ name: "Sicilian Defense", line: ["e4", "c5"], games: 30 }],
      black_vs: [
        { ...choice("e4", 30, 50), replies: [choice("c5", 24, 75), choice("e5", 6, 40)] },
        { ...choice("d4", 10, 50), replies: [choice("d5", 10, 50)] },
      ],
    });
    const p = openingPreview(me, them);
    expect(p.as_black).toEqual([]);
    expect(p.as_white.map((l) => [l.first, l.reply, l.name, l.edge])).toEqual([
      ["e4", "c5", "Sizilianische Verteidigung", "them"],
      ["d4", "d5", null, null],
      ["e4", "e5", null, "me"],
    ]);
    // 80 % of Tim's games start 1.e4, which Lena answers with 1…c5 in 80 %.
    expect(p.as_white[0].chance).toBeCloseTo(0.8 * 0.8, 9);
  });
});
