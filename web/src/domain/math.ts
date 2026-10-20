// Port of src/backend/analysis/math_utils.py.

/** Floor for per-move accuracy so one blunder cannot collapse the harmonic mean to zero. */
export const MIN_MOVE_ACCURACY = 10.0;

export function applyAccuracyFloor(accuracy: number): number {
  return Math.max(accuracy, MIN_MOVE_ACCURACY);
}

/** Win probability (0..1, White perspective) from centipawns or mate. */
export function getWinProbability(cp: number | null | undefined, mate: number | null | undefined): number {
  if (mate !== null && mate !== undefined) {
    return mate > 0 ? 1.0 : 0.0;
  }
  if (cp === null || cp === undefined) return 0.5;
  const multiplier = -0.00368208 * cp;
  if (multiplier > 40) return 0.0;
  if (multiplier < -40) return 1.0;
  const winPercent = 50 + 50 * (2 / (1 + Math.exp(multiplier)) - 1);
  return winPercent / 100.0;
}

/**
 * Accuracy of a single move. Lichess formula with a stricter decay constant
 * (0.06 instead of 0.04354) so the scale lands closer to Chess.com's.
 */
export function calculateMoveAccuracy(winProbBefore: number, winProbAfter: number): number {
  const diff = winProbBefore * 100.0 - winProbAfter * 100.0;
  if (diff <= 0) return 100.0;
  const raw = 103.1668 * Math.exp(-0.06 * diff) - 3.1669;
  return Math.max(0.0, Math.min(100.0, raw));
}

/** Score in centipawns with mates capped at ±2000. */
export function getCp(cp: number | null | undefined, mate: number | null | undefined): number {
  if (mate !== null && mate !== undefined) return mate > 0 ? 2000 : -2000;
  return cp ?? 0;
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0.0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, x) => a + (x - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Sliding-window standard deviation weights (Lichess), clamped to 0.5..12. */
export function calculateVolatilityWeights(winPercents: number[], windowSize: number): number[] {
  if (winPercents.length < windowSize) return winPercents.map(() => 1.0);
  const wp = winPercents.map((w) => w * 100);
  const windows: number[][] = [];
  const first = wp.slice(0, windowSize);
  for (let i = 0; i < Math.min(windowSize - 1, wp.length); i++) windows.push(first);
  for (let i = 0; i <= wp.length - windowSize; i++) windows.push(wp.slice(i, i + windowSize));
  return windows
    .slice(0, winPercents.length)
    .map((w) => Math.max(0.5, Math.min(12.0, stdDev(w))));
}

export function weightedMean(values: number[], weights: number[]): number {
  if (!values.length || !weights.length) return 0.0;
  const n = Math.min(values.length, weights.length);
  let total = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    total += weights[i];
    sum += values[i] * weights[i];
  }
  if (total === 0) return values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  return sum / total;
}

export function harmonicMean(values: number[]): number {
  const positive = values.filter((v) => v > 0);
  if (!positive.length) return 0.0;
  return positive.length / positive.reduce((a, v) => a + 1 / v, 0);
}

/** Game accuracy: mean of volatility-weighted mean and harmonic mean (Lichess). */
export function gameAccuracy(accuracies: number[], winPercents: number[]): number {
  if (accuracies.length === 0) return 0;
  if (accuracies.length === 1) return Math.max(0, Math.min(100, accuracies[0]));
  const capped = accuracies.map(applyAccuracyFloor);
  const windowSize = Math.max(2, Math.min(8, Math.floor(accuracies.length / 10)));
  const weights = calculateVolatilityWeights(winPercents, windowSize);
  const acc = (weightedMean(capped, weights) + harmonicMean(capped)) / 2;
  return Math.max(0, Math.min(100, acc));
}
