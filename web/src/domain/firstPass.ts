// A fresh import first gets a quick look at every game, so the profile fills
// within minutes instead of an hour, and only then a second, deeper pass at the
// user's own depth setting. Headless: the app layer runs the queue.
import type { AnalysisSettings } from "./analyzer";
import { DEPTH_PRESETS } from "./analysisDepth";

/** The quick first pass: the "Blitzschnell" preset (about 9 ms per position on a desktop core). */
export const QUICK_SETTINGS: AnalysisSettings = DEPTH_PRESETS.blitz.settings;

/** A deeper second pass only helps when the user's own setting looks deeper than the quick pass. */
export function needsDeeperPass(target: AnalysisSettings, quick: AnalysisSettings = QUICK_SETTINGS): boolean {
  return target.depth > quick.depth || target.movetimeMs > quick.movetimeMs;
}

export type Pass = "quick" | "deep" | "normal";

export interface BatchInput {
  /** Games finished since the queue last ran empty. */
  finished: number;
  current: string | null;
  queued: number;
  /** Moves done / total of the game in analysis. */
  done: number;
  total: number;
  /** Games waiting for the deeper second pass (not yet in the queue). */
  deeper: number;
}

export interface BatchProgress {
  /** 0..1 over the games of the running pass, including the current game's share. */
  fraction: number;
  /** 1-based number of the game in analysis (0 when idle). */
  index: number;
  games: number;
  deeper: number;
  idle: boolean;
}

/** Overall progress of the running batch, counted in games; the current game counts by its moves. */
export function batchProgress({ finished, current, queued, done, total, deeper }: BatchInput): BatchProgress {
  const games = finished + queued + (current ? 1 : 0);
  if (!games) return { fraction: 0, index: 0, games: 0, deeper, idle: true };
  const part = current && total > 0 ? Math.min(1, done / total) : 0;
  return {
    fraction: Math.min(1, (finished + part) / games),
    index: current ? finished + 1 : finished,
    games,
    deeper,
    idle: !current && queued === 0,
  };
}
