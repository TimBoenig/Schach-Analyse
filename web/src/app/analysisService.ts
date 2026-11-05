// One Stockfish worker for the whole app plus a queue, so batch analysis and
// the open game never compete for the CPU (and the device stays cool).
import {
  DEFAULT_CHOICES,
  DEPTH_KEYS,
  isBulletGame,
  normalizeChoice,
  recordSpeed,
  resolveSettings,
  scopeOf,
  SKIP_BULLET_KEY,
  type DepthChoice,
  type DepthScope,
  type SpeedLog,
} from "../domain/analysisDepth";
import { analyzeGame, firstUnanalyzedIndex, type AnalysisSettings } from "../domain/analyzer";
import { loadBookData } from "../domain/book";
import type { GameAnalysis } from "../domain/types";
import { createStockfishWorker, EngineFailure, UciEngine } from "../engine/uci";
import { evalCache, getGame, getSetting, putGames } from "../storage/db";
import { fromStoredGame, toStoredGame } from "../storage/rows";

/** Depth choice for own games or friends' games (older versions stored a bare preset name). */
export async function loadDepthChoice(scope: DepthScope): Promise<DepthChoice> {
  return normalizeChoice(await getSetting<unknown>(DEPTH_KEYS[scope], DEFAULT_CHOICES[scope]), scope);
}

// Measured speed stays on this device: a phone and a PC differ a lot.
const SPEED_KEY = "schach.analysis.speed";

export function loadSpeedLog(): SpeedLog {
  try {
    return JSON.parse(localStorage.getItem(SPEED_KEY) || "{}") as SpeedLog;
  } catch {
    return {};
  }
}

function saveSpeed(s: AnalysisSettings, positions: number, ms: number): void {
  try {
    localStorage.setItem(SPEED_KEY, JSON.stringify(recordSpeed(loadSpeedLog(), s, positions, ms)));
  } catch {
    // Private mode or full storage: the estimate falls back to the upper bound.
  }
}

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

// The queue outlives a reload or a closed tab (iOS discards background PWAs
// often): open games are remembered on this device and resumed on the next start.
const QUEUE_KEY = "schach.analysis.queue";

function rememberQueue(): void {
  try {
    const ids = [...(state.current ? [state.current] : []), ...state.queued];
    if (ids.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(ids));
    else localStorage.removeItem(QUEUE_KEY);
  } catch {
    // Private mode: nothing to resume later, analysis still runs now.
  }
}

function emit(patch: Partial<QueueState>): void {
  state = { ...state, ...patch };
  if ("queued" in patch || "current" in patch) rememberQueue();
  for (const l of listeners) l(state);
}

/** Re-queues games whose analysis was still open when the app was closed. */
export async function resumeQueue(): Promise<number> {
  let ids: string[] = [];
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    if (Array.isArray(raw)) ids = raw.filter((x): x is string => typeof x === "string");
  } catch {
    return 0;
  }
  const rows = await Promise.all(ids.map((id) => getGame(id)));
  const open = ids.filter((_, i) => rows[i] && rows[i]!.summary_json?.analysis_status !== "completed");
  if (open.length) enqueue(open);
  else rememberQueue();
  return open.length;
}

export function subscribeQueue(cb: (s: QueueState) => void): () => void {
  listeners.add(cb);
  cb(state);
  return () => listeners.delete(cb);
}

export function getEngine(): UciEngine {
  // A crashed or hung worker is replaced by a fresh one.
  if (engine?.broken) {
    engine.quit();
    engine = null;
  }
  if (!engine) {
    engine = new UciEngine(createStockfishWorker());
    // Small hash keeps memory low on phones (thermal/memory safety like the desktop defaults).
    void engine.setOption("Hash", 32);
  }
  return engine;
}

/** Setting key: analyse freshly imported games without asking (on by default). */
export const AUTO_ANALYZE_KEY = "analysis.auto";

/**
 * Queues freshly imported games when automatic analysis is on; returns whether it did.
 * Bullet games stay out when the user chose to skip them.
 */
export async function autoAnalyze(ids: string[]): Promise<boolean> {
  if (!ids.length || !(await getSetting<boolean>(AUTO_ANALYZE_KEY, true))) return false;
  let pick = ids;
  if (await getSetting<boolean>(SKIP_BULLET_KEY, false)) {
    const rows = await Promise.all(ids.map((id) => getGame(id)));
    pick = ids.filter((_, i) => rows[i] && !isBulletGame(rows[i]!));
  }
  if (!pick.length) return false;
  enqueue(pick);
  return true;
}

export interface EnqueueOptions {
  /** Analyse next instead of last. */
  front?: boolean;
  /** Engine limits for these games instead of the own/friends setting. */
  settings?: AnalysisSettings;
  /** Start over instead of resuming (e.g. to re-analyse deeper). */
  restart?: boolean;
}

// Per-game overrides (re-analysis with other limits), used once.
const overrides = new Map<string, { settings?: AnalysisSettings; restart?: boolean }>();

/** Adds games to the queue (front = analyse next). */
export function enqueue(ids: string[], { front = false, settings, restart }: EnqueueOptions = {}): void {
  if (settings || restart) for (const id of ids) overrides.set(id, { settings, restart });
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

// Keeps the screen on during batch analysis: iOS pauses the engine worker when
// the display locks. Not every browser supports it, so failures are ignored.
let wakeLock: { release: () => Promise<void> } | null = null;

async function holdWakeLock(on: boolean): Promise<void> {
  const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
  try {
    if (on && !wakeLock && nav.wakeLock && document.visibilityState === "visible") wakeLock = await nav.wakeLock.request("screen");
    if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}

if (typeof document !== "undefined") {
  // The lock is dropped when the page is hidden; take it again on return.
  document.addEventListener("visibilitychange", () => {
    if (running) {
      wakeLock = null;
      void holdWakeLock(true);
    }
  });
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  void holdWakeLock(true);
  try {
    while (state.queued.length) {
      const [id, ...rest] = state.queued;
      emit({ queued: rest, current: id, done: 0, total: 0, error: null });
      try {
        await analyseOne(id);
      } catch (e) {
        if (e instanceof EngineFailure) {
          // Typical on phones: the WASM worker dies (memory) or stalls in a
          // background tab. Start a new engine and resume the game once;
          // finished moves were saved, so it continues where it stopped.
          try {
            await analyseOne(id);
            continue;
          } catch (again) {
            e = again;
          }
        }
        emit({ error: e instanceof Error ? e.message : String(e) });
      }
    }
  } finally {
    running = false;
    void holdWakeLock(false);
    emit({ current: null, live: null });
  }
}

/** Limits for one game: an override, else the own or friends setting. */
async function settingsFor(row: { white: string; black: string }, override?: AnalysisSettings): Promise<AnalysisSettings> {
  if (override) return override;
  const names = await getSetting<string[]>("usernames", []);
  return resolveSettings(await loadDepthChoice(scopeOf(row, names)));
}

async function analyseOne(id: string): Promise<void> {
  const row = await getGame(id);
  const override = overrides.get(id);
  overrides.delete(id);
  if (!row) return;
  const game = fromStoredGame(row);
  const settings = await settingsFor(row, override?.settings);
  const restart = Boolean(override?.restart);
  const book = await loadBookData();
  abort = new AbortController();
  emit({ live: game, total: game.moves.length });
  const from = restart ? 0 : firstUnanalyzedIndex(game);
  const started = Date.now();
  let lastSave = Date.now();
  const savePartial = () =>
    putGames([toStoredGame({ ...game, summary: { analysis_status: "paused" } }, row.timestamp)], { silent: true });
  let summary;
  try {
    summary = await analyzeGame(game, getEngine(), {
      settings,
      restart,
      book,
      cache: evalCache,
      signal: abort.signal,
      onProgress: (e) => {
        emit({ done: e.done, total: e.total, live: { ...game } });
        // Persist partial progress now and then so a closed tab resumes later.
        if (Date.now() - lastSave > 15000) {
          lastSave = Date.now();
          void savePartial();
        }
      },
    });
  } catch (e) {
    // Keep what was analysed so a retry (or the next visit) resumes from here.
    if (game.moves.some((m) => m.classification)) await savePartial().catch(() => undefined);
    throw e;
  }
  saveSpeed(settings, (summary.analyzed_moves ?? 0) - from, Date.now() - started);
  // Remembered so the game can show its depth and offer a deeper re-run.
  game.summary.analysis_depth = settings.depth;
  game.summary.analysis_movetime_ms = settings.movetimeMs;
  await putGames([toStoredGame(game, row.timestamp)]);
  emit({ live: { ...game } });
}
