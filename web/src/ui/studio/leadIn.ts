// "Start from the starting position": the video begins in the starting position and plays the game
// quickly up to its first scene, instead of opening in the middle of the game.
//
// Edits and puzzles usually open in the critical position (the hook). Some viewers want to see where the
// position comes from, so the setting puts one fast scene in front: every move from move 1 up to the
// position the first scene starts in. It is a normal scene (marked `leadIn`), so it shows in the scene
// list and its length can be changed like any other; switching the setting off removes it again.
// The moves come from the game the video was cut from (`project.game`, kept by the AI import), or from
// the scenes themselves when the video already plays from the starting position.
// Pure: takes a project, returns the project.
import { Chess } from "chess.js";

import { movesLabel, parseMoves, scene, scenePositions, START_FEN, type StudioProject } from "./model";

/** Seconds the lead-in takes per half-move, and its shortest and longest length. */
export const LEAD_PER_PLY = 0.22;
export const LEAD_MIN = 1.3;
export const LEAD_MAX = 6;
/** More half-moves than this are not played out (a lead-in of half a game would bore). */
export const LEAD_MAX_PLIES = 60;

/** The first four fields of a FEN (pieces, side, castling, en passant): the same position whatever the move counters say. */
const key = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

export type FromStartState =
  /** The video already starts in the starting position. */
  | { kind: "already" }
  /** The game up to the first picture of the board is known: `plies` half-moves would be played. */
  | { kind: "possible"; plies: number }
  /** The way to the first position is not known (no game, or a position that is not in it, like a composed puzzle). */
  | { kind: "unknown" };

interface Plan {
  state: FromStartState;
  /** Where the lead-in goes and what it plays. */
  at: number;
  moves: string[];
}

function plan(project: StudioProject): Plan {
  const base = { ...project, scenes: project.scenes.filter((s) => !s.leadIn) };
  const positions = scenePositions(base);
  // The first scene that shows the board (a title card covers it): the lead-in goes right before it.
  const at = base.scenes.findIndex((s) => s.card === "none" || s.moves.trim() || s.fen.trim());
  if (at < 0) return { state: { kind: "already" }, at: 0, moves: [] };
  const target = positions[at].before;
  if (key(target) === key(START_FEN)) return { state: { kind: "already" }, at, moves: [] };
  const game = parseMoves(START_FEN, base.game ?? "");
  const walk = new Chess(START_FEN);
  for (let i = 0; i < game.moves.length && i < LEAD_MAX_PLIES; i++) {
    walk.move(game.moves[i].san);
    if (key(walk.fen()) === key(target)) return { state: { kind: "possible", plies: i + 1 }, at, moves: game.moves.slice(0, i + 1).map((m) => m.san) };
  }
  return { state: { kind: "unknown" }, at, moves: [] };
}

/** Whether the video can start from the starting position, and how long the lead-in would be. Ignores a lead-in that is already there. */
export function fromStartState(project: StudioProject): FromStartState {
  return plan(project).state;
}

/** Seconds the lead-in of so many half-moves plays. */
export const leadSeconds = (plies: number) => Math.min(LEAD_MAX, Math.max(LEAD_MIN, plies * LEAD_PER_PLY));

/**
 * Switches "start from the starting position" on or off: on puts the fast scene with the game up to the first scene in
 * front of it (when the game is known), off takes it out. Either way the setting is stored, so a later import or edit can
 * put the lead-in back.
 */
export function applyFromStart(project: StudioProject, on: boolean): StudioProject {
  const clean: StudioProject = { ...project, scenes: project.scenes.filter((s) => !s.leadIn), video: { ...project.video, fromStart: on } };
  if (!clean.scenes.length) return { ...project, video: { ...project.video, fromStart: on } };
  if (!on) return clean;
  const p = plan(clean);
  if (p.state.kind !== "possible") return clean;
  const chess = new Chess(START_FEN);
  const played = p.moves.map((san) => chess.move(san));
  const speed = Math.max(0.3, clean.video.speed || 1);
  // Squeezed: the moves are played faster than their natural pace so the whole run fits into a few seconds.
  // A video cut down to the critical position starts there: the lead-in jumps back to the starting position first.
  const lead = scene({ moves: movesLabel(played, START_FEN), fen: START_FEN, duration: leadSeconds(played.length) * speed, squeeze: true, leadIn: true, camera: "top", tempo: 1.6 });
  const scenes = clean.scenes.slice();
  scenes.splice(p.at, 0, lead);
  return { ...clean, scenes };
}
