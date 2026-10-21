// Judging a play-out exercise against the engine. Scores are from the
// player's perspective: positive = the player is better.

import type { PlayoutGoal } from "./exercises";

export interface PlayoutState {
  userMoves: number;
  maxMoves: number;
  /** Engine score of the current position for the player (null before the first evaluation). */
  score: { cp: number | null; mate: number | null } | null;
  /** How the game ended, if it did. */
  over: "won" | "lost" | "draw" | null;
  /** The player has promoted a pawn. */
  promoted: boolean;
}

export type Verdict = { done: false } | { done: true; success: boolean; text: string };

// A winning attempt fails once the advantage is below a pawn, a defense once
// the position is clearly lost; after the last move a win needs 2.5 pawns.
export const WIN_LOST_CP = 100;
export const WIN_KEPT_CP = 250;
export const HOLD_LOST_CP = -400;
export const PROMOTE_KEPT_CP = 300;

const MATE_CP = 100_000;

export function scoreCp(s: PlayoutState["score"]): number | null {
  if (!s) return null;
  if (s.mate !== null) return s.mate > 0 ? MATE_CP : -MATE_CP;
  return s.cp;
}

const pawns = (cp: number) => (Math.abs(cp) >= MATE_CP ? "Matt" : `${cp > 0 ? "+" : ""}${(cp / 100).toFixed(1).replace(".", ",")}`);

export function judgePlayout(goal: PlayoutGoal, s: PlayoutState): Verdict {
  if (s.over === "won") return { done: true, success: true, text: "Matt! Aufgabe gelöst." };
  if (s.over === "lost") return { done: true, success: false, text: "Du wurdest mattgesetzt." };
  if (s.over === "draw") {
    return goal === "hold"
      ? { done: true, success: true, text: "Remis gehalten. Stark verteidigt!" }
      : { done: true, success: false, text: "Remis – der Gewinn ist dir entglitten." };
  }
  const cp = scoreCp(s.score);
  if (goal === "promote" && s.promoted && cp !== null && cp >= PROMOTE_KEPT_CP) {
    return { done: true, success: true, text: "Umgewandelt und die neue Dame ist sicher. Aufgabe gelöst." };
  }
  if (goal !== "hold" && cp !== null && cp < WIN_LOST_CP) {
    return { done: true, success: false, text: `Der Vorteil ist weg (Bewertung ${pawns(cp)}).` };
  }
  if (goal === "hold" && cp !== null && cp <= HOLD_LOST_CP) {
    return { done: true, success: false, text: `Die Stellung ist jetzt verloren (Bewertung ${pawns(cp)}).` };
  }
  if (s.userMoves < s.maxMoves) return { done: false };
  switch (goal) {
    case "hold":
      return { done: true, success: true, text: `${s.maxMoves} Züge gehalten. Aufgabe gelöst.` };
    case "win":
      return cp !== null && cp >= WIN_KEPT_CP
        ? { done: true, success: true, text: `Vorteil sicher verwertet (Bewertung ${pawns(cp)}).` }
        : { done: true, success: false, text: `Nach ${s.maxMoves} Zügen reicht der Vorteil nicht mehr (Bewertung ${cp !== null ? pawns(cp) : "?"}).` };
    case "mate":
      return { done: true, success: false, text: `Nicht in ${s.maxMoves} Zügen mattgesetzt. Versuch es noch einmal.` };
    case "promote":
      return { done: true, success: false, text: `In ${s.maxMoves} Zügen keine sichere Umwandlung geschafft.` };
  }
}
