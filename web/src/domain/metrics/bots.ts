// Games against computer opponents. A bot's "rating" says nothing about a
// human's strength (Lichess AI games carry none, bot accounts are rated in a
// pool of their own) and people play bots to try things out, so comparisons
// between players leave these games out.

import type { RawGame } from "./models";

// Lichess AI ("lichess AI level 8"), engines named in PGN files, Chess.com's
// computer player and its coach personas ("Coach-Hikaru"). Plain names ending
// in "bot" ("Abbot") are no evidence, so a bot word needs a separator or the
// whole name.
const BOT_NAME = /^(lichess ai|stockfish|komodo|leela|lc0|maia\d*|houdini|fritz|computer|engine)(\b|$)|\bai level \d|(^|[-_ ])bot$|^bot([-_ ]|$)|^coach[-_ ]/i;
const BOT_EVENT = /\b(vs\.? computer|gegen (den )?computer|computer game|bot game)\b/i;

function header(pgn: string | undefined, tag: string): string | null {
  if (!pgn) return null;
  const m = new RegExp(`\\[${tag}\\s+"([^"]*)"\\]`).exec(pgn);
  return m ? m[1] : null;
}

/** The side opposite `color` is a computer (title BOT, an engine or AI name, a computer event). */
export function isBotGame(g: RawGame, color: "white" | "black"): boolean {
  const opp = color === "white" ? "Black" : "White";
  if ((header(g.pgn, `${opp}Title`) ?? "").toUpperCase() === "BOT") return true;
  const name = String((color === "white" ? g.black : g.white) ?? "").trim();
  if (BOT_NAME.test(name)) return true;
  return BOT_EVENT.test(String(g.event ?? ""));
}

/**
 * The games without any computer opponent: a game counts as a bot game when
 * either side is one, since the comparison may look at it from both sides.
 */
export function withoutBots<G extends RawGame>(games: G[]): G[] {
  return games.filter((g) => !isBotGame(g, "white") && !isBotGame(g, "black"));
}
