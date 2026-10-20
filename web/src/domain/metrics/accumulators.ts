// Statistical accumulators (port of src/backend/analysis/metrics/accumulators.py).
// Modular sub-accumulators maintain state and produce the final metrics output.

import {
  ADVANTAGE_DRILLS,
  ADVANTAGE_KEYS,
  COLORS,
  DRAW_BUCKETS,
  MAX_DRILL_DOWN_ITEMS,
  MOTIF_NAMES,
  NON_DRAW_TERM_TYPES,
  PHASES,
  PIECE_NAMES,
  QUALITY_NAMES,
  QUALITY_PACE_KEYS,
  TERM_TYPES,
} from "./constants";
import type { GameRecord } from "./models";

type Dict = Record<string, any>;

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Percentage, safely returning 0 when the denominator is zero. */
export function pct(num: number, denom: number): number {
  return denom ? (num / denom) * 100 : 0;
}

function appendCapped<T>(target: T[], item: T, maxLen = MAX_DRILL_DOWN_ITEMS): void {
  if (target.length < maxLen) target.push(item);
}

const zeros = (keys: readonly string[]): Record<string, number> =>
  Object.fromEntries(keys.map((k) => [k, 0]));

export class ColorStats {
  wins = 0;
  draws = 0;
  losses = 0;
  total = 0;
  total_acc = 0;
  acc_count = 0;
  blunders = 0;
  pieces_hung = 0;

  toDict(): Dict {
    return {
      wins: this.wins,
      draws: this.draws,
      losses: this.losses,
      total: this.total,
      total_acc: this.total_acc,
      acc_count: this.acc_count,
      blunders: this.blunders,
      pieces_hung: this.pieces_hung,
      avg_accuracy: this.acc_count > 0 ? this.total_acc / this.acc_count : 0,
    };
  }
}

export class FormatStats {
  games = 0;
  wins = 0;
  draws = 0;
  losses = 0;
  acc_sum = 0;
  acc_count = 0;
  time_losses = 0;
  total_time_spent = 0;
  timed_moves = 0;

  toDict(name: string): Dict {
    return {
      name,
      games: this.games,
      wins: this.wins,
      draws: this.draws,
      losses: this.losses,
      win_rate: pct(this.wins, this.games),
      avg_accuracy: this.acc_count > 0 ? this.acc_sum / this.acc_count : 0,
      time_losses: this.time_losses,
      avg_move_time: this.timed_moves > 0 ? this.total_time_spent / this.timed_moves : 0,
      timed_moves: this.timed_moves,
    };
  }
}

export class OpeningStats {
  total = 0;
  wins = 0;
  draws = 0;
  losses = 0;
  as_white = 0;
  as_black = 0;
  white_wins = 0;
  black_wins = 0;
  total_acc = 0;
  acc_count = 0;
  variations: string[] = [];

  constructor(
    public name: string,
    public eco = "",
  ) {}

  toDict(): Dict {
    return {
      name: this.name,
      eco: this.eco,
      total: this.total,
      wins: this.wins,
      draws: this.draws,
      losses: this.losses,
      as_white: this.as_white,
      as_black: this.as_black,
      white_wins: this.white_wins,
      black_wins: this.black_wins,
      total_acc: this.total_acc,
      acc_count: this.acc_count,
      variations: [...this.variations],
      win_rate: pct(this.wins, this.total),
      avg_acc: this.acc_count > 0 ? this.total_acc / this.acc_count : 0,
    };
  }
}

export class ClockStats {
  total_timed_moves = 0;
  total_time_spent = 0;
  phase_time = zeros(PHASES);
  phase_moves = zeros(PHASES);
  quality_time = zeros(QUALITY_PACE_KEYS);
  quality_moves = zeros(QUALITY_PACE_KEYS);
  normal_moves = 0;
  normal_blunders = 0;
  trouble_moves = 0;
  trouble_blunders = 0;

  /** Merge clock metrics from a game's tactical analysis. */
  merge(cm: Dict): void {
    this.total_timed_moves += cm.total_timed_moves ?? 0;
    this.total_time_spent += cm.total_time_spent ?? 0;
    const pTime: Dict = cm.phase_time_spent ?? {};
    const pMoves: Dict = cm.phase_timed_moves ?? {};
    for (const ph of PHASES) {
      this.phase_time[ph] += pTime[ph] ?? 0;
      this.phase_moves[ph] += pMoves[ph] ?? 0;
    }
    const qTime: Dict = cm.quality_time_spent ?? {};
    const qMoves: Dict = cm.quality_timed_moves ?? {};
    for (const qk of QUALITY_PACE_KEYS) {
      this.quality_time[qk] += qTime[qk] ?? 0;
      this.quality_moves[qk] += qMoves[qk] ?? 0;
    }
    this.normal_moves += cm.normal_moves ?? 0;
    this.normal_blunders += cm.normal_blunders ?? 0;
    this.trouble_moves += cm.trouble_moves ?? 0;
    this.trouble_blunders += cm.trouble_blunders ?? 0;
  }

  toDict(formatsFinal: Record<string, Dict>): Dict {
    const phasePace = Object.fromEntries(
      PHASES.map((ph) => [
        ph,
        {
          avg_time: this.phase_moves[ph] > 0 ? this.phase_time[ph] / this.phase_moves[ph] : 0,
          moves_count: this.phase_moves[ph],
        },
      ]),
    );
    const qualityPace = Object.fromEntries(
      QUALITY_PACE_KEYS.map((qk) => [
        qk,
        {
          avg_time:
            this.quality_moves[qk] > 0 ? this.quality_time[qk] / this.quality_moves[qk] : 0,
          moves_count: this.quality_moves[qk],
        },
      ]),
    );
    const nPct = pct(this.normal_blunders, this.normal_moves);
    const tPct = pct(this.trouble_blunders, this.trouble_moves);
    const panic = nPct > 0 ? tPct / nPct : tPct > 0 ? Infinity : 0;

    return {
      has_clock_data: this.total_timed_moves > 0,
      total_timed_moves: this.total_timed_moves,
      overall_avg_time:
        this.total_timed_moves > 0 ? this.total_time_spent / this.total_timed_moves : 0,
      formats: formatsFinal,
      phase_pace: phasePace,
      quality_pace: qualityPace,
      time_trouble: {
        normal_moves: this.normal_moves,
        normal_blunders: this.normal_blunders,
        normal_blunder_pct: nPct,
        trouble_moves: this.trouble_moves,
        trouble_blunders: this.trouble_blunders,
        trouble_blunder_pct: tPct,
        panic_multiplier: panic,
        total_time_losses: Object.values(formatsFinal).reduce(
          (s, f) => s + (f.time_losses as number),
          0,
        ),
      },
    };
  }
}

export class HangingStats {
  total_hung = 0;
  by_piece = zeros(PIECE_NAMES);
  hanging_blunders = 0;
  opponent_hanging_captured = 0;
  opponent_hanging_missed = 0;
  captured_by_piece = zeros(PIECE_NAMES);

  /** Merge hanging piece metrics and return total pieces hung in this game. */
  merge(h: Dict): number {
    const hung: number = h.total_hung ?? 0;
    this.total_hung += hung;
    this.hanging_blunders += h.hanging_blunders ?? 0;
    this.opponent_hanging_captured += h.opponent_hanging_captured ?? 0;
    this.opponent_hanging_missed += h.opponent_hanging_missed ?? 0;
    for (const [p, c] of Object.entries((h.by_piece ?? {}) as Record<string, number>)) {
      if (p in this.by_piece) this.by_piece[p] += c;
    }
    for (const [p, c] of Object.entries((h.captured_by_piece ?? {}) as Record<string, number>)) {
      if (p in this.captured_by_piece) this.captured_by_piece[p] += c;
    }
    return hung;
  }

  toDict(): Dict {
    return {
      total_hung: this.total_hung,
      by_piece: { ...this.by_piece },
      hanging_blunders: this.hanging_blunders,
      opponent_hanging_captured: this.opponent_hanging_captured,
      opponent_hanging_missed: this.opponent_hanging_missed,
      captured_by_piece: { ...this.captured_by_piece },
    };
  }
}

export class AdvantageStats {
  counts = zeros(ADVANTAGE_KEYS);

  merge(adv: Dict): void {
    for (const k of ADVANTAGE_KEYS) if (adv[k]) this.counts[k] += 1;
  }

  toDict(): Dict {
    const hwa = this.counts.had_winning_advantage;
    const hlp = this.counts.had_losing_position;
    return {
      ...this.counts,
      conversion_rate: pct(this.counts.converted_advantage, hwa),
      throw_rate: pct(this.counts.thrown_losses, hwa),
      comeback_rate: pct(this.counts.comeback_drawn_or_won, hlp),
    };
  }
}

export class PhaseStats {
  data: Record<string, { acc_sum: number; total_moves: number; blunders: number }> =
    Object.fromEntries(PHASES.map((p) => [p, { acc_sum: 0, total_moves: 0, blunders: 0 }]));

  record(phase: string, accVal: number | null | undefined, moveCnt: number, blunders: number) {
    const entry = this.data[phase];
    if (accVal !== null && accVal !== undefined) {
      const weight = moveCnt > 0 ? moveCnt : 1;
      entry.acc_sum += accVal * weight;
      entry.total_moves += weight;
    }
    entry.blunders += blunders;
  }

  toDict(): Dict {
    const accuracies: Record<string, number> = {};
    const blunders: Record<string, number> = {};
    for (const p of PHASES) {
      const e = this.data[p];
      accuracies[p] = e.total_moves > 0 ? e.acc_sum / e.total_moves : 0;
      blunders[p] = e.blunders;
    }
    return { accuracies, blunders };
  }
}

/** Aggregates multiple GameRecords into comprehensive player metrics. */
export class StatsAccumulator {
  total = 0;
  wins = 0;
  draws = 0;
  losses = 0;
  total_acc = 0;
  acc_count = 0;
  best_win_rating = 0;
  clean_games = 0;

  term_counts = zeros(TERM_TYPES);
  win_term_counts = zeros(NON_DRAW_TERM_TYPES);
  loss_term_counts = zeros(NON_DRAW_TERM_TYPES);
  draw_term_counts = zeros(DRAW_BUCKETS);

  quality_counts = zeros(QUALITY_NAMES);
  accuracy_history: number[] = [];

  color_stats: Record<string, ColorStats> = Object.fromEntries(
    COLORS.map((c) => [c, new ColorStats()]),
  );
  format_stats = new Map<string, FormatStats>();
  detailed_openings = new Map<string, OpeningStats>();

  clock = new ClockStats();
  hanging = new HangingStats();
  phase = new PhaseStats();
  advantage = new AdvantageStats();

  tactical_themes = zeros(MOTIF_NAMES);
  brilliancies: Dict[] = [];

  drill_down: {
    hung_pieces: Record<string, Dict[]>;
    opp_captured: Record<string, Dict[]>;
    tactical_themes: Record<string, Dict[]>;
    advantage: Record<string, Dict[]>;
    blunders: Dict[];
    clean_games: Dict[];
    openings: Record<string, Dict[]>;
  } = {
    hung_pieces: { all: [], ...Object.fromEntries(PIECE_NAMES.map((p) => [p, [] as Dict[]])) },
    opp_captured: { all: [], ...Object.fromEntries(PIECE_NAMES.map((p) => [p, [] as Dict[]])) },
    tactical_themes: Object.fromEntries(MOTIF_NAMES.map((m) => [m, [] as Dict[]])),
    advantage: { thrown_losses: [], squandered_draws: [], comeback_wins: [], comeback_draws: [] },
    blunders: [],
    clean_games: [],
    openings: {},
  };

  /** Accumulate a single game record into the running statistics. */
  add(rec: GameRecord): void {
    this.total += 1;
    const cStat = this.color_stats[rec.user_color];
    cStat.total += 1;

    // 1. Outcomes
    if (rec.is_win) {
      this.wins += 1;
      cStat.wins += 1;
    } else if (rec.is_draw) {
      this.draws += 1;
      cStat.draws += 1;
    } else if (rec.is_loss) {
      this.losses += 1;
      cStat.losses += 1;
    }

    // 2. Terminations
    this.term_counts[rec.term_type] = (this.term_counts[rec.term_type] ?? 0) + 1;
    if (rec.is_draw && rec.draw_type) {
      this.draw_term_counts[rec.draw_type] = (this.draw_term_counts[rec.draw_type] ?? 0) + 1;
    } else if (rec.is_win && rec.term_type in this.win_term_counts) {
      this.win_term_counts[rec.term_type] += 1;
    } else if (rec.is_loss && rec.term_type in this.loss_term_counts) {
      this.loss_term_counts[rec.term_type] += 1;
    }

    // 3. Formats
    let fEntry = this.format_stats.get(rec.speed);
    if (!fEntry) {
      fEntry = new FormatStats();
      this.format_stats.set(rec.speed, fEntry);
    }
    fEntry.games += 1;
    if (rec.is_win) fEntry.wins += 1;
    else if (rec.is_draw) fEntry.draws += 1;
    else if (rec.is_loss) fEntry.losses += 1;

    const termModeRaw = (rec.raw_game.termination_mode || "").trim().toLowerCase();
    const termRaw = (rec.raw_game.termination || "").toLowerCase();
    if (
      rec.is_loss &&
      (rec.term_type === "Time" || termModeRaw === "timeout" || termRaw.includes("time"))
    ) {
      fEntry.time_losses += 1;
    }

    // 4. Accuracy & move quality
    if (rec.game_acc > 0) {
      this.total_acc += rec.game_acc;
      this.acc_count += 1;
      cStat.total_acc += rec.game_acc;
      cStat.acc_count += 1;
      this.accuracy_history.push(rec.game_acc);
      fEntry.acc_sum += rec.game_acc;
      fEntry.acc_count += 1;
    }

    for (const [qk, count] of Object.entries(rec.quality_counts)) {
      this.quality_counts[qk] = (this.quality_counts[qk] ?? 0) + count;
    }

    cStat.blunders += rec.blunders_count;
    const startFen = rec.raw_game.starting_fen || STARTING_FEN;
    if (rec.blunders_count === 0) {
      this.clean_games += 1;
      appendCapped(this.drill_down.clean_games, {
        ...rec.game_meta,
        is_game: true,
        ply: 1,
        move_number: 1,
        move_display: "0 Patzer",
        classification: "Clean Game",
        description:
          rec.game_acc > 0 ? `Genauigkeit: ${rec.game_acc.toFixed(1)}% • 0 Patzer` : "0 Patzer",
        fen_before: startFen,
      });
    }

    // 5. Best win rating
    if (rec.is_win && rec.opp_elo > this.best_win_rating) this.best_win_rating = rec.opp_elo;

    // 6. Openings
    if (rec.opening) {
      const mainName = rec.opening.split(":")[0].split(",")[0].trim();
      const varName = rec.opening
        .slice(mainName.length)
        .replace(/^[:,]+/, "")
        .trim();

      let dOp = this.detailed_openings.get(mainName);
      if (!dOp) {
        dOp = new OpeningStats(mainName, rec.eco);
        this.detailed_openings.set(mainName, dOp);
      }
      dOp.total += 1;
      if (!dOp.eco && rec.eco) dOp.eco = rec.eco;
      if (rec.is_win) dOp.wins += 1;
      else if (rec.is_draw) dOp.draws += 1;
      else if (rec.is_loss) dOp.losses += 1;

      if (rec.user_color === "white") {
        dOp.as_white += 1;
        if (rec.is_win) dOp.white_wins += 1;
      } else {
        dOp.as_black += 1;
        if (rec.is_win) dOp.black_wins += 1;
      }
      if (rec.game_acc > 0) {
        dOp.total_acc += rec.game_acc;
        dOp.acc_count += 1;
      }
      if (varName && !dOp.variations.includes(varName)) dOp.variations.push(varName);

      const bucket = (this.drill_down.openings[mainName] ??= []);
      appendCapped(bucket, {
        ...rec.game_meta,
        is_game: true,
        ply: 1,
        move_number: 1,
        move_display: rec.eco || "Eröffnung",
        classification:
          rec.game_acc > 0 ? `${rec.game_acc.toFixed(1)}% Gen.` : rec.eco || "Eröffnung",
        description:
          rec.game_acc > 0
            ? `${rec.opening} • ${rec.game_acc.toFixed(1)}% Genauigkeit`
            : rec.opening,
        fen_before: startFen,
      });
    }

    // 7. Tactics data
    const tactics = rec.tactics_data;
    if (!tactics) return;

    const cm = tactics.clock_metrics;
    if (cm) {
      fEntry.total_time_spent += cm.total_time_spent ?? 0;
      fEntry.timed_moves += cm.total_timed_moves ?? 0;
      this.clock.merge(cm);
    }

    cStat.pieces_hung += this.hanging.merge(tactics.hanging_metrics ?? {});

    const pAcc: Dict = tactics.phase_accuracies ?? {};
    const pBlund: Dict = tactics.phase_blunders ?? {};
    const pCounts: Dict = tactics.phase_move_counts ?? {};
    for (const phase of PHASES) {
      this.phase.record(phase, pAcc[phase], pCounts[phase] ?? 0, pBlund[phase] ?? 0);
    }

    const adv: Dict = tactics.advantage_metrics ?? {};
    this.advantage.merge(adv);

    for (const [motif, count] of Object.entries((tactics.tactical_themes ?? {}) as Dict)) {
      if (motif in this.tactical_themes) this.tactical_themes[motif] += count as number;
    }

    for (const b of (tactics.brilliancies ?? []) as Dict[]) {
      appendCapped(this.brilliancies, {
        ...rec.game_meta,
        san: b.san,
        uci: b.uci,
        fen_before: b.fen_before,
        ply: b.ply,
        move_number: b.move_number,
        classification: b.classification,
        explanation: b.explanation,
        opening_name: b.opening_name || rec.game_meta.opening,
      });
    }

    for (const h of (tactics.hung_pieces_details ?? []) as Dict[]) {
      const item = { ...rec.game_meta, ...h };
      appendCapped(this.drill_down.hung_pieces.all, item);
      const p = String(h.piece_name ?? "").toLowerCase();
      if (p in this.drill_down.hung_pieces) appendCapped(this.drill_down.hung_pieces[p], item);
    }
    for (const c of (tactics.opp_captured_details ?? []) as Dict[]) {
      const item = { ...rec.game_meta, ...c };
      appendCapped(this.drill_down.opp_captured.all, item);
      const p = String(c.piece_name ?? "").toLowerCase();
      if (p in this.drill_down.opp_captured) appendCapped(this.drill_down.opp_captured[p], item);
    }
    for (const tm of (tactics.tactical_motifs_details ?? []) as Dict[]) {
      const motif = String(tm.motif ?? "").toLowerCase();
      if (motif in this.drill_down.tactical_themes) {
        appendCapped(this.drill_down.tactical_themes[motif], { ...rec.game_meta, ...tm });
      }
    }
    for (const b of (tactics.blunders_details ?? []) as Dict[]) {
      appendCapped(this.drill_down.blunders, { ...rec.game_meta, ...b });
    }

    for (const [advKey, moveKey, fallbackSan, fallbackClass] of ADVANTAGE_DRILLS) {
      if (!adv[advKey]) continue;
      const mv = tactics[moveKey] as Dict | null | undefined;
      appendCapped(
        this.drill_down.advantage[advKey],
        mv
          ? { ...rec.game_meta, ...mv }
          : { ...rec.game_meta, san: fallbackSan, classification: fallbackClass },
      );
    }
  }

  /** Produce the complete statistical dictionary for consumers. */
  finalize(
    colorFilter = "All Colors",
    formatFilter = "All Formats",
    sourceFilter = "All Sources",
    dateFilter = "All Time",
  ): Dict {
    const openings: Record<string, number> = {};
    const openingWins: Record<string, number> = {};
    const detailed: Record<string, Dict> = {};
    for (const [name, op] of this.detailed_openings) {
      openings[name] = op.total;
      if (op.wins > 0) openingWins[name] = op.wins;
      detailed[name] = op.toDict();
    }

    const q = this.quality_counts;
    const legacyQuality = {
      Best: q.Best + q.Brilliant + q.Great,
      Inaccuracy: q.Inaccuracy,
      Mistake: q.Mistake,
      Blunder: q.Blunder,
    };

    const formatsFinal: Record<string, Dict> = {};
    for (const [sp, f] of this.format_stats) formatsFinal[sp] = f.toDict(sp);

    return {
      total: this.total,
      wins: this.wins,
      losses: this.losses,
      draws: this.draws,
      win_rate: pct(this.wins, this.total),
      avg_accuracy: this.acc_count ? this.total_acc / this.acc_count : 0,
      best_win: this.best_win_rating > 0 ? String(this.best_win_rating) : "N/A",
      term_counts: this.term_counts,
      win_term_counts: this.win_term_counts,
      loss_term_counts: this.loss_term_counts,
      draw_term_counts: this.draw_term_counts,
      time_loss_pct: this.losses > 0 ? pct(this.loss_term_counts.Time, this.losses) : 0,
      quality_counts: legacyQuality,
      detailed_quality_counts: this.quality_counts,
      accuracy_history: this.accuracy_history,
      openings,
      opening_wins: openingWins,
      detailed_openings: detailed,
      color_stats: Object.fromEntries(COLORS.map((c) => [c, this.color_stats[c].toDict()])),
      hanging_stats: this.hanging.toDict(),
      clean_games: this.clean_games,
      clean_games_pct: pct(this.clean_games, this.total),
      phase_stats: this.phase.toDict(),
      advantage_stats: this.advantage.toDict(),
      brilliancies: this.brilliancies,
      tactical_themes: this.tactical_themes,
      drill_down: this.drill_down,
      time_stats: this.clock.toDict(formatsFinal),
      filter_applied: {
        color: colorFilter,
        format: formatFilter,
        source: sourceFilter,
        date: dateFilter,
      },
    };
  }
}
