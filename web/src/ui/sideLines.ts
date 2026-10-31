// Side lines on the analysis board, kept like the variations in the lichess
// move tree: every line the player tried stays in the move list until the
// game is closed, and can be picked up again at any move.
import { Chess } from "chess.js";

export interface Explore {
  /** Moves of the game played before the side line starts. */
  base: number;
  fens: string[];
  sans: string[];
  /** UCI of each tried move; ucis[k] leads from fens[k] to fens[k + 1]. */
  ucis: string[];
  lastUci: string | null;
  /** Engine moves (UCI) still to be played when stepping forward through a picked line. */
  pending: string[];
}

/** Most side lines kept per game; the oldest one goes first. */
export const MAX_SIDE_LINES = 12;

export function startLine(base: number, fen: string): Explore {
  return { base, fens: [fen], sans: [], ucis: [], lastUci: null, pending: [] };
}

/** Plays `uci` at the end of a side line; returns the line unchanged if the move is illegal. */
export function extendLine(line: Explore, uci: string, pending: string[]): Explore {
  try {
    const b = new Chess(line.fens[line.fens.length - 1]);
    const m = b.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return { ...line, fens: [...line.fens, b.fen()], sans: [...line.sans, m.san], ucis: [...line.ucis, uci], lastUci: uci, pending };
  } catch {
    return line;
  }
}

/** The line with its not yet played engine moves appended, as it shows in the move list. */
export function fullLine(line: Explore): Explore {
  let out = line;
  for (const uci of line.pending) {
    const next = extendLine(out, uci, []);
    if (next === out) break;
    out = next;
  }
  return { ...out, pending: [] };
}

const startsWith = (long: string[], short: string[]) => short.every((u, k) => long[k] === u);

/**
 * Adds `line` to the kept side lines. A line that only repeats the start of a kept
 * one adds nothing; a kept line that is the start of the new one is replaced.
 */
export function mergeLine(lines: Explore[], line: Explore): Explore[] {
  const full = fullLine(line);
  if (!full.ucis.length) return lines;
  if (lines.some((l) => l.base === full.base && startsWith(l.ucis, full.ucis))) return lines;
  const rest = lines.filter((l) => !(l.base === full.base && startsWith(full.ucis, l.ucis)));
  return [...rest, full].slice(-MAX_SIDE_LINES);
}

/** The kept line that contains the current side line, and the index of its current move. */
export function activeIn(lines: Explore[], line: Explore | null): { line: Explore; ply: number } | null {
  if (!line || !line.ucis.length) return null;
  const hit = lines.find((l) => l.base === line.base && startsWith(l.ucis, line.ucis));
  return hit ? { line: hit, ply: line.ucis.length - 1 } : null;
}

/** Re-enters a kept line after its move `ply`; the rest of the line stays ready for forward steps. */
export function resumeLine(line: Explore, ply: number): Explore {
  return {
    ...line,
    fens: line.fens.slice(0, ply + 2),
    sans: line.sans.slice(0, ply + 1),
    ucis: line.ucis.slice(0, ply + 1),
    lastUci: line.ucis[ply] ?? null,
    pending: line.ucis.slice(ply + 1),
  };
}

/**
 * The same position with the other side to move, so the engine shows what the
 * opponent threatens (the lichess "threat" mode). Null while in check, where
 * passing the move would be illegal.
 */
export function threatFen(fen: string): string | null {
  const parts = fen.split(" ");
  if (parts.length < 4) return null;
  try {
    if (new Chess(fen).inCheck()) return null;
    parts[1] = parts[1] === "w" ? "b" : "w";
    parts[3] = "-";
    // The side that passes is not in check, so the flipped position is legal.
    const flipped = parts.join(" ");
    return new Chess(flipped).isGameOver() ? null : flipped;
  } catch {
    return null;
  }
}

/** Move number label for move `k` of a line ("12." for White, "12…" for Black's first move). */
export function lineMoveNumber(line: Explore, k: number): string | null {
  const parts = line.fens[k]?.split(" ") ?? [];
  const white = parts[1] === "w";
  const num = parts[5] ?? "1";
  if (white) return `${num}.`;
  return k === 0 ? `${num}…` : null;
}
