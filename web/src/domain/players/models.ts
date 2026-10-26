// Other players the user follows: opponents to scout and friends to rank
// against. Stored as the synced setting `players`; their games live in the
// normal game store and are told apart by username, like the user's own.

export type AccountSource = "lichess" | "chesscom" | "other";

export interface PlayerAccount {
  source: AccountSource;
  username: string;
}

export interface TrackedPlayer {
  /** Stable id for routes, derived from the first username. */
  id: string;
  /** Display name (defaults to the first username). */
  name: string;
  accounts: PlayerAccount[];
  /** Friends take part in the ranking; every player gets a scouting report. */
  friend: boolean;
  /** Milliseconds since epoch. */
  added_at: number;
  /** When games were last loaded from Lichess/Chess.com (ms), null if never. */
  imported_at: number | null;
}

export const SOURCE_LABELS: Record<AccountSource, string> = {
  lichess: "Lichess",
  chesscom: "Chess.com",
  other: "PGN",
};

export const playerUsernames = (p: Pick<TrackedPlayer, "accounts">): string[] =>
  [...new Set(p.accounts.map((a) => a.username.trim()).filter(Boolean))];

// Path segments of the players page that an id must not shadow.
const RESERVED_IDS = ["rangliste"];

/** Route-safe id: lower-case username with everything but letters, digits, - and _ dropped. */
export function playerId(username: string, taken: Iterable<string> = []): string {
  const base = username.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "") || "spieler";
  const used = new Set([...taken, ...RESERVED_IDS]);
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
  return id;
}

/** Normalizes a stored `players` setting; drops entries without a username. */
export function parsePlayers(raw: unknown): TrackedPlayer[] {
  if (!Array.isArray(raw)) return [];
  const out: TrackedPlayer[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const p = r as Partial<TrackedPlayer>;
    const accounts = (Array.isArray(p.accounts) ? p.accounts : [])
      .filter((a): a is PlayerAccount => Boolean(a && typeof a.username === "string" && a.username.trim()))
      .map((a) => ({ source: (["lichess", "chesscom"].includes(a.source) ? a.source : "other") as AccountSource, username: a.username.trim() }));
    if (!accounts.length || typeof p.id !== "string" || !p.id) continue;
    out.push({
      id: p.id,
      name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : accounts[0].username,
      accounts,
      friend: Boolean(p.friend),
      added_at: Number(p.added_at) || 0,
      imported_at: typeof p.imported_at === "number" ? p.imported_at : null,
    });
  }
  return out;
}
