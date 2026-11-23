// What Lucena's game story is built from beyond the review itself: the
// player's costly moves in the order they happened, the way the opening went
// and how the game ended. Pure functions, so every sentence's facts are tested.
import type { GameMetadata, MoveData } from "../types";
import { ERROR_CLASSES, moveLabel, sanForUci } from "./features";
import type { GameReview, KeyMoment } from "./models";

/** How many costly moves the story walks through; more would be a list, not a story. */
export const STORY_ERRORS = 3;

/**
 * The player's own costly moves: the ones that gave away the most winning
 * chance, told in the order they happened so the story reads as the game went.
 */
export function costlyMoments(review: GameReview, max = STORY_ERRORS): KeyMoment[] {
  return review.key_moments
    .filter((k) => k.by_user && ERROR_CLASSES.has(k.classification) && k.wp_after < k.wp_before)
    .sort((a, b) => b.wp_before - b.wp_after - (a.wp_before - a.wp_after))
    .slice(0, max)
    .sort((a, b) => a.ply_index - b.ply_index);
}

export interface OpeningStory {
  /** Opening name of the last theory move, English as stored. */
  name: string;
  /** Half moves played from theory. */
  bookPlies: number;
  /** Who played the first move outside theory. */
  leftBy: "you" | "opponent";
  /** Label of that move, e.g. "6... Lxf7". */
  exitLabel: string;
  /** Index of that move in the game. */
  exitPly: number;
  /** The player's own exit move: how it was rated and what the engine preferred. */
  yourExit: { classification: string; best_move_san: string } | null;
  /** Theory moves of that position (SAN), when the book knew any. */
  known: string[];
}

const whiteMoved = (m: MoveData, idx: number): boolean => (m.fen_before ? ` ${m.fen_before} `.includes(" w ") : idx % 2 === 0);

/**
 * How the opening went: how long both sides stayed in theory and who left it
 * first. Null when the game has no theory moves at all, or never left them.
 */
export function openingStory(moves: MoveData[], isWhite: boolean, chess960 = false): OpeningStory | null {
  let book = 0;
  while (book < moves.length && moves[book].is_book_move) book++;
  if (book === 0 || book >= moves.length) return null;
  const exit = moves[book];
  const byYou = whiteMoved(exit, book) === isWhite;
  let bestSan = "";
  if (byYou && exit.best_move && exit.best_move !== exit.uci) bestSan = sanForUci(exit.fen_before, exit.best_move, chess960);
  const name = [...moves.slice(0, book)].reverse().find((m) => m.opening_name)?.opening_name ?? "";
  return {
    name,
    bookPlies: book,
    leftBy: byYou ? "you" : "opponent",
    exitLabel: moveLabel(exit.move_number, whiteMoved(exit, book), exit.san),
    exitPly: book,
    yourExit: byYou && exit.classification ? { classification: exit.classification, best_move_san: bestSan } : null,
    known: moves[book - 1].candidate_continuations ?? [],
  };
}

/** The game's end in one phrase ("Aufgabe", "Schachmatt"), or null when the file did not record it. */
export function endingText(meta: Pick<GameMetadata, "termination_description"> | undefined): string | null {
  const text = meta?.termination_description?.trim();
  return text ? text : null;
}
