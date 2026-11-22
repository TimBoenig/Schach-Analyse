// Which rating pool a game belongs to: UltraBullet, Bullet, Blitz, Rapid,
// Classical, Daily or Untimed.
//
// The platforms draw the lines differently, and a rating only means something
// inside its own pool. Filing a game under the wrong one puts a foreign rating
// into a rating line (a jump of several hundred points from one game to the
// next), so the platform decides wherever it is known:
//   Chess.com  bullet < 3 min, blitz < 10 min, everything longer is rapid
//              (30 and 60 minute games are rated as rapid; there is no
//              classical or ultrabullet pool).
//   Lichess    names the pool in the event ("Rated Blitz game"); by time it is
//              ultrabullet < 30 s, bullet < 3 min, blitz < 8 min, rapid < 25 min.
// The estimated length of a game is base time + 40 × increment on both.

/** A game without a clock (Chess.com's "Play vs Coach", PGN files without a TimeControl). */
export const UNTIMED = "Untimed";

const DAY_SECONDS = 86400;

type Platform = "chesscom" | "lichess" | "other";

function platformOf(source: string | null | undefined): Platform {
  const s = (source || "").toLowerCase();
  if (s.includes("lichess")) return "lichess";
  if (s.includes("chesscom") || s.includes("chess.com")) return "chesscom";
  return "other";
}

/** The pool a text names ("Rated Blitz game", "casual correspondence game"), or null. */
function namedSpeed(...texts: string[]): string | null {
  const has = (k: string) => texts.some((tk) => tk.includes(k));
  if (has("ultrabullet")) return "UltraBullet";
  if (has("bullet")) return "Bullet";
  if (has("blitz")) return "Blitz";
  if (has("rapid")) return "Rapid";
  if (has("daily") || has("correspondence") || has("per move")) return "Daily";
  if (has("classical")) return "Classical";
  return null;
}

function byLength(total: number, platform: Platform): string {
  if (total >= DAY_SECONDS) return "Daily";
  if (platform === "chesscom") return total < 180 ? "Bullet" : total < 600 ? "Blitz" : "Rapid";
  if (platform === "lichess") {
    if (total < 30) return "UltraBullet";
    if (total < 180) return "Bullet";
    if (total < 480) return "Blitz";
    return total < 1500 ? "Rapid" : "Classical";
  }
  if (total < 30) return "UltraBullet";
  if (total < 180) return "Bullet";
  if (total < 600) return "Blitz";
  return total < 1800 ? "Rapid" : "Classical";
}

/**
 * Classify a game by its TimeControl header, the event name and the platform
 * it was played on. A game whose time control is unknown is Untimed: guessing
 * a pool for it would mix its rating into a line it does not belong to.
 */
export function detectSpeedCategory(
  timeControl: string | null | undefined,
  event: string | null | undefined,
  source?: string | null,
): string {
  const tc = (timeControl || "").trim();
  const evt = (event || "").toLowerCase();
  const platform = platformOf(source);

  // Slash notation: "1/259200" (one move per three days) or "40/7200".
  const slash = /^(\d+)\/(\d+)$/.exec(tc);
  if (slash) {
    const movesCount = parseInt(slash[1], 10);
    const secCount = parseInt(slash[2], 10);
    if (secCount >= DAY_SECONDS || (movesCount === 1 && secCount >= 3600)) return "Daily";
    if (secCount >= 1800) return platform === "chesscom" ? "Rapid" : "Classical";
    if (secCount >= 600) return "Rapid";
    return "Blitz";
  }

  // Seconds plus increment; Chess.com writes fractions ("15+0.3").
  const m = /^(\d+(?:\.\d+)?)(?:\+(\d+(?:\.\d+)?))?$/.exec(tc);
  if (m) {
    const total = Number(m[1]) + 40 * (m[2] ? Number(m[2]) : 0);
    // Lichess names the pool itself; its word beats any threshold.
    const named = platform === "lichess" ? namedSpeed(evt) : null;
    return named ?? byLength(total, platform);
  }

  return namedSpeed(evt, tc.toLowerCase()) ?? UNTIMED;
}

/** Games the platforms rate in a pool of their own, i.e. everything with a clock. */
export function hasRatingPool(speed: string | null | undefined): boolean {
  return Boolean(speed) && speed !== UNTIMED;
}
