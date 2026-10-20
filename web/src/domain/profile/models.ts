// Result structures for the player profile and per-game review
// (port of src/backend/analysis/profile/models.py). All user-visible text is German.

/** Pointer to a concrete position in a stored game (used for "Beispiel ansehen"). */
export interface GameRef {
  game_id: string;
  ply_index: number; // 0-based index into the move list; -1 = start of game
  label: string;
  detail: string;
}

export interface SkillScore {
  key: string;
  name: string;
  score: number; // 0..100
  grade: string;
  detail: string;
  sample: number;
  reliable: boolean;
}

export interface Insight {
  key: string;
  title: string;
  text: string;
  category: string; // e.g. "Fähigkeit", "Eröffnung", "Farbe", "Bedenkzeit"
  strength: number; // how pronounced the finding is (for sorting)
}

export interface Pattern {
  key: string;
  title: string;
  text: string;
  severity: "hoch" | "mittel" | "niedrig" | "positiv";
  value: number;
  examples: GameRef[];
}

export interface StyleAxis {
  key: string;
  name: string;
  value: number; // 0..100
  low_label: string;
  high_label: string;
}

export interface StyleProfile {
  label: string;
  description: string;
  axes: StyleAxis[];
  facts: string[];
}

export interface TrainingItem {
  priority: number;
  title: string;
  reason: string;
  steps: string[];
  focus_skill: string;
  examples: GameRef[];
}

/** A position from the player's own games where a better move existed. */
export interface Puzzle {
  game_id: string;
  ply_index: number;
  fen: string;
  best_move_uci: string;
  best_move_san: string;
  played_san: string;
  classification: string;
  phase: string;
  wp_loss: number;
  opponent: string;
  date: string;
  chess960: boolean;
}

export interface OpeningLine {
  name: string;
  eco: string;
  color: string;
  games: number;
  score_pct: number; // (wins + 0.5 * draws) / games
  avg_accuracy: number;
  first_error_move: number | null;
}

export interface PlayerProfile {
  usernames: string[];
  total_games: number;
  analyzed_games: number;
  /** True when no game of the player has been analyzed yet. */
  is_empty: boolean;
  overview: Record<string, any>;
  skills: SkillScore[];
  strengths: Insight[];
  weaknesses: Insight[];
  style: StyleProfile | null;
  patterns: Pattern[];
  openings_best: OpeningLine[];
  openings_worst: OpeningLine[];
  trends: Record<string, any>;
  breakdowns: Record<string, any>;
  training_plan: TrainingItem[];
  puzzles: Puzzle[];
}

export interface KeyMoment {
  ply_index: number;
  move_label: string; // e.g. "23... Lxf7"
  by_user: boolean;
  classification: string;
  title: string;
  text: string;
  wp_before: number; // user perspective, 0..1
  wp_after: number;
  best_move_san: string;
}

export interface PhaseReview {
  phase: string;
  name: string;
  accuracy: number | null;
  moves: number;
  errors: number;
  grade: string;
  comment: string;
}

export interface GameReview {
  game_id: string;
  user_color: string;
  headline: string;
  result_text: string;
  accuracy: number;
  opponent_accuracy: number;
  grade: string;
  phases: PhaseReview[];
  key_moments: KeyMoment[];
  positives: string[];
  negatives: string[];
  lessons: string[];
  move_counts: Record<string, number>;
  turning_point: KeyMoment | null;
}
