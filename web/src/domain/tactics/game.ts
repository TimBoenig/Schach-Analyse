// Game tactical analysis: phase accuracies, hanging pieces, motifs,
// advantage conversion and drill-down details
// (port of src/backend/analysis/tactics/game.py).

import {
  applyAccuracyFloor,
  calculateMoveAccuracy,
  calculateVolatilityWeights,
  harmonicMean,
  weightedMean,
} from "../math";
import type { MoveData, Side } from "../types";
import { Board, BLACK, type Move, moveFromUci, square, squareFile, squareName, squareRank, WHITE } from "./board";
import { toUserCp, toUserWp } from "./board_utils";
import {
  ADVANTAGE_THRESHOLD_CP,
  BAD_MOVE_CLASSIFICATIONS,
  BLUNDER_CLASSIFICATIONS,
  BRILLIANT_CLASSIFICATIONS,
  DEFAULT_TROUBLE_SECONDS,
  type GamePhase,
  GOOD_MOVE_WP_DROP_THRESHOLD,
  MAX_REASONABLE_TIME_SECONDS,
  MoveQualityBucket,
  PHASES,
  PIECE_NAMES_ORDERED,
  PIECE_VALUES,
  SOUND_MOVE_WP_DROP_THRESHOLD,
  SOUND_TACTIC_MAX_WP_DROP,
  TACTICAL_THEMES,
  TROUBLE_SECONDS,
  TURNING_POINT_MIN_WP_SWING,
  WINNING_WP_THRESHOLD,
} from "./constants";
import { getHangingPieces, type HangingPiece } from "./hanging";
import { detectTacticalMotifs } from "./motifs";
import { classifyGamePhase } from "./phase";

/** Move input: stored MoveData or the looser dicts used by tests/imports. */
export type TacticsMoveInput = Partial<MoveData> & {
  fen_after?: string;
  is_book?: boolean;
  eval_diff?: number | null;
};

type Detail = Record<string, any>;

/** Python round(x, n) for display values (half-away rounding). */
function round(x: number, n: number): number {
  const f = 10 ** n;
  return Math.round(x * f) / f;
}

export interface MoveCtx {
  ply: number;
  move_number: number;
  san: string;
  uci: string;
  fen_before: string;
  fen_after: string;
  classification: string;
  eval_user_cp: number | null;
  eval_after_user: number | null;
  eval_diff: number | null;
  wp_drop: number;
  player_wp_before: number;
  player_wp_after: number;
  is_user_move: boolean;
  is_book: boolean;
  is_mating_move: boolean;
  is_checkmate_move: boolean;
  board_before: Board;
  board_after: Board | null;
  move_obj: Move | null;
  phase: GamePhase;
  time_spent: number | null;
  time_left: number | null;
  opening_name: string;
  explanation: string;
}

/** Standardized 11-key drill-down detail dictionary. */
function moveDetail(mv: MoveCtx, extra: Detail = {}): Detail {
  return {
    ply: mv.ply,
    move_number: mv.move_number,
    san: mv.san,
    uci: mv.uci,
    fen_before: mv.fen_before,
    fen_after: mv.fen_after,
    classification: mv.classification,
    eval_before_cp: mv.eval_user_cp,
    eval_after_cp: mv.eval_after_user,
    eval_drop: mv.eval_diff,
    wp_drop: round(mv.wp_drop, 3),
    ...extra,
  };
}

function phaseRecord<T>(init: () => T): Record<GamePhase, T> {
  return Object.fromEntries(PHASES.map((p) => [p, init()])) as Record<GamePhase, T>;
}

function bucketRecord(): Record<MoveQualityBucket, number> {
  return { [MoveQualityBucket.BEST]: 0, [MoveQualityBucket.BLUNDER]: 0, [MoveQualityBucket.OTHER]: 0 };
}

/** Aggregates clock timing, time-trouble and quality stats. */
export class ClockStats {
  total_timed_moves = 0;
  total_time_spent = 0.0;
  normal_moves = 0;
  normal_blunders = 0;
  trouble_moves = 0;
  trouble_blunders = 0;
  phase_time_spent = phaseRecord(() => 0.0);
  phase_timed_moves = phaseRecord(() => 0);
  quality_time_spent = bucketRecord();
  quality_timed_moves = bucketRecord();

  record(
    timeSpent: number | null,
    timeLeft: number | null,
    phase: GamePhase,
    classification: string,
    troubleThreshold: number,
  ): void {
    if (timeSpent !== null && timeSpent >= 0.0 && timeSpent < MAX_REASONABLE_TIME_SECONDS) {
      this.total_timed_moves += 1;
      this.total_time_spent += timeSpent;
      if (phase in this.phase_time_spent) {
        this.phase_time_spent[phase] += timeSpent;
        this.phase_timed_moves[phase] += 1;
      }
      let bucket: MoveQualityBucket;
      if (["Brilliant", "Great", "Best"].includes(classification)) bucket = MoveQualityBucket.BEST;
      else if (["Blunder", "Mistake"].includes(classification)) bucket = MoveQualityBucket.BLUNDER;
      else bucket = MoveQualityBucket.OTHER;
      this.quality_time_spent[bucket] += timeSpent;
      this.quality_timed_moves[bucket] += 1;
    }

    if (timeLeft !== null && timeLeft >= 0.0) {
      const isBad = classification === "Blunder" || classification === "Mistake";
      if (timeLeft <= troubleThreshold) {
        this.trouble_moves += 1;
        if (isBad) this.trouble_blunders += 1;
      } else {
        this.normal_moves += 1;
        if (isBad) this.normal_blunders += 1;
      }
    }
  }

  toDict(): Record<string, any> {
    const roundAll = (rec: Record<string, number>) =>
      Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, round(v, 1)]));
    return {
      total_timed_moves: this.total_timed_moves,
      total_time_spent: round(this.total_time_spent, 1),
      phase_time_spent: roundAll(this.phase_time_spent),
      phase_timed_moves: { ...this.phase_timed_moves },
      quality_time_spent: roundAll(this.quality_time_spent),
      quality_timed_moves: { ...this.quality_timed_moves },
      normal_moves: this.normal_moves,
      normal_blunders: this.normal_blunders,
      trouble_moves: this.trouble_moves,
      trouble_blunders: this.trouble_blunders,
    };
  }
}

/** Tactical tracking state accumulated across a full game. */
export class TacticsState {
  phase_accuracies = phaseRecord<number[]>(() => []);
  phase_win_percents = phaseRecord<number[]>(() => []);
  phase_blunders = phaseRecord(() => 0);
  phase_move_counts = phaseRecord(() => 0);
  pieces_hung_by_type: Record<string, number> = Object.fromEntries(PIECE_NAMES_ORDERED.map((n) => [n, 0]));
  captured_by_piece: Record<string, number> = Object.fromEntries(PIECE_NAMES_ORDERED.map((n) => [n, 0]));
  tactical_themes: Record<string, number> = Object.fromEntries(TACTICAL_THEMES.map((t) => [t, 0]));

  brilliancies: Detail[] = [];
  hung_pieces_details: Detail[] = [];
  opp_captured_details: Detail[] = [];
  tactical_motifs_details: Detail[] = [];
  blunders_details: Detail[] = [];

  had_winning_advantage = false;
  converted_advantage = false;
  choked_advantage = false;
  thrown_losses = false;
  squandered_draws = false;
  had_losing_position = false;
  comeback_drawn_or_won = false;
  comeback_wins = false;
  comeback_draws = false;
  lost_deficit = false;

  max_lead_drop = 0.0;
  max_comeback_gain = 0.0;
  lead_collapse_move: Detail | null = null;
  comeback_turn_move: Detail | null = null;

  peak_eval_cp: number | null = null;
  lowest_eval_cp: number | null = null;
  book_exit_ply: number | null = null;
  total_hung = 0;
  hanging_blunders = 0;
  opponent_hanging_captured = 0;
  opponent_hanging_missed = 0;

  clock_stats = new ClockStats();
}

/** Harmonic + volatility-weighted phase accuracy. */
function phaseAccuracy(accuracies: number[], winPercents: number[]): number | null {
  if (accuracies.length === 0) return null;
  if (accuracies.length === 1) return accuracies[0];
  const windowSize = Math.max(2, Math.min(8, Math.floor(accuracies.length / 10)));
  const weights = calculateVolatilityWeights(winPercents, windowSize);
  return (weightedMean(accuracies, weights) + harmonicMean(accuracies)) / 2.0;
}

function recordAccuracy(ctx: MoveCtx, state: TacticsState): void {
  state.phase_move_counts[ctx.phase] += 1;
  let accuracy =
    ctx.is_book || ctx.is_checkmate_move || ctx.is_mating_move
      ? 100.0
      : calculateMoveAccuracy(ctx.player_wp_before, ctx.player_wp_after);
  accuracy = applyAccuracyFloor(accuracy);
  state.phase_accuracies[ctx.phase].push(accuracy);
  state.phase_win_percents[ctx.phase].push(ctx.player_wp_before);

  if (BLUNDER_CLASSIFICATIONS.has(ctx.classification)) {
    state.phase_blunders[ctx.phase] += 1;
    state.blunders_details.push(moveDetail(ctx));
  }
}

function recordHanging(
  ctx: MoveCtx,
  state: TacticsState,
  hangingBefore: HangingPiece[],
  hangingAfter: HangingPiece[],
): void {
  const isAdvantageousOrSound =
    ctx.is_book ||
    ["Brilliant", "Great", "Best", "Excellent"].includes(ctx.classification) ||
    (ctx.classification === "Good" && ctx.wp_drop < GOOD_MOVE_WP_DROP_THRESHOLD) ||
    (ctx.wp_drop < SOUND_MOVE_WP_DROP_THRESHOLD && ctx.player_wp_after >= WINNING_WP_THRESHOLD);
  if (isAdvantageousOrSound) return;

  const hungBefore = new Set(hangingBefore.map((h) => h.square));
  const toSqName = ctx.move_obj ? squareName(ctx.move_obj.to) : "";
  const newlyHung = hangingAfter.filter((h) => !hungBefore.has(h.square) || h.square === toSqName);
  if (newlyHung.length === 0) return;

  state.total_hung += newlyHung.length;
  for (const h of newlyHung) {
    if (h.piece_name in state.pieces_hung_by_type) state.pieces_hung_by_type[h.piece_name] += 1;
    state.hung_pieces_details.push(moveDetail(ctx, { piece_name: h.piece_name, square: h.square }));
  }
  if (BAD_MOVE_CLASSIFICATIONS.has(ctx.classification)) state.hanging_blunders += 1;
}

function recordOppHanging(
  ctx: MoveCtx,
  state: TacticsState,
  oppHangingBefore: HangingPiece[],
  prevMoveObj: Move | null,
  prevBoardBefore: Board | null,
): void {
  if (oppHangingBefore.length === 0 || !ctx.move_obj) return;

  // Routine recapture filter: capturing on the square where the opponent
  // just took an equal or greater value piece completes an exchange and is
  // not capitalizing on a hanging piece.
  if (prevMoveObj !== null && prevBoardBefore !== null && prevMoveObj.to === ctx.move_obj.to) {
    let oppCaptured = prevBoardBefore.pieceAt(ctx.move_obj.to);
    if (oppCaptured === null && prevBoardBefore.isEnPassant(prevMoveObj)) {
      oppCaptured = prevBoardBefore.pieceAt(square(squareFile(prevMoveObj.to), squareRank(prevMoveObj.from)));
    }
    if (oppCaptured !== null) {
      const oppCapturedVal = PIECE_VALUES[oppCaptured.type];
      const oppMover = ctx.board_before.pieceAt(ctx.move_obj.to);
      const oppMoverVal = oppMover !== null ? PIECE_VALUES[oppMover.type] : 0;
      if (oppCapturedVal >= oppMoverVal) return;
    }
  }

  const oppHung = new Map(oppHangingBefore.map((h) => [h.square, h]));
  const toSqName = squareName(ctx.move_obj.to);
  const captured = oppHung.get(toSqName);
  if (captured) {
    // Only count when the user didn't blunder into a trap / poisoned piece
    if (!BAD_MOVE_CLASSIFICATIONS.has(ctx.classification) && ctx.wp_drop < SOUND_TACTIC_MAX_WP_DROP) {
      state.opponent_hanging_captured += 1;
      if (captured.piece_name in state.captured_by_piece) state.captured_by_piece[captured.piece_name] += 1;
      state.opp_captured_details.push({
        piece_name: captured.piece_name,
        square: toSqName,
        ply: ctx.ply,
        move_number: ctx.move_number,
        san: ctx.san,
        uci: ctx.uci,
        fen_before: ctx.fen_before,
        fen_after: ctx.fen_after,
        classification: ctx.classification,
        eval_before_cp: ctx.eval_user_cp,
      });
    }
  } else if (["Mistake", "Blunder", "Miss"].includes(ctx.classification)) {
    state.opponent_hanging_missed += 1;
  }
}

function recordMotifs(ctx: MoveCtx, state: TacticsState): void {
  if (!ctx.move_obj || !ctx.board_after) return;
  if (BAD_MOVE_CLASSIFICATIONS.has(ctx.classification) || ctx.wp_drop >= SOUND_TACTIC_MAX_WP_DROP) return;
  for (const motif of detectTacticalMotifs(ctx.board_before, ctx.board_after, ctx.move_obj, ctx.board_before.turn)) {
    if (motif in state.tactical_themes) {
      state.tactical_themes[motif] += 1;
      state.tactical_motifs_details.push(moveDetail(ctx, { motif }));
    }
  }
}

function recordBrilliancies(ctx: MoveCtx, state: TacticsState): void {
  if (!BRILLIANT_CLASSIFICATIONS.has(ctx.classification)) return;
  state.brilliancies.push({
    ply: ctx.ply,
    move_number: ctx.move_number,
    san: ctx.san,
    uci: ctx.uci,
    fen_before: ctx.fen_before,
    classification: ctx.classification,
    explanation: ctx.explanation,
    opening_name: ctx.opening_name,
    time_spent: ctx.time_spent,
  });
}

function recordTurningPoints(ctx: MoveCtx, state: TacticsState): void {
  if (ctx.eval_user_cp !== null) {
    if (state.peak_eval_cp === null || ctx.eval_user_cp > state.peak_eval_cp) state.peak_eval_cp = ctx.eval_user_cp;
    if (state.lowest_eval_cp === null || ctx.eval_user_cp < state.lowest_eval_cp) {
      state.lowest_eval_cp = ctx.eval_user_cp;
    }
    if (ctx.eval_user_cp >= ADVANTAGE_THRESHOLD_CP) state.had_winning_advantage = true;
    if (ctx.eval_user_cp <= -ADVANTAGE_THRESHOLD_CP) state.had_losing_position = true;
  }

  if (state.had_winning_advantage && ctx.wp_drop > state.max_lead_drop && ctx.wp_drop > TURNING_POINT_MIN_WP_SWING) {
    state.max_lead_drop = ctx.wp_drop;
    state.lead_collapse_move = moveDetail(ctx);
  }

  const wpGain = ctx.player_wp_after - ctx.player_wp_before;
  if (state.had_losing_position && wpGain > state.max_comeback_gain && wpGain > TURNING_POINT_MIN_WP_SWING) {
    state.max_comeback_gain = wpGain;
    state.comeback_turn_move = {
      ply: ctx.ply,
      move_number: ctx.move_number,
      san: ctx.san,
      uci: ctx.uci,
      fen_before: ctx.fen_before,
      fen_after: ctx.fen_after,
      classification: ctx.classification,
      eval_before_cp: ctx.eval_user_cp,
      eval_after_cp: ctx.eval_after_user,
      eval_gain: ctx.eval_diff !== null ? -ctx.eval_diff : null,
      wp_gain: round(wpGain, 3),
    };
  }
}

function tryBoard(fen: string): Board | null {
  try {
    return new Board(fen);
  } catch {
    return null;
  }
}

/**
 * Full tactical, phase and advantage analysis of a game's moves from the
 * perspective of `side`. Returns the same snake_case structure as the Python
 * analyze_game_tactics (phase_accuracies, hanging_metrics, advantage_metrics,
 * brilliancies, tactical_themes, drill-down detail lists, book_exit_ply,
 * clock_metrics, ...).
 */
export function analyzeGameTactics(
  moves: readonly TacticsMoveInput[],
  side: Side,
  result = "*",
  speedCategory = "Blitz",
): Record<string, any> {
  const isUserWhite = side.toLowerCase() === "white";
  const targetColor = isUserWhite ? WHITE : BLACK;

  const cat = (speedCategory || "blitz").toLowerCase();
  let troubleThreshold = DEFAULT_TROUBLE_SECONDS;
  for (const [k, v] of Object.entries(TROUBLE_SECONDS)) {
    if (cat.includes(k)) {
      troubleThreshold = v;
      break;
    }
  }

  const state = new TacticsState();
  let cachedHangingTarget: HangingPiece[] | null = null;
  let cachedHangingEnemy: HangingPiece[] | null = null;
  let prevMoveObj: Move | null = null;
  let prevBoardBefore: Board | null = null;

  moves.forEach((md, idx) => {
    const ply = md.ply ?? idx;
    const moveNumber = md.move_number ?? Math.floor((ply + 1) / 2);
    const san = md.san ?? "";
    const uci = md.uci ?? "";
    const fenBefore = md.fen_before ?? "";
    let fenAfter = md.fen_after ?? "";
    const classification = md.classification ?? "";
    const isBook = Boolean(md.is_book_move ?? md.is_book ?? false);
    const evalBeforeRaw = md.eval_before_cp ?? null;
    const evalAfterRaw = md.eval_after_cp ?? null;
    const evalAfterMate = md.eval_after_mate ?? null;

    const playerWpBefore = toUserWp(md.win_chance_before ?? 0.5, isUserWhite);
    const playerWpAfter = toUserWp(md.win_chance_after ?? 0.5, isUserWhite);

    const isCheckmateMove = san ? san.endsWith("#") : false;
    const isMatingMove =
      evalAfterMate !== null && ((isUserWhite && evalAfterMate > 0) || (!isUserWhite && evalAfterMate < 0));

    const boardBefore = (fenBefore ? tryBoard(fenBefore) : null) ?? new Board();
    const isWhiteTurn = fenBefore ? boardBefore.turn === WHITE : ply % 2 === 0;
    const isUserMove = isWhiteTurn === isUserWhite;

    const phase = classifyGamePhase(boardBefore, ply, isBook);
    if (!isBook && state.book_exit_ply === null) state.book_exit_ply = ply;

    let moveObj: Move | null = null;
    let boardAfter: Board | null = null;
    if (uci || san) {
      try {
        moveObj = uci ? moveFromUci(uci) : boardBefore.parseSan(san);
        if (fenAfter) {
          boardAfter = new Board(fenAfter);
        } else {
          boardAfter = boardBefore.copy();
          boardAfter.push(moveObj);
        }
      } catch {
        moveObj = null;
        boardAfter = null;
      }
    } else if (fenAfter) {
      boardAfter = tryBoard(fenAfter);
    }
    if (boardAfter !== null) fenAfter = boardAfter.fen();

    const evalUserCp = toUserCp(evalBeforeRaw, isUserWhite);
    const evalAfterUser = toUserCp(evalAfterRaw, isUserWhite);
    const evalDiff =
      evalUserCp !== null && evalAfterUser !== null ? evalUserCp - evalAfterUser : (md.eval_diff ?? null);

    const ctx: MoveCtx = {
      ply,
      move_number: moveNumber,
      san,
      uci,
      fen_before: fenBefore,
      fen_after: fenAfter,
      classification,
      eval_user_cp: evalUserCp,
      eval_after_user: evalAfterUser,
      eval_diff: evalDiff,
      wp_drop: Math.max(0.0, playerWpBefore - playerWpAfter),
      player_wp_before: playerWpBefore,
      player_wp_after: playerWpAfter,
      is_user_move: isUserMove,
      is_book: isBook,
      is_mating_move: isMatingMove,
      is_checkmate_move: isCheckmateMove,
      board_before: boardBefore,
      board_after: boardAfter,
      move_obj: moveObj,
      phase,
      time_spent: md.time_spent ?? null,
      time_left: md.time_left ?? null,
      opening_name: md.opening_name ?? "",
      explanation: md.explanation ?? "",
    };

    if (!isUserMove) {
      if (boardAfter !== null) {
        cachedHangingTarget = getHangingPieces(boardAfter, targetColor);
        cachedHangingEnemy = getHangingPieces(boardAfter, !targetColor, moveObj, boardBefore);
      }
      prevMoveObj = moveObj;
      prevBoardBefore = boardBefore;
      return;
    }

    recordAccuracy(ctx, state);
    recordTurningPoints(ctx, state);
    recordBrilliancies(ctx, state);
    state.clock_stats.record(ctx.time_spent, ctx.time_left, ctx.phase, ctx.classification, troubleThreshold);

    if (moveObj !== null && boardAfter !== null) {
      const hangingBefore: HangingPiece[] = cachedHangingTarget ?? getHangingPieces(boardBefore, targetColor);
      const oppHangingBefore: HangingPiece[] =
        cachedHangingEnemy ?? getHangingPieces(boardBefore, !targetColor, prevMoveObj, prevBoardBefore);
      const hangingAfter = getHangingPieces(boardAfter, targetColor, moveObj, boardBefore);
      cachedHangingTarget = hangingAfter;
      cachedHangingEnemy = getHangingPieces(boardAfter, !targetColor);

      recordHanging(ctx, state, hangingBefore, hangingAfter);
      recordOppHanging(ctx, state, oppHangingBefore, prevMoveObj, prevBoardBefore);
      recordMotifs(ctx, state);
    }

    prevMoveObj = moveObj;
    prevBoardBefore = boardBefore;
  });

  // Finalize advantage conversion
  const isUserWin = (result === "1-0" && isUserWhite) || (result === "0-1" && !isUserWhite);
  const isDraw = result === "1/2-1/2" || result === "Draw";
  const userLost = !isUserWin && !isDraw;

  if (state.had_winning_advantage) {
    state.converted_advantage = isUserWin;
    state.choked_advantage = !isUserWin;
    if (!isUserWin && !isDraw) state.thrown_losses = true;
    else if (isDraw) state.squandered_draws = true;
  }
  if (state.had_losing_position) {
    state.comeback_drawn_or_won = isUserWin || isDraw;
    if (isUserWin) state.comeback_wins = true;
    else if (isDraw) state.comeback_draws = true;
    state.lost_deficit = userLost;
  }

  const phaseAccResults = Object.fromEntries(
    PHASES.map((p) => [p, phaseAccuracy(state.phase_accuracies[p], state.phase_win_percents[p])]),
  ) as Record<GamePhase, number | null>;

  return {
    phase_accuracies: phaseAccResults,
    phase_blunders: state.phase_blunders,
    phase_move_counts: state.phase_move_counts,
    hanging_metrics: {
      total_hung: state.total_hung,
      by_piece: state.pieces_hung_by_type,
      captured_by_piece: state.captured_by_piece,
      hanging_blunders: state.hanging_blunders,
      opponent_hanging_captured: state.opponent_hanging_captured,
      opponent_hanging_missed: state.opponent_hanging_missed,
    },
    advantage_metrics: {
      had_winning_advantage: state.had_winning_advantage,
      converted_advantage: state.converted_advantage,
      choked_advantage: state.choked_advantage,
      thrown_losses: state.thrown_losses,
      squandered_draws: state.squandered_draws,
      had_losing_position: state.had_losing_position,
      comeback_drawn_or_won: state.comeback_drawn_or_won,
      comeback_wins: state.comeback_wins,
      comeback_draws: state.comeback_draws,
      lost_deficit: state.lost_deficit,
      peak_eval_cp: state.peak_eval_cp ?? 0,
      lowest_eval_cp: state.lowest_eval_cp ?? 0,
    },
    brilliancies: state.brilliancies,
    tactical_themes: state.tactical_themes,
    hung_pieces_details: state.hung_pieces_details,
    opp_captured_details: state.opp_captured_details,
    tactical_motifs_details: state.tactical_motifs_details,
    blunders_details: state.blunders_details,
    lead_collapse_move: state.lead_collapse_move,
    comeback_turn_move: state.comeback_turn_move,
    book_exit_ply: state.book_exit_ply,
    clock_metrics: state.clock_stats.toDict(),
  };
}

