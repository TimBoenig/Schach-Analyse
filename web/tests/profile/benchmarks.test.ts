import { describe, expect, it } from "vitest";
import { benchmark, buildPlayerProfile, expectedScore, typicalSkillScores } from "../../src/domain/profile";
import { buildMoves, gameRow } from "./fixtures";

describe("rating benchmarks", () => {
  it("interpolates between anchors and clamps outside the table", () => {
    expect(benchmark("accuracy", 1500)).toBe(76);
    expect(benchmark("accuracy", 1350)).toBeCloseTo(73, 5);
    expect(benchmark("accuracy", 400)).toBe(62);
    expect(benchmark("accuracy", 3000)).toBe(90);
  });

  it("follows the Elo expectation", () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 10);
    expect(expectedScore(1900, 1500)).toBeCloseTo(10 / 11, 10);
    expect(expectedScore(1500, 1700) + expectedScore(1700, 1500)).toBeCloseTo(1, 10);
  });

  it("typical skill scores stay in range and rise with the rating", () => {
    const low = typicalSkillScores(900);
    const high = typicalSkillScores(2200);
    for (const [key, v] of Object.entries(low)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(high[key]).toBeLessThanOrEqual(100);
      if (key !== "time" && key !== "defense") expect(high[key]).toBeGreaterThan(v);
    }
  });
});

describe("rating context in the profile", () => {
  it("compares the score with the per-game Elo expectation", () => {
    const moves = buildMoves({});
    // Tim (1500) beats a 1700 player twice and loses once to a 1300 player.
    const rows = [
      { ...gameRow("g1", moves, { result: "1-0", utc: "2026.05.01 10:00:00" }), black_elo: "1700" },
      { ...gameRow("g2", moves, { result: "1-0", utc: "2026.05.02 10:00:00" }), black_elo: "1700" },
      { ...gameRow("g3", moves, { result: "0-1", utc: "2026.05.03 10:00:00" }), black_elo: "1300", white_elo: "1520" },
    ];
    const rc = buildPlayerProfile(rows, ["Tim"]).rating;
    expect(rc).not.toBeNull();
    expect(rc!.rating).toBe(1520); // latest game
    expect(rc!.rated_games).toBe(3);
    expect(rc!.score).toBe(2);
    const expected = 2 * expectedScore(1500, 1700) + expectedScore(1520, 1300);
    expect(rc!.expected_score).toBeCloseTo(expected, 1);
    expect(rc!.avg_opponent).toBe(1567);
    expect(rc!.performance).toBe(Math.round(4700 / 3 + 400 / 3));
    expect(rc!.typical_accuracy).toBeCloseTo(benchmark("accuracy", 1520), 1);
  });

  it("is absent when the games carry no ratings", () => {
    const row = { ...gameRow("g1", buildMoves({})), white_elo: "", black_elo: "" };
    const profile = buildPlayerProfile([row], ["Tim"]);
    expect(profile.rating).toBeNull();
    expect(profile.skills.every((s) => s.typical === null)).toBe(true);
  });
});
