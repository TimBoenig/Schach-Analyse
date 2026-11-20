// Judging a play-out exercise against the engine. Scores are from the
// player's perspective: positive = the player is better.

import type { PlayoutGoal } from "./exercises";
import { t } from "../../i18n";

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

const pawns = (cp: number) => (Math.abs(cp) >= MATE_CP ? t("Matt") : `${cp > 0 ? "+" : ""}${(cp / 100).toFixed(1).replace(".", ",")}`);

export function judgePlayout(goal: PlayoutGoal, s: PlayoutState): Verdict {
  if (s.over === "won") return { done: true, success: true, text: t("Matt! Aufgabe gelöst.") };
  if (s.over === "lost") return { done: true, success: false, text: t("Du wurdest mattgesetzt.") };
  if (s.over === "draw") {
    return goal === "hold"
      ? { done: true, success: true, text: t("Remis gehalten. Stark verteidigt!") }
      : { done: true, success: false, text: t("Remis – der Gewinn ist dir entglitten.") };
  }
  const cp = scoreCp(s.score);
  if (goal === "promote" && s.promoted && cp !== null && cp >= PROMOTE_KEPT_CP) {
    return { done: true, success: true, text: t("Umgewandelt und die neue Dame ist sicher. Aufgabe gelöst.") };
  }
  if (goal !== "hold" && cp !== null && cp < WIN_LOST_CP) {
    return { done: true, success: false, text: t("Der Vorteil ist weg (Bewertung {pawns}).", { pawns: pawns(cp) }) };
  }
  if (goal === "hold" && cp !== null && cp <= HOLD_LOST_CP) {
    return { done: true, success: false, text: t("Die Stellung ist jetzt verloren (Bewertung {pawns}).", { pawns: pawns(cp) }) };
  }
  if (s.userMoves < s.maxMoves) return { done: false };
  switch (goal) {
    case "hold":
      return { done: true, success: true, text: t("{maxMoves} Züge gehalten. Aufgabe gelöst.", { maxMoves: s.maxMoves }) };
    case "win":
      return cp !== null && cp >= WIN_KEPT_CP
        ? { done: true, success: true, text: t("Vorteil sicher verwertet (Bewertung {pawns}).", { pawns: pawns(cp) }) }
        : { done: true, success: false, text: t("Nach {maxMoves} Zügen reicht der Vorteil nicht mehr (Bewertung {1}).", { maxMoves: s.maxMoves, 1: cp !== null ? pawns(cp) : "?" }) };
    case "mate":
      return { done: true, success: false, text: t("Nicht in {maxMoves} Zügen mattgesetzt. Versuch es noch einmal.", { maxMoves: s.maxMoves }) };
    case "promote":
      return { done: true, success: false, text: t("In {maxMoves} Zügen keine sichere Umwandlung geschafft.", { maxMoves: s.maxMoves }) };
  }
}
