// Which of the player's own names belongs to which site. Names are kept per
// site ("import.lastUser") but one typo or a name typed for the wrong site
// replaced the right one, and "Neueste holen" then asked chess.com for a
// stranger's games and found none. The games already stored know better: the
// own name that plays most of them on a site is the account there.

export type AccountSite = "chesscom" | "lichess";

interface NamedGame {
  source?: string | null;
  white?: string | null;
  black?: string | null;
}

/**
 * The account name to fetch new games for on `site`: the own name with the
 * most stored games from that site, else the remembered name, else "".
 */
export function accountNameFor(
  site: AccountSite,
  games: readonly NamedGame[],
  usernames: readonly string[],
  remembered?: string | null,
): string {
  const own = new Set(usernames.map((n) => n.trim().toLowerCase()).filter(Boolean));
  // Counted under the site's own spelling of the name, as the games carry it.
  const counts = new Map<string, { name: string; n: number }>();
  for (const g of games) {
    if (g.source !== site) continue;
    for (const side of [g.white, g.black]) {
      const name = (side ?? "").trim();
      const key = name.toLowerCase();
      if (!own.has(key)) continue;
      const c = counts.get(key) ?? { name, n: 0 };
      c.n += 1;
      counts.set(key, c);
    }
  }
  let best: { name: string; n: number } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best?.name ?? (remembered ?? "").trim();
}
