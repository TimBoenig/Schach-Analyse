// Tracked players (opponents and friends): the synced `players` setting and
// loading their games. Their games go into the normal game store; unlike the
// regular import, their usernames are never added to the user's own names.
import { importChesscomGames, importLichessGames, type ImportResult } from "../api/import";
import { getUserColor } from "../domain/metrics";
import { parsePlayers, playerId, playerUsernames, type PlayerAccount, type TrackedPlayer } from "../domain/players";
import type { GameAnalysis } from "../domain/types";
import { deleteGame, gameExists, getSetting, listGames, setSetting } from "../storage/db";
import { storeImported } from "../storage/rows";

export const PLAYERS_KEY = "players";

export async function loadPlayers(): Promise<TrackedPlayer[]> {
  return parsePlayers(await getSetting<unknown>(PLAYERS_KEY, []));
}

async function save(list: TrackedPlayer[]): Promise<void> {
  await setSetting(PLAYERS_KEY, list);
}

export async function addPlayer(input: { name?: string; accounts: PlayerAccount[]; friend: boolean }): Promise<TrackedPlayer> {
  const list = await loadPlayers();
  const accounts = input.accounts.map((a) => ({ ...a, username: a.username.trim() })).filter((a) => a.username);
  if (!accounts.length) throw new Error("Bitte einen Benutzernamen eingeben.");
  const lower = new Set(accounts.map((a) => a.username.toLowerCase()));
  const existing = list.find((p) => playerUsernames(p).some((u) => lower.has(u.toLowerCase())));
  if (existing) {
    // Same person again: merge accounts and keep the stronger relationship.
    const merged = { ...existing, friend: existing.friend || input.friend, accounts: mergeAccounts(existing.accounts, accounts) };
    await save(list.map((p) => (p.id === existing.id ? merged : p)));
    return merged;
  }
  const player: TrackedPlayer = {
    id: playerId(accounts[0].username, list.map((p) => p.id)),
    name: input.name?.trim() || accounts[0].username,
    accounts,
    friend: input.friend,
    added_at: Date.now(),
    imported_at: null,
  };
  await save([...list, player]);
  return player;
}

function mergeAccounts(a: PlayerAccount[], b: PlayerAccount[]): PlayerAccount[] {
  const out = [...a];
  for (const acc of b) {
    if (!out.some((x) => x.source === acc.source && x.username.toLowerCase() === acc.username.toLowerCase())) out.push(acc);
  }
  return out;
}

export async function updatePlayer(id: string, patch: Partial<Omit<TrackedPlayer, "id">>): Promise<void> {
  const list = await loadPlayers();
  await save(list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
}

/**
 * Stops tracking a player. With `deleteGames`, also removes their games that
 * involve neither the user nor another tracked player.
 */
export async function removePlayer(id: string, { deleteGames = false } = {}): Promise<void> {
  const list = await loadPlayers();
  const player = list.find((p) => p.id === id);
  const rest = list.filter((p) => p.id !== id);
  await save(rest);
  if (!player || !deleteGames) return;
  const keep = [...(await getSetting<string[]>("usernames", [])), ...rest.flatMap(playerUsernames)];
  const theirs = playerUsernames(player);
  for (const g of await listGames()) {
    if (getUserColor(g, theirs) && !getUserColor(g, keep)) await deleteGame(g.id);
  }
}

export interface PlayerImportOptions {
  /** Lichess: number of newest games. */
  count?: number;
  /** Chess.com: number of newest monthly archives. */
  months?: number;
  signal?: AbortSignal;
  onProgress?: (label: string) => void;
}

/** Loads the newest games of every online account of the player. */
export async function importPlayerGames(
  player: TrackedPlayer,
  { count = 100, months = 3, signal, onProgress }: PlayerImportOptions = {},
): Promise<{ result: ImportResult; ids: string[] }> {
  const result: ImportResult = { found: 0, imported: 0, already_known: 0, skipped: [] };
  const ids: string[] = [];
  const onBatch = async (games: GameAnalysis[]) => {
    ids.push(...games.map((g) => g.game_id));
    await storeImported(games);
  };
  const opts = { onBatch, signal, onProgress: (_c: number, _t: number, label: string) => onProgress?.(label) };
  for (const acc of player.accounts) {
    if (signal?.aborted) break;
    let part: ImportResult | null = null;
    if (acc.source === "lichess") part = (await importLichessGames(acc.username, gameExists, count, opts)).result;
    else if (acc.source === "chesscom") part = (await importChesscomGames(acc.username, gameExists, months, opts)).result;
    if (!part) continue;
    result.found += part.found;
    result.imported += part.imported;
    result.already_known += part.already_known;
    result.skipped.push(...part.skipped);
  }
  await updatePlayer(player.id, { imported_at: Date.now() });
  return { result, ids };
}
