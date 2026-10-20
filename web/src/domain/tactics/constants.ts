// Constants, enums and thresholds for tactics analysis
// (port of src/backend/analysis/tactics/constants.py).

import { BISHOP, KING, KNIGHT, PAWN, type PieceType, QUEEN, ROOK } from "./board";

export const PIECE_VALUES: Record<PieceType, number> = {
  [PAWN]: 1,
  [KNIGHT]: 3,
  [BISHOP]: 3,
  [ROOK]: 5,
  [QUEEN]: 9,
  [KING]: 0,
};

export const PIECE_NAMES: Record<PieceType, string> = {
  [PAWN]: "pawn",
  [KNIGHT]: "knight",
  [BISHOP]: "bishop",
  [ROOK]: "rook",
  [QUEEN]: "queen",
  [KING]: "king",
};

export const PIECE_NAMES_ORDERED = ["pawn", "knight", "bishop", "rook", "queen"] as const;

export const GamePhase = {
  OPENING: "opening",
  MIDDLEGAME: "middlegame",
  ENDGAME: "endgame",
} as const;
export type GamePhase = (typeof GamePhase)[keyof typeof GamePhase];

export const PHASES: readonly GamePhase[] = [
  GamePhase.OPENING,
  GamePhase.MIDDLEGAME,
  GamePhase.ENDGAME,
];

export const TacticalTheme = {
  FORK: "fork",
  PIN: "pin",
  SKEWER: "skewer",
  DISCOVERED_ATTACK: "discovered_attack",
  SACRIFICE: "sacrifice",
  BACK_RANK: "back_rank",
} as const;
export type TacticalTheme = (typeof TacticalTheme)[keyof typeof TacticalTheme];

/** Declaration order of TacticalTheme (Python enum iteration order). */
export const TACTICAL_THEMES: readonly TacticalTheme[] = Object.values(TacticalTheme);

export const MoveQualityBucket = {
  BEST: "best",
  BLUNDER: "blunder",
  OTHER: "other",
} as const;
export type MoveQualityBucket = (typeof MoveQualityBucket)[keyof typeof MoveQualityBucket];

export const BLUNDER_CLASSIFICATIONS: ReadonlySet<string> = new Set(["Blunder"]);
export const BAD_MOVE_CLASSIFICATIONS: ReadonlySet<string> = new Set(["Blunder", "Mistake"]);
export const BRILLIANT_CLASSIFICATIONS: ReadonlySet<string> = new Set(["Brilliant", "Great"]);

// Trouble time threshold in seconds based on time control category
export const TROUBLE_SECONDS: Readonly<Record<string, number>> = {
  bullet: 15.0,
  blitz: 30.0,
  rapid: 60.0,
  classical: 120.0,
  daily: 300.0,
};
export const DEFAULT_TROUBLE_SECONDS = 30.0;
export const MAX_REASONABLE_TIME_SECONDS = 7200.0; // 2 hours per move cap

// Tactical evaluation thresholds
export const ADVANTAGE_THRESHOLD_CP = 300;
export const MIN_SACRIFICE_DEFICIT_CP = 200;
export const LEAD_COLLAPSE_DROP_CP = 300;
export const COMEBACK_SWING_CP = 300;
export const WINNING_WP_THRESHOLD = 0.5;
export const SOUND_MOVE_WP_DROP_THRESHOLD = 0.03;
export const GOOD_MOVE_WP_DROP_THRESHOLD = 0.05;
export const TURNING_POINT_MIN_WP_SWING = 0.05;
export const SOUND_TACTIC_MAX_WP_DROP = 0.08;

// Game phase material thresholds
export const ENDGAME_NO_QUEEN_TOTAL_MAX = 26;
export const ENDGAME_LOW_TOTAL_NON_PAWN = 18;
export const ENDGAME_SOLO_PIECE_MAX = 6;
export const OPENING_MAX_PLY = 16;
export const OPENING_MIN_NON_PAWN = 20;

// King arbitrary high value for skewer comparison
export const KING_SKEWER_VALUE = 100;
