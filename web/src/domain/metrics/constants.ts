// Constants for metrics aggregation (port of src/backend/analysis/metrics/constants.py).

export const PHASES = ["opening", "middlegame", "endgame"] as const;
export const COLORS = ["white", "black"] as const;
export const PIECE_NAMES = ["pawn", "knight", "bishop", "rook", "queen"] as const;

export const QUALITY_NAMES = [
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

export const QUALITY_PACE_KEYS = ["best", "blunder", "other"] as const;

export const MOTIF_NAMES = [
  "fork",
  "pin",
  "skewer",
  "discovered_attack",
  "sacrifice",
  "back_rank",
] as const;

export const ADVANTAGE_KEYS = [
  "had_winning_advantage",
  "converted_advantage",
  "choked_advantage",
  "thrown_losses",
  "squandered_draws",
  "had_losing_position",
  "comeback_drawn_or_won",
  "comeback_wins",
  "comeback_draws",
] as const;

// (advantage_key, move_key, fallback_display_label, fallback_classification_key)
export const ADVANTAGE_DRILLS: ReadonlyArray<readonly [string, string, string, string]> = [
  ["thrown_losses", "lead_collapse_move", "Vorteil verspielt", "Lost Lead"],
  ["squandered_draws", "lead_collapse_move", "Vorteil nur remis", "Drawn Lead"],
  ["comeback_wins", "comeback_turn_move", "Aufholjagd", "Comeback Win"],
  ["comeback_draws", "comeback_turn_move", "Aufholjagd", "Comeback Draw"],
];

export const DRAW_MODE_TO_BUCKET: Record<string, string> = {
  threefold_repetition: "3-Fold Repetition",
  repetition: "3-Fold Repetition",
  agreed_draw: "Agreement",
  agreement: "Agreement",
  stalemate: "Stalemate",
  timeout_insufficient: "Insufficient vs Timeout",
  insufficient_material: "Insufficient Material",
  fifty_moves: "50-Move Rule",
  "50_moves": "50-Move Rule",
};

export const DRAW_BUCKETS = [
  "3-Fold Repetition",
  "Agreement",
  "Stalemate",
  "Insufficient vs Timeout",
  "Insufficient Material",
  "50-Move Rule",
] as const;

export const TERM_TYPES = ["Checkmate", "Resignation", "Time", "Abandon", "Draw"] as const;
export const NON_DRAW_TERM_TYPES = ["Checkmate", "Resignation", "Time", "Abandon"] as const;

export const VALID_DATE_FILTERS: ReadonlySet<string> = new Set([
  "All Time",
  "Last 24 Hours",
  "Last 7 Days",
  "Last 14 Days",
  "Last 30 Days",
  "Last 90 Days",
  "Last 180 Days",
  "Last 365 Days",
  "This Year",
]);

// Maximum occurrences per bucket to prevent memory explosion at 10,000+ games
export const MAX_DRILL_DOWN_ITEMS = 500;
