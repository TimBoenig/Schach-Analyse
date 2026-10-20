// Shared data model. Keys deliberately mirror the Python desktop app
// (src/backend/storage/models.py and the games table row) in snake_case so
// the ported domain code reads 1:1 and exported data stays interchangeable.
//
// All evaluation scores are White-perspective (positive = White better).

export type Side = "white" | "black";

export type Classification =
  | ""
  | "Brilliant"
  | "Great"
  | "Best"
  | "Excellent"
  | "Good"
  | "Book"
  | "Inaccuracy"
  | "Mistake"
  | "Miss"
  | "Blunder";

export interface PvLine {
  pv: string[];
  cp: number | null;
  mate: number | null;
  depth: number | string;
  pv_san?: string;
  score_value?: string;
}

export interface MoveData {
  move_number: number;
  ply: number;
  san: string;
  uci: string;
  fen_before: string;
  eval_before_cp: number | null;
  eval_before_mate: number | null;
  best_move: string | null;
  best_eval_cp?: number | null;
  best_eval_mate?: number | null;
  pv: string[];
  eval_after_cp: number | null;
  eval_after_mate: number | null;
  win_chance_before: number;
  win_chance_after: number;
  classification: Classification;
  explanation: string;
  multi_pvs: PvLine[];
  is_book_move: boolean;
  book_move_count: number;
  book_exit_move: boolean;
  eco: string;
  opening_name: string;
  candidate_continuations: string[];
  // Clock data parsed from [%clk] comments (seconds).
  time_left: number | null;
  time_spent: number | null;
  raw_clk: string | null;
}

export interface GameMetadata {
  white: string;
  black: string;
  event: string;
  date: string;
  result: string;
  headers: Record<string, string>;
  starting_fen: string | null;
  white_elo: string | null;
  black_elo: string | null;
  time_control: string | null;
  eco: string | null;
  termination: string | null;
  termination_mode: string | null;
  termination_description: string | null;
  speed_category: string | null;
  opening: string | null;
  source: string; // file | chesscom | lichess
  chess960: boolean;
}

/** Per-side summary produced by the analyzer (plus `tactics` added on save). */
export interface SideSummary {
  accuracy: number;
  acpl: number;
  move_count: number;
  accuracies: number[];
  win_percents: number[];
  tactics?: Record<string, any>;
  [classification: string]: any;
}

export interface GameSummary {
  white?: SideSummary;
  black?: SideSummary;
  analysis_status?: "completed" | "paused" | "not_started";
  analyzed_moves?: number;
  total_moves?: number;
  [key: string]: any;
}

/** In-memory game being analyzed (Python: GameAnalysis). */
export interface GameAnalysis {
  game_id: string;
  metadata: GameMetadata;
  moves: MoveData[];
  summary: GameSummary;
  pgn_content: string;
}

/**
 * Persisted game (Python: one row of the `games` table, as returned by
 * GamesRepo.get_all_games()). `summary_json` / `moves_json` hold parsed
 * objects instead of JSON strings; consumers that expect strings should
 * accept both.
 */
export interface StoredGame {
  id: string;
  white: string;
  black: string;
  result: string;
  date: string;
  event: string;
  white_elo: string | null;
  black_elo: string | null;
  time_control: string | null;
  speed_category: string | null;
  eco: string | null;
  opening: string | null;
  termination: string | null;
  termination_mode: string | null;
  source: string;
  starting_fen: string | null;
  chess960: number;
  book_exit_ply: number | null;
  white_opening_acc: number | null;
  black_opening_acc: number | null;
  white_middlegame_acc: number | null;
  black_middlegame_acc: number | null;
  white_endgame_acc: number | null;
  black_endgame_acc: number | null;
  white_pieces_hung: number;
  black_pieces_hung: number;
  white_brilliant_count: number;
  black_brilliant_count: number;
  white_great_count: number;
  black_great_count: number;
  pgn: string;
  summary_json: GameSummary;
  moves_json: MoveData[];
  /** Seconds since epoch (Python time.time()). */
  timestamp: number;
  /** Milliseconds since epoch of the last local change; drives sync. */
  updated_at: number;
  /** Soft-delete marker so deletions propagate through sync. */
  deleted?: boolean;
}

export function emptyMove(partial: Partial<MoveData>): MoveData {
  return {
    move_number: 0,
    ply: 0,
    san: "",
    uci: "",
    fen_before: "",
    eval_before_cp: null,
    eval_before_mate: null,
    best_move: null,
    pv: [],
    eval_after_cp: null,
    eval_after_mate: null,
    win_chance_before: 0.5,
    win_chance_after: 0.5,
    classification: "",
    explanation: "",
    multi_pvs: [],
    is_book_move: false,
    book_move_count: 0,
    book_exit_move: false,
    eco: "",
    opening_name: "",
    candidate_continuations: [],
    time_left: null,
    time_spent: null,
    raw_clk: null,
    ...partial,
  };
}

export function emptyMetadata(partial: Partial<GameMetadata> = {}): GameMetadata {
  return {
    white: "?",
    black: "?",
    event: "?",
    date: "?",
    result: "*",
    headers: {},
    starting_fen: null,
    white_elo: null,
    black_elo: null,
    time_control: null,
    eco: null,
    termination: null,
    termination_mode: null,
    termination_description: null,
    speed_category: null,
    opening: null,
    source: "file",
    chess960: false,
    ...partial,
  };
}
