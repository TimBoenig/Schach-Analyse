// The player's own opening tree: every position of the first moves that came
// up in their games, with how often each move was played, how the games went
// from there and, for the player's own moves, how often the engine called the
// move an error. It is the data behind the opening explorer ("what do I play
// here, what do they play against me, and where does it go wrong").

import { Board, STARTING_FEN } from "../tactics/board";
import { shareAtLeast } from "./evidence";
import { ERROR_CLASSES, type GameFeatures, sanForUci } from "./features";

/** Ten full moves cover the opening of nearly every game. */
export const TREE_PLIES = 20;
/** Newest games kept per position, so the explorer can link to them. */
const NODE_GAMES = 5;
/** Own move judged in at least this many games before it can be called a leak. */
export const LEAK_MIN_JUDGED = 5;
/** Error share (lower 95 % bound) above which a move is a leak rather than bad luck. */
export const LEAK_SHARE = 0.3;
const MAX_LEAKS = 6;

/** A game through a position, enough to list and open it. */
export interface TreeGame {
  id: string;
  date: string;
  opponent: string;
  opp_rating: number;
  score: number | null;
}

export interface OpeningNode {
  /** Move that leads here (empty at the root). */
  san: string;
  uci: string;
  /** Number of plies from the start position. */
  ply: number;
  /** The move was the tracked player's own. */
  user: boolean;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  score_pct: number | null;
  /** Games in which this (own) move was judged by the engine, and how many of them called it an error. */
  judged: number;
  errors: number;
  /** The engine's usual better move (SAN) where this move was an error. */
  better: string | null;
  /** The move is an error in a clear share of the games, beyond chance. */
  leak: boolean;
  /** Most games were still in the opening book after this move. */
  book: boolean;
  /** Newest games through this position. */
  recent: TreeGame[];
  children: OpeningNode[];
}

export interface OpeningLeak {
  color: "white" | "black";
  /** SAN moves from the start up to and including the leaky move. */
  path: string[];
  /** Position before the leaky move. */
  fen: string;
  san: string;
  better: string | null;
  errors: number;
  judged: number;
  games: number;
  score_pct: number | null;
  recent: TreeGame[];
}

export interface OpeningTree {
  white: OpeningNode;
  black: OpeningNode;
  /** Own moves that keep going wrong, worst first. */
  leaks: OpeningLeak[];
}

function newestFirst(a: GameFeatures, b: GameFeatures): number {
  return (b.played_at ?? 0) - (a.played_at ?? 0) || b.date.localeCompare(a.date);
}

function majority(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [v, c] of counts) if (c > n || (c === n && best !== null && v < best)) [best, n] = [v, c];
  return best;
}

function node(fs: GameFeatures[], ply: number, color: "white" | "black", fenBefore: string | null): OpeningNode {
  const scores = fs.map((f) => f.score).filter((s): s is number => s !== null);
  const step = ply > 0 ? fs[0].opening_line[ply - 1] : null;
  const user = ply > 0 && ((ply - 1) % 2 === 0) === (color === "white");
  const judgedGames = user ? fs.filter((f) => f.opening_line[ply - 1].classification) : [];
  const errorGames = judgedGames.filter((f) => ERROR_CLASSES.has(f.opening_line[ply - 1].classification));
  const betterUci = majority(errorGames.map((f) => f.opening_line[ply - 1].best_move ?? ""));
  const better = betterUci && fenBefore ? sanForUci(fenBefore, betterUci) : null;
  return {
    san: step?.san ?? "",
    uci: step?.uci ?? "",
    ply,
    user,
    games: fs.length,
    wins: scores.filter((s) => s === 1).length,
    draws: scores.filter((s) => s === 0.5).length,
    losses: scores.filter((s) => s === 0).length,
    score_pct: scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) * 100 : null,
    judged: judgedGames.length,
    errors: errorGames.length,
    better: better && better !== step?.san && better !== betterUci ? better : null,
    leak: judgedGames.length >= LEAK_MIN_JUDGED && shareAtLeast(errorGames.length, judgedGames.length, LEAK_SHARE),
    book: ply > 0 && fs.filter((f) => f.opening_line[ply - 1].is_book).length * 2 > fs.length,
    recent: [...fs]
      .sort(newestFirst)
      .slice(0, NODE_GAMES)
      .map((f) => ({ id: f.game_id, date: f.date, opponent: f.rec.opp_name, opp_rating: f.opp_rating, score: f.score })),
    children: [],
  };
}

function grow(n: OpeningNode, fs: GameFeatures[], board: Board, color: "white" | "black"): void {
  // A line seen in one game only is that game's moves, not part of a repertoire.
  if (n.ply >= TREE_PLIES || (n.ply > 0 && fs.length < 2)) return;
  const groups = new Map<string, GameFeatures[]>();
  for (const f of fs) {
    const san = f.opening_line[n.ply]?.san;
    if (!san) continue;
    const list = groups.get(san);
    if (list) list.push(f);
    else groups.set(san, [f]);
  }
  const fen = board.fen();
  for (const [san, group] of groups) {
    const next = board.copy();
    try {
      next.push(next.parseSan(san));
    } catch {
      continue; // A corrupt line ends the branch instead of the whole tree.
    }
    const child = node(group, n.ply + 1, color, fen);
    n.children.push(child);
    grow(child, group, next, color);
  }
  n.children.sort((a, b) => b.games - a.games || a.san.localeCompare(b.san));
}

function collectLeaks(n: OpeningNode, color: "white" | "black", path: string[], board: Board, out: OpeningLeak[]): void {
  for (const c of n.children) {
    const here = [...path, c.san];
    if (c.leak) {
      out.push({
        color,
        path: here,
        fen: board.fen(),
        san: c.san,
        better: c.better,
        errors: c.errors,
        judged: c.judged,
        games: c.games,
        score_pct: c.score_pct,
        recent: c.recent,
      });
    }
    const next = board.copy();
    try {
      next.push(next.parseSan(c.san));
    } catch {
      continue;
    }
    collectLeaks(c, color, here, next, out);
  }
}

export function buildOpeningTree(feats: GameFeatures[]): OpeningTree {
  const trees = {} as Record<"white" | "black", OpeningNode>;
  const leaks: OpeningLeak[] = [];
  for (const color of ["white", "black"] as const) {
    const fs = feats.filter((f) => !f.chess960 && f.rec.user_color === color && f.opening_line.length > 0);
    const root = node(fs, 0, color, null);
    grow(root, fs, new Board(STARTING_FEN), color);
    trees[color] = root;
    collectLeaks(root, color, [], new Board(STARTING_FEN), leaks);
  }
  // Errors that cost the most games first; earlier in the game breaks ties.
  leaks.sort((a, b) => b.errors - a.errors || b.errors / b.judged - a.errors / a.judged || a.path.length - b.path.length);
  return { ...trees, leaks: leaks.slice(0, MAX_LEAKS) };
}

/**
 * Typical line of one opening: at each ply the move most of these games took,
 * as long as at least two games (or the only one) share it.
 */
export function mainLine(fs: GameFeatures[], maxPlies = 10): string[] {
  let here = fs.filter((f) => f.opening_line.length > 0);
  const need = Math.min(2, here.length);
  const line: string[] = [];
  for (let ply = 0; ply < maxPlies && here.length; ply++) {
    const san = majority(here.map((f) => f.opening_line[ply]?.san ?? ""));
    if (!san) break;
    const next = here.filter((f) => f.opening_line[ply]?.san === san);
    if (next.length < need) break;
    line.push(san);
    here = next;
  }
  return line;
}

/** Position after a list of SAN moves from the start; stops at the first illegal move. */
export function fenAfter(sans: string[]): string {
  const board = new Board(STARTING_FEN);
  for (const san of sans) {
    try {
      board.push(board.parseSan(san));
    } catch {
      break;
    }
  }
  return board.fen();
}
