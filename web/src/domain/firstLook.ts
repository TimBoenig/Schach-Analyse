// The first thing Lucena can honestly say about a fresh import, before the
// engine has looked at a single move: results straight from the game records.
import { getUserColor, isBulletGame } from "./metrics";
import type { GameAnalysis } from "./types";

export interface FirstLook {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** Games with the white pieces (the rest were black). */
  white: number;
  bullet: number;
}

export function firstLook(games: GameAnalysis[], name: string): FirstLook {
  const out: FirstLook = { games: 0, wins: 0, draws: 0, losses: 0, white: 0, bullet: 0 };
  for (const g of games) {
    const color = getUserColor(g.metadata, [name]);
    if (!color) continue;
    out.games++;
    if (color === "white") out.white++;
    if (isBulletGame(g.metadata)) out.bullet++;
    const r = g.metadata.result;
    if (r === "1/2-1/2") out.draws++;
    else if (r === "1-0" || r === "0-1") (r === "1-0") === (color === "white") ? out.wins++ : out.losses++;
  }
  return out;
}
