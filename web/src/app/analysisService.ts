// One Stockfish worker for the whole app plus a queue, so batch analysis and
// the open game never compete for the CPU (and the device stays cool).
import { analyzeGame, DEFAULT_SETTINGS, type AnalysisSettings } from "../domain/analyzer";
import { loadBookData } from "../domain/book";
import type { GameAnalysis } from "../domain/types";
import { createStockfishWorker, UciEngine } from "../engine/uci";
import { evalCache, getGame, getSetting, putGames } from "../storage/db";
import { fromStoredGame, toStoredGame } from "../storage/rows";

export type AnalysisStrength = "fast" | "normal" | "deep";

export const STRENGTHS: Record<AnalysisStrength, { label: string; settings: AnalysisSettings }> = {
  fast: { label: "Schnell (Tiefe 12)", settings: { depth: 12, movetimeMs: 400, multiPv: 2 } },
  normal: { label: "Normal (Tiefe 16)", settings: DEFAULT_SETTINGS },
  deep: { label: "Gründlich (Tiefe 20)", settings: { depth: 20, movetimeMs: 3000, multiPv: 2 } },
};

export interface QueueState {
  /** Game currently being analysed. */
  current: string | null;
  done: number;
  total: number;
  queued: string[];
  /** Live copy of the game in analysis, for the analysis view. */
  live: GameAnalysis | null;
  error: string | null;
}

let engine: UciEngine | null = null;
let state: QueueState = { current: null, done: 0, total: 0, queued: [], live: null, error: null };
let abort: AbortController | null = null;
let running = false;
const listeners = new Set<(s: QueueState) => void>();

function emit(patch: Partial<QueueState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
}

export function subscribeQueue(cb: (s: QueueState) => void): () => void {
  listeners.add(cb);
  cb(state);
  return () => listeners.delete(cb);
}

export function getEngine(): UciEngine {
  if (!engine) {
    engine = new UciEngine(createStockfishWorker());
    // Small hash keeps memory low on phones (thermal/memory safety like the desktop defaults).
    void engine.setOption("Hash", 32);
  }
  return engine;
}

/** Adds games to the queue (front = analyse next). */
export function enqueue(ids: string[], { front = false } = {}): void {
  const rest = state.queued.filter((id) => !ids.includes(id) && id !== state.current);
  const add = ids.filter((id) => id !== state.current);
  emit({ queued: front ? [...add, ...rest] : [...rest, ...add] });
  void pump();
}

export function cancelAll(): void {
  emit({ queued: [] });
  abort?.abort();
}

export function cancelCurrent(): void {
  abort?.abort();
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (state.queued.length) {
      const [id, ...rest] = state.queued;
      emit({ queued: rest, current: id, done: 0, total: 0, error: null });
      try {
        await analyseOne(id);
      } catch (e) {
        emit({ error: e instanceof Error ? e.message : String(e) });
      }
    }
  } finally {
    running = false;
    emit({ current: null, live: null });
  }
}

async function analyseOne(id: string): Promise<void> {
  const row = await getGame(id);
  if (!row) return;
  const game = fromStoredGame(row);
  const strength = await getSetting<AnalysisStrength>("analysis.strength", "normal");
  const book = await loadBookData();
  abort = new AbortController();
  emit({ live: game, total: game.moves.length });
  let lastSave = Date.now();
  await analyzeGame(game, getEngine(), {
    settings: STRENGTHS[strength]?.settings ?? DEFAULT_SETTINGS,
    book,
    cache: evalCache,
    signal: abort.signal,
    onProgress: (e) => {
      emit({ done: e.done, total: e.total, live: { ...game } });
      // Persist partial progress now and then so a closed tab resumes later.
      if (Date.now() - lastSave > 15000) {
        lastSave = Date.now();
        void putGames([toStoredGame({ ...game, summary: { analysis_status: "paused" } }, row.timestamp)], { silent: true });
      }
    },
  });
  await putGames([toStoredGame(game, row.timestamp)]);
  emit({ live: { ...game } });
}
