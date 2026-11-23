// Concrete reasons for a stored game move, shared by the analysis board and
// Lucena's game story: what the move does, stops or allows.
import { type Explanation, explainMoveDetailed } from "./explain";
import type { MoveData } from "./types";

const explanations = new Map<string, Explanation>();

/** Concrete reasons for a stored game move: what it does, stops or allows. */
export function explainStored(move: MoveData, next: MoveData | undefined, previous: MoveData | undefined): Explanation {
  const input = {
    fenBefore: move.fen_before,
    uci: move.uci,
    bestPv: move.multi_pvs[0]?.pv ?? move.pv,
    replyPv: next?.multi_pvs[0]?.pv ?? [],
    mateBefore: move.eval_before_mate,
    mateAfter: move.eval_after_mate,
    classification: move.classification,
    previousMove: previous ? { uci: previous.uci, san: previous.san } : undefined,
  };
  const key = `${previous?.uci ?? ""}|${input.fenBefore}|${input.uci}|${input.classification}|${input.bestPv.slice(0, 6).join(" ")}|${input.replyPv.slice(0, 8).join(" ")}`;
  let hit = explanations.get(key);
  if (!hit) {
    hit = explainMoveDetailed(input);
    if (explanations.size > 500) explanations.delete(explanations.keys().next().value as string);
    explanations.set(key, hit);
  }
  return hit;
}
