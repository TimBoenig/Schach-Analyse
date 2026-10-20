// Python-compatible numeric helpers so ported scores match the desktop app.

/**
 * Python's round(): ties go to the even neighbour ("banker's rounding").
 * Matters for school grades (e.g. round(2.5) == 2) and 0.1-step scores.
 */
export function pyRound(x: number, ndigits = 0): number {
  const m = 10 ** ndigits;
  const y = x * m;
  const floor = Math.floor(y);
  // Only exact binary ties round to even; everything else rounds to nearest.
  const r = y - floor === 0.5 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(y);
  return r / m;
}

export function avg(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

/** Population standard deviation (statistics.pstdev). */
export function pstdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = avg(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

/** Python-style "{x:.Nf}" formatting (ties to even like CPython's float formatting). */
export function fmt(x: number, digits: number): string {
  return pyRound(x, digits).toFixed(digits);
}
