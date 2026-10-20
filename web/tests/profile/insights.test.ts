import { describe, expect, it } from "vitest";
import { buildDeepInsights, buildPlayerProfile, extractFeatures, sessions } from "../../src/domain/profile";
import { buildMoves, gameRow } from "./fixtures";

// White (the user) blunders with 4. c3 (ply 6) and castles into a mistake at ply 14.
const ERRORS = buildMoves({ 6: ["Blunder", 0.2], 14: ["Mistake", 0.1] });
const CLEAN = buildMoves({});
const utcHour = (ts: number) => new Date(ts * 1000).getUTCHours();
const utcDay = (ts: number) => new Date(ts * 1000).getUTCDay();

const feats = (rows: ReturnType<typeof gameRow>[]) => rows.map((r) => extractFeatures(r, "white"));

describe("deep insights", () => {
  it("maps errors to destination squares, move ranges and pieces", () => {
    const d = buildDeepInsights(feats([gameRow("a", ERRORS), gameRow("b", ERRORS)]), utcHour, utcDay);
    expect(d.error_total).toBe(4);
    expect(d.error_squares[2 * 8 + 2]).toBe(2); // c3
    expect(d.error_squares[0 * 8 + 6]).toBe(2); // g1 (castling king)
    expect(d.hot_squares.map((h) => h.square).sort()).toEqual(["c3", "g1"]);
    // Both errors fall in moves 1–10 (4. c3 and 8. O-O).
    expect(d.by_move_number[0].errors).toBe(4);
    expect(d.by_piece.find((p) => p.piece === "P")?.errors).toBe(2);
    expect(d.by_piece.find((p) => p.piece === "K")?.errors).toBe(2);
    const moves = d.by_piece.reduce((s, p) => s + p.moves, 0);
    expect(moves).toBe(26);
  });

  it("groups games into sessions and scores the game after a loss", () => {
    const rows = [
      gameRow("s1", CLEAN, { result: "0-1", utc: "2026.06.01 18:00:00" }),
      gameRow("s2", CLEAN, { result: "0-1", utc: "2026.06.01 18:20:00" }),
      gameRow("s3", CLEAN, { result: "1-0", utc: "2026.06.01 18:40:00" }),
      // Next day: a new session, so it does not count as "after a win".
      gameRow("s4", CLEAN, { result: "0-1", utc: "2026.06.02 09:00:00" }),
    ];
    const fs = feats(rows);
    expect(sessions(fs).map((s) => s.length)).toEqual([3, 1]);
    const d = buildDeepInsights(fs, utcHour, utcDay);
    const [afterWin, , afterLoss, afterTwo] = d.after_result;
    expect(afterWin.games).toBe(0);
    expect(afterLoss.games).toBe(2);
    expect(afterLoss.score_pct).toBe(50);
    expect(afterTwo.games).toBe(1);
    expect(afterTwo.score_pct).toBe(100);
    expect(d.by_session_game.map((b) => b.games)).toEqual([2, 1, 1, 0]);
    expect(d.by_daytime.find((b) => b.key === "evening")?.games).toBe(3);
    expect(d.by_daytime.find((b) => b.key === "morning")?.games).toBe(1);
    expect(d.by_weekday.find((b) => b.label === "Mo")?.games).toBe(3); // 2026-06-01 is a Monday
  });

  it("ignores time-of-day and sessions for games without a start time", () => {
    const row = gameRow("t", CLEAN);
    row.pgn = (row.pgn ?? "").replace(/\[UTCTime "[^"]*"\]\n/, "");
    const d = buildDeepInsights(feats([row, { ...row, id: "t2" }]), utcHour, utcDay);
    expect(d.by_daytime.every((b) => b.games === 0)).toBe(true);
    expect(d.after_result.every((b) => b.games === 0)).toBe(true);
  });

  it("names tilt and the time of day as headline findings", () => {
    const rows = [];
    // Eight sessions of loss → loss; plus wins in single-game sessions to lift the average.
    for (let day = 1; day <= 8; day++) {
      const d = `2026.06.${String(day).padStart(2, "0")}`;
      rows.push(gameRow(`l${day}a`, CLEAN, { result: "0-1", utc: `${d} 18:00:00` }));
      rows.push(gameRow(`l${day}b`, CLEAN, { result: "0-1", utc: `${d} 18:30:00` }));
      rows.push(gameRow(`w${day}`, CLEAN, { result: "1-0", utc: `${d} 08:00:00` }));
      rows.push(gameRow(`v${day}`, CLEAN, { result: "1-0", utc: `${d} 12:00:00` }));
    }
    const d = buildDeepInsights(feats(rows), utcHour, utcDay);
    expect(d.facts).toContain("Morgens spielst du am besten (100 %), abends am schwächsten (0 %).");
    expect(d.facts.some((f) => f.startsWith("Nach einer Niederlage holst du nur 0 % der Punkte (sonst 50 %)"))).toBe(true);
  });

  it("is part of the profile once a game is analyzed", () => {
    expect(buildPlayerProfile([gameRow("p", ERRORS)], ["Tim"]).deep?.error_total).toBe(2);
    const unanalyzed = { ...gameRow("u", ERRORS), summary_json: JSON.stringify({ analysis_status: "not_started" }) };
    expect(buildPlayerProfile([unanalyzed], ["Tim"]).deep).toBeNull();
  });
});
