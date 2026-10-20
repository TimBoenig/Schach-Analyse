// Game termination classification (port of src/backend/analysis/metrics/termination.py).
// Determines termination type (Checkmate, Resignation, Time, Abandon, Draw) and the
// draw subcategory from termination_mode and word-boundary text patterns.

import { DRAW_MODE_TO_BUCKET } from "./constants";

// JS \b is ASCII-only, so German umlaut words use explicit lookarounds over letters.
const W = "A-Za-zÄÖÜäöüß0-9_";
const wb = (body: string) => new RegExp(`(?<![${W}])(?:${body})(?![${W}])`, "i");

const STALEMATE_PAT = wb("stalemate|patt");
const REPETITION_PAT = wb(`threefold|repetition|[${W}]*wiederholung`);
const INSUFFICIENT_PAT = wb(`insufficient|ungenügend[${W}]*`);
const TIME_PAT = wb(`time|timeout|clock|flag|flagged|zeit[${W}]*`);
const FIFTY_MOVES_PAT = new RegExp(`(?<![${W}])(?:50[- ]move|50-züge|fifty[- ]moves?|50(?![${W}]))`, "i");

const CHECKMATE_PAT = wb("checkmate|mate|schachmatt|matt");
const ABANDON_PAT = wb("abandon|abandoned|abandonment|abgebrochen");
const RESIGN_PAT = wb("resign|resigned|resignation|aufgabe");

export interface TerminationSource {
  termination?: string | null;
  termination_mode?: string | null;
  pgn?: string | null;
}

/** Classify game termination into [term_type, draw_type]. */
export function classifyTermination(
  game: TerminationSource,
  isDraw: boolean,
): [string, string | null] {
  const termMode = (game.termination_mode || "").trim().toLowerCase();
  const term = (game.termination || "").trim();

  if (isDraw) {
    if (termMode in DRAW_MODE_TO_BUCKET) return ["Draw", DRAW_MODE_TO_BUCKET[termMode]];
    if (REPETITION_PAT.test(term)) return ["Draw", "3-Fold Repetition"];
    if (STALEMATE_PAT.test(term)) return ["Draw", "Stalemate"];
    if (INSUFFICIENT_PAT.test(term) && TIME_PAT.test(term)) {
      return ["Draw", "Insufficient vs Timeout"];
    }
    if (INSUFFICIENT_PAT.test(term)) return ["Draw", "Insufficient Material"];
    if (FIFTY_MOVES_PAT.test(term)) return ["Draw", "50-Move Rule"];
    return ["Draw", "Agreement"];
  }

  if (termMode === "checkmate") return ["Checkmate", null];
  if (termMode === "timeout") return ["Time", null];
  if (termMode === "abandonment") return ["Abandon", null];
  if (termMode === "resignation") return ["Resignation", null];

  // Anchored pattern checks (ensure "mate" does not match "stalemate")
  if (CHECKMATE_PAT.test(term) && !STALEMATE_PAT.test(term)) return ["Checkmate", null];
  if (TIME_PAT.test(term)) return ["Time", null];
  if (ABANDON_PAT.test(term)) return ["Abandon", null];
  if (RESIGN_PAT.test(term)) return ["Resignation", null];

  if ((game.pgn || "").includes("#")) return ["Checkmate", null];
  return ["Resignation", null];
}
