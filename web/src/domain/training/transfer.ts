// Does the training show up in real games? Compares the player's error rates in
// games played before the first training day with games played since, per area
// the training targets. A change is only reported when both sides have enough
// games and moves (evidence.ts minimums) and the difference is significant;
// otherwise the area says how much data is still missing.

import { MIN_BUCKET_MOVES, MIN_GROUP_GAMES, meansDiffer, ratesDiffer } from "../profile/evidence";

/** One analysed game, reduced to what the transfer check needs (player's moves only). */
export interface GameErrorPoint {
  date: string;
  /** Player moves and errors (Inaccuracy excluded) per phase. */
  phases: Record<"opening" | "middlegame" | "endgame", [moves: number, errors: number]>;
  /** Blunders and misses (the moves the blunder check trains against). */
  serious: number;
  moves: number;
  accuracy: number;
}

export type TransferMetric = "serious" | "opening" | "endgame" | "accuracy";

export interface TransferRow {
  metric: TransferMetric;
  label: string;
  /** Errors per 100 moves (accuracy in percent for "accuracy"). */
  before: number | null;
  after: number | null;
  gamesBefore: number;
  gamesAfter: number;
  /** -1 better, 1 worse, 0 no clear change, null not enough data yet. */
  verdict: -1 | 0 | 1 | null;
}

export interface TransferReport {
  start: string | null;
  rows: TransferRow[];
}

const LABEL: Record<TransferMetric, string> = {
  serious: "Grobe Fehler (Blunder, verpasste Chancen)",
  opening: "Fehler in der Eröffnung",
  endgame: "Fehler im Endspiel",
  accuracy: "Genauigkeit",
};

function rateRow(metric: TransferMetric, before: GameErrorPoint[], after: GameErrorPoint[], pick: (g: GameErrorPoint) => [number, number]): TransferRow {
  const sum = (gs: GameErrorPoint[]) => gs.map(pick).reduce<[number, number]>((s, [m, e]) => [s[0] + m, s[1] + e], [0, 0]);
  const [mb, eb] = sum(before);
  const [ma, ea] = sum(after);
  const gb = before.filter((g) => pick(g)[0] > 0).length;
  const ga = after.filter((g) => pick(g)[0] > 0).length;
  const enough = gb >= MIN_GROUP_GAMES && ga >= MIN_GROUP_GAMES && mb >= MIN_BUCKET_MOVES && ma >= MIN_BUCKET_MOVES;
  const rb = mb ? (eb / mb) * 100 : null;
  const ra = ma ? (ea / ma) * 100 : null;
  let verdict: TransferRow["verdict"] = null;
  if (enough && rb !== null && ra !== null) verdict = ratesDiffer(ea, ma, eb, mb) ? (ra < rb ? -1 : 1) : 0;
  return { metric, label: LABEL[metric], before: rb, after: ra, gamesBefore: gb, gamesAfter: ga, verdict };
}

/** Before/after comparison around the first training day (null start: nothing trained yet). */
export function transferReport(series: GameErrorPoint[], start: string | null): TransferReport {
  if (!start) return { start, rows: [] };
  const before = series.filter((g) => g.date < start);
  const after = series.filter((g) => g.date >= start);
  const rows = [
    rateRow("serious", before, after, (g) => [g.moves, g.serious]),
    rateRow("opening", before, after, (g) => g.phases.opening),
    rateRow("endgame", before, after, (g) => g.phases.endgame),
  ];
  const accB = before.map((g) => g.accuracy);
  const accA = after.map((g) => g.accuracy);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
  const enough = accB.length >= MIN_GROUP_GAMES && accA.length >= MIN_GROUP_GAMES;
  const mb = mean(accB);
  const ma = mean(accA);
  rows.push({
    metric: "accuracy",
    label: LABEL.accuracy,
    before: mb,
    after: ma,
    gamesBefore: accB.length,
    gamesAfter: accA.length,
    // Higher accuracy is better, so "better" means the mean went up.
    verdict: enough && mb !== null && ma !== null ? (meansDiffer(accA, accB) ? (ma > mb ? -1 : 1) : 0) : null,
  });
  return { start, rows };
}

/** First day with a logged exercise, or null. */
export function trainingStart(days: string[]): string | null {
  return days.length ? [...days].sort()[0] : null;
}
