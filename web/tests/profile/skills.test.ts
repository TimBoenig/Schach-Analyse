import { describe, expect, it } from "vitest";

import { buildPlayerProfile, PRIOR_WEIGHT, settleSkills, type SkillScore } from "../../src/domain/profile";
import { buildMoves, gameRow } from "./fixtures";

const skill = (key: string, score: number, sample: number, typical: number | null = 60): SkillScore => ({
  key,
  name: key,
  score,
  grade: "",
  detail: "",
  sample,
  reliable: true,
  typical,
});

describe("skill scores with little evidence", () => {
  it("pulls thin evidence towards the rating-typical value and narrows the margin with more data", () => {
    // One thrown win reads as 0 % conversion; that is no reason for a score of 0.
    const [one, many, none, noRating] = settleSkills([
      skill("conversion", 0, 1),
      skill("conversion", 0, 300),
      skill("conversion", 0, 0),
      skill("defense", 100, PRIOR_WEIGHT.defense, null),
    ]);
    expect(one.raw_score).toBe(0);
    expect(one.score).toBe(54.5); // 1 situation against a prior weight of 10 at 60
    expect(one.grade).toBe("Solide");
    expect(one.reliable).toBe(false);
    expect(many.score).toBeLessThan(3);
    expect(many.reliable).toBe(true);
    expect(many.margin as number).toBeLessThan(one.margin as number);
    expect(none).toMatchObject({ score: 0, margin: null });
    // Without a rating the prior is the middle of the scale.
    expect(noRating.score).toBe(75);
  });

  it("measures steadiness only on games long enough to say something", () => {
    const moves = buildMoves();
    const games = [
      ...[0, 1, 2, 3, 4, 5].map((i) => gameRow(`g${i}`, moves, { accuracy: 80, utc: `2026.06.0${i + 1} 18:00:00` })),
      // A resignation after three moves with a random-looking accuracy.
      gameRow("short", moves.slice(0, 6), { accuracy: 20, utc: "2026.06.09 18:00:00" }),
    ];
    const consistency = buildPlayerProfile(games, ["Tim"]).skills.find((s) => s.key === "consistency")!;
    expect(consistency.sample).toBe(6);
    expect(consistency.raw_score).toBe(100);
  });
});
