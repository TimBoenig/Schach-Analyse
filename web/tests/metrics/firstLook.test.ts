import { describe, expect, it } from "vitest";

import { firstLook } from "../../src/domain/firstLook";
import type { GameAnalysis } from "../../src/domain/types";

const game = (white: string, black: string, result: string, time_control = "600"): GameAnalysis =>
  ({ game_id: `${white}-${black}-${result}`, metadata: { white, black, result, time_control, event: "", headers: {} } }) as unknown as GameAnalysis;

describe("first look after an import", () => {
  it("counts results from the player's side, ignoring case and games of others", () => {
    const look = firstLook(
      [game("Tim", "a", "1-0"), game("b", "TIM", "1-0"), game("c", "tim", "1/2-1/2"), game("tim", "d", "*", "60"), game("x", "y", "1-0")],
      "tim",
    );
    expect(look).toEqual({ games: 4, wins: 1, draws: 1, losses: 1, white: 2, bullet: 1 });
  });
});
