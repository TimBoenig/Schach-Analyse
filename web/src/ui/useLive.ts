import { useEffect, useState } from "preact/hooks";

import { judgeTried, positionLines } from "../app/liveEval";
import type { MoveData, PvLine } from "../domain/types";

/** Live engine lines for a position the player reached; empty while `fen` is null. */
export function usePositionLines(fen: string | null, multiPv = 2): { lines: PvLine[]; busy: boolean } {
  const [state, setState] = useState<{ fen: string | null; lines: PvLine[] }>({ fen: null, lines: [] });
  useEffect(() => {
    if (!fen) return;
    let alive = true;
    // Short delay so stepping through a line quickly doesn't queue a search per move.
    const t = window.setTimeout(() => {
      void positionLines(fen, multiPv).then((lines) => alive && setState({ fen, lines }));
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [fen, multiPv]);
  const current = fen !== null && state.fen === fen;
  return { lines: current ? state.lines : [], busy: fen !== null && !current };
}

export interface TriedMove {
  fenBefore: string;
  uci: string;
  fenAfter: string;
}

/** Classification of each tried move; undefined while the engine still thinks. */
export function useVerdicts(steps: TriedMove[]): (MoveData | null | undefined)[] {
  const [done, setDone] = useState<Record<string, MoveData | null>>({});
  const key = steps.map((s) => `${s.fenBefore}|${s.uci}`).join(",");
  useEffect(() => {
    let alive = true;
    // Judge the newest move first: that is the one the player is looking at.
    for (const s of [...steps].reverse()) {
      const k = `${s.fenBefore}|${s.uci}`;
      if (k in done) continue;
      void judgeTried(s.fenBefore, s.uci, s.fenAfter).then((m) => alive && setDone((d) => ({ ...d, [k]: m })));
    }
    return () => {
      alive = false;
    };
  }, [key]);
  return steps.map((s) => done[`${s.fenBefore}|${s.uci}`]);
}
