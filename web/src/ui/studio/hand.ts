// The pointer hand of the "close" reel look: where it is, how tightly it grips and where it looks, for one moment of a scene.
//
// Pure (no canvas), so preview and export agree and the motion can be tested. The hand behaves like a real mouse pointer
// that a person uses to drag the piece:
//   - it flies in on a small arc and settles on the piece with a little overshoot (approach, still an open pointing hand),
//   - it closes into a fist the moment the piece lifts (grab) and drags it, a hair behind the piece and leaning into the direction of travel,
//   - it opens on the landing, hangs there for a heartbeat and floats away, fading out,
//   - between two moves of one scene it glides straight from the first landing to the next piece.
// The hand is in two parts: a point in square coordinates (the piece it holds, rotated and flipped with the board) and a
// small offset in screen directions (the hand sits to the lower right of the piece, whichever side of the board is at the bottom).
import { squareXZ } from "./timeline";

export interface HandStep {
  t0: number;
  t1: number;
  from: string;
  to: string;
}

export interface HandState {
  /** The held point in square coordinates: where the piece is right now. */
  x: number;
  z: number;
  /** Offset of the hand from that point, in screen directions (board units). */
  ox: number;
  oz: number;
  /** 0 = open pointing hand, 1 = closed fist. */
  grip: number;
  /** Lean in radians (positive = clockwise); follows the sideways speed of the piece. */
  angle: number;
  alpha: number;
  /** 1 = full size; the hand sinks a little while it presses and pulls back on the landing. */
  scale: number;
  /** Seconds since the grab (for the ripple under the fingers), -1 when there is none. */
  grabAge: number;
}

/** The hand's resting place relative to the piece it holds, and the spot it flies in from. */
export const HAND_REST = { x: 0.14, z: 0.2 } as const;
const ENTRY = { x: 1.9, z: 1.5 };
/** Seconds the hand needs to arrive before a piece lifts, to close its fist and to let go. */
export const APPROACH = 0.24;
const GRAB = 0.1;
const LAG = 0.03;
const RELEASE = 0.36;
const LET_GO = 0.12;
/** Where the hand drifts to after it let go. */
const DRIFT = { x: 0.55, z: 0.5 };

const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
const easeOut = (k: number) => 1 - Math.pow(1 - clamp01(k), 3);
const easeInOut = (k: number) => {
  const x = clamp01(k);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Starts and ends softly and settles with a little overshoot: the hand lands on the piece and gives a hair. */
const settle = (k: number) => easeInOut(k) + 0.07 * Math.sin(Math.PI * clamp01(k)) * clamp01(k);

/** Where the piece is at scene time `local` during `st` (the same easing as the timeline's flight). */
function piecePoint(st: HandStep, local: number): [number, number] {
  const [ax, az] = squareXZ(st.from);
  const [bx, bz] = squareXZ(st.to);
  const k = easeInOut((local - st.t0) / Math.max(1e-6, st.t1 - st.t0));
  return [lerp(ax, bx, k), lerp(az, bz, k)];
}

/** How long before step j the hand starts flying: as long as the gap to the move before allows, never more than APPROACH. */
function approachOf(steps: HandStep[], j: number): number {
  const gap = steps[j].t0 - (j > 0 ? steps[j - 1].t1 : 0);
  return Math.max(0.05, Math.min(APPROACH, gap));
}

/** How visible the hand still is `dt` seconds after it let go: it hangs for a heartbeat, then fades. */
const releaseAlpha = (dt: number) => 1 - easeInOut((dt - 0.1) / (RELEASE - 0.1));

/** Where the hand floats `dt` seconds after letting go of step j. */
function afterRelease(st: HandStep, dt: number): { x: number; z: number; ox: number; oz: number } {
  const [bx, bz] = squareXZ(st.to);
  const e = easeOut(dt / RELEASE);
  return { x: bx, z: bz, ox: HAND_REST.x + DRIFT.x * e, oz: HAND_REST.z + DRIFT.z * e };
}

/**
 * The hand at scene time `local`, or null when it is not on the screen.
 * `around` carries the last move of the scene before and the first of the scene after, in this scene's time (the one before is negative,
 * the one after lies beyond the scene's end): a scene cut on the beat lets the hand fly in during the scene before and let go during the scene after,
 * so it is one continuous movement across the cut instead of a hand that pops up at the start of every scene.
 */
export function handAt(own: HandStep[], local: number, around: { before?: HandStep | null; after?: HandStep | null } = {}): HandState | null {
  const steps = [...(around.before ? [around.before] : []), ...own, ...(around.after ? [around.after] : [])];
  if (!steps.length) return null;
  // The latest step whose approach has started rules the hand.
  let j = -1;
  for (let i = 0; i < steps.length; i++) if (local >= steps[i].t0 - approachOf(steps, i)) j = i;
  if (j < 0) return null;
  const st = steps[j];
  const a = approachOf(steps, j);

  if (local < st.t0) {
    // Approach: from the entry spot (or from where the last move was let go) to the piece, on a small arc.
    const u = (local - (st.t0 - a)) / a;
    const e = settle(u);
    const [bx, bz] = squareXZ(st.from);
    let from: { x: number; z: number; ox: number; oz: number };
    let fade = clamp01(u * 3.5);
    let grip0 = 0;
    let angle0 = 0.28;
    let scale0 = 1.08;
    // The hand of the move before may still be on its way out: the next approach takes over from exactly where it is (open, fading), so nothing pops.
    const since = j > 0 ? st.t0 - a - steps[j - 1].t1 : Infinity;
    if (since < RELEASE - 0.05) {
      from = afterRelease(steps[j - 1], since);
      fade = releaseAlpha(since) + (1 - releaseAlpha(since)) * clamp01(u * 3.5);
      grip0 = 1 - easeInOut(since / LET_GO);
      angle0 = lerp(-0.1, 0.12, easeOut(since / RELEASE));
      scale0 = lerp(0.93, 1.03, easeOut(since / 0.2));
    } else from = { x: bx, z: bz, ox: ENTRY.x, oz: ENTRY.z };
    // The arc bows away from the straight line, strongest in the middle of the flight.
    const bow = Math.sin(Math.PI * clamp01(u)) * 0.35;
    const dx = HAND_REST.x - from.ox + (bx - from.x);
    const dz = HAND_REST.z - from.oz + (bz - from.z);
    const len = Math.hypot(dx, dz) || 1;
    return {
      x: lerp(from.x, bx, e),
      z: lerp(from.z, bz, e),
      ox: lerp(from.ox, HAND_REST.x, e) + (-dz / len) * bow,
      oz: lerp(from.oz, HAND_REST.z, e) + (dx / len) * bow,
      grip: grip0 * (1 - easeInOut(u * 1.4)),
      angle: lerp(angle0, -0.1, easeOut(u)),
      alpha: fade,
      scale: lerp(scale0, 1, easeOut(u)),
      grabAge: -1,
    };
  }

  if (local < st.t1) {
    // Drag: the fist closes as the piece lifts and follows it, a hair behind, leaning into the direction of travel.
    const [px, pz] = piecePoint(st, local - LAG);
    const [qx] = piecePoint(st, local - LAG + 0.04);
    const vx = (qx - px) / 0.04;
    const grip = easeInOut((local - st.t0) / GRAB);
    return {
      x: px,
      z: pz,
      ox: HAND_REST.x,
      oz: HAND_REST.z,
      grip,
      angle: -0.1 + Math.max(-0.3, Math.min(0.3, vx * 0.035)),
      alpha: 1,
      scale: 1 - 0.07 * grip,
      grabAge: local - st.t0,
    };
  }

  // Release: open, hang for a heartbeat, float away and fade.
  const dt = local - st.t1;
  const r = afterRelease(st, dt);
  const open = easeInOut(dt / LET_GO);
  const alpha = releaseAlpha(dt);
  if (alpha <= 0.01) return null;
  return {
    x: r.x,
    z: r.z,
    ox: r.ox,
    oz: r.oz,
    grip: 1 - open,
    angle: lerp(-0.1, 0.12, easeOut(dt / RELEASE)),
    alpha,
    scale: lerp(0.93, 1.03, easeOut(dt / 0.2)),
    grabAge: -1,
  };
}
