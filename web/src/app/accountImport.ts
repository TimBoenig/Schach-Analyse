// Imports a player's games from chess.com or Lichess and remembers the name as
// one of "my" names, so the profile picks the games up. Shared by the import
// dialog and the landing page's guided start.
import { importChesscomGames, importLichessGames, type ImportResult } from "../api/import";
import type { GameAnalysis } from "../domain/types";
import { gameExists, getSetting, setSetting } from "../storage/db";
import { storeImported } from "../storage/rows";

export type Site = "chesscom" | "lichess";

export interface AccountImportOptions {
  /** chess.com: newest months to fetch (null = all). */
  months?: number | null;
  /** Lichess: newest games to fetch. */
  count?: number;
  signal?: AbortSignal;
  onProgress?: (label: string) => void;
  /** Every stored batch, e.g. to count games while they arrive. */
  onStored?: (games: GameAnalysis[]) => void;
}

export async function importAccount(
  site: Site,
  username: string,
  { months = 3, count = 100, signal, onProgress, onStored }: AccountImportOptions = {},
): Promise<{ result: ImportResult; games: GameAnalysis[] }> {
  const name = username.trim();
  const games: GameAnalysis[] = [];
  const opts = {
    signal,
    onProgress: (_c: number, _t: number, label: string) => onProgress?.(label),
    onBatch: async (batch: GameAnalysis[]) => {
      games.push(...batch);
      await storeImported(batch);
      onStored?.(batch);
    },
  };
  const result =
    site === "chesscom"
      ? (await importChesscomGames(name, gameExists, months, opts)).result
      : (await importLichessGames(name, gameExists, count, opts)).result;
  // Only a name that has games on the site is remembered for it: a typo, or the
  // other site's name, must not replace the account "Neueste holen" asks for.
  if (result.found > 0) {
    const last = await getSetting<Record<string, string>>("import.lastUser", {});
    await setSetting("import.lastUser", { ...last, [site]: name });
  }
  const names = await getSetting<string[]>("usernames", []);
  if (name && !names.some((n) => n.toLowerCase() === name.toLowerCase())) await setSetting("usernames", [...names, name]);
  return { result, games };
}
