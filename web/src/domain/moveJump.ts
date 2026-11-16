// Jumping from a report to the moves it counts: which moves of a game carry a
// classification, and where the next click on that number should land.
import type { Classification, MoveData } from "./types";

export type JumpSide = "white" | "black";

const sideOf = (m: MoveData): JumpSide => (m.fen_before.split(" ")[1] === "b" ? "black" : "white");

/**
 * Board positions (number of moves played, so 1 = after the first move) of all
 * moves with one of `classes`, in game order. `side` limits it to one colour.
 */
export function stopsOf(moves: MoveData[], classes: readonly Classification[], side?: JumpSide): number[] {
  const out: number[] = [];
  moves.forEach((m, k) => {
    if (classes.includes(m.classification) && (!side || sideOf(m) === side)) out.push(k + 1);
  });
  return out;
}

/** The stop after `current`; past the last one it starts again at the first, so repeated clicks cycle. */
export function nextStop(stops: number[], current: number): number | null {
  if (!stops.length) return null;
  return stops.find((s) => s > current) ?? stops[0];
}

export interface Glanzzug {
  stop: number;
  side: JumpSide;
  classification: Classification;
  /** "23. Rxf7" or "23... Rxf7" */
  label: string;
}

/** The brilliant and great moves of a game, in game order. */
export function glanzzuege(moves: MoveData[]): Glanzzug[] {
  return stopsOf(moves, ["Brilliant", "Great"]).map((stop) => {
    const m = moves[stop - 1];
    const side = sideOf(m);
    return { stop, side, classification: m.classification, label: `${m.move_number}${side === "white" ? "." : "..."} ${m.san}` };
  });
}
