// Keeps the opening names of analysed games in line with the opening book.
// Books before 2026-11 named in-between positions after the longest line passing
// through them (1. e4 c5 came out as a deep Sveshnikov sideline), and analysis
// copied those names into the games. Re-reading them is cheap (one lookup per
// book move, no engine), so it runs at every start and only writes what changed.
import { loadBookData, relabelBookMoves } from "../domain/book";
import { listGames, putGames } from "../storage/db";

/** Re-names the book moves of all analysed games; returns how many games changed. */
export async function repairOpeningNames(): Promise<number> {
  const data = await loadBookData();
  if (!Object.keys(data).length) return 0; // offline without a book: keep what is stored
  const changed = [];
  for (const row of await listGames()) {
    // Unfinished analyses are rewritten by the analysis itself.
    if (row.summary_json?.analysis_status !== "completed" || !Array.isArray(row.moves_json)) continue;
    const moves = row.moves_json.map((m) => ({ ...m }));
    const opening = relabelBookMoves(moves, data);
    if (opening) changed.push({ ...row, moves_json: moves, eco: opening.eco, opening: opening.name });
  }
  await putGames(changed);
  return changed.length;
}
