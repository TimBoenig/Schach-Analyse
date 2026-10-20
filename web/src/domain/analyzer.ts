// Port of src/backend/analysis/analyzer.py: runs the engine over every position
// of a game, then classifies moves and computes accuracy/ACPL per side.
//
// Engine scores arrive relative to the side to move and are converted to the
// White perspective exactly once, in processAnalysisResults(); everything
// stored on MoveData is White-perspective.
import { Chess } from "chess.js";

import { OpeningBook, type BookData } from "./book";
import { classifyMove } from "./classifier";
import {
  applyAccuracyFloor,
  calculateMoveAccuracy,
  gameAccuracy,
  getCp,
  getWinProbability,
} from "./math";
import type { GameAnalysis, GameSummary, MoveData, PvLine, Side, SideSummary } from "./types";

export interface AnalysisSettings {
  depth: number;
  movetimeMs: number;
  /** 2 lets the classifier compare against the second-best line (Great/Brilliant). */
  multiPv: number;
}

export const DEFAULT_SETTINGS: AnalysisSettings = { depth: 16, movetimeMs: 1000, multiPv: 2 };

export interface PositionEngine {
  analyse(fen: string, limits: { depth: number; movetimeMs: number; multiPv: number }): Promise<PvLine[]>;
}

export interface EvalCache {
  get(key: string): Promise<PvLine[] | undefined>;
  set(key: string, lines: PvLine[]): Promise<void>;
}

export interface ProgressEvent {
  done: number;
  total: number;
  index: number;
  move: MoveData;
}

export interface AnalyzeOptions {
  settings?: AnalysisSettings;
  book?: BookData;
  cache?: EvalCache;
  signal?: AbortSignal;
  onProgress?: (e: ProgressEvent) => void;
  /** Re-analyse from scratch instead of resuming after the last analysed move. */
  restart?: boolean;
}

const CLASSIFICATIONS = [
  "Brilliant",
  "Great",
  "Best",
  "Excellent",
  "Good",
  "Inaccuracy",
  "Mistake",
  "Blunder",
  "Miss",
  "Book",
] as const;

function emptySideSummary(): SideSummary {
  const s: SideSummary = { accuracy: 0, acpl: 0, move_count: 0, accuracies: [], win_percents: [] };
  for (const c of CLASSIFICATIONS) s[c] = 0;
  return s;
}

function sideToMove(fen: string): Side {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

function cacheKey(fen: string, s: AnalysisSettings): string {
  return `${fen}|d${s.depth}|t${s.movetimeMs}|m${s.multiPv}`;
}

function resetMove(m: MoveData): void {
  m.eval_before_cp = null;
  m.eval_before_mate = null;
  m.eval_after_cp = null;
  m.eval_after_mate = null;
  m.classification = "";
  m.explanation = "";
  m.best_move = null;
  m.pv = [];
  m.multi_pvs = [];
  m.win_chance_before = 0.5;
  m.win_chance_after = 0.5;
  m.is_book_move = false;
  m.book_move_count = 0;
  m.book_exit_move = false;
  m.candidate_continuations = [];
}

export function firstUnanalyzedIndex(game: GameAnalysis): number {
  const i = game.moves.findIndex(
    (m) => (m.eval_before_cp === null && m.eval_before_mate === null) || !m.classification,
  );
  return i === -1 ? game.moves.length : i;
}

function pvToSan(fen: string, pv: string[]): string {
  try {
    const board = new Chess(fen);
    const out: string[] = [];
    for (const uci of pv.slice(0, 12)) {
      const mv = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      const num = mv.color === "w" ? `${board.moveNumber()}. ` : out.length === 0 ? `${board.moveNumber() - 1}... ` : "";
      out.push(num + mv.san);
    }
    return out.join(" ");
  } catch {
    return pv.join(" ");
  }
}

/** Stores the engine lines on the move; the best line's score becomes the White-perspective eval_before. */
export function processAnalysisResults(move: MoveData, lines: PvLine[]): void {
  const whiteToMove = sideToMove(move.fen_before) === "white";
  move.multi_pvs = lines.map((l) => ({
    pv: l.pv,
    cp: l.mate !== null ? null : l.cp,
    mate: l.mate,
    depth: l.depth,
    pv_san: pvToSan(move.fen_before, l.pv),
    score_value: l.mate !== null ? `M${l.mate}` : l.cp !== null ? (l.cp / 100).toFixed(2) : "?",
  }));
  const best = move.multi_pvs[0];
  let cp = best ? best.cp : null;
  let mate = best ? best.mate : null;
  if (!whiteToMove) {
    if (cp !== null) cp = -cp;
    if (mate !== null) mate = -mate;
  }
  move.eval_before_cp = cp;
  move.eval_before_mate = mate;
  move.best_move = best?.pv[0] ?? null;
  move.pv = best?.pv ?? [];
}

/** White-perspective score of the final position (mate/stalemate resolved without the engine). */
async function finalPositionScore(
  game: GameAnalysis,
  engine: PositionEngine,
  settings: AnalysisSettings,
): Promise<{ cp: number | null; mate: number | null } | null> {
  const last = game.moves[game.moves.length - 1];
  if (!last) return null;
  const board = new Chess(last.fen_before);
  try {
    board.move({ from: last.uci.slice(0, 2), to: last.uci.slice(2, 4), promotion: last.uci[4] });
  } catch {
    return null; // e.g. a PGN null move ("--") as the last move
  }
  const whiteToMove = board.turn() === "w";
  if (board.isCheckmate()) {
    // The side to move is mated, so the side that just moved wins.
    return { cp: null, mate: whiteToMove ? -1 : 1 };
  }
  if (board.isGameOver()) return { cp: 0, mate: null };
  const lines = await engine.analyse(board.fen(), settings);
  const best = lines[0];
  if (!best) return null;
  const sign = whiteToMove ? 1 : -1;
  return best.mate !== null ? { cp: null, mate: sign * best.mate } : { cp: best.cp !== null ? sign * best.cp : null, mate: null };
}

function nextEval(
  game: GameAnalysis,
  i: number,
  final: { cp: number | null; mate: number | null } | null,
): { cp: number | null; mate: number | null } {
  if (i < game.moves.length - 1) {
    const next = game.moves[i + 1];
    if (next.eval_before_cp !== null || next.eval_before_mate !== null) {
      return { cp: next.eval_before_cp, mate: next.eval_before_mate };
    }
    const cur = game.moves[i];
    if (cur.eval_after_cp !== null || cur.eval_after_mate !== null) {
      return { cp: cur.eval_after_cp, mate: cur.eval_after_mate };
    }
    return { cp: cur.eval_before_cp, mate: cur.eval_before_mate };
  }
  return final ?? { cp: null, mate: null };
}

function wplFor(side: Side, wpBefore: number, wpAfter: number): number {
  return Math.max(0, side === "white" ? wpBefore - wpAfter : wpAfter - wpBefore);
}

/** Classifies every analysed move and builds the per-side summary (accuracy, ACPL, counts). */
export function classifyAndSummarize(
  game: GameAnalysis,
  final: { cp: number | null; mate: number | null } | null,
  bookData: BookData | undefined,
): GameSummary {
  const summary: Record<Side, SideSummary> = { white: emptySideSummary(), black: emptySideSummary() };
  const book = new OpeningBook(bookData ?? {});

  // Positions that repeat get no win-chance loss: steering into a draw by
  // repetition from an equal or worse position is not an error.
  const posKey = (fen: string) => fen.split(" ").slice(0, 4).join(" ");
  const cleanFens: string[] = [];
  if (game.moves.length) {
    cleanFens.push(posKey(game.moves[0].fen_before));
    for (const m of game.moves) {
      try {
        const b = new Chess(m.fen_before);
        b.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] });
        cleanFens.push(posKey(b.fen()));
      } catch {
        cleanFens.push("");
      }
    }
  }
  const fenCounts = new Map<string, number>();
  for (const f of cleanFens) if (f) fenCounts.set(f, (fenCounts.get(f) ?? 0) + 1);

  let recordedExit = false;
  game.moves.forEach((move, i) => {
    if (move.eval_before_cp === null && move.eval_before_mate === null) return;
    const side = sideToMove(move.fen_before);
    const after = nextEval(game, i, final);
    move.eval_after_cp = after.cp;
    move.eval_after_mate = after.mate;

    const wpBefore = getWinProbability(move.eval_before_cp, move.eval_before_mate);
    const isCheckmate = move.san.endsWith("#");
    let wpAfter = isCheckmate ? (side === "white" ? 1.0 : 0.0) : getWinProbability(after.cp, after.mate);

    let protectedRepetition = false;
    const f = cleanFens[i];
    if (f && (fenCounts.get(f) ?? 0) > 1) protectedRepetition = true;
    else {
      const playerWp = side === "white" ? wpBefore : 1 - wpBefore;
      for (let o = -2; o <= 2 && !protectedRepetition; o++) {
        const g = cleanFens[i + o];
        if (g && (fenCounts.get(g) ?? 0) > 1 && playerWp < 0.7) protectedRepetition = true;
      }
    }
    if (protectedRepetition) wpAfter = wpBefore;

    move.win_chance_before = wpBefore;
    move.win_chance_after = wpAfter;
    const wpl = wplFor(side, wpBefore, wpAfter);
    classifyMove(move, wpl, side, move.multi_pvs, i > 0 ? game.moves[i - 1] : null);

    const s = summary[side];
    s[move.classification] += 1;
    s.move_count += 1;

    // ACPL with mates capped at ±2000 and per-move loss capped at 1000.
    const v1 = getCp(move.eval_before_cp, move.eval_before_mate);
    const v2 = getCp(after.cp, after.mate);
    s.acpl += Math.min(1000, Math.max(0, side === "white" ? v1 - v2 : v2 - v1));

    const plyNumber = move.move_number * 2 - (side === "white" ? 1 : 0);
    const br = book.processMove(move.fen_before, move.uci, plyNumber);
    if (br.is_book) {
      s[move.classification] -= 1;
      move.classification = "Book";
      move.explanation = "Eröffnungstheorie.";
      move.is_book_move = true;
      move.book_move_count = br.book_move_count;
      move.candidate_continuations = br.candidate_moves;
      move.eco = br.current_eco ?? "";
      move.opening_name = br.current_opening ?? "";
      s.Book += 1;
      if (br.current_opening) game.metadata.opening = br.current_opening;
      if (br.current_eco) game.metadata.eco = br.current_eco;
    } else if (!recordedExit && !move.book_exit_move) {
      move.book_exit_move = true;
      recordedExit = true;
    }

    const pBefore = side === "white" ? wpBefore : 1 - wpBefore;
    const pAfter = side === "white" ? wpAfter : 1 - wpAfter;
    let acc = calculateMoveAccuracy(pBefore, pAfter);
    const mating =
      move.eval_after_mate !== null &&
      ((side === "white" && move.eval_after_mate > 0) || (side === "black" && move.eval_after_mate < 0));
    // Book moves, mates and moves into a forced mate are optimal by definition.
    if (br.is_book || isCheckmate || mating) acc = 100.0;
    s.accuracies.push(applyAccuracyFloor(acc));
    s.win_percents.push(pBefore);
  });

  for (const side of ["white", "black"] as const) {
    const s = summary[side];
    if (s.move_count > 0) {
      s.acpl /= s.move_count;
      s.accuracy = gameAccuracy(s.accuracies, s.win_percents);
    }
  }
  return { white: summary.white, black: summary.black };
}

/** Classifies one move as soon as the next position is known (live progress only). */
function provisionalClassify(game: GameAnalysis, i: number): void {
  const move = game.moves[i];
  const next = game.moves[i + 1];
  if (!next || (next.eval_before_cp === null && next.eval_before_mate === null)) return;
  const side = sideToMove(move.fen_before);
  move.eval_after_cp = next.eval_before_cp;
  move.eval_after_mate = next.eval_before_mate;
  move.win_chance_before = getWinProbability(move.eval_before_cp, move.eval_before_mate);
  move.win_chance_after = getWinProbability(move.eval_after_cp, move.eval_after_mate);
  classifyMove(move, wplFor(side, move.win_chance_before, move.win_chance_after), side, move.multi_pvs, game.moves[i - 1] ?? null);
}

/**
 * Analyses `game` in place. Resumes after the last analysed move unless
 * `restart` is set. On abort the analysed part is still classified and the
 * summary is marked "paused".
 */
export async function analyzeGame(game: GameAnalysis, engine: PositionEngine, opts: AnalyzeOptions = {}): Promise<GameSummary> {
  const settings = opts.settings ?? DEFAULT_SETTINGS;
  const total = game.moves.length;
  const start = opts.restart ? 0 : firstUnanalyzedIndex(game);
  for (let i = start; i < total; i++) resetMove(game.moves[i]);

  let interrupted = false;
  for (let i = start; i < total; i++) {
    if (opts.signal?.aborted) {
      interrupted = true;
      break;
    }
    const move = game.moves[i];
    const key = cacheKey(move.fen_before, settings);
    let lines = opts.cache ? await opts.cache.get(key) : undefined;
    if (!lines || !lines.length) {
      lines = await engine.analyse(move.fen_before, settings);
      if (opts.cache && lines.length) await opts.cache.set(key, lines);
    }
    processAnalysisResults(move, lines);
    if (i > 0) {
      provisionalClassify(game, i - 1);
      opts.onProgress?.({ done: i, total, index: i - 1, move: game.moves[i - 1] });
    }
  }

  let final: { cp: number | null; mate: number | null } | null = null;
  if (!interrupted && total > 0) {
    if (opts.signal?.aborted) interrupted = true;
    else final = await finalPositionScore(game, engine, settings);
  }

  const summary = classifyAndSummarize(game, final, opts.book);
  const analyzed = game.moves.filter((m) => m.classification).length;
  summary.analysis_status = interrupted ? "paused" : "completed";
  summary.analyzed_moves = interrupted ? analyzed : total;
  summary.total_moves = total;
  game.summary = summary;
  if (total > 0) opts.onProgress?.({ done: total, total, index: total - 1, move: game.moves[total - 1] });
  return summary;
}
