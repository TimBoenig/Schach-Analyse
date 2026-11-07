// Builds the opening tree the PWA serves as public/openings/book.json from the
// desktop app's Lichess ECO TSVs (see src/domain/book.ts for the reader).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Chess } from "chess.js";

// Position key without move counters and en-passant field; must match
// bookKey() in src/domain/book.ts.
export function bookKey(fen) {
  return fen.split(" ").slice(0, 3).join(" ");
}

/** Position keys along a line, starting with the initial position; stops at an illegal move. */
function lineKeys(sans) {
  const board = new Chess();
  const keys = [{ key: bookKey(board.fen()), san: null }];
  for (const san of sans) {
    try {
      board.move(san);
    } catch {
      break;
    }
    keys.push({ key: bookKey(board.fen()), san });
  }
  return keys;
}

/**
 * Opening tree for public/openings/book.json: key -> [eco, name, child SANs, most common first].
 *
 * Every position on the way to a named line gets a name. Only positions whose
 * own line ends there carry that line's name; positions in between inherit the
 * name of the last named position before them (1. e4 c5 is "Sicilian Defense",
 * not one of the hundreds of deeper Sicilian lines that pass through it).
 */
export function buildBookData(tsvDir) {
  const lines = [];
  for (const file of readdirSync(tsvDir).filter((f) => f.endsWith(".tsv")).sort()) {
    for (const line of readFileSync(join(tsvDir, file), "utf8").split("\n")) {
      const [eco, name, pgn] = line.split("\t");
      if (!pgn || eco === "eco") continue;
      lines.push({ eco, name, keys: lineKeys(pgn.trim().split(/\s+/).filter((t) => !t.endsWith("."))) });
    }
  }
  // Pass 1: the positions the lines end in, with their own names.
  const exact = new Map(); // key -> [eco, name]
  for (const l of lines) {
    if (l.keys.length < 2) continue;
    const last = l.keys[l.keys.length - 1];
    const prev = exact.get(last.key);
    // Transpositions: the shorter (more general) name describes the position best.
    if (!prev || l.name.length < prev[1].length) exact.set(last.key, [l.eco, l.name]);
  }
  // Pass 2: every position on a line, named by the last exact position up to it.
  const nodes = new Map(); // key -> { name: [eco, name] | null, children: Map<san, lines through it> }
  for (const l of lines) {
    let named = null;
    let prev = null;
    for (const { key, san } of l.keys) {
      if (exact.has(key)) named = exact.get(key);
      let n = nodes.get(key);
      if (!n) nodes.set(key, (n = { name: null, children: new Map() }));
      if (!n.name && named) n.name = named;
      if (prev && san) prev.children.set(san, (prev.children.get(san) ?? 0) + 1);
      prev = n;
    }
  }
  const out = {};
  for (const [key, n] of nodes) {
    if (!n.name) continue; // only the start position has no name
    // Main moves first: the more named lines go through a move, the more common it is.
    const children = [...n.children].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([san]) => san);
    out[key] = [n.name[0], n.name[1], children];
  }
  return out;
}

