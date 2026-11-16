// Online ratings on the FIDE scale.
//
// Chess.com and Lichess numbers are not FIDE Elo: Lichess blitz runs some
// 300-400 points above Chess.com blitz, and both drift away from FIDE in
// different directions at the low and high end. Every rating estimate the
// profile shows is stated on the FIDE scale, so the platform rating is
// converted first.
//
// Source: ChessGoals rating comparison (chessgoals.com/rating-comparison,
// updated July 2026): players active on both sites, N = 1,923 with a FIDE
// rating, 10,156 Chess.com rapid, 1,935 Lichess blitz, 1,066 Lichess rapid,
// 240 Lichess classical. Half of the players fall within about ±75 (FIDE) to
// ±135 (bullet) of a row, so a converted rating is a typical value, not an
// exact one. Chess.com blitz is the survey's common column; every other
// column is mapped through it. The FIDE numbers are after the 2024 reform
// (rating floor raised to 1400, ratings below 2000 lifted by
// 0.4 · (2000 − rating)), which is why the low end is compressed.
//
// Below Chess.com blitz 1100 the survey has no FIDE players. There the line
// runs straight down to the FIDE floor of 1400 at Chess.com blitz 500; such
// values are flagged `extrapolated`.

/** Lowest rating FIDE publishes since March 2024. */
export const FIDE_FLOOR = 1400;

// Columns: Chess.com blitz, bullet, rapid; FIDE (null = no survey data);
// Lichess blitz, bullet, rapid, classical.
type Row = [number, number, number, number | null, number, number, number, number];
const TABLE: Row[] = [
  [500, 550, 815, null, 1090, 1060, 1290, 1505],
  [600, 615, 905, null, 1160, 1120, 1360, 1540],
  [700, 685, 995, null, 1225, 1180, 1425, 1575],
  [800, 760, 1085, null, 1290, 1240, 1490, 1610],
  [900, 840, 1170, null, 1360, 1305, 1555, 1650],
  [1000, 920, 1255, null, 1425, 1375, 1615, 1690],
  [1100, 1010, 1340, 1660, 1490, 1445, 1680, 1730],
  [1200, 1100, 1420, 1670, 1555, 1515, 1740, 1770],
  [1300, 1195, 1500, 1685, 1620, 1585, 1795, 1815],
  [1400, 1290, 1580, 1710, 1685, 1660, 1850, 1860],
  [1500, 1385, 1655, 1740, 1755, 1735, 1905, 1900],
  [1600, 1485, 1730, 1780, 1820, 1815, 1960, 1945],
  [1700, 1590, 1800, 1820, 1885, 1890, 2015, 1990],
  [1800, 1690, 1870, 1865, 1950, 1970, 2065, 2035],
  [1900, 1795, 1935, 1915, 2015, 2050, 2115, 2080],
  [2000, 1900, 1995, 1965, 2080, 2135, 2165, 2120],
  [2100, 2005, 2055, 2020, 2145, 2215, 2215, 2165],
  [2200, 2110, 2110, 2075, 2210, 2300, 2260, 2205],
  [2300, 2215, 2165, 2135, 2275, 2380, 2310, 2245],
  [2400, 2320, 2215, 2190, 2340, 2465, 2355, 2280],
  [2500, 2425, 2260, 2245, 2410, 2550, 2400, 2320],
  [2600, 2530, 2300, 2300, 2475, 2635, 2445, 2350],
  [2700, 2630, 2340, 2350, 2540, 2715, 2490, 2385],
  [2800, 2725, 2375, 2400, 2610, 2800, 2530, 2415],
  [2900, 2825, 2405, 2445, 2675, 2885, 2575, 2440],
  [3000, 2915, 2430, 2485, 2745, 2970, 2615, 2465],
];

const SURVEY_LOW = 1100; // lowest Chess.com blitz row with FIDE players
const COL = { cc_blitz: 0, cc_bullet: 1, cc_rapid: 2, li_blitz: 4, li_bullet: 5, li_rapid: 6, li_classical: 7 } as const;
type Column = keyof typeof COL;

/** FIDE value of a Chess.com blitz row: survey value, or the straight line down to the floor. */
function fideAtBlitz(ccBlitz: number): number {
  return Math.max(FIDE_FLOOR, fideLine(ccBlitz));
}

/** fideAtBlitz without the floor: the straight line carries on below it (for ordering only). */
function fideLine(ccBlitz: number): number {
  const first = TABLE.find((r) => r[0] === SURVEY_LOW)!;
  const fideLow = first[3] as number;
  if (ccBlitz >= SURVEY_LOW) {
    const rows = TABLE.filter((r) => r[3] !== null).map((r) => [r[0], r[3] as number] as const);
    return interpolate(rows, ccBlitz);
  }
  const t = (ccBlitz - TABLE[0][0]) / (SURVEY_LOW - TABLE[0][0]);
  return FIDE_FLOOR + t * (fideLow - FIDE_FLOOR);
}

/** Piecewise-linear lookup in increasing [x, y] pairs; the end segments carry on outside. */
function interpolate(rows: readonly (readonly [number, number])[], x: number): number {
  let i = 1;
  while (i < rows.length - 1 && x > rows[i][0]) i++;
  const [x0, y0] = rows[i - 1];
  const [x1, y1] = rows[i];
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

function column(source: string, speed: string): Column | null {
  const s = speed.toLowerCase();
  if (source === "chesscom") {
    if (s.includes("bullet")) return "cc_bullet";
    if (s === "blitz") return "cc_blitz";
    // Chess.com has no classical pool; daily is closest to rapid in the survey's terms.
    return "cc_rapid";
  }
  if (source === "lichess") {
    if (s.includes("bullet")) return "li_bullet";
    if (s === "blitz") return "li_blitz";
    if (s === "rapid") return "li_rapid";
    return "li_classical";
  }
  return null;
}

export interface FideRating {
  rating: number;
  /** Below the survey's range: anchored on the FIDE floor, rough. */
  extrapolated: boolean;
  /** The rating came from a PGN file and is taken as an over-the-board (FIDE-like) rating. */
  as_is: boolean;
}

/**
 * A platform rating on the FIDE scale. PGN files mostly come from
 * over-the-board events and carry FIDE or national Elo, so they stay as they are.
 */
export function toFide(rating: number, source: string, speed: string): FideRating {
  const col = column(String(source || "").toLowerCase(), String(speed || ""));
  if (col === null) return { rating: Math.max(FIDE_FLOOR, Math.round(rating)), extrapolated: rating < FIDE_FLOOR, as_is: true };
  const rows = TABLE.map((r) => [r[COL[col]], r[0]] as const);
  if (rating <= rows[0][0]) return { rating: FIDE_FLOOR, extrapolated: true, as_is: false };
  const ccBlitz = interpolate(rows, rating);
  return { rating: Math.round(fideAtBlitz(ccBlitz)), extrapolated: ccBlitz < SURVEY_LOW, as_is: false };
}

// ---------- one common scale for comparing players ----------
//
// Comparing friends needs a scale on which a difference means the same win
// chance everywhere and which never clamps: FIDE (floor 1400, compressed low
// end since the 2024 reform) gives two different beginners the same 1400.
// The league therefore estimates on the Lichess blitz scale (a Glicko scale,
// so 400 points are 10:1 odds, and the scale the published error-to-rating
// fits were made on) and converts to FIDE only for display. Beyond the
// survey's rows the lines carry on straight instead of clamping.

/** Survey column of a platform and speed; "fide" for PGN files (taken as over-the-board Elo). */
export function ratingColumn(source: string, speed: string): Column | "fide" {
  return column(String(source || "").toLowerCase(), String(speed || "")) ?? "fide";
}

/** Chess.com blitz equivalent of a rating in a survey column (unclamped). */
function ccBlitzOf(rating: number, col: Column | "fide"): number {
  if (col === "fide") {
    // Invert the (monotonic) FIDE line by bisection.
    let lo = -2000;
    let hi = 5000;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (fideLine(mid) < rating) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }
  return interpolate(
    TABLE.map((r) => [r[COL[col]], r[0]] as const),
    rating,
  );
}

const LICHESS_BLITZ = TABLE.map((r) => [r[0], r[COL.li_blitz]] as const);

/** A platform rating on the Lichess blitz scale, the league's common scale. */
export function toLichessBlitz(rating: number, source: string, speed: string): number {
  const col = ratingColumn(source, speed);
  if (col === "li_blitz") return rating;
  return interpolate(LICHESS_BLITZ, ccBlitzOf(rating, col));
}

// ---------- the Elo number the league shows ----------
//
// FIDE is a poor display scale for club and hobby players: nothing is
// published below 1400 and the 2024 reform squeezed everything under 2000, so
// most beginners would read the same number. The league therefore shows its
// strengths as Chess.com rapid equivalents: the largest pool in the survey
// (N = 10,156), the one most beginners play in, and wide open at the low end
// (a few hundred points up to 1400 instead of one floor value).

/** What the shown number is, for captions. */
export const ELO_SCALE_LABEL = "Chess.com-Rapid-Skala";
/** Lowest value shown; Chess.com itself has no ratings below 100. */
export const ELO_MIN = 100;

const ELO_FROM_LICHESS_BLITZ = TABLE.map((r) => [r[COL.li_blitz], r[COL.cc_rapid]] as const);

/** A value of the common (Lichess blitz) scale as the Elo number shown to players. */
export function lichessBlitzToElo(value: number): number {
  return Math.max(ELO_MIN, Math.round(interpolate(ELO_FROM_LICHESS_BLITZ, value)));
}
