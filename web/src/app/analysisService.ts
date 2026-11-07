// Stockfish engines for the whole app plus a queue, so batch analysis and the
// open game never compete for the CPU. How many engines run side by side is a
// per-device performance setting (one by default on phones, to stay cool).
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
import { mergeQueue } from "../domain/analysisQueue";
import { analyzeGame, firstUnanalyzedIndex, type AnalysisSettings } from "../domain/analyzer";
import { loadBookData } from "../domain/book";
import { parsePlayedAt } from "../domain/metrics/played";
import {
  normalizePerfChoice,
  resolvePerf,
  type DeviceInfo,
  type PerfChoice,
  type PerfSettings,
} from "../domain/performance";
import type { GameAnalysis } from "../domain/types";
import { EnginePool } from "../engine/pool";
import { createStockfishWorker, EngineFailure, UciEngine } from "../engine/uci";
import { evalCache, getGame, getSetting, onDataChanged, putGames, setSetting } from "../storage/db";
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

function saveSpeed(s: AnalysisSettings, positions: number, ms: number, engines: number): void {
  try {
    localStorage.setItem(SPEED_KEY, JSON.stringify(recordSpeed(loadSpeedLog(), s, positions, ms, engines)));
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
  /** Limits in use for the current game right now (they follow setting changes). */
  settings: AnalysisSettings | null;
  /** Whose depth setting the current game follows; null = fixed limits (deeper re-run). */
  scope: DepthScope | null;
  /** Engines searching in parallel. */
  engines: number;
}

let state: QueueState = {
  current: null,
  done: 0,
  total: 0,
  queued: [],
  live: null,
  error: null,
  settings: null,
  scope: null,
  engines: 1,
};
// Explicitly requested games still waiting; they stay ahead of the background queue.
let priority = new Set<string>();
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
  if (open.length) await enqueue(open);
  else rememberQueue();
  return open.length;
}

export function subscribeQueue(cb: (s: QueueState) => void): () => void {
  listeners.add(cb);
  cb(state);
  return () => listeners.delete(cb);
}

// ---- performance (per device, not synced: a phone and a PC differ a lot) ----

const PERF_KEY = "schach.analysis.performance";

export function deviceInfo(): DeviceInfo {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  // iPadOS reports itself as a Mac; touch points give it away.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
  return { cores, mobile: coarse || ios || /Android/.test(ua) };
}

export function loadPerfChoice(): PerfChoice {
  let raw: unknown = null;
  try {
    raw = JSON.parse(localStorage.getItem(PERF_KEY) || "null");
  } catch {
    // Private mode: device default.
  }
  return normalizePerfChoice(raw, deviceInfo());
}

export function currentPerf(): PerfSettings {
  return resolvePerf(loadPerfChoice(), deviceInfo());
}

const pool = new EnginePool(() => new UciEngine(createStockfishWorker()));
pool.configure(currentPerf());

/** Saves the performance choice and applies it at once, also to a running analysis. */
export function setPerfChoice(choice: PerfChoice): PerfSettings {
  const c = normalizePerfChoice(choice, deviceInfo());
  try {
    localStorage.setItem(PERF_KEY, JSON.stringify(c));
  } catch {
    // Not remembered, but still applied for this session.
  }
  const perf = resolvePerf(c, deviceInfo());
  pool.configure(perf);
  emit({ engines: perf.engines });
  return perf;
}

// ---- depth, kept current so a running analysis picks up changes ----

const liveDepth: Record<DepthScope, AnalysisSettings> = {
  own: resolveSettings(DEFAULT_CHOICES.own),
  friends: resolveSettings(DEFAULT_CHOICES.friends),
};
let depthLoaded: Promise<void> | null = null;

function refreshDepth(): Promise<void> {
  depthLoaded = (async () => {
    for (const scope of ["own", "friends"] as const) liveDepth[scope] = resolveSettings(await loadDepthChoice(scope));
  })().catch(() => undefined);
  return depthLoaded;
}

if (typeof window !== "undefined") {
  // Settings changes (also from another device via sync) fire a data change.
  onDataChanged(() => void refreshDepth());
}

/**
 * Changes the depth for own games or friends' games. A game in analysis
 * continues with the new limits from its next position on.
 */
export async function setDepthChoice(scope: DepthScope, choice: DepthChoice): Promise<DepthChoice> {
  const c = normalizeChoice(choice, scope);
  liveDepth[scope] = resolveSettings(c);
  if (state.scope === scope) emit({ settings: liveDepth[scope] });
  await setSetting(DEPTH_KEYS[scope], c);
  return c;
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
  await enqueue(pick);
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

// Played date per game, for the newest-first order (read once per game).
const playedAt = new Map<string, number | null>();

/**
 * Adds games to the queue: `front` = analyse next, otherwise the newest played
 * games run first. Returns once the games are in the queue.
 */
export async function enqueue(ids: string[], { front = false, settings, restart }: EnqueueOptions = {}): Promise<void> {
  if (settings || restart) for (const id of ids) overrides.set(id, { settings, restart });
  const unknown = ids.filter((id) => !playedAt.has(id));
  const rows = await Promise.all(unknown.map((id) => getGame(id)));
  unknown.forEach((id, i) => playedAt.set(id, rows[i] ? parsePlayedAt(rows[i]!) : null));
  // Read the queue only now: another enqueue may have changed it meanwhile.
  const next = mergeQueue({ queued: state.queued, add: ids, front, priority, playedAt: (id) => playedAt.get(id), current: state.current });
  priority = next.priority;
  emit({ queued: next.queued });
  void pump();
}

// Aborting alone would let the running searches finish (up to 8 s each at
// "Maximal"); stopping them makes a cancel take effect at once.
function abortRunning(): void {
  abort?.abort();
  pool.stopSearches();
}

export function cancelAll(): void {
  priority = new Set();
  emit({ queued: [] });
  abortRunning();
}

export function cancelCurrent(): void {
  abortRunning();
}

/** Takes one game out of the analysis: stops it if it runs, else drops it from the queue. */
export function cancelGame(id: string): void {
  priority.delete(id);
  if (state.queued.includes(id)) emit({ queued: state.queued.filter((q) => q !== id) });
  if (state.current === id) abortRunning();
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
      priority.delete(id);
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
    emit({ current: null, live: null, settings: null, scope: null });
  }
}

async function analyseOne(id: string): Promise<void> {
  const row = await getGame(id);
  const override = overrides.get(id);
  overrides.delete(id);
  if (!row) return;
  const game = fromStoredGame(row);
  await (depthLoaded ?? refreshDepth());
  // A deeper re-run keeps its fixed limits; otherwise the game follows the
  // own/friends depth setting live, position by position.
  const scope = override?.settings ? null : scopeOf(row, await getSetting<string[]>("usernames", []));
  const settingsNow = (): AnalysisSettings => (scope ? liveDepth[scope] : override!.settings!);
  const first = settingsNow();
  let changed = false;
  const restart = Boolean(override?.restart);
  const book = await loadBookData();
  abort = new AbortController();
  emit({ live: game, total: game.moves.length, settings: first, scope, engines: pool.capacity });
  const from = restart ? 0 : firstUnanalyzedIndex(game);
  const started = Date.now();
  const enginesAtStart = pool.capacity;
  let lastSave = Date.now();
  const savePartial = () =>
    putGames([toStoredGame({ ...game, summary: { analysis_status: "paused" } }, row.timestamp)], { silent: true });
  let summary;
  try {
    summary = await analyzeGame(game, pool, {
      settings: () => {
        const s = settingsNow();
        if (s !== state.settings) emit({ settings: s });
        if (s !== first) changed = true;
        return s;
      },
      concurrency: () => pool.capacity,
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
  // Only clean runs teach the speed estimate: mixed limits or engine counts would skew it.
  if (!changed && pool.capacity === enginesAtStart) {
    saveSpeed(first, (summary.analyzed_moves ?? 0) - from, Date.now() - started, enginesAtStart);
  }
  await putGames([toStoredGame(game, row.timestamp)]);
  emit({ live: { ...game } });
}
