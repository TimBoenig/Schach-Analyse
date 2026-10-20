// Speed category detection (port of PGNParser.detect_speed_category).

/** Classify a game into UltraBullet, Bullet, Blitz, Rapid, Classical, or Daily. */
export function detectSpeedCategory(
  timeControl: string | null | undefined,
  event: string | null | undefined,
): string {
  const tc = (timeControl || "").trim();

  // Slash notation: e.g. "1/259200" (Daily) or "40/7200" (Classical)
  const slash = /^(\d+)\/(\d+)$/.exec(tc);
  if (slash) {
    const movesCount = parseInt(slash[1], 10);
    const secCount = parseInt(slash[2], 10);
    if (secCount >= 86400 || (movesCount === 1 && secCount >= 3600)) return "Daily";
    if (secCount >= 1800) return "Classical";
    if (secCount >= 600) return "Rapid";
    return "Blitz";
  }

  const m = /^(\d+)(?:\+(\d+))?$/.exec(tc);
  if (m) {
    const base = parseInt(m[1], 10);
    const inc = m[2] ? parseInt(m[2], 10) : 0;
    const total = base + 40 * inc;
    if (total < 30) return "UltraBullet";
    if (total < 180) return "Bullet";
    if (total < 600) return "Blitz";
    if (total < 1800) return "Rapid";
    if (total >= 86400) return "Daily";
    return "Classical";
  }

  const evt = (event || "").toLowerCase();
  const tcl = tc.toLowerCase();
  const has = (k: string) => evt.includes(k) || tcl.includes(k);
  if (has("ultrabullet")) return "UltraBullet";
  if (has("bullet")) return "Bullet";
  if (has("blitz")) return "Blitz";
  if (has("rapid")) return "Rapid";
  if (has("daily") || has("correspondence")) return "Daily";
  if (has("classical")) return "Classical";
  return "Blitz";
}
