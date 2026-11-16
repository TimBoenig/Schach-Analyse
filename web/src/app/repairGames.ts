// Puts stored games right that an earlier version of the app filed wrongly.
// Both checks are cheap (no engine, one pass over the games), so they run at
// every start and only write what changed; games arriving from another device
// through the cloud are covered the same way.
//
// 1. Rating pool. Every unknown time control used to count as "Blitz" and the
//    platforms' own limits were ignored (see domain/metrics/speed.ts), so
//    foreign ratings sat in the Blitz and Classical lines.
// 2. Double records. The same platform game stored under two ids (see
//    domain/gameKey.ts) counted twice everywhere.
import { duplicateGameIds } from "../domain/gameKey";
import { detectSpeedCategory } from "../domain/metrics/speed";
import { analyzeGameTactics } from "../domain/tactics";
import type { GameSummary, StoredGame } from "../domain/types";
import { deleteGames, listGames, putGames } from "../storage/db";

export interface RepairResult {
  /** Games moved to another rating pool. */
  refiled: number;
  /** Redundant copies removed. */
  duplicates: number;
}

/** The game with its pool corrected (and the clock-dependent tactics recomputed), or null when it is right. */
export function refiledGame(row: StoredGame): StoredGame | null {
  if (row.chess960) return null;
  const speed = detectSpeedCategory(row.time_control, row.event, row.source);
  if (speed === row.speed_category) return null;
  const fixed: StoredGame = { ...row, speed_category: speed };
  const analysed = Array.isArray(row.moves_json) && row.moves_json.some((m) => m.classification);
  if (analysed) {
    // Time-trouble thresholds depend on the pool.
    const summary: GameSummary = { ...(row.summary_json ?? {}) };
    for (const side of ["white", "black"] as const) {
      if (!summary[side]) continue;
      summary[side] = { ...summary[side]!, tactics: analyzeGameTactics(row.moves_json, side, row.result, speed) };
    }
    fixed.summary_json = summary;
  }
  return fixed;
}

export async function repairGames(): Promise<RepairResult> {
  const games = await listGames();
  const refiled = games.map(refiledGame).filter((g): g is StoredGame => g !== null);
  await putGames(refiled);
  const duplicates = duplicateGameIds(await listGames());
  await deleteGames(duplicates);
  return { refiled: refiled.length, duplicates: duplicates.length };
}
