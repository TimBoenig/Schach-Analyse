// Exercise pool built from the player's own games: positions to solve
// (blunder check, missed chances, opening, endgame, conversion, defense),
// repertoire drills replaying the player's openings with their typical errors
// corrected, and won positions to play out against the engine.
//
// Ids are derived from game id + ply, so progress survives profile rebuilds.

import { Board, moveFromUci, STARTING_FEN } from "../tactics/board";
import { ERROR_CLASSES, type GameFeatures, type MoveEvent, moveLabel, sanForUci } from "../profile/features";
import { openingMain } from "../profile/openings";
import { BASIC_ENDGAMES } from "./basics";

export type Category =
  | "blunder"
  | "chance"
  | "opening"
  | "repertoire"
  | "endgame"
  | "basics"
  | "conversion"
  | "defense";

export interface CategoryInfo {
  label: string;
  /** What the exercise trains, one sentence. */
  text: string;
  /** Skill keys (profile/skills.ts) this category improves. */
  skills: string[];
}

export const CATEGORIES: Record<Category, CategoryInfo> = {
  blunder: {
    label: "Blunder-Check",
    text: "Stellungen, in denen du Material oder die Stellung eingestellt hast. Finde den sicheren Zug.",
    skills: ["safety"],
  },
  chance: {
    label: "Chancen nutzen",
    text: "Dein Gegner hat gepatzt und du hast es nicht bestraft. Finde den Zug, der den Fehler ausnutzt.",
    skills: ["tactics"],
  },
  opening: {
    label: "Eröffnungsfehler",
    text: "Stellungen aus der Eröffnung, in denen du vom besten Weg abgekommen bist.",
    skills: ["opening"],
  },
  repertoire: {
    label: "Repertoire üben",
    text: "Spiele deine eigenen Eröffnungen Zug für Zug nach. Deine typischen Fehler sind schon korrigiert.",
    skills: ["opening"],
  },
  endgame: {
    label: "Endspiel-Aufgaben",
    text: "Endspielstellungen aus deinen Partien, in denen es einen deutlich besseren Zug gab.",
    skills: ["endgame"],
  },
  basics: {
    label: "Endspiel-Grundlagen",
    text: "Klassische Lehrstellungen gegen die Engine: Mattführung, Opposition, Lucena und Philidor.",
    skills: ["endgame"],
  },
  conversion: {
    label: "Vorteil verwerten",
    text: "Du stehst auf Gewinn. Finde den Zug, der den Vorteil sichert, oder spiele die Stellung gegen die Engine zu Ende.",
    skills: ["conversion"],
  },
  defense: {
    label: "Zähe Verteidigung",
    text: "Schlechtere Stellungen aus deinen Partien. Finde den Zug, der am meisten Widerstand leistet.",
    skills: ["defense"],
  },
};

export const CATEGORY_ORDER: Category[] = [
  "blunder",
  "chance",
  "opening",
  "repertoire",
  "endgame",
  "basics",
  "conversion",
  "defense",
];

const PROMPTS: Record<Category, string> = {
  blunder: "Blunder-Check: Welche Schachs, Schläge und Drohungen gibt es? Finde den besten Zug.",
  chance: "Dein Gegner hat gerade einen Fehler gemacht. Bestrafe ihn!",
  opening: "Eröffnung: Welcher Zug hält deine Stellung gesund?",
  repertoire: "",
  endgame: "Endspiel: Finde den genauesten Zug.",
  basics: "",
  conversion: "Du stehst auf Gewinn. Finde den Zug, der den Vorteil sichert.",
  defense: "Du stehst schlechter. Finde die zäheste Verteidigung.",
};

interface Base {
  id: string;
  category: Category;
  title: string;
}

/** Find the best move in a position from the player's own game. */
export interface PuzzleExercise extends Base {
  kind: "puzzle";
  fen: string;
  solution: string; // UCI
  solution_san: string;
  /** Every UCI move that counts as solved (solution first). */
  accept: string[];
  /** Engine continuation in SAN, starting with the solution. */
  line_san: string[];
  prompt: string;
  game_id: string;
  ply_index: number;
  move_label: string;
  played_san: string;
  classification: string;
  phase: string;
  wp_before: number;
  wp_loss: number;
  opponent: string;
  date: string;
}

/** Replay one of the player's openings from move 1 with the player's side to move. */
export interface RepertoireExercise extends Base {
  kind: "repertoire";
  color: "white" | "black";
  opening: string;
  /** SAN of every ply from the start position. */
  moves: string[];
  /** Set when the player's usual move was an error and the line uses the engine move instead. */
  correction: { ply: number; played_san: string; best_san: string; games: number } | null;
  games: number;
  score_pct: number | null;
}

export type PlayoutGoal = "mate" | "promote" | "win" | "hold";

/** Play a position out against the engine until the goal is reached or the moves run out. */
export interface PlayoutExercise extends Base {
  kind: "playout";
  fen: string;
  goal: PlayoutGoal;
  /** Moves of the player within which the goal must be reached (or held). */
  max_moves: number;
  text: string;
  game_id?: string;
  ply_index?: number;
}

export type Exercise = PuzzleExercise | RepertoireExercise | PlayoutExercise;

export const MAX_PUZZLES = 150;
export const MAX_DRILLS = 10;
export const MAX_PLAYOUTS = 12;
// Clear errors become puzzles: a drop of 20 points in winning chances. Opening
// inaccuracies count from 8 points, otherwise there are hardly any opening puzzles.
export const PUZZLE_MIN_WP_LOSS = 0.2;
export const OPENING_MIN_WP_LOSS = 0.08;
// Positions this clearly won (player's winning chance) are worth playing out.
export const PLAYOUT_MIN_WP = 0.85;
// A repertoire node needs this many games to count as "your line".
export const DRILL_MIN_GAMES = 2;
export const DRILL_MAX_PLIES = 24;

/** Category of an erroneous move: the situation it happened in decides what it trains. */
export function puzzleCategory(m: MoveEvent): Category {
  if (m.after_opponent_error || m.classification === "Miss") return "chance";
  if (m.phase === "endgame") return "endgame";
  if (m.phase === "opening") return "opening";
  if (m.wp_before >= 0.7) return "conversion";
  if (m.wp_before <= 0.3) return "defense";
  return "blunder";
}

/** SAN of a UCI line, stopping at the first illegal move. */
export function lineToSan(fen: string, uciLine: string[], limit = 6): string[] {
  const out: string[] = [];
  try {
    const board = new Board(fen);
    for (const uci of uciLine.slice(0, limit)) {
      const mv = moveFromUci(uci);
      if (!board.legalMoves().some((l) => l.from === mv.from && l.to === mv.to && (l.promotion ?? null) === (mv.promotion ?? null))) break;
      out.push(board.san(mv));
      board.push(mv);
    }
  } catch {
    // Broken FEN: no continuation to show.
  }
  return out;
}

function isPuzzleMove(m: MoveEvent): boolean {
  if (m.is_book || !m.best_move_uci || m.best_move_uci === m.uci || !m.fen_before) return false;
  if (m.is_serious_error && m.wp_drop >= PUZZLE_MIN_WP_LOSS) return true;
  return m.phase === "opening" && ERROR_CLASSES.has(m.classification) && m.wp_drop >= OPENING_MIN_WP_LOSS;
}

function puzzle(f: GameFeatures, m: MoveEvent): PuzzleExercise | null {
  const solution = m.best_move_uci as string;
  const san = sanForUci(m.fen_before, solution);
  if (!san || san === solution) return null; // engine move not legal here
  const category = puzzleCategory(m);
  const label = moveLabel(m.move_number, f.rec.user_color === "white", m.san);
  const pv = m.best_pv[0] === solution ? m.best_pv : [solution];
  return {
    id: `p:${f.game_id}:${m.ply_index}`,
    kind: "puzzle",
    category,
    title: `${label} gegen ${f.rec.opp_name || "?"}`,
    fen: m.fen_before,
    solution,
    solution_san: san,
    accept: [solution, ...m.alt_moves.filter((u) => u !== solution && u !== m.uci)],
    line_san: lineToSan(m.fen_before, pv),
    prompt: PROMPTS[category],
    game_id: f.game_id,
    ply_index: m.ply_index,
    move_label: label,
    played_san: m.san,
    classification: m.classification,
    phase: m.phase,
    wp_before: Math.round(m.wp_before * 1000) / 1000,
    wp_loss: Math.round(m.wp_drop * 1000) / 1000,
    opponent: f.rec.opp_name,
    date: f.date,
  };
}

function puzzles(analyzed: GameFeatures[]): PuzzleExercise[] {
  const candidates = analyzed.flatMap((f) => f.moves.filter(isPuzzleMove).map((m) => ({ f, m })));
  // Newest games first: recent errors say most about the player today.
  candidates.sort((a, b) => (b.f.played_at || 0) - (a.f.played_at || 0) || b.m.wp_drop - a.m.wp_drop);
  const out: PuzzleExercise[] = [];
  for (const { f, m } of candidates) {
    const p = puzzle(f, m);
    if (p) out.push(p);
    if (out.length >= MAX_PUZZLES) break;
  }
  return out;
}

function majority(values: string[]): [string, number] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = "";
  let n = 0;
  for (const [v, c] of counts) if (c > n || (c === n && v < best)) [best, n] = [v, c];
  return [best, n];
}

/**
 * The player's most played line in one opening: at each ply the move chosen
 * most often, until fewer than DRILL_MIN_GAMES games share the line. Where the
 * player's usual move was an error in most analyzed games, the engine's move
 * replaces it and the drill ends there.
 */
export function repertoireDrill(color: "white" | "black", opening: string, games: GameFeatures[]): RepertoireExercise | null {
  let node = games.filter((g) => g.opening_line.length > 0);
  const board = new Board(STARTING_FEN);
  const moves: string[] = [];
  let correction: RepertoireExercise["correction"] = null;
  for (let ply = 0; ply < DRILL_MAX_PLIES; ply++) {
    const here = node.filter((g) => g.opening_line.length > ply && g.opening_line[ply].san);
    const [san, count] = majority(here.map((g) => g.opening_line[ply].san));
    if (count < DRILL_MIN_GAMES) break;
    const sub = here.filter((g) => g.opening_line[ply].san === san);
    const userMove = (ply % 2 === 0) === (color === "white");
    if (userMove) {
      const judged = sub.filter((g) => g.opening_line[ply].classification);
      const errors = judged.filter((g) => ERROR_CLASSES.has(g.opening_line[ply].classification));
      if (judged.length && errors.length * 2 >= judged.length) {
        const [bestUci] = majority(errors.map((g) => g.opening_line[ply].best_move ?? "").filter(Boolean));
        const bestSan = bestUci ? sanForUci(board.fen(), bestUci) : "";
        if (bestSan && bestSan !== bestUci && bestSan !== san) {
          moves.push(bestSan);
          correction = { ply, played_san: san, best_san: bestSan, games: errors.length };
          break;
        }
      }
    }
    try {
      board.push(board.parseSan(san));
    } catch {
      break;
    }
    moves.push(san);
    node = sub;
  }
  // A drill ends on the player's move; a trailing opponent move would be left hanging.
  const lastIsUser = (n: number) => ((n - 1) % 2 === 0) === (color === "white");
  while (moves.length && !lastIsUser(moves.length)) moves.pop();
  const userMoves = moves.filter((_, i) => (i % 2 === 0) === (color === "white")).length;
  if (userMoves < 3) return null;
  const scores = games.map((g) => g.score).filter((s): s is number => s !== null);
  return {
    id: `r:${color}:${opening}`,
    kind: "repertoire",
    category: "repertoire",
    title: opening,
    color,
    opening,
    moves,
    correction: correction && correction.ply < moves.length ? correction : null,
    games: games.length,
    score_pct: scores.length ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 1000) / 10 : null,
  };
}

function drills(feats: GameFeatures[]): RepertoireExercise[] {
  const groups = new Map<string, { color: "white" | "black"; name: string; fs: GameFeatures[] }>();
  for (const f of feats) {
    if (!f.opening_line.length || !f.rec.opening) continue;
    const name = openingMain(f.rec.opening);
    const key = `${f.rec.user_color}\u0000${name}`;
    const g = groups.get(key);
    if (g) g.fs.push(f);
    else groups.set(key, { color: f.rec.user_color, name, fs: [f] });
  }
  return [...groups.values()]
    .filter((g) => g.fs.length >= DRILL_MIN_GAMES)
    .sort((a, b) => b.fs.length - a.fs.length)
    .map((g) => repertoireDrill(g.color, g.name, g.fs))
    .filter((d): d is RepertoireExercise => d !== null)
    .slice(0, MAX_DRILLS);
}

function playouts(analyzed: GameFeatures[]): PlayoutExercise[] {
  const out: PlayoutExercise[] = [];
  const recent = [...analyzed].sort((a, b) => (b.played_at || 0) - (a.played_at || 0));
  for (const f of recent) {
    // One position per game: the first time a clearly won game started to slip.
    const m = f.moves.find((x) => x.is_serious_error && x.wp_before >= PLAYOUT_MIN_WP && x.phase !== "opening" && x.fen_before);
    if (!m) continue;
    out.push({
      id: `w:${f.game_id}:${m.ply_index}`,
      kind: "playout",
      category: "conversion",
      title: `Gewinnstellung gegen ${f.rec.opp_name || "?"}`,
      fen: m.fen_before,
      goal: "win",
      max_moves: 12,
      text: `Hier hast du ${moveLabel(m.move_number, f.rec.user_color === "white", m.san)} gespielt und den Vorteil aus der Hand gegeben. Spiele die Stellung gegen die Engine zu Ende: nach 12 Zügen musst du noch klar auf Gewinn stehen.`,
      game_id: f.game_id,
      ply_index: m.ply_index,
    });
    if (out.length >= MAX_PLAYOUTS) break;
  }
  return out;
}

/** All exercises for the player. Chess960 games are skipped (the board UI plays standard chess only). */
export function buildExercisePool(feats: GameFeatures[]): Exercise[] {
  const standard = feats.filter((f) => !f.chess960);
  const analyzed = standard.filter((f) => f.analyzed);
  return [...puzzles(analyzed), ...drills(standard), ...playouts(analyzed), ...BASIC_ENDGAMES];
}

export function countByCategory(pool: Exercise[]): Record<Category, number> {
  const out = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])) as Record<Category, number>;
  for (const e of pool) out[e.category] += 1;
  return out;
}
