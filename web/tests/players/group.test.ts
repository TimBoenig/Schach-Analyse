import { describe, expect, it } from "vitest";

import { groupForm, groupStanding, RANK_FACTORS, type Ranking, type RankRow, sharedOpenings } from "../../src/domain/players";
import type { RawGame } from "../../src/domain/metrics";
import type { PlayerProfile } from "../../src/domain/profile";
import type { OpeningStat } from "../../src/domain/profile/openings";

function row(id: string, isMe: boolean, cells: Record<string, [number, number]>): RankRow {
  return {
    id,
    name: id,
    is_me: isMe,
    rank: null,
    overall: null,
    games: 50,
    analyzed: 30,
    source: "lichess",
    cells: Object.fromEntries(Object.entries(cells).map(([k, [value, se]]) => [k, { value, se, rank: null, points: null, note: "" }])),
  };
}

const ranking = (rows: RankRow[]): Ranking => ({ factors: RANK_FACTORS, rows, rating_speed: "Blitz", notes: [] });

describe("group standing", () => {
  it("names a clear edge, the friend to learn from, and ignores gaps within noise or results-only factors", () => {
    const st = groupStanding(
      ranking([
        row("Du", true, { accuracy: [82, 1], endgame: [50, 3], tactics: [60, 8], rating: [1500, 60], blunders: [1.0, 0.1] }),
        row("Lena", false, { accuracy: [75, 1], endgame: [70, 3], tactics: [64, 8], rating: [1900, 60], blunders: [1.1, 0.1] }),
        row("Max", false, { accuracy: [70, 1], endgame: [52, 3], tactics: [62, 8], blunders: [2.0, 0.1] }),
      ]),
    )!;
    // Accuracy: even the closest friend (Lena, 75) is clearly behind.
    expect(st.edges.map((g) => [g.key, g.other_name])).toEqual([["accuracy", "Lena"]]);
    // Endgame: Lena is clearly better. Tactics differ by less than the noise,
    // blunders only lead against Max (Lena is close), rating is not something to copy.
    expect(st.learn.map((g) => [g.key, g.other_name, g.other, g.mine])).toEqual([["endgame", "Lena", 70, 50]]);
    expect(st.members).toBe(3);
  });

  it("treats fewer blunders as better", () => {
    const st = groupStanding(ranking([row("Du", true, { blunders: [3, 0.2] }), row("Ida", false, { blunders: [1, 0.2] })]))!;
    expect(st.learn.map((g) => g.key)).toEqual(["blunders"]);
    expect(st.edges).toEqual([]);
  });
});

const DAY = 86400;
const NOW = Date.parse("2026-06-30T12:00:00Z") / 1000;

function rated(id: string, player: string, daysAgo: number, elo: number, source = "lichess", speed = "blitz"): RawGame {
  const d = new Date((NOW - daysAgo * DAY) * 1000);
  const date = `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;
  return {
    id,
    white: player,
    black: "Gegner",
    white_elo: elo,
    black_elo: 1500,
    result: "1-0",
    date,
    source,
    speed_category: speed,
    pgn: `[UTCDate "${date}"]\n[UTCTime "12:00:00"]\n\n1. e4 1-0`,
  } as unknown as RawGame;
}

describe("group form", () => {
  it("measures the change on the main platform only, so a second site cannot fake a 400-point jump", () => {
    const games = [
      rated("old", "Tim", 40, 1480),
      ...[20, 15, 10, 5, 1].map((d, i) => rated(`t${i}`, "Tim", d, 1490 + i * 10)),
      // A few Chess.com games with a much lower rating in between.
      rated("c1", "Tim", 12, 1100, "chesscom"),
      rated("c2", "Tim", 3, 1080, "chesscom"),
      // Ida played too little in the window to show a change.
      ...[20, 2].map((d, i) => rated(`i${i}`, "Ida", d, 1600)),
    ];
    const form = groupForm(
      [
        { id: "ich", name: "Du", is_me: true, usernames: ["Tim"] },
        { id: "ida", name: "Ida", is_me: false, usernames: ["Ida"] },
      ],
      games,
      NOW,
    );
    // From the last rating before the window (1480) to the newest one (1530).
    expect(form).toEqual([{ id: "ich", name: "Du", is_me: true, speed: "blitz", source: "lichess", rating: 1530, delta: 50, games: 5 }]);
  });
});

describe("shared openings", () => {
  const line = (name: string, color: "white" | "black", games: number, score: number): OpeningStat =>
    ({ name, color, games, score_pct: score, eco: "", wins: 0, draws: 0, losses: 0, analyzed: 0 }) as unknown as OpeningStat;
  const profile = (white: OpeningStat[], black: OpeningStat[] = []) => ({ openings: { white, black } }) as unknown as PlayerProfile;

  it("keeps openings both play with the same colour often enough and only calls clear score gaps", () => {
    const me = profile([line("Italian Game", "white", 40, 75), line("Ruy Lopez", "white", 12, 50), line("London System", "white", 5, 60)], [line("Sicilian Defense", "black", 20, 50)]);
    const them = profile([line("Italian Game", "white", 40, 40), line("Ruy Lopez", "white", 10, 55), line("London System", "white", 30, 50)], [line("French Defense", "black", 20, 50)]);
    expect(sharedOpenings(me, them).map((o) => [o.name, o.color, o.better])).toEqual([
      ["Italienische Partie", "white", "me"],
      ["Spanische Partie", "white", null],
    ]);
  });
});
