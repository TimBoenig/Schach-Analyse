// Engine opponent for play-out exercises. It runs in its own worker so a
// batch analysis in the background never makes the opponent wait (and the
// analysis queue keeps its own hash table).
import { createStockfishWorker, UciEngine } from "../engine/uci";

let engine: UciEngine | null = null;

export function getTrainingEngine(): UciEngine {
  if (!engine) {
    engine = new UciEngine(createStockfishWorker());
    void engine.setOption("Hash", 16);
  }
  return engine;
}

/** Engine reply and its score from the side to move (centipawns or mate in n). */
export async function engineMove(fen: string, movetimeMs = 600): Promise<{ uci: string; cp: number | null; mate: number | null } | null> {
  const lines = await getTrainingEngine().analyse(fen, { movetimeMs, multiPv: 1 });
  const best = lines[0];
  if (!best?.pv.length) return null;
  return { uci: best.pv[0], cp: best.cp, mate: best.mate };
}
