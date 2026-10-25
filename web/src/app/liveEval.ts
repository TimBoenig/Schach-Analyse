// Live engine evaluation for positions the player sets up or tries on the board.
// Runs on the training engine's worker, so a batch analysis in the background
// (for example right after an import) never delays the answer.
import { pvToSan } from "../domain/analyzer";
import { explainMove } from "../domain/explain";
import { judgeMove, terminalScore, whiteScore } from "../domain/live";
import type { MoveData, PvLine } from "../domain/types";
import { getTrainingEngine } from "./trainingEngine";

export const LIVE_LIMITS = { depth: 16, movetimeMs: 1000, multiPv: 2 };

const lines = new Map<string, Promise<PvLine[]>>();
const verdicts = new Map<string, Promise<MoveData | null>>();
// Bounded so a long session of free play does not grow memory without end.
const MAX_CACHE = 400;

function remember<T>(map: Map<string, T>, key: string, value: T): T {
  if (map.size >= MAX_CACHE) map.delete(map.keys().next().value as string);
  map.set(key, value);
  return value;
}

/** Engine lines (side-to-move scores, SAN filled in) for a position, cached per FEN. */
export function positionLines(fen: string, multiPv = LIVE_LIMITS.multiPv): Promise<PvLine[]> {
  const key = `${fen}|${multiPv}`;
  const hit = lines.get(key);
  if (hit) return hit;
  const p = getTrainingEngine()
    .analyse(fen, { ...LIVE_LIMITS, multiPv })
    .then((res) => res.map((l) => ({ ...l, pv_san: pvToSan(fen, l.pv) })))
    .catch(() => {
      lines.delete(key);
      return [] as PvLine[];
    });
  return remember(lines, key, p);
}

/** Classifies a move tried in `fenBefore` (cached), e.g. "Exzellent" or "Fehler". */
export function judgeTried(fenBefore: string, uci: string, fenAfter: string): Promise<MoveData | null> {
  const key = `${fenBefore}|${uci}`;
  const hit = verdicts.get(key);
  if (hit) return hit;
  const p = (async () => {
    const parent = await positionLines(fenBefore);
    if (!parent.length) return null;
    const child = terminalScore(fenAfter) ? [] : await positionLines(fenAfter);
    const after = terminalScore(fenAfter) ?? whiteScore(fenAfter, child[0]);
    const move = after ? judgeMove(fenBefore, uci, parent, after) : null;
    if (!move) return null;
    // Concrete reasons (fork, hanging piece, mate) instead of a bare percentage.
    const reasons = explainMove({
      fenBefore,
      uci,
      bestPv: parent[0]?.pv ?? [],
      replyPv: child[0]?.pv ?? [],
      mateBefore: move.eval_before_mate,
      mateAfter: move.eval_after_mate,
    });
    if (reasons.length) move.explanation = reasons.join(" ");
    return move;
  })();
  return remember(verdicts, key, p);
}
