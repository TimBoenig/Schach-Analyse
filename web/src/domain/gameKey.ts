// One game, one record.
//
// A game's id is the MD5 of its PGN, so the same PGN never lands twice. But a
// platform may hand out the same game with a different PGN later: Lichess
// changed its Site header from "https://lichess.org/ID" to
// "https://lichess.org/game/ID", and a correspondence game imported while it
// is still running grows with every move. Both produced a second (and third)
// copy that counted double in every statistic. The platform's own game number
// names the game for good, whatever the PGN looks like.

import type { StoredGame } from "./types";

type KeyedGame = Pick<StoredGame, "id" | "source" | "pgn"> & Partial<Pick<StoredGame, "moves_json" | "summary_json" | "updated_at">>;

function header(pgn: string, tag: string): string | null {
  const m = new RegExp(`\\[${tag}\\s+"([^"]*)"\\]`).exec(pgn);
  return m ? m[1] : null;
}

/**
 * The platform's name for a game ("lichess:Ab3dEf9h", "chesscom:live/123"),
 * or null for games that carry none (PGN files).
 */
export function platformGameKey(game: Pick<StoredGame, "source" | "pgn">): string | null {
  const pgn = game.pgn || "";
  if (!pgn) return null;
  const link = header(pgn, "Link") ?? "";
  const site = header(pgn, "Site") ?? "";
  for (const url of [link, site]) {
    // Lichess ids have eight characters; longer ones carry the player's own token.
    const li = /lichess\.org\/(?:game\/)?(?:export\/)?([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:[/?#].*)?$/.exec(url);
    if (li) return `lichess:${li[1]}`;
    const cc = /chess\.com\/(?:[a-z]{2}\/)?(?:game\/)?(live|daily)(?:\/game)?\/(\d+)/.exec(url);
    if (cc) return `chesscom:${cc[1]}/${cc[2]}`;
  }
  return null;
}

const moveCount = (g: KeyedGame): number => (Array.isArray(g.moves_json) ? g.moves_json.length : 0);
const analysed = (g: KeyedGame): number => (g.summary_json?.analysis_status === "completed" ? 2 : g.summary_json?.analysis_status === "paused" ? 1 : 0);
const depthOf = (g: KeyedGame): number => Number(g.summary_json?.analysis_depth ?? 0) || 0;

/**
 * Which of two copies of one game to keep: the one with more moves (a running
 * game that was imported again), then the analysed one, the deeper analysis,
 * the newer record; the id settles what is left so every device decides alike.
 */
function better(a: KeyedGame, b: KeyedGame): KeyedGame {
  const order = [moveCount(a) - moveCount(b), analysed(a) - analysed(b), depthOf(a) - depthOf(b), (a.updated_at ?? 0) - (b.updated_at ?? 0)];
  for (const d of order) if (d !== 0) return d > 0 ? a : b;
  return a.id <= b.id ? a : b;
}

/** Ids of the redundant copies among `games`: every platform game keeps exactly one record. */
export function duplicateGameIds<G extends KeyedGame>(games: G[]): string[] {
  const best = new Map<string, G>();
  const drop: string[] = [];
  for (const g of games) {
    const key = platformGameKey(g);
    if (!key) continue;
    const held = best.get(key);
    if (!held) {
      best.set(key, g);
      continue;
    }
    const keep = better(held, g) as G;
    drop.push(keep === held ? g.id : held.id);
    best.set(key, keep);
  }
  return drop;
}
