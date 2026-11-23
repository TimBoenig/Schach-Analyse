// The numbers behind the trophies: one pass over a player's finished games
// that counts what the trophy rules ask about (wins, streaks, brilliant
// moves, special mates …). Every trophy is just a stat plus a goal, so the
// rules live in one table (catalog.ts) and this file is the only place that
// reads games.
//
// Everything is computed from games already in the app, so it works the same
// for the user and for every tracked friend, offline, without new data.
// Games against computers count only for the trophies about computers: a bot's
// rating and its mistakes say nothing about a human opponent.

import { classifyTermination, getUserColor, isBotGame, outcomeFor, parseMoves, parsePlayedAt, parseSummary, type Outcome, type RawGame } from "../metrics";
import { detectSpeedCategory } from "../metrics/speed";
import { Board, KNIGHT, square, squareFile, squareRank } from "../tactics/board";
import { localDay } from "../training/progress";
import type { MoveData } from "../types";

export const STAT_KEYS = [
  // volume
  "games", "wins", "draws", "wins_white", "wins_black", "analyzed",
  // time controls and sources
  "bullet_wins", "blitz_wins", "rapid_wins", "classical_wins", "daily_wins", "speeds_won", "chess960_games", "platforms",
  // how games end
  "mates", "timeout_wins", "timeout_losses", "resign_wins", "abandon_wins", "stalemate_draws", "repetition_draws", "bot_wins",
  // streaks and days
  "win_streak", "loss_streak", "rebound", "day_streak", "days_active", "best_day_games", "best_day_wins", "perfect_day",
  "night_games", "early_games", "holiday_games", "friday13_wins",
  // length
  "min_win_plies", "max_game_plies",
  // opponents
  "peak_rating", "max_beaten_rating", "max_beaten_gap", "beat_gm", "max_wins_one_opponent",
  "rival_wins", "rivals_beaten", "max_wins_one_rival",
  // openings
  "openings_distinct", "max_opening_games", "gambit_games", "bongcloud_games", "grob_games", "polish_games",
  // moves
  "promotions", "under_promotions", "max_promotions_game", "en_passants", "queenside_castles",
  "castle_mates", "promo_mates", "mate_knight", "mate_bishop", "mate_pawn", "smothered_mates", "scholars_mates", "fool_mates",
  "max_checks", "max_captures", "max_knight_moves", "max_king_moves", "early_queen_games", "max_think", "min_time_left_win",
  // quality (analysed games only)
  "brilliants", "max_brilliants_game", "best_accuracy", "acc95_games", "clean_games", "blunder_free_streak",
  "max_blunders_game", "chaos_wins", "lowest_wp_win", "highest_wp_lost",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

/** A stat's value and one game that shows it (the first that reached it), for "show me the game". */
export interface Stat {
  /** null = never happened (only matters for "lowest" stats, which start empty). */
  value: number | null;
  game?: string;
}

export type TrophyStats = Record<StatKey, Stat>;

/** A game needs this many moves of the player before accuracy-based trophies count it: a 10-move game is too short to be "perfect". */
export const MIN_QUALITY_MOVES = 20;
/** Shorter games do not break or extend a streak without blunders. */
export const MIN_STREAK_MOVES = 10;

export interface TrophyOptions {
  /** Usernames of the friends to count duels against (lower case is fine). */
  rivals?: string[];
}

interface Fact {
  id: string;
  at: number;
  day: string | null;
  hour: number | null;
  color: "white" | "black";
  outcome: Outcome;
  speed: string;
  source: string;
  chess960: boolean;
  term: string;
  draw: string | null;
  opp: string;
  myRating: number | null;
  oppRating: number | null;
  oppTitle: string;
  opening: string;
  family: string;
  bot: boolean;
  plies: number;
  userMoves: number;
  analyzed: boolean;
  accuracy: number;
  counts: Record<string, number>;
  /** Win chance of the player (percent) at its lowest / highest during the game; null without a full analysis. */
  wpLow: number | null;
  wpHigh: number | null;
  mv: MoveFacts;
}

interface MoveFacts {
  promotions: number;
  underPromotions: number;
  enPassants: number;
  queensideCastles: number;
  checks: number;
  captures: number;
  knightMoves: number;
  kingMoves: number;
  earlyQueen: boolean;
  think: number | null;
  finalTimeLeft: number | null;
  /** SAN of the player's mating move, if the game ended with one. */
  mate: string | null;
  smothered: boolean;
  bongcloud: boolean;
  grob: boolean;
  polish: boolean;
}

const EMPTY_MOVES: MoveFacts = {
  promotions: 0,
  underPromotions: 0,
  enPassants: 0,
  queensideCastles: 0,
  checks: 0,
  captures: 0,
  knightMoves: 0,
  kingMoves: 0,
  earlyQueen: false,
  think: null,
  finalTimeLeft: null,
  mate: null,
  smothered: false,
  bongcloud: false,
  grob: false,
  polish: false,
};

const rating = (v: unknown): number | null => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && n >= 100 && n <= 3500 ? n : null;
};

const header = (pgn: string | null | undefined, tag: string): string => new RegExp(`\\[${tag}\\s+"([^"]*)"\\]`).exec(pgn ?? "")?.[1] ?? "";

/** Every square around the mated king is held by its own pieces (or the board edge): the knight mate that cannot be escaped. */
function isSmothered(fenBefore: string, san: string): boolean {
  try {
    const board = new Board(fenBefore);
    board.push(board.parseSan(san));
    const matedColor = board.turn;
    const king = board.king(matedColor);
    if (king === null || !board.isCheckmate()) return false;
    const [file, rank] = [squareFile(king), squareRank(king)];
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (!df && !dr) continue;
        const [f, r] = [file + df, rank + dr];
        if (f < 0 || f > 7 || r < 0 || r > 7) continue;
        const piece = board.squares[square(f, r)];
        if (!piece || piece.color !== matedColor) return false;
      }
    }
    // The checking piece must be the knight itself (a knight mate by discovery is no smothered mate).
    return board.checkers().some((sq) => board.pieceAt(sq)?.type === KNIGHT);
  } catch {
    return false;
  }
}

function moveFacts(moves: MoveData[], color: "white" | "black", won: boolean): MoveFacts {
  if (!moves.length) return EMPTY_MOVES;
  const white = color === "white";
  const mine = moves.filter((_, i) => (i % 2 === 0) === white);
  const out: MoveFacts = { ...EMPTY_MOVES };
  const sans = mine.map((m) => m.san ?? "");
  mine.forEach((m, i) => {
    const san = sans[i];
    if (san.includes("=")) {
      out.promotions++;
      if (/=[NBR]/.test(san)) out.underPromotions++;
    }
    // A pawn capture onto the square the position names as en-passant target.
    if (/^[a-h]x[a-h][1-8]/.test(san) && (m.fen_before ?? "").split(" ")[3] === san.slice(2, 4)) out.enPassants++;
    if (san.startsWith("O-O-O")) out.queensideCastles++;
    if (/[+#]$/.test(san)) out.checks++;
    if (san.includes("x")) out.captures++;
    if (san.startsWith("N")) out.knightMoves++;
    if (/^K/.test(san)) out.kingMoves++;
    if (i < 3 && san.startsWith("Q")) out.earlyQueen = true;
    if (typeof m.time_spent === "number" && m.time_spent >= 0) out.think = Math.max(out.think ?? 0, m.time_spent);
  });
  // A game of one move has none for Black (the opponent left at once).
  const lastMine = mine[mine.length - 1];
  if (lastMine && typeof lastMine.time_left === "number" && lastMine.time_left >= 0) out.finalTimeLeft = lastMine.time_left;
  // The Bongcloud, the Grob and the Orangutan are choices of the first moves.
  out.bongcloud = white ? sans[0] === "e4" && /^Ke2/.test(sans[1] ?? "") : sans[0] === "e5" && /^Ke7/.test(sans[1] ?? "");
  out.grob = white && sans[0] === "g4";
  out.polish = white && sans[0] === "b4";
  // The player's last move mates when the game ended on it.
  const last = moves[moves.length - 1];
  const lastIsMine = (moves.length % 2 === 1) === white;
  if (won && lastIsMine && /#$/.test(last.san ?? "")) {
    out.mate = last.san;
    out.smothered = last.san.startsWith("N") && isSmothered(last.fen_before ?? "", last.san);
  }
  return out;
}

function toFact(g: RawGame, names: string[]): Fact | null {
  const color = getUserColor(g, names);
  if (!color) return null;
  const outcome = outcomeFor(g.result, color);
  if (!outcome) return null;
  const white = color === "white";
  const moves = parseMoves(g.moves_json);
  const summary = parseSummary(g.summary_json);
  const side = (summary?.[color] ?? {}) as Record<string, number | undefined>;
  const counts: Record<string, number> = {};
  for (const k of ["Brilliant", "Great", "Inaccuracy", "Mistake", "Miss", "Blunder"]) counts[k] = Number(side[k] ?? 0) || 0;
  const accuracy = Number(side.accuracy ?? 0) || 0;
  const analyzed = Boolean(summary) && (summary?.analysis_status === "completed" || accuracy > 0);
  const [term, draw] = classifyTermination(g, outcome === "draw");
  const at = parsePlayedAt(g) ?? Number(g.timestamp ?? 0);
  const timeKnown = /\[(UTCTime|StartTime)\s+"/.test(g.pgn ?? "") && parsePlayedAt(g) !== null;
  const dateText = String(g.date ?? "").replace(/\./g, "-");
  const day = timeKnown ? localDay(new Date(at * 1000)) : /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? dateText : at ? localDay(new Date(at * 1000)) : null;
  const opening = String(g.opening ?? "").trim();
  const [myRating, oppRating] = [rating(white ? g.white_elo : g.black_elo), rating(white ? g.black_elo : g.white_elo)];
  let wpLow: number | null = null;
  let wpHigh: number | null = null;
  if (analyzed && summary?.analysis_status === "completed" && moves.length) {
    for (const m of moves) {
      const wp = (white ? m.win_chance_after : 1 - m.win_chance_after) * 100;
      if (!Number.isFinite(wp)) continue;
      wpLow = wpLow === null ? wp : Math.min(wpLow, wp);
      wpHigh = wpHigh === null ? wp : Math.max(wpHigh, wp);
    }
  }
  const chess960 = Boolean(g.chess960);
  return {
    id: String(g.id ?? ""),
    at,
    day,
    hour: timeKnown ? new Date(at * 1000).getHours() : null,
    color,
    outcome,
    speed: chess960 ? "Chess960" : (g.speed_category ?? "").trim() || detectSpeedCategory(g.time_control, g.event, g.source),
    source: String(g.source ?? ""),
    chess960,
    term,
    draw,
    opp: String((white ? g.black : g.white) ?? "").trim(),
    myRating,
    oppRating,
    oppTitle: header(g.pgn, white ? "BlackTitle" : "WhiteTitle").toUpperCase(),
    opening,
    family: opening.split(":")[0].trim().toLowerCase(),
    bot: isBotGame(g, color),
    plies: moves.length,
    userMoves: moves.filter((_, i) => (i % 2 === 0) === white).length,
    analyzed,
    accuracy,
    counts,
    wpLow,
    wpHigh,
    mv: moveFacts(moves, color, outcome === "win"),
  };
}

function emptyStats(): TrophyStats {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, { value: null }])) as unknown as TrophyStats;
}

/** Longest run of consecutive calendar days in a sorted list of YYYY-MM-DD days. */
function longestDayRun(days: string[]): number {
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of days) {
    const [y, m, dd] = d.split("-").map(Number);
    const n = Math.round(Date.UTC(y, m - 1, dd) / 86_400_000);
    run = prev !== null && n === prev + 1 ? run + 1 : 1;
    prev = n;
    best = Math.max(best, run);
  }
  return best;
}

export function computeStats(games: RawGame[], names: string[], opts: TrophyOptions = {}): { stats: TrophyStats; games: number } {
  const stats = emptyStats();
  const rivals = new Set((opts.rivals ?? []).map((r) => r.toLowerCase()).filter(Boolean));
  const own = new Set(names.map((n) => n.toLowerCase()));

  const facts: Fact[] = [];
  for (const g of games) {
    // One odd stored game must never take the whole collection down.
    try {
      const f = toFact(g, names);
      if (f) facts.push(f);
    } catch {
      // skipped: not countable
    }
  }
  facts.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

  const add = (key: StatKey, game: string, n = 1) => {
    const s = stats[key];
    s.value = (s.value ?? 0) + n;
    if (s.game === undefined) s.game = game;
  };
  const high = (key: StatKey, value: number, game: string) => {
    const s = stats[key];
    if (s.value === null || value > s.value) {
      s.value = value;
      s.game = game;
    }
  };
  const low = (key: StatKey, value: number, game: string) => {
    const s = stats[key];
    if (s.value === null || value < s.value) {
      s.value = value;
      s.game = game;
    }
  };
  // Counters start at 0 so a progress bar can show "0 / 10".
  for (const key of STAT_KEYS) if (!/^(min_|lowest_)/.test(key)) stats[key].value = 0;

  const human = facts.filter((f) => !f.bot);
  for (const f of facts) if (f.bot && f.outcome === "win") add("bot_wins", f.id);

  const speedsWon = new Set<string>();
  const platforms = new Set<string>();
  const days = new Map<string, { games: number; wins: number; losses: number }>();
  const winsVs = new Map<string, number>();
  const rivalWins = new Map<string, number>();
  const openings = new Map<string, number>();
  const ratingBuckets = new Map<string, { games: number; peak: number }>();
  let winRun = 0;
  let lossRun = 0;
  let cleanRun = 0;

  for (const f of human) {
    const won = f.outcome === "win";
    const mv = f.mv;
    add("games", f.id);
    if (won) add("wins", f.id);
    if (f.outcome === "draw") add("draws", f.id);
    if (f.analyzed) add("analyzed", f.id);
    if (f.chess960) add("chess960_games", f.id);
    if (/lichess|chesscom|chess\.com/i.test(f.source)) platforms.add(/lichess/i.test(f.source) ? "lichess" : "chesscom");
    if (f.at > 0 && f.day) {
      const d = days.get(f.day) ?? { games: 0, wins: 0, losses: 0 };
      d.games++;
      if (won) d.wins++;
      if (f.outcome === "loss") d.losses++;
      days.set(f.day, d);
    }

    if (won) {
      add(f.color === "white" ? "wins_white" : "wins_black", f.id);
      const speedKey = { bullet: "bullet_wins", ultrabullet: "bullet_wins", blitz: "blitz_wins", rapid: "rapid_wins", classical: "classical_wins", daily: "daily_wins" }[f.speed.toLowerCase()] as StatKey | undefined;
      if (speedKey) {
        add(speedKey, f.id);
        speedsWon.add(f.speed.toLowerCase());
      }
      if (f.term === "Checkmate" || mv.mate) add("mates", f.id);
      if (f.term === "Time") add("timeout_wins", f.id);
      if (f.term === "Resignation") add("resign_wins", f.id);
      if (f.term === "Abandon") add("abandon_wins", f.id);
      if (f.opp) winsVs.set(f.opp.toLowerCase(), (winsVs.get(f.opp.toLowerCase()) ?? 0) + 1);
      if (f.oppRating !== null) high("max_beaten_rating", f.oppRating, f.id);
      if (f.oppRating !== null && f.myRating !== null) high("max_beaten_gap", f.oppRating - f.myRating, f.id);
      if (f.oppTitle === "GM") add("beat_gm", f.id);
      // A win in a few moves counts only when it was played out: opponents who never moved or left are no achievement.
      if ((f.term === "Checkmate" || f.term === "Resignation") && f.plies >= 6) low("min_win_plies", f.plies, f.id);
      if (f.wpLow !== null) low("lowest_wp_win", f.wpLow, f.id);
      if (f.counts.Blunder >= 5) add("chaos_wins", f.id);
      if (f.day && /^\d{4}-\d{2}-13$/.test(f.day) && new Date(Number(f.day.slice(0, 4)), Number(f.day.slice(5, 7)) - 1, 13).getDay() === 5) add("friday13_wins", f.id);
      if (mv.mate) {
        if (/^O-O/.test(mv.mate)) add("castle_mates", f.id);
        else if (mv.mate.includes("=")) add("promo_mates", f.id);
        else if (mv.mate.startsWith("N")) add("mate_knight", f.id);
        else if (mv.mate.startsWith("B")) add("mate_bishop", f.id);
        else if (/^[a-h]/.test(mv.mate)) add("mate_pawn", f.id);
        if (mv.smothered) add("smothered_mates", f.id);
        if (f.plies <= 8 && /^Qxf[27]#/.test(mv.mate)) add("scholars_mates", f.id);
        if (f.color === "black" && f.plies === 4) add("fool_mates", f.id);
      }
    }
    if (f.outcome === "loss" && f.term === "Time") add("timeout_losses", f.id);
    if (f.outcome === "loss" && f.wpHigh !== null) high("highest_wp_lost", f.wpHigh, f.id);
    if (f.outcome === "draw" && f.draw === "Stalemate") add("stalemate_draws", f.id);
    if (f.outcome === "draw" && f.draw === "3-Fold Repetition") add("repetition_draws", f.id);

    // streaks: a draw ends a winning run as well as a losing one
    if (won) {
      winRun++;
      if (lossRun >= 3) add("rebound", f.id);
      lossRun = 0;
    } else {
      winRun = 0;
      lossRun = f.outcome === "loss" ? lossRun + 1 : 0;
    }
    high("win_streak", winRun, f.id);
    high("loss_streak", lossRun, f.id);

    if (f.hour !== null) {
      if (f.hour < 5) add("night_games", f.id);
      else if (f.hour < 7) add("early_games", f.id);
    }
    if (f.day && /^\d{4}-(12-2[456]|12-31|01-01)$/.test(f.day)) add("holiday_games", f.id);
    high("max_game_plies", f.plies, f.id);

    if (f.myRating !== null && f.speed !== "Untimed" && !f.chess960) {
      const key = `${f.source}|${f.speed}`;
      const b = ratingBuckets.get(key) ?? { games: 0, peak: 0 };
      b.games++;
      b.peak = Math.max(b.peak, f.myRating);
      ratingBuckets.set(key, b);
    }

    if (f.family && !f.chess960) {
      openings.set(f.family, (openings.get(f.family) ?? 0) + 1);
      if (/gambit/i.test(f.opening)) add("gambit_games", f.id);
    }
    if (mv.bongcloud) add("bongcloud_games", f.id);
    if (mv.grob) add("grob_games", f.id);
    if (mv.polish) add("polish_games", f.id);

    if (mv.promotions) {
      add("promotions", f.id, mv.promotions);
      high("max_promotions_game", mv.promotions, f.id);
    }
    if (mv.underPromotions) add("under_promotions", f.id, mv.underPromotions);
    if (mv.enPassants) add("en_passants", f.id, mv.enPassants);
    if (mv.queensideCastles) add("queenside_castles", f.id);
    if (f.plies) {
      high("max_checks", mv.checks, f.id);
      high("max_captures", mv.captures, f.id);
      high("max_knight_moves", mv.knightMoves, f.id);
      high("max_king_moves", mv.kingMoves, f.id);
      if (mv.earlyQueen) add("early_queen_games", f.id);
    }
    if (mv.think !== null) high("max_think", mv.think, f.id);
    if (won && mv.finalTimeLeft !== null) low("min_time_left_win", mv.finalTimeLeft, f.id);

    if (f.analyzed) {
      add("brilliants", f.id, f.counts.Brilliant);
      high("max_brilliants_game", f.counts.Brilliant, f.id);
      high("max_blunders_game", f.counts.Blunder, f.id);
      if (f.userMoves >= MIN_QUALITY_MOVES && f.accuracy > 0) {
        high("best_accuracy", f.accuracy, f.id);
        if (f.accuracy >= 95) add("acc95_games", f.id);
        if (f.counts.Inaccuracy + f.counts.Mistake + f.counts.Miss + f.counts.Blunder === 0) add("clean_games", f.id);
      }
      if (f.userMoves >= MIN_STREAK_MOVES) {
        cleanRun = f.counts.Blunder === 0 ? cleanRun + 1 : 0;
        high("blunder_free_streak", cleanRun, f.id);
      }
    }

    const opp = f.opp.toLowerCase();
    if (rivals.size && opp && rivals.has(opp) && !own.has(opp) && won) {
      add("rival_wins", f.id);
      rivalWins.set(opp, (rivalWins.get(opp) ?? 0) + 1);
    }
  }

  stats.speeds_won.value = speedsWon.size;
  stats.platforms.value = platforms.size;
  stats.days_active.value = days.size;
  stats.day_streak.value = longestDayRun([...days.keys()].sort());
  for (const [, d] of days) {
    stats.best_day_games.value = Math.max(stats.best_day_games.value ?? 0, d.games);
    stats.best_day_wins.value = Math.max(stats.best_day_wins.value ?? 0, d.wins);
    if (!d.losses) stats.perfect_day.value = Math.max(stats.perfect_day.value ?? 0, d.wins);
  }
  stats.max_wins_one_opponent.value = Math.max(0, ...winsVs.values());
  stats.rivals_beaten.value = rivalWins.size;
  stats.max_wins_one_rival.value = Math.max(0, ...rivalWins.values());
  stats.openings_distinct.value = openings.size;
  stats.max_opening_games.value = Math.max(0, ...openings.values());
  // Ratings from a pool with only a few games are often still settling.
  stats.peak_rating.value = Math.max(0, ...[...ratingBuckets.values()].filter((b) => b.games >= 5).map((b) => b.peak));
  return { stats, games: human.length };
}
