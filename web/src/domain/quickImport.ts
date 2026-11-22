// Which chess.com accounts the one-click "Neueste holen" asks for new games.
//
// It used to ask only for the name typed last into the import dialog. That
// name is overwritten by every import, a friend's included, and the guided
// start could store a Lichess name under chess.com, so the button quietly
// asked the wrong account and reported "Keine neuen Partien" although the
// player had new games.

import { t } from "../i18n";

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
  return names.length < 2 ? (names[0] ?? "") : t("{list} und {last}", { list: names.slice(0, -1).join(", "), last: names[names.length - 1] });
}

const games = (n: number) => (n === 1 ? t("1 Partie") : t("{n} Partien", { n }));

export function failedMonthsNote(failedMonths: number | undefined): string {
  const n = failedMonths ?? 0;
  if (!n) return "";
  return n === 1
    ? t(" Ein Monat konnte nicht geladen werden; hol die Partien später noch einmal, dann kommen die fehlenden dazu.")
    : t(" {n} Monate konnten nicht geladen werden; hol die Partien später noch einmal, dann kommen die fehlenden dazu.", { n });
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
  const analysing = !queued ? "" : queued === 1 ? t(", 1 wird jetzt analysiert") : t(", {queued} werden jetzt analysiert", { queued });
  let text = n
    ? n === 1
      ? t("1 neue Partie von {who} geholt{analysing}.", { who, analysing })
      : t("{n} neue Partien von {who} geholt{analysing}.", { n, who, analysing })
    : t("Keine neuen Partien von {who} auf chess.com.", { who }) +
      (complete ? t(" Alle {games} der letzten zwei Monate sind schon da.", { games: games(result.already_known) }) : "");
  if (result.skipped.length) text += t(" {games} (Chess960 oder Varianten) kann die App nicht analysieren.", { games: games(result.skipped.length) });
  text += failedMonthsNote(result.failed_months);
  if (failed.length) text += ` ${failed.join(" ")}`;
  return text;
}
