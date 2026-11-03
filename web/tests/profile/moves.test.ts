import { describe, expect, it } from "vitest";

import { buildPlayerProfile } from "../../src/domain/profile";
import { buildMoves, gameRow, type Events } from "./fixtures";

// Tim plays White, so his moves are the even plies; Black (the opponent) the odd ones.
const pad = (n: number) => String(n).padStart(2, "0");

function games(events: Events[], month = "06"): ReturnType<typeof gameRow>[] {
  return events.map((e, i) => gameRow(`g${month}${i}`, buildMoves(e), { utc: `2026.${month}.${pad(i + 1)} 18:00:00` }));
}

describe("move tally", () => {
  it("counts every kind of move with rates, phases, months, highlights and records", () => {
    const rows = [
      ...games([{ 16: ["Blunder", 0.3] }], "05"),
      ...games([{ 4: ["Brilliant", 0.6], 8: ["Great", 0.62] }, { 6: ["Great", 0.55], 9: ["Mistake", 0.7] }, {}]),
    ];
    const t = buildPlayerProfile(rows, ["Tim"]).moves!;

    expect(t.games).toBe(4);
    expect(t.moves).toBe(4 * 13);
    expect(t.counts).toMatchObject({ Brilliant: 1, Great: 2, Blunder: 1, Mistake: 0, Best: 4 * 13 - 4 });
    const great = t.classes.find((c) => c.key === "Great")!;
    expect(great.games_with).toBe(2);
    expect(great.per_game).toBeCloseTo(0.5);
    expect(great.per_100).toBeCloseTo((2 / 52) * 100);

    // The opponent's mistake is theirs, not Tim's.
    expect(t.opponents?.counts.Mistake).toBe(1);
    expect(t.opponents?.moves).toBe(4 * 13);
    expect(t.phases.reduce((s, p) => s + p.moves, 0)).toBe(t.moves);
    expect(t.months.map((m) => [m.key, m.games, m.counts.Blunder])).toEqual([
      ["2026-05", 1, 1],
      ["2026-06", 3, 0],
    ]);

    // Newest first: the great move of the second June game before the first game's ones.
    expect(t.highlights.map((h) => [h.game_id, h.classification, h.move])).toEqual([
      ["g061", "Great", "4. c3"],
      ["g060", "Great", "5. d4"],
      ["g060", "Brilliant", "3. Bc4"],
    ]);
    expect(t.top_games.map((g) => g.game_id)).toEqual(["g060", "g061"]);
    expect(t.records).toEqual({
      games_with_brilliant: 1,
      most_brilliant: 1,
      blunder_free_games: 3,
      longest_blunder_free: 3,
      current_blunder_free: 3,
    });
  });

  it("is null until a game is analyzed", () => {
    const row = gameRow("raw", buildMoves());
    row.summary_json = JSON.stringify({ analysis_status: "pending" });
    expect(buildPlayerProfile([row], ["Tim"]).moves).toBeNull();
  });

  it("only states findings that many moves clearly show", () => {
    const blundery: Events = { 10: ["Blunder", 0.3], 14: ["Mistake", 0.2], 20: ["Blunder", 0.1] };
    const keys = (rows: ReturnType<typeof gameRow>[]) => buildPlayerProfile(rows, ["Tim"]).moves!.findings.map((f) => [f.key, f.tone]);

    // Three bad games are no evidence of anything.
    expect(keys(games([blundery, blundery, blundery]))).toEqual([]);

    // 20 bad games in May, then 20 clean ones in June: clearly better lately,
    // while the opponents (always clean) still err less overall.
    const rows = [...games(Array(20).fill(blundery), "05"), ...games(Array(20).fill({}), "06")];
    const found = keys(rows);
    expect(found).toContainEqual(["vs_opp_errors", "neg"]);
    expect(found).toContainEqual(["trend_errors", "pos"]);
  });
});
