// Which chess.com accounts the one-click "Neueste holen" asks for new games.
//
// It used to ask only for the name typed last into the import dialog. That
// name is overwritten by every import, a friend's included, and the guided
// start could store a Lichess name under chess.com, so the button quietly
// asked the wrong account and reported "Keine neuen Partien" although the
// player had new games.

export interface NamedGame {
  white: string;
  black: string;
  source: string;
  deleted?: boolean;
}

const lower = (s: string) => s.trim().toLowerCase();

/**
 * The player's own chess.com names, most used first: names from "my" names
 * that already play in stored chess.com games, minus tracked friends. The last
 * typed name comes along when it is no friend's (a new account has no stored
 * games yet).
 */
export function ownChesscomNames(
  games: Iterable<NamedGame>,
  usernames: readonly string[],
  lastTyped: string | null | undefined,
  friendNames: readonly string[] = [],
): string[] {
  const friends = new Set(friendNames.map(lower));
  const mine = new Map<string, string>();
  for (const n of usernames) {
    const key = lower(n);
    if (key && !friends.has(key) && !mine.has(key)) mine.set(key, n.trim());
  }
  const count = new Map<string, number>();
  for (const g of games) {
    if (g.deleted || g.source !== "chesscom") continue;
    for (const side of [g.white, g.black]) {
      const key = lower(side || "");
      if (mine.has(key)) count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  const names = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => mine.get(key) as string);
  const typed = (lastTyped ?? "").trim();
  if (typed && !friends.has(lower(typed)) && !names.some((n) => lower(n) === lower(typed))) names.push(typed);
  return names;
}

/** "a", "a und b", "a, b und c". */
function joinNames(names: readonly string[]): string {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
}

const games = (n: number) => `${n} ${n === 1 ? "Partie" : "Partien"}`;

export function failedMonthsNote(failedMonths: number | undefined): string {
  const n = failedMonths ?? 0;
  return n ? ` ${n === 1 ? "Ein Monat konnte" : `${n} Monate konnten`} nicht geladen werden; hol die Partien später noch einmal, dann kommen die fehlenden dazu.` : "";
}

export interface QuickImportOutcome {
  names: string[];
  result: { imported: number; already_known: number; skipped: readonly unknown[]; failed_months?: number };
  queued: number;
  /** Why single accounts could not be loaded (the others still were). */
  failed: string[];
}

/** The notice after "Neueste holen": which accounts were asked and what came back. */
export function quickImportMessage({ names, result, queued, failed }: QuickImportOutcome): string {
  const who = joinNames(names);
  const n = result.imported;
  const complete = !result.failed_months && !failed.length;
  let text = n
    ? `${n} ${n === 1 ? "neue Partie" : "neue Partien"} von ${who} geholt${queued ? `, ${queued} ${queued === 1 ? "wird" : "werden"} jetzt analysiert` : ""}.`
    : `Keine neuen Partien von ${who} auf chess.com.${complete ? ` Alle ${games(result.already_known)} der letzten zwei Monate sind schon da.` : ""}`;
  if (result.skipped.length) text += ` ${games(result.skipped.length)} (Chess960 oder Varianten) kann die App nicht analysieren.`;
  text += failedMonthsNote(result.failed_months);
  if (failed.length) text += ` ${failed.join(" ")}`;
  return text;
}
