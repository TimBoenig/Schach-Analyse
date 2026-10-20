// Tactical analysis package (port of src/backend/analysis/tactics/).
// Hanging piece detection, game phase classification, advantage conversion,
// brilliancy extraction and tactical motif detection. Pure TS, no DOM.

export * from "./board";
export {
  findSliderRayTargets,
  isOnSegment,
  legalDefenders,
  minAttackerValue,
  pieceValue,
  type RayTarget,
  toUserCp,
  toUserWp,
} from "./board_utils";
export * from "./constants";
export { analyzeGameTactics, ClockStats, type MoveCtx, type TacticsMoveInput, TacticsState } from "./game";
export { getHangingPieces, type HangingPiece, isPieceHanging } from "./hanging";
export { affectedAlignments, DETECTORS, detectTacticalMotifs, type MotifCtx } from "./motifs";
export { classifyGamePhase, nonPawnMaterial } from "./phase";
export { isSafelyPlaced, staticExchangeEvaluation } from "./see";
