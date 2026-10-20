// Port of the import half of src/backend/services/game_import_service.py.
// Storage stays with the caller: `exists` reports already stored ids and
// `onBatch` (optional) receives each archive's new games so a cancelled
// import keeps everything fetched so far, as in the desktop app.

import { type SkippedGame, parsePgnTextDetailed } from "../domain/pgn";
import type { GameAnalysis, GameSummary } from "../domain/types";
import { getArchiveGames, getArchiveUrls } from "./chesscom";
import { LichessAPI } from "./lichess";

export interface ImportResult {
  found: number;
  imported: number;
  already_known: number;
  /** Games the web app cannot analyze (Chess960, variants). */
  skipped: SkippedGame[];
}

export interface ImportBatch {
  result: ImportResult;
  /** New games (not yet stored), in PGN order. */
  games: GameAnalysis[];
}

export type ExistsFn = (gameId: string) => Promise<boolean> | boolean;
export type ProgressFn = (current: number, total: number, label: string) => void;
export type BatchFn = (games: GameAnalysis[]) => Promise<void> | void;

export interface RemoteImportOptions {
  onProgress?: ProgressFn;
  onBatch?: BatchFn;
  /** Stops after the current archive; already fetched games are kept. */
  signal?: AbortSignal;
}

const emptyResult = (): ImportResult => ({ found: 0, imported: 0, already_known: 0, skipped: [] });

function addResult(total: ImportResult, part: ImportResult): void {
  total.found += part.found;
  total.imported += part.imported;
  total.already_known += part.already_known;
  total.skipped.push(...part.skipped);
}

/**
 * Parses a PGN (one or many games) and returns the games that are not stored
 * yet. Deterministic MD5 ids make re-imports no-ops; `seen` also dedupes
 * repeats within one import run.
 */
export async function importPgnText(
  text: string,
  exists: ExistsFn,
  source?: string | null,
  seen: Set<string> = new Set(),
): Promise<ImportBatch> {
  const { games, skipped } = parsePgnTextDetailed(text || "");
  const result: ImportResult = { ...emptyResult(), found: games.length, skipped };
  const fresh: GameAnalysis[] = [];
  for (const g of games) {
    if (seen.has(g.game_id) || (await exists(g.game_id))) {
      result.already_known += 1;
      continue;
    }
    if (source) g.metadata.source = source;
    seen.add(g.game_id);
    fresh.push(g);
  }
  result.imported = fresh.length;
  return { result, games: fresh };
}

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (err instanceof DOMException && err.name === "AbortError");
}

/**
 * Imports a chess.com player's games from the last `months` monthly archives
 * (all when months is null). Newest months first, so a cancelled import still
 * holds the most relevant games.
 */
export async function importChesscomGames(
  username: string,
  exists: ExistsFn,
  months: number | null = 6,
  options: RemoteImportOptions = {},
): Promise<ImportBatch> {
  const { onProgress, onBatch, signal } = options;
  const total = emptyResult();
  const all: GameAnalysis[] = [];
  const seen = new Set<string>();
  try {
    let archives = await getArchiveUrls(username, { signal });
    if (months !== null && months > 0) archives = archives.slice(-months);
    archives = [...archives].reverse();
    for (let i = 0; i < archives.length; i++) {
      if (signal?.aborted) break;
      const url = archives[i];
      const month = url.replace(/\/+$/, "").split("/").slice(-2).join("/");
      onProgress?.(i + 1, archives.length, `Lade Partien ${month} …`);
      const games = await getArchiveGames(url, { signal });
      // Bughouse, crazyhouse etc. cannot be analyzed by Stockfish.
      const playable = games
        .filter((g) => ["chess", "chess960"].includes(g.rules ?? "chess"))
        .map((g) => g.pgn as string);
      const part = await importPgnText(playable.join("\n\n"), exists, "chesscom", seen);
      addResult(total, part.result);
      all.push(...part.games);
      if (part.games.length) await onBatch?.(part.games);
    }
  } catch (err) {
    if (!isAbort(err, signal)) throw err;
  }
  return { result: total, games: all };
}

/** Imports a lichess player's last `maxGames` games (one request, NDJSON stream). */
export async function importLichessGames(
  username: string,
  exists: ExistsFn,
  maxGames = 100,
  options: RemoteImportOptions & { token?: string | null } = {},
): Promise<ImportBatch> {
  const { onProgress, onBatch, signal, token } = options;
  try {
    onProgress?.(1, 1, `Lade Partien von ${username} …`);
    const games = await new LichessAPI({ token }).getUserGames(username, maxGames, { signal });
    const batch = await importPgnText(games.map((g) => g.pgn).filter(Boolean).join("\n\n"), exists, "lichess");
    if (batch.games.length) await onBatch?.(batch.games);
    return batch;
  } catch (err) {
    if (!isAbort(err, signal)) throw err;
    return { result: emptyResult(), games: [] };
  }
}

/** True while a stored game still needs (or needs to finish) engine analysis. */
export function isPendingAnalysis(summary: GameSummary | string | null | undefined): boolean {
  if (!summary) return true;
  let parsed: GameSummary;
  if (typeof summary === "string") {
    try {
      parsed = JSON.parse(summary) as GameSummary;
    } catch {
      return true;
    }
  } else parsed = summary;
  return parsed?.analysis_status !== "completed";
}
