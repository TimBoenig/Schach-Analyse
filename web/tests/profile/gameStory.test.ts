import { describe, expect, it } from "vitest";

import { buildGameReview } from "../../src/domain/profile";
import { costlyMoments, endingText, openingStory } from "../../src/domain/profile/gameStory";
import { buildMoves, gameAnalysis, gameRow } from "./fixtures";

describe("costly moves of the story", () => {
  // White (the player) errs at plies 4, 8 and 12 (costs 20, 60, 15 points); Black's blunder at ply 5 is not theirs.
  const moves = buildMoves({
    4: ["Mistake", 0.3],
    5: ["Blunder", 0.8],
    8: ["Blunder", 0.2],
    12: ["Mistake", 0.05],
  });
  const review = buildGameReview(gameRow("g", moves), "white")!;

  it("takes the player's most expensive errors and tells them in game order", () => {
    const list = costlyMoments(review, 3);
    expect(list.map((k) => k.ply_index)).toEqual([4, 8, 12]);
    // Fewer slots keep the most expensive ones, still in game order.
    expect(costlyMoments(review, 2).map((k) => k.ply_index)).toEqual([4, 8]);
    expect(list.every((k) => k.by_user && k.wp_after < k.wp_before)).toBe(true);
  });

  it("leaves the opponent's mistakes out and keeps fewer when there are fewer", () => {
    expect(costlyMoments(review, 10).some((k) => k.ply_index === 5)).toBe(false);
    expect(costlyMoments(buildGameReview(gameRow("g", buildMoves()), "white")!)).toEqual([]);
  });
});

describe("opening story", () => {
  const book = (plies: number, names = true) => {
    const moves = buildMoves({ 6: ["Mistake", 0.3] });
    moves.forEach((m, i) => {
      if (i < plies) {
        m.is_book_move = true;
        m.classification = "Book";
        if (names) m.opening_name = i < 3 ? "Italian Game" : "Italian Game: Giuoco Piano";
        m.candidate_continuations = ["Nf6", "d6"];
      }
    });
    return moves;
  };

  it("names the opening and who left theory first, with the player's own exit rated", () => {
    // Ply 6 (index 6) is White's move: the player leaves theory with a mistake.
    const o = openingStory(book(6), true)!;
    expect(o).toMatchObject({ name: "Italian Game: Giuoco Piano", bookPlies: 6, leftBy: "you", exitPly: 6, exitLabel: "4. c3" });
    expect(o.yourExit?.classification).toBe("Mistake");
    expect(o.yourExit?.best_move_san).not.toBe("");
    expect(o.known).toEqual(["Nf6", "d6"]);
  });

  it("says the opponent left theory when it was their move, without rating the player", () => {
    const o = openingStory(book(5), true)!;
    expect(o).toMatchObject({ leftBy: "opponent", exitLabel: "3... Bc5" });
    expect(o.yourExit).toBeNull();
    // From Black's side the same exit is the player's own.
    expect(openingStory(book(5), false)?.leftBy).toBe("you");
  });

  it("has nothing to tell without theory moves or when the game never left them", () => {
    expect(openingStory(book(0), true)).toBeNull();
    expect(openingStory(book(100), true)).toBeNull();
  });
});

describe("ending", () => {
  it("reads how the game ended, if the file said so", () => {
    const game = gameAnalysis(buildMoves());
    game.metadata.termination_description = "Aufgabe von Gegner";
    expect(endingText(game.metadata)).toBe("Aufgabe von Gegner");
    game.metadata.termination_description = "  ";
    expect(endingText(game.metadata)).toBeNull();
    expect(endingText(undefined)).toBeNull();
  });
});
