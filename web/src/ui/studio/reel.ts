// The "Reel" look: the editing style of the viral chess clips. A grey board on
// pure black that is always tilted and always moving (punch-in cuts, whip
// turns, camera roll), colour only where it means something (red = danger,
// green = best, cyan = brilliant, blue = the piece in question), round move
// badges on the corner of the square, thick glowing arrows, pieces that grow
// and flip while they fly, white flashes on the cuts and almost no text.
//
// Everything is drawn in one transformed 2D layer ("board units": one square
// is 1 × 1), so glows, arrows and badges stay glued to the squares however the
// camera rolls. Like the other looks the picture depends only on the frame, so
// preview and export are identical.
import type { PieceSymbol } from "chess.js";

import { softBlob } from "./shadow";
import { BRAND, BRAND_DOMAIN } from "../../brand";
import { t } from "../../i18n";
import { drawCard, fitText, layout, tokens, type Assets } from "./compose";
import { pieceKey } from "./flat";
import { CLOSE_BADGE, CLOSE_BOARD, CLOSE_RED, CLOSE_SAND, drawDust, drawGlass, drawHand, greyPiece, rgb as rgbOf, wireFlash } from "./closeLook";
import { powerOf, type Badge, type CameraPreset, type ReelLook, type Tone, type StudioProject } from "./model";
import { squareXZ, WHIP_T, xzSquare, type Frame, type FramePiece, type ReelShot } from "./timeline";

const SANS = '"Geist", -apple-system, "Segoe UI", sans-serif';
const SERIF = '"Instrument Serif", Georgia, serif';

/** The only colours of the look. Everything else is grey. */
export const GLOW = { red: "#ff2a2a", green: "#1fdc3c", blue: "#5b6cff", cyan: "#19e0e0", amber: "#ffcf40", white: "#ffffff" } as const;
/** How solid each glow is: red and green are almost opaque, blue stays a soft tint. */
const SOLID: Record<string, number> = { [CLOSE_RED]: 0.96, [CLOSE_SAND]: 0.5, [CLOSE_BADGE.blunder]: 0.92, [CLOSE_BADGE.best]: 0.9, [CLOSE_BADGE.book]: 0.7, [GLOW.red]: 0.92, [GLOW.green]: 0.85, [GLOW.cyan]: 0.82, [GLOW.blue]: 0.55, [GLOW.amber]: 0.8, [GLOW.white]: 0.6 };

export const TONE_GLOW: Record<Tone, string> = { bad: GLOW.red, good: GLOW.green, accent: GLOW.blue, idea: GLOW.cyan, white: GLOW.white };
/** Glow under the badge's square, like the rating colours of the analysis page. */
export const BADGE_GLOW: Partial<Record<Exclude<Badge, "">, string>> = {
  brilliant: GLOW.cyan,
  great: GLOW.blue,
  best: GLOW.green,
  excellent: GLOW.green,
  good: GLOW.green,
  inaccuracy: GLOW.amber,
  mistake: GLOW.red,
  miss: GLOW.red,
  blunder: GLOW.red,
};

const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
const easeOut = (k: number) => 1 - Math.pow(1 - clamp01(k), 3);
const backOut = (k: number) => {
  const x = clamp01(k) - 1;
  return 1 + 2.4 * x * x * x + 1.4 * x * x;
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const easeInOut = (k: number) => {
  const x = clamp01(k);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
/** Seconds a flight into the next framing takes at most. */
const FLOW = 0.6;
/** The close variant: a quick flight to the next move, a long one at the opening. */
const CLOSE_FLOW = 0.4;
const OPEN_FLOW = 1.3;
/** The opening overview: the picture is this many squares across (the whole board with a margin) and stays so for this many seconds. */
export const OVERVIEW_ACROSS = 8.8;
export const OVERVIEW_HOLD = 0.7;

/**
 * How close each scene of a four-scene cycle is (0 = whole board, 1 = two squares): the camera flows between these framings and never closes in far enough to lose the board.
 * Even the closest of these still shows about five and a half squares across; the old cycle went down to three and cut the pieces off.
 */
export const SHOT_SIZES = [0.12, 0.34, 0.2, 0.4];
/** Which pieces grow and flip when they move: the heavy ones, never pawns. */
const WEIGHT: Record<PieceSymbol, number> = { p: 0.25, n: 0.8, b: 0.6, r: 0.6, q: 1, k: 0.4 };

export interface ReelCam {
  /** Radians, positive = clockwise. */
  roll: number;
  /** Pixels per square. */
  S: number;
  /** Board point (before mirroring) in the middle of the picture. */
  fx: number;
  fz: number;
  shakeX: number;
  shakeY: number;
  /** White flash over everything, 0..1. */
  flash: number;
}

/** What `paintReel` leaves behind: enough to turn a click on the picture into a square. */
export interface ReelView extends ReelCam {
  W: number;
  H: number;
  dir: 1 | -1;
}

const flipped = (yaw: number) => Math.cos((yaw * Math.PI) / 180) < 0;

interface Pose {
  /** Pixels per square. */
  S: number;
  /** Board point in the middle of the picture. */
  x: number;
  z: number;
  /** Tilt of the horizon in degrees. */
  roll: number;
}

/**
 * The camera angles of a scene that cuts (`cameras`), translated to this flat tilted board: how close the picture is
 * (0 = whole board, 1 = very close; kept at 3 squares or more) and how far the horizon leans.
 */
export const PRESET_LOOK: Record<CameraPreset, { cl: number; roll: number }> = {
  white: { cl: 0.2, roll: 0 },
  black: { cl: 0.25, roll: 0 },
  top: { cl: 0.1, roll: 0 },
  corner: { cl: 0.45, roll: 9 },
  side: { cl: 0.55, roll: -12 },
  low: { cl: 0.7, roll: -7 },
  close: { cl: 0.9, roll: 4 },
};

/**
 * The framing of the "close" variant: about four and a half squares across, centred on what the scene is about
 * (the move, else the arrow, else the mark), straight, never a tilt unless the scene asks for one. A long move pulls back
 * just far enough to keep both ends in the picture; the mating blow shows a little more of the board.
 */
function closePose(shot: ReelShot, m: number, preset: CameraPreset | null): Pose {
  const span = shot.move ?? shot.arrow;
  let across = 4.6;
  if (preset) across *= 1 + 0.35 * (0.3 - PRESET_LOOK[preset].cl);
  across /= shot.zoom;
  if (shot.effects.includes("mate")) across = Math.max(across, 6.2);
  if (shot.card !== "none") across = 8.6;
  // The title shot at the start has no move to frame: it keeps most of the board in view.
  if (shot.index === 0 && !shot.move) across = Math.max(across, 6.8);
  let [tx, tz] = [0, 0];
  if (span) {
    const [ax, az] = squareXZ(span.from);
    const [bx, bz] = squareXZ(span.to);
    across = Math.max(across, Math.hypot(bx - ax, bz - az) + 3.4);
    [tx, tz] = [(ax + bx) / 2, (az + bz) / 2];
  } else {
    const sq = shot.fxSquare ?? shot.mark;
    if (sq) [tx, tz] = squareXZ(sq);
  }
  across = Math.min(across, 8.6);
  const S = m / across;
  // The whole board in view stays centred.
  const hold = clamp01((8.6 - across) / 2);
  return { S, x: tx * hold, z: tz * hold, roll: preset ? PRESET_LOOK[preset].roll * 0.3 : 0 };
}

/** How a scene is framed once the camera has arrived: pure, so the previous scene's framing can be the start of this one's flight. */
function shotPose(shot: ReelShot, m: number, preset: CameraPreset | null = shot.entryPreset, tight = false): Pose {
  if (tight) return closePose(shot, m, preset);
  const wide = m / 9.2;
  const close = m / 2.3;
  // How close: 0 = the whole tilted board, 1 = two or three squares. The overview is never given up, so the range stays moderate.
  // The mating blow ends with the whole board in view, so the next scene flies on from there.
  if (shot.effects.includes("mate")) return { S: wide * 1.12, x: 0, z: 0, roll: 0 };
  let cl = (preset ? PRESET_LOOK[preset].cl : SHOT_SIZES[shot.index % SHOT_SIZES.length]) + (1 - shot.zoom) * 0.5;
  // The tilted board has to stay readable: a preset never closes in beyond about four and a half squares.
  if (preset) cl = Math.min(0.55, cl);
  if (shot.effects.includes("spotlight")) cl += 0.05;
  if (shot.card !== "none") cl = 0.08;
  let S = Math.exp(lerp(Math.log(wide), Math.log(close), clamp01(cl)));
  // A long arrow or move pulls the shot back so both ends stay in the picture.
  let [tx, tz] = [0, 0];
  const span = shot.arrow ?? shot.move;
  if (span) {
    const [ax, az] = squareXZ(span.from);
    const [bx, bz] = squareXZ(span.to);
    S = Math.min(S, (0.6 * m) / (Math.hypot(bx - ax, bz - az) + 1.6));
    // Framed by the middle, so the piece it starts from stays in the picture too.
    [tx, tz] = [(ax + bx) / 2, (az + bz) / 2];
  } else {
    const sq = shot.fxSquare ?? shot.mark;
    if (sq) [tx, tz] = squareXZ(sq);
  }
  // A wide shot shows the whole board, so it stays centred.
  const hold = clamp01(((S - wide) / (close - wide)) * 1.4);
  return { S, x: tx * hold, z: tz * hold, roll: preset ? PRESET_LOOK[preset].roll : 0 };
}

/** How close the camera gets on the showcase move: the picture is this many squares across. */
const HERO_CLOSE = 4.2;

/** 0..1: how much the camera is on the showcase piece right now (in shortly before take-off, out half a second after the landing). */
export function heroFocus(frame: Frame): number {
  const hero = frame.shot.hero;
  if (!hero) return 0;
  const into = easeInOut((frame.local - (hero.t0 - 0.55)) / 0.55);
  const out = easeInOut((frame.local - (hero.t1 + 0.3)) / 0.6);
  return into * (1 - out);
}

/** Where the showcase piece is: on its square before and after, in the air in between. */
function heroPoint(frame: Frame): [number, number] {
  const hero = frame.shot.hero!;
  const [ax, az] = squareXZ(hero.from);
  const [bx, bz] = squareXZ(hero.to);
  const p = frame.pieces.find((q) => q.flight && q.flight.k > 0 && q.flight.k < 1 && Math.hypot(q.flight.fromX - ax, q.flight.fromZ - az) < 0.1);
  if (p) return [p.x, p.z];
  return frame.local < hero.t0 ? [ax, az] : [bx, bz];
}

/** Is this piece the showcase piece in the air? */
function isHeroFlight(frame: Frame, p: FramePiece): boolean {
  const hero = frame.shot.hero;
  if (!hero || !p.flight) return false;
  const [ax, az] = squareXZ(hero.from);
  return Math.hypot(p.flight.fromX - ax, p.flight.fromZ - az) < 0.1;
}

/**
 * The camera of one frame: pure, so the movement can be tested without a canvas.
 * There are no cuts. Each scene's framing is reached by an eased flight that starts from where the
 * previous scene's framing ended, and the picture rolls slowly like an orbit around the board, so the
 * whole video is one continuous move.
 */
export function reelCamera(frame: Frame, W: number, H: number, look: ReelLook = "classic"): ReelCam {
  const close = look === "close";
  const m = Math.min(W, H);
  const u = m / 1080;
  const age = frame.local;
  const wide = m / 9.2;
  const fx = (kind: string) => frame.fx.find((f) => f.kind === kind)?.age;

  const sc = frame.scene;
  const to = shotPose(frame.shot, m, frame.shot.entryPreset, close);
  // The very first picture is the overview: the whole board and the whole position, held for a moment, so viewers know what they are looking at.
  // Only then does the camera fly in to the scene's framing. Cuts, punch-ins and the orbit's sway wait until the overview has been seen (`ov`).
  const opening = !frame.prevShot;
  const from: Pose = frame.prevShot ? shotPose(frame.prevShot, m, frame.prevShot.lastPreset, close) : { S: m / OVERVIEW_ACROSS, x: 0, z: 0, roll: 0 };
  const flow = close ? (frame.prevShot ? CLOSE_FLOW : OPEN_FLOW) : FLOW;
  const hold = opening ? Math.min(OVERVIEW_HOLD, frame.dur * 0.45) : 0;
  const ov = opening ? 1 - easeInOut((age - hold) / 0.35) : 0;
  // The horizon straightens and sways back in more slowly than the zoom changes, so the roll never snaps.
  const ovRoll = opening ? 1 - easeInOut((age - hold) / 0.9) : 0;
  // A scene that cuts between angles (or whips) is entered quickly, any other by a slow flight.
  const k = easeInOut((age - hold) / Math.min(Math.max(0.2, frame.dur - hold), frame.shot.fastEntry ? WHIP_T : flow));
  let S = Math.exp(lerp(Math.log(from.S), Math.log(to.S), k));
  let tx = lerp(from.x, to.x, k);
  let tz = lerp(from.z, to.z, k);
  let tilt = lerp(from.roll, to.roll, k);
  // The cuts of the scene: a quick whip from the angle before to the one now; the first cut after a hit-stop starts from where the picture is.
  const cut = frame.cut;
  if (cut && cut.prev !== null) {
    const a: Pose = cut.prev === "plain" ? { S, x: tx, z: tz, roll: tilt } : shotPose(frame.shot, m, cut.prev, close);
    const b = shotPose(frame.shot, m, cut.preset, close);
    const kc = easeInOut((age - cut.since) / WHIP_T);
    S = Math.exp(lerp(Math.log(a.S), Math.log(b.S), kc));
    tx = lerp(a.x, b.x, kc);
    tz = lerp(a.z, b.z, kc);
    tilt = lerp(a.roll, b.roll, kc);
  }
  // After arriving the camera keeps creeping in, so a held shot is never dead.
  S *= 1 + (close ? 0.03 : 0.04) * Math.max(0, age - flow);
  const zoomAge = fx("zoom");
  if (zoomAge !== undefined) S *= 1 + 0.35 * powerOf(sc, "zoom") * easeOut(zoomAge / 0.5);
  // Punch-in and riser push the picture in.
  S /= frame.push;
  // The showcase move: the camera goes in on the spinning piece, follows it through the air in slow motion,
  // takes the landing and then backs out to where the scene was. Close, but still about four squares across.
  const heroK = heroFocus(frame);
  const hero = frame.shot.hero;
  if (hero && heroK > 0) {
    const [px, pz] = heroPoint(frame);
    S = Math.exp(lerp(Math.log(S), Math.log(Math.max(S, m / HERO_CLOSE)), heroK));
    tx = lerp(tx, px, heroK);
    tz = lerp(tz, pz, heroK);
  } else {
    // Any other heavy piece in the air makes the camera lean in a little, never past a four-square view.
    const flying = close ? 0 : frame.pieces.reduce((best, p) => (p.flight ? Math.max(best, WEIGHT[p.type] * Math.sin(Math.PI * clamp01(p.flight.k))) : best), 0);
    if (flying > 0) S = Math.min(S * (1 + 0.22 * flying), Math.max(S, m / 4.2));
  }
  // Every landing nudges the picture.
  if (frame.landing) S *= 1 + 0.04 * Math.exp(-frame.landing.k * 8);

  // The orbit: a slow swing of the horizon, never the same twice in a row, and the same in every scene, so nothing jumps.
  const t = frame.time;
  // The close variant stays almost straight: a light sway, a lean into a threat or the mating blow, and the opening's tilt (in `tilt`).
  const sway = close ? 1.6 * Math.sin(t * 0.9) : 13 * Math.sin(t * 0.8) + 7 * Math.sin(t * 0.31 + 1.3);
  const threatAge = fx("threat");
  const leanAge = threatAge ?? fx("mate");
  const lean = close && leanAge !== undefined ? 12 * easeOut(leanAge / 0.6) : 0;
  // During the overview the board stays nearly straight: a tilted whole board would lose its corners.
  const roll = (((sway + (frame.scene.orbit || 0) * age + tilt + frame.roll + lean) * (1 - 0.8 * ovRoll)) * Math.PI) / 180;

  // The mating blow: the camera backs off to show the whole board while the pieces break.
  const mateAge = fx("mate");
  if (mateAge !== undefined) {
    const km = easeOut((mateAge - 0.3) / 0.7);
    S = lerp(S, close ? m / 6.2 : wide * 1.12, km);
    tx *= 1 - km;
    tz *= 1 - km;
  }

  if (ov > 0) {
    S = Math.exp(lerp(Math.log(S), Math.log(m / OVERVIEW_ACROSS), ov));
    tx *= 1 - ov;
    tz *= 1 - ov;
  }

  // Never show the black around the board when close: the centre stays far enough inside that the picture (with some slack for the roll) is all board.
  // (The close variant may show a little black at the edge, like the reference: the centre only stays on the board.)
  const half = (m / 2 / S) * 1.25;
  const limit = close ? 3.1 : Math.max(0, 4 - half);
  tx = Math.max(-limit, Math.min(limit, tx));
  tz = Math.max(-limit, Math.min(limit, tz));

  let shake = 0;
  const sh = fx("shake");
  if (sh !== undefined) shake = Math.max(shake, 16 * powerOf(sc, "shake") * Math.exp(-sh * 6));
  const mate = fx("mate");
  if (mate !== undefined) shake = Math.max(shake, 24 * powerOf(sc, "mate") * Math.exp(-mate * 4));
  // The showcase piece hits the board hard.
  const impact = hero ? age - hero.t1 : -1;
  if (impact >= 0) shake = Math.max(shake, 14 * Math.exp(-impact * 9));
  const shakeX = shake * u * Math.sin(age * 71);
  const shakeY = shake * u * Math.cos(age * 63);

  // No strobe at cuts, there are none: white only for the "flash" effect and the mating blow.
  let flash = 0;
  const fl = fx("flash");
  if (fl !== undefined && fl < 0.45) flash = Math.max(flash, 0.9 * powerOf(sc, "flash") * (1 - fl / 0.45) ** 2);
  if (mate !== undefined && mate < 0.25) flash = Math.max(flash, 0.55 * (1 - mate / 0.25));
  if (impact >= 0 && impact < 0.12) flash = Math.max(flash, 0.3 * (1 - impact / 0.12));
  return { roll, S, fx: tx, fz: tz, shakeX, shakeY, flash: clamp01(flash) };
}

/** The square under a point of the picture (0..1, y down), for clicks in the editor. */
export function reelSquareAt(view: ReelView, sx: number, sy: number): string | null {
  const dx = sx * view.W - (view.W / 2 + view.shakeX);
  const dy = sy * view.H - (view.H / 2 + view.shakeY);
  const c = Math.cos(-view.roll);
  const s = Math.sin(-view.roll);
  const bx = (dx * c - dy * s) / view.S + view.dir * view.fx;
  const bz = (dx * s + dy * c) / view.S + view.dir * view.fz;
  return xzSquare(view.dir * bx, view.dir * bz);
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** A square lit from within: solid colour that bleeds over its neighbours. */
function glowSquare(ctx: CanvasRenderingContext2D, S: number, x: number, z: number, colour: string, a: number): void {
  if (a <= 0.01) return;
  ctx.save();
  ctx.shadowColor = colour;
  ctx.shadowBlur = 0.75 * S;
  ctx.fillStyle = colour;
  ctx.globalAlpha = clamp01(a) * (SOLID[colour] ?? 0.8);
  ctx.fillRect(x - 0.5, z - 0.5, 1, 1);
  ctx.shadowBlur = 0.3 * S;
  ctx.globalAlpha = clamp01(a) * 0.5;
  ctx.fillRect(x - 0.5, z - 0.5, 1, 1);
  ctx.restore();
}

interface Glow {
  square: string;
  colour: string;
  alpha: number;
}

/** Which squares glow in which colour; later entries win, so danger beats the last-move tint. */
function glows(frame: Frame, close = false): Glow[] {
  if (close) return closeGlows(frame);
  const out = new Map<string, Glow>();
  const put = (square: string, colour: string, alpha: number) => {
    if (alpha > 0.01) out.set(square, { square, colour, alpha });
  };
  if (frame.lastMove) {
    put(frame.lastMove.from, GLOW.blue, 0.25 * frame.lastMove.alpha);
    put(frame.lastMove.to, GLOW.blue, 0.8 * frame.lastMove.alpha);
  }
  for (const h of frame.hints) put(h.square, GLOW.blue, 0.7 * h.alpha);
  for (const m of frame.marks) put(m.square, TONE_GLOW[m.tone], m.alpha);
  const threat = frame.fx.find((f) => f.kind === "threat")?.age;
  if (threat !== undefined) for (const sq of frame.threats) put(sq, GLOW.red, powerOf(frame.scene, "threat") * Math.min(1, threat / 0.3) * (0.75 + 0.25 * Math.sin(threat * 8)));
  const mate = frame.fx.find((f) => f.kind === "mate")?.age;
  if (mate !== undefined && frame.mate) put(frame.mate.king, GLOW.red, Math.min(1, mate / 0.2));
  if (frame.badge) {
    const colour = BADGE_GLOW[frame.badge.kind];
    if (colour) put(frame.badge.square, colour, Math.min(1, frame.badge.age / 0.2));
  }
  return [...out.values()];
}

/** The tints of the close variant: the squares of the last move carry the rating's colour (sand when there is none), threats are solid red. */
function closeGlows(frame: Frame): Glow[] {
  const out = new Map<string, Glow>();
  const put = (square: string, colour: string, alpha: number) => {
    if (alpha > 0.01) out.set(square, { square, colour, alpha });
  };
  const rated = frame.badge ? CLOSE_BADGE[frame.badge.kind] : CLOSE_SAND;
  if (frame.lastMove) {
    put(frame.lastMove.from, rated, 0.4 * frame.lastMove.alpha);
    put(frame.lastMove.to, rated, 0.85 * frame.lastMove.alpha);
  }
  for (const h of frame.hints) put(h.square, CLOSE_SAND, 0.6 * h.alpha);
  const tone: Record<Tone, string> = { bad: CLOSE_RED, good: CLOSE_BADGE.best, accent: CLOSE_BADGE.great, idea: CLOSE_BADGE.brilliant, white: "#ffffff" };
  for (const m of frame.marks) put(m.square, tone[m.tone], m.alpha);
  const threat = frame.fx.find((f) => f.kind === "threat")?.age;
  if (threat !== undefined) for (const sq of frame.threats) put(sq, CLOSE_RED, powerOf(frame.scene, "threat") * Math.min(1, threat / 0.3) * (0.85 + 0.15 * Math.sin(threat * 8)));
  const mate = frame.fx.find((f) => f.kind === "mate")?.age;
  if (mate !== undefined && frame.mate) put(frame.mate.king, CLOSE_RED, Math.min(1, mate / 0.2));
  if (frame.badge) put(frame.badge.square, CLOSE_BADGE[frame.badge.kind], Math.min(1, frame.badge.age / 0.2));
  return [...out.values()];
}

/** A thick arrow with a glow around it. Black arrows glow white, coloured ones glow in their own colour. */
function drawArrow(ctx: CanvasRenderingContext2D, S: number, a: [number, number], b: [number, number], progress: number, fill: string, glow: string, bend: number, alpha: number): void {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const nx = -uz;
  const nz = ux;
  // Starts just off the piece, ends with the tip short of the target's middle.
  const p0: [number, number] = [a[0] + ux * 0.3, a[1] + uz * 0.3];
  const p2: [number, number] = [b[0] - ux * 0.12, b[1] - uz * 0.12];
  const ctrl: [number, number] = [(p0[0] + p2[0]) / 2 + nx * bend * len, (p0[1] + p2[1]) / 2 + nz * bend * len];
  const at = (k: number): [number, number] => [(1 - k) ** 2 * p0[0] + 2 * (1 - k) * k * ctrl[0] + k * k * p2[0], (1 - k) ** 2 * p0[1] + 2 * (1 - k) * k * ctrl[1] + k * k * p2[1]];
  const head = 0.7;
  const end = clamp01(progress);
  if (end <= 0.02) return;
  const tip = at(end);
  const before = at(Math.max(0, end - 0.04));
  const tl = Math.hypot(tip[0] - before[0], tip[1] - before[1]) || 1;
  const tx = (tip[0] - before[0]) / tl;
  const tz = (tip[1] - before[1]) / tl;
  const baseC: [number, number] = [tip[0] - tx * head, tip[1] - tz * head];
  ctx.save();
  ctx.globalAlpha = clamp01(alpha);
  ctx.lineJoin = "round";
  // A thin rim in the glow colour under the arrow: a black arrow gets a white edge, so it still reads on the dark squares.
  ctx.shadowBlur = 0;
  ctx.strokeStyle = glow;
  ctx.fillStyle = glow;
  ctx.lineWidth = 0.36;
  ctx.beginPath();
  for (let i = 0; i <= 22; i++) {
    const p = at((end * i) / 22);
    if (i === 0) ctx.moveTo(p[0], p[1]);
    else ctx.lineTo(p[0], p[1]);
  }
  ctx.lineTo(baseC[0], baseC[1]);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(baseC[0] - tz * 0.5, baseC[1] + tx * 0.5);
  ctx.lineTo(baseC[0] + tz * 0.5, baseC[1] - tx * 0.5);
  ctx.closePath();
  ctx.lineWidth = 0.16;
  ctx.stroke();
  ctx.fill();
  // The reference's arrow sits in a thick cloud of light: three passes of a wide blur build it up, the last one stays tight so the edge reads.
  for (const pass of [0, 1, 2]) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = [1.35, 0.85, 0.35][pass] * S;
    ctx.strokeStyle = fill;
    ctx.fillStyle = fill;
    ctx.lineWidth = 0.2;
    ctx.beginPath();
    const steps = 22;
    for (let i = 0; i <= steps; i++) {
      const p = at((end * i) / steps);
      // The shaft stops where the head starts.
      const d = Math.hypot(p[0] - baseC[0], p[1] - baseC[1]);
      if (i === 0) ctx.moveTo(p[0], p[1]);
      else if (d > 0.01 || i < steps) ctx.lineTo(p[0], p[1]);
    }
    ctx.lineTo(baseC[0], baseC[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tip[0], tip[1]);
    ctx.lineTo(baseC[0] - tz * 0.44, baseC[1] + tx * 0.44);
    ctx.lineTo(baseC[0] + tz * 0.44, baseC[1] - tx * 0.44);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Deterministic pseudo-random 0..1, so a shard flies the same way in preview and export. */
function rnd(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** The pieces of the mated side break like glass: a crack runs through them, then the shards fly apart and fall. */
function drawShattered(ctx: CanvasRenderingContext2D, p: FramePiece, assets: Assets, dir: number, local: number, blast: [number, number]): void {
  const img = assets.pieces[pieceKey(p.color, p.type)];
  if (!img) return;
  const size = 0.96 * p.scale;
  const x = dir * p.x;
  const z = dir * p.z - 0.04;
  // A very short crack, then the piece bursts: the shards fly outwards, away from the mated king, instead of dropping.
  const CRACK = 0.1;
  const ring = [
    [-0.5, -0.5], [0, -0.5], [0.5, -0.5], [0.5, 0],
    [0.5, 0.5], [0, 0.5], [-0.5, 0.5], [-0.5, 0],
  ];
  const cx = (rnd(p.id * 3.1) - 0.5) * 0.24;
  const cz = (rnd(p.id * 5.7) - 0.5) * 0.24;
  if (local < CRACK) {
    const k = clamp01(local / CRACK);
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.translate(x + 0.03 * Math.sin(local * 160), z);
    // It swells a little under the pressure and glows white before it goes.
    const swell = 1 + 0.12 * k;
    softBlob(ctx, 0, 0, size * 0.9 * swell, size * 0.9 * swell, 0.8 * k, "255,255,255");
    ctx.drawImage(img, (-size * swell) / 2, (-size * swell) / 2, size * swell, size * swell);
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 0.035;
    ctx.lineCap = "round";
    ctx.beginPath();
    ring.forEach(([ex, ez]) => {
      ctx.moveTo(cx, cz);
      ctx.lineTo(lerp(cx, ex, k) * swell, lerp(cz, ez, k) * swell);
    });
    ctx.stroke();
    ctx.restore();
    return;
  }
  const t = local - CRACK;
  const fade = 1 - clamp01((t - 0.45) / 0.5);
  if (fade <= 0.01) return;
  // A white burst where the piece stood.
  if (t < 0.18) {
    ctx.save();
    const g = ctx.createRadialGradient(x, z, 0, x, z, 0.9);
    g.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - t / 0.18)})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - 1, z - 1, 2, 2);
    ctx.restore();
  }
  // Away from the king; the king itself bursts evenly in all directions.
  const bdx = p.x - blast[0];
  const bdz = p.z - blast[1];
  const bl = Math.hypot(bdx, bdz);
  const push: [number, number] = bl > 0.1 ? [(dir * bdx) / bl, (dir * bdz) / bl] : [0, 0];
  // Sixteen shards: each of the eight wedges split once more at a jittered point on its outer edge.
  let n = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const j = 0.35 + rnd(p.id * 17 + i) * 0.3;
    const mid: [number, number] = [lerp(a[0], b[0], j), lerp(a[1], b[1], j)];
    for (const [u, v] of [[a, mid], [mid, b]] as const) {
      n += 1;
      const gx = (cx + u[0] + v[0]) / 3;
      const gz = (cz + u[1] + v[1]) / 3;
      const gl = Math.hypot(gx, gz) || 1;
      const spread = (rnd(p.id * 7 + n) - 0.5) * 0.7;
      const ang = Math.atan2(gz / gl, gx / gl) + spread;
      const speed = 5 + rnd(p.id * 11 + n) * 6;
      // Fast out, then dragged by the air; only a touch of gravity.
      const travel = (speed * (1 - Math.exp(-t * 3.2))) / 3.2;
      const ox = (Math.cos(ang) + push[0] * 0.9) * travel;
      const oz = (Math.sin(ang) + push[1] * 0.9) * travel + 1.2 * t * t;
      const spin = (rnd(p.id * 13 + n) - 0.5) * 22 * t;
      // Shards come towards the camera as they fly.
      const grow = 1 + 0.7 * t;
      ctx.save();
      ctx.globalAlpha = p.alpha * fade;
      ctx.translate(x + ox, z + oz);
      ctx.translate(size * gx, size * gz);
      ctx.rotate(spin);
      ctx.scale(grow, grow);
      ctx.translate(-size * gx, -size * gz);
      ctx.beginPath();
      ctx.moveTo(size * cx, size * cz);
      ctx.lineTo(size * u[0], size * u[1]);
      ctx.lineTo(size * v[0], size * v[1]);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
      // A bright edge on every shard catches the light.
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 0.02;
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawPiece(ctx: CanvasRenderingContext2D, p: FramePiece, frame: Frame, assets: Assets, dir: number, close = false): void {
  const plain = assets.pieces[pieceKey(p.color, p.type)];
  if (!plain) return;
  const img = close && p.color === "b" ? greyPiece(plain) : plain;
  const x = dir * p.x;
  const z = dir * p.z;
  let size = 0.96 * p.scale;
  let rot = 0;
  let flipX = 1;
  const w = WEIGHT[p.type];
  const flying = p.flight && p.flight.k > 0 && p.flight.k < 1 ? p.flight.k : null;
  ctx.save();
  ctx.globalAlpha = p.alpha;
  const hero = flying !== null && isHeroFlight(frame, p);
  let squash = 0;
  if (flying !== null && hero) {
    // The showcase: the piece rises towards the camera and turns a full 360° in slow motion, then drops onto its square.
    const arc = Math.sin(Math.PI * flying);
    size *= 1 + 1.25 * arc;
    rot = (p.id % 2 ? 1 : -1) * 2 * Math.PI * easeInOut(flying);
  } else if (flying !== null) {
    // The piece swells towards the camera and flips like a coin, so every move feels thrown.
    const arc = Math.sin(Math.PI * flying);
    // The close variant lifts the piece a little like a hand would, no coin flip.
    size *= 1 + (close ? 0.2 : 0.9) * w * arc;
    if (!close && w >= 0.8) flipX = Math.cos(2 * Math.PI * flying);
    rot = close ? 0 : arc * 0.35 * (p.id % 2 ? 1 : -1) * w;
  }
  if (flying !== null) {
    // Motion trail: fainter copies back along the path.
    if (!close && w >= 0.6 && flying > 0.05) {
      const [fx0, fz0] = [dir * p.flight!.fromX, dir * p.flight!.fromZ];
      for (let i = 4; i >= 1; i--) {
        const back = 1 - i * 0.11;
        ctx.save();
        ctx.globalAlpha = p.alpha * 0.2 * (1 - i / 5);
        ctx.translate(lerp(fx0, x, back), lerp(fz0, z, back));
        ctx.drawImage(img, (-size * 0.92) / 2, (-size * 0.92) / 2, size * 0.92, size * 0.92);
        ctx.restore();
      }
    }
    // A flying piece sits in a halo of light.
    softBlob(ctx, x, z, size * (hero ? 1.1 : 0.8), size * (hero ? 1.1 : 0.8), hero ? 0.75 : 0.6, "255,255,255");
  } else {
    const landed = frame.landing && xzSquare(p.x, p.z) === frame.landing.square;
    const heroLanded = landed && frame.shot.hero && frame.shot.hero.to === frame.landing!.square && frame.local >= frame.shot.hero.t1;
    if (heroLanded) {
      // The showcase piece slams down: it squashes flat, springs up and wobbles out, like a ball hitting the floor.
      const tk = frame.landing!.k * 0.7;
      squash = 0.34 * Math.exp(-tk * 7) * Math.cos(tk * 26);
    } else if (landed) size *= 1 + 0.14 * Math.sin(Math.min(1, frame.landing!.k / 0.3) * Math.PI);
    softBlob(ctx, x, z + 0.3 * size, 0.5 * size, 0.2 * size, 0.6);
  }
  ctx.translate(x, z - 0.04);
  if (p.tilt) {
    // The mated king falls over, away from the piece that gives mate.
    const side = Math.sin(p.tiltYaw ?? 0) * dir;
    ctx.translate(0, size * 0.42);
    ctx.rotate((side >= 0 ? 1 : -1) * p.tilt);
    ctx.translate(0, -size * 0.42);
  }
  ctx.rotate(rot);
  ctx.scale(Math.abs(flipX) < 0.05 ? 0.05 * Math.sign(flipX || 1) : flipX, 1);
  if (squash) {
    // Squash about the piece's foot, so it stays standing on the square.
    ctx.translate(0, size * 0.42);
    ctx.scale(1 + squash, 1 - squash);
    ctx.translate(0, -size * 0.42);
  }
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
}

/** Paints one frame in the reel look and returns where the board ended up. */
export function paintReel(ctx: CanvasRenderingContext2D, frame: Frame, project: StudioProject, assets: Assets): ReelView {
  const { width: W, height: H } = ctx.canvas;
  const L = layout(W, H);
  const u = L.u;
  const st = project.style;
  const v = project.video;
  const dir: 1 | -1 = flipped(frame.camera.yaw) ? -1 : 1;
  const close = st.reelLook === "close";
  const cam = reelCamera(frame, W, H, st.reelLook);
  const { S } = cam;
  const view: ReelView = { ...cam, W, H, dir };

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);

  const onScreen = (sq: string): [number, number] => {
    const [x, z] = squareXZ(sq);
    const bx = (dir * x - dir * cam.fx) * S;
    const bz = (dir * z - dir * cam.fz) * S;
    const c = Math.cos(cam.roll);
    const s = Math.sin(cam.roll);
    return [W / 2 + cam.shakeX + bx * c - bz * s, H / 2 + cam.shakeY + bx * s + bz * c];
  };

  ctx.save();
  ctx.translate(W / 2 + cam.shakeX, H / 2 + cam.shakeY);
  ctx.rotate(cam.roll);
  ctx.scale(S, S);
  ctx.translate(-dir * cam.fx, -dir * cam.fz);

  // ---- the board: two greys, rank and file in the corners like on the big chess sites
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      ctx.fillStyle = (f + r) % 2 === 0 ? (close ? CLOSE_BOARD.dark : st.dark) : close ? CLOSE_BOARD.light : st.light;
      ctx.fillRect(dir * (f - 3.5) - 0.505, dir * (3.5 - r) - 0.505, 1.01, 1.01);
    }
  }
  if (st.coords) {
    ctx.font = `700 0.17px ${SANS}`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    const leftFile = dir > 0 ? 0 : 7;
    for (let r = 0; r < 8; r++) {
      ctx.fillStyle = (leftFile + r) % 2 === 0 ? "rgba(235,235,235,0.8)" : "rgba(70,70,70,0.85)";
      ctx.fillText(String(r + 1), dir * (leftFile - 3.5) - 0.46, dir * (3.5 - r) - 0.46);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    const bottomRank = dir > 0 ? 0 : 7;
    for (let f = 0; f < 8; f++) {
      ctx.fillStyle = (f + bottomRank) % 2 === 0 ? "rgba(235,235,235,0.8)" : "rgba(70,70,70,0.85)";
      ctx.fillText("abcdefgh"[f], dir * (f - 3.5) + 0.46, dir * (3.5 - bottomRank) + 0.46);
    }
  }

  // ---- glowing squares under the pieces
  for (const g of glows(frame, close)) {
    const [x, z] = squareXZ(g.square);
    glowSquare(ctx, S, dir * x, dir * z, g.colour, g.alpha);
  }
  // Shock rings round the mated king.
  const mateAge = frame.fx.find((f) => f.kind === "mate")?.age;
  if (mateAge !== undefined && frame.mate) {
    const [kx, kz] = squareXZ(frame.mate.king);
    for (const delay of [0.15, 0.4]) {
      const k = (mateAge - delay) / 0.9;
      if (k <= 0 || k >= 1) continue;
      ctx.beginPath();
      ctx.arc(dir * kx, dir * kz, 0.5 + k * 4.5, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(GLOW.red, 0.9 * (1 - k));
      ctx.lineWidth = 0.14 * (1 - k) + 0.02;
      ctx.stroke();
    }
  }

  // ---- close variant: a halo of the rating's colour behind the piece that just moved
  const rating = close && frame.badge ? CLOSE_BADGE[frame.badge.kind] : null;
  if (rating && frame.badge) {
    const [bx, bz] = squareXZ(frame.badge.square);
    const a = clamp01(frame.badge.age / 0.2) * (1 - clamp01((frame.badge.age - 1.3) / 0.9));
    softBlob(ctx, dir * bx, dir * bz, 1.25, 1.25, 0.6 * a, rgbOf(rating));
  }

  // ---- pieces: the ones on the board first, the flying ones on top
  const ordered = [...frame.pieces].filter((p) => p.alpha > 0.01).sort((a, b) => Number(Boolean(a.flight)) - Number(Boolean(b.flight)) || a.y - b.y);
  // The side that got mated: all its pieces break, the nearest to the king first.
  const matedColour = mateAge !== undefined && frame.mate ? frame.pieces.find((q) => q.type === "k" && xzSquare(q.x, q.z) === frame.mate!.king)?.color : undefined;
  const matedKing = frame.mate ? squareXZ(frame.mate.king) : [0, 0];
  for (const p of ordered) {
    if (matedColour && p.color === matedColour && mateAge !== undefined) {
      const dist = Math.hypot(p.x - matedKing[0], p.z - matedKing[1]);
      const local = mateAge - (0.25 + dist * 0.05);
      if (local >= 0) drawShattered(ctx, p, assets, dir, local, matedKing as [number, number]);
      else drawPiece(ctx, { ...p, tilt: undefined }, frame, assets, dir, close);
    } else drawPiece(ctx, p, frame, assets, dir, close);
  }
  // ---- close variant: the hand that drags the piece, and rings that spread from the rated square
  if (close) {
    const hand = frame.hand;
    if (hand) {
      // The hand holds the piece it drags; the showcase piece swells in the air, so its hand grows with it.
      const air = ordered.find((p) => isHeroFlight(frame, p));
      const grow = air?.flight ? 1 + 0.9 * Math.sin(Math.PI * air.flight.k) : 1;
      // A soft ring spreads from the fingers at the grab, like a click.
      if (hand.grabAge >= 0 && hand.grabAge < 0.45) {
        const k = hand.grabAge / 0.45;
        ctx.beginPath();
        ctx.arc(dir * hand.x, dir * hand.z, 0.3 + easeOut(k) * 0.55, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - k)})`;
        ctx.lineWidth = 0.05 * (1 - k) + 0.01;
        ctx.stroke();
      }
      drawHand(ctx, S, dir * hand.x + hand.ox * grow, dir * hand.z + hand.oz * grow, 1.25 * hand.scale * grow, hand.angle, hand.alpha, hand.grip);
    }
    if (rating && frame.badge) {
      const [bx, bz] = squareXZ(frame.badge.square);
      for (const delay of [0, 0.22]) {
        const k = (frame.badge.age - delay) / 0.9;
        if (k <= 0 || k >= 1) continue;
        ctx.beginPath();
        ctx.arc(dir * bx, dir * bz, 0.5 + easeOut(k) * 0.9, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(rating, 0.75 * (1 - k));
        ctx.lineWidth = 0.05 * (1 - k) + 0.008;
        ctx.stroke();
      }
    }
  }

  // ---- the showcase landing: a white shock ring, a second fainter one and dust flying off the square
  const heroShot = frame.shot.hero;
  if (heroShot && frame.local >= heroShot.t1) {
    const tk = frame.local - heroShot.t1;
    const [hx, hz] = squareXZ(heroShot.to);
    ctx.save();
    for (const [delay, width] of [[0, 0.16], [0.08, 0.07]] as const) {
      const k = (tk - delay) / 0.55;
      if (k <= 0 || k >= 1) continue;
      ctx.beginPath();
      ctx.arc(dir * hx, dir * hz, 0.45 + easeOut(k) * 2.4, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - k)})`;
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 0.4 * S;
      ctx.lineWidth = width * (1 - k) + 0.015;
      ctx.stroke();
    }
    const dust = tk / 0.6;
    if (dust < 1) {
      ctx.fillStyle = `rgba(255,255,255,${0.8 * (1 - dust)})`;
      for (let i = 0; i < 14; i++) {
        const ang = (i / 14) * Math.PI * 2 + rnd(i * 3.3) * 0.4;
        const r = 0.4 + easeOut(dust) * (1.1 + rnd(i * 7.1) * 1.2);
        ctx.beginPath();
        ctx.arc(dir * hx + Math.cos(ang) * r, dir * hz + Math.sin(ang) * r, 0.035 + rnd(i * 1.7) * 0.04, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---- arrows: neutral ones black with a white glow, danger ones red and curved
  // While the showcase piece is in the air its arrow steps back, so the spin is not drawn over.
  const heroAir = heroShot && frame.local > heroShot.t0 - 0.2 && frame.local < heroShot.t1 + 0.1 ? 0.15 : 1;
  frame.arrows.forEach((a0, i) => {
    const a = { ...a0, alpha: a0.alpha * heroAir };
    if (a.path || a.progress <= 0 || a.alpha <= 0) return;
    const [ax, az] = squareXZ(a.from);
    const [bx, bz] = squareXZ(a.to);
    const from: [number, number] = [dir * ax, dir * az];
    const to: [number, number] = [dir * bx, dir * bz];
    if (a.colour) drawArrow(ctx, S, from, to, a.progress, a.colour, "#ffffff", 0, a.alpha);
    else if (a.tone === "bad") drawArrow(ctx, S, from, to, a.progress, GLOW.red, GLOW.red, i % 2 ? -0.28 : 0.28, a.alpha);
    else if (a.tone === "good") drawArrow(ctx, S, from, to, a.progress, GLOW.green, GLOW.green, 0, a.alpha);
    else drawArrow(ctx, S, from, to, a.progress, "#050505", "#ffffff", 0, a.alpha);
  });

  // ---- rating badge on the corner of the square, like on the analysis page
  if (frame.badge) {
    const img = assets.badges[frame.badge.kind];
    const k = backOut(frame.badge.age / 0.4);
    if (img && k > 0) {
      const [bx, bz] = squareXZ(frame.badge.square);
      const size = 0.5 * k;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 0.2 * S;
      ctx.drawImage(img, dir * bx + 0.5 - size * 0.72, dir * bz - 0.5 - size * 0.28, size, size);
      ctx.restore();
    }
  }
  ctx.restore();

  // ---- picture-wide light: dark edges that close in on the action, a red wash for danger
  const spot = frame.fx.find((f) => f.kind === "spotlight")?.age;
  let cx = W / 2;
  let cy = H / 2;
  let hole = 0.42;
  if (spot !== undefined && frame.fxSquare) {
    [cx, cy] = onScreen(frame.fxSquare);
    hole = lerp(0.42, 0.1, easeOut(spot / 0.4) * powerOf(frame.scene, "spotlight"));
  }
  const vig = ctx.createRadialGradient(cx, cy, Math.min(W, H) * hole, cx, cy, Math.max(W, H) * 0.8);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, `rgba(0,0,0,${spot !== undefined ? 0.72 + 0.2 * powerOf(frame.scene, "spotlight") : close ? 0.4 : 0.72})`);
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
  const danger = close ? 0 : mateAge !== undefined ? Math.min(1, mateAge / 0.3) * Math.max(0.12, 0.34 - 0.1 * mateAge) * (1 + 0.2 * Math.sin(mateAge * 9)) : frame.badge && (frame.badge.kind === "blunder" || frame.badge.kind === "miss") ? 0.3 * Math.exp(-frame.badge.age * 3.5) : 0;
  if (danger > 0.01) {
    ctx.fillStyle = `rgba(150,0,0,${danger})`;
    ctx.fillRect(0, 0, W, H);
  }

  if (close) {
    drawDust(ctx, frame.time, 1);
    // Glass at the big hits: the mating blow first, then the showcase landing, then a bad rated move. It breaks over the square it happened on.
    const hero = frame.shot.hero;
    const badRated = frame.badge && (frame.badge.kind === "blunder" || frame.badge.kind === "mistake" || frame.badge.kind === "miss");
    let hit: { age: number; square: string } | null = null;
    if (mateAge !== undefined && frame.mate) hit = { age: mateAge, square: frame.mate.king };
    else if (hero && frame.local >= hero.t1) hit = { age: frame.local - hero.t1, square: hero.to };
    else if (badRated && frame.badge) hit = { age: frame.badge.age, square: frame.badge.square };
    if (hit) {
      const [gx, gy] = onScreen(hit.square);
      drawGlass(ctx, gx, gy, hit.age, 1, frame.shot.index * 13 + 5);
    }
  }

  // ---- text: almost none. A quiet headline on top, a plain caption at the bottom.
  const card = frame.card;
  const quiet = card.kind === "none" ? 1 : 1 - card.alpha;
  ctx.save();
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 18 * u;
  if (close && !frame.lesson && frame.title.text.trim() && quiet > 0.01) drawCloseTitle(ctx, frame, assets, L, quiet, st.textScale);
  else if (!frame.lesson && frame.title.text.trim() && quiet > 0.01) {
    ctx.globalAlpha = frame.title.alpha * quiet * easeOut(frame.title.age / 0.4);
    const fit = fitText(ctx, tokens(frame.title.text), L.textMax, 2, 78 * u * st.textScale, (sz) => `400 ${sz}px ${SERIF}`);
    ctx.font = `400 ${fit.size}px ${SERIF}`;
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "alphabetic";
    fit.lines.forEach((line, i) => ctx.fillText(line.map((tk) => tk.word).join(" "), W / 2, L.titleTop + (L.portrait ? 10 : 28) * u + i * fit.size * 1.05));
  }
  if (!frame.lesson && frame.text.text.trim() && quiet > 0.01) {
    ctx.globalAlpha = frame.text.alpha * quiet * easeOut(frame.text.age / 0.3);
    const base = 42 * u * st.textScale;
    const fit = fitText(ctx, tokens(frame.text.text), L.textMax, 3, base, (sz) => `600 ${sz}px ${SANS}`, (sz) => `800 ${sz}px ${SANS}`);
    ctx.textBaseline = "alphabetic";
    const lh = fit.size * 1.3;
    const top = L.subCenter - (fit.lines.length * lh) / 2 + fit.size;
    fit.lines.forEach((line, li) => {
      ctx.font = `600 ${fit.size}px ${SANS}`;
      const space = ctx.measureText(" ").width;
      const widths = line.map((tk) => {
        ctx.font = `${tk.emph ? 800 : 600} ${fit.size}px ${SANS}`;
        return ctx.measureText(tk.word).width;
      });
      const total = widths.reduce((sum, w, k) => sum + w + (k && !line[k].glue ? space : 0), 0);
      let x = W / 2 - total / 2;
      ctx.textAlign = "left";
      line.forEach((tk, k) => {
        if (k && !tk.glue) x += space;
        ctx.font = `${tk.emph ? 800 : 600} ${fit.size}px ${SANS}`;
        ctx.fillStyle = tk.emph ? GLOW.cyan : "#ffffff";
        ctx.fillText(tk.word, x, top + li * lh);
        x += widths[k];
      });
    });
  }
  ctx.restore();

  // ---- cards: question and poll reuse the usual ones, intro is the usual one on a darker board, outro is the reel's own
  if (card.kind === "outro") drawOutro(ctx, frame, assets, L, W, H, st.textScale);
  else if (card.kind !== "none" && card.alpha > 0.01) drawCard(ctx, frame, project, assets, L, W, H);

  // ---- the strobe
  if (cam.flash > 0.01) {
    ctx.fillStyle = `rgba(255,255,255,${cam.flash})`;
    ctx.fillRect(0, 0, W, H);
  }

  // ---- close variant: the wireframe flash on the hits and at the start of a rated move, in the colour of the rating
  if (close) {
    const colour = frame.badge ? CLOSE_BADGE[frame.badge.kind] : CLOSE_BADGE.best;
    let wire = frame.impact.invert;
    const loud = frame.badge && ["best", "great", "brilliant", "blunder", "mistake", "miss"].includes(frame.badge.kind);
    if (loud && frame.shot.index > 0 && frame.local < 0.14) wire = Math.max(wire, 1 - frame.local / 0.14);
    wireFlash(ctx, colour, wire > 0.05 ? wire : 0);
  }

  // ---- branding stays small and quiet: the name at the bottom, the address under it
  if (close && v.brand && !(card.kind === "outro" && card.alpha > 0.5)) {
    // Like the reference: the handle small in the lower right corner, upper case.
    ctx.save();
    ctx.globalAlpha = 0.7 * Math.max(quiet, 0.5);
    ctx.font = `700 ${22 * u}px ${SANS}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 6 * u;
    ctx.fillText(`@${BRAND.toUpperCase()}`, W - 28 * u, H - (L.portrait ? 120 : 24) * u);
    ctx.restore();
  } else if (v.brand && !(card.kind === "outro" && card.alpha > 0.5)) {
    // Square and wide pictures fill the frame with the board: the name sits at the top edge, not on the white king (e1) at the bottom.
    // Phone format too: the lower picture is the board, so the name goes up under the progress edge, above the hook text.
    const size = (L.portrait ? 28 : 24) * u;
    const y = L.portrait ? 120 * u : 36 * u;
    ctx.save();
    ctx.globalAlpha = 0.72 * Math.max(quiet, 0.5);
    ctx.font = `400 ${size}px ${SERIF}`;
    const tw = ctx.measureText(BRAND).width;
    const logo = size * 1.1;
    const x0 = W / 2 - (tw + logo + 10 * u) / 2;
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 8 * u;
    if (assets.logo) ctx.drawImage(assets.logo, x0, y - logo / 2, logo, logo);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(BRAND, x0 + logo + 10 * u, y + 2 * u);
    if (v.watermark) {
      ctx.font = `500 ${18 * u}px ${SANS}`;
      ctx.globalAlpha *= 0.65;
      ctx.textAlign = "center";
      ctx.fillText(BRAND_DOMAIN, W / 2, y + size * 0.95);
    }
    ctx.restore();
  }
  if (v.progress) {
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(0, H - 4 * u, W * frame.progress, 4 * u);
  }
  return view;
}

/**
 * The title of the close variant: thin capitals with a glow, in the middle of a board that dims behind it. On the very first picture a king and a queen
 * flank the line, like the hook of the reference.
 */
function drawCloseTitle(ctx: CanvasRenderingContext2D, frame: Frame, assets: Assets, L: ReturnType<typeof layout>, quiet: number, textScale: number): void {
  const { width: W, height: H } = ctx.canvas;
  const u = L.u;
  const a = frame.title.alpha * quiet * easeOut(frame.title.age / 0.3);
  if (a <= 0.01) return;
  ctx.save();
  // The very first title shot dims the board less: the position is what the viewer should take in first.
  ctx.fillStyle = `rgba(0,0,0,${(frame.prevShot ? 0.66 : 0.24) * a})`;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = a;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const fit = fitText(ctx, tokens(frame.title.text.toUpperCase()), L.textMax * 0.8, 3, 58 * u * textScale, (sz) => `300 ${sz}px ${SANS}`);
  ctx.font = `300 ${fit.size}px ${SANS}`;
  // letterSpacing is missing in older browsers: the text is then just a little tighter.
  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  spaced.letterSpacing = `${(fit.size * 0.04).toFixed(1)}px`;
  ctx.shadowColor = "rgba(255,255,255,0.9)";
  ctx.shadowBlur = 16 * u;
  ctx.fillStyle = "#ffffff";
  const lh = fit.size * 1.18;
  const top = H * 0.5 - (fit.lines.length * lh) / 2 + fit.size * 0.85;
  let widest = 0;
  fit.lines.forEach((line, i) => {
    const text = line.map((tk) => tk.word).join(" ");
    widest = Math.max(widest, ctx.measureText(text).width);
    ctx.fillText(text, W / 2, top + i * lh);
  });
  spaced.letterSpacing = "0px";
  if (!frame.prevShot) {
    const king = assets.pieces[pieceKey("b", "k")];
    const queen = assets.pieces[pieceKey("w", "q")];
    const size = fit.size * 1.9;
    ctx.shadowBlur = 0;
    ctx.globalAlpha = a * 0.85;
    if (king) {
      ctx.save();
      ctx.translate(W / 2 - widest / 2 - size * 0.6, H * 0.5);
      ctx.rotate(-0.28);
      ctx.drawImage(king, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    if (queen) {
      ctx.save();
      ctx.translate(W / 2 + widest / 2 + size * 0.6, H * 0.5);
      ctx.rotate(0.22);
      ctx.drawImage(queen, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
  }
  ctx.restore();
}

/**
 * The last picture: black, a knight that sweeps through the frame with a long
 * white smear behind it, then name, message and address.
 */
/** An outro up to this long (seconds) is an overlay on the board, not a black end screen: the video loops straight into its start. */
export const OUTRO_OVERLAY_MAX = 2.1;

function drawOutro(ctx: CanvasRenderingContext2D, frame: Frame, assets: Assets, L: ReturnType<typeof layout>, W: number, H: number, textScale: number): void {
  const { u } = L;
  const a = frame.card.alpha;
  const age = frame.card.age;
  // Short outro: everything twice as fast, the shattered board stays visible behind a dark veil.
  const over = frame.dur <= OUTRO_OVERLAY_MAX;
  const pace = over ? 2.4 : 1;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = over ? "rgba(0,0,0,0.62)" : "#000000";
  ctx.fillRect(0, 0, W, H);

  // The sweep: from the lower left to the upper right, fast first, then it hangs there.
  const k = easeOut((age * pace) / 1.3);
  const from: [number, number] = [-0.1 * W, H * 0.62];
  const to: [number, number] = [W * 0.8, H * 0.2];
  const x = lerp(from[0], to[0], k);
  const y = lerp(from[1], to[1], k) + Math.sin(age * 2.2) * 6 * u;
  const knight = assets.pieces[pieceKey("w", "n")];
  const queen = assets.pieces[pieceKey("w", "q")];
  const size = 250 * u;
  if (queen) {
    ctx.globalAlpha = a * 0.3;
    ctx.save();
    ctx.translate(W * 0.2, H * 0.3);
    ctx.rotate(-0.25 + Math.sin(age * 1.4) * 0.06);
    ctx.drawImage(queen, -size * 0.45, -size * 0.45, size * 0.9, size * 0.9);
    ctx.restore();
    ctx.globalAlpha = a;
  }
  const dx = x - from[0];
  const dy = y - from[1];
  const dl = Math.hypot(dx, dy) || 1;
  const trail = Math.min(dl, 0.7 * W);
  const g = ctx.createLinearGradient(x, y, x - (dx / dl) * trail, y - (dy / dl) * trail);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.save();
  ctx.strokeStyle = g;
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(255,255,255,0.8)";
  ctx.shadowBlur = 30 * u;
  ctx.lineWidth = 34 * u * (1 - 0.4 * k);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - (dx / dl) * trail, y - (dy / dl) * trail);
  ctx.stroke();
  ctx.restore();
  if (knight) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(0.35 * (1 - k));
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 24 * u;
    ctx.drawImage(knight, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  // Name, message, address.
  const cx = W / 2;
  const base = H * (L.portrait ? 0.62 : 0.66);
  const show = clamp01((age * pace - 0.45) / 0.5);
  ctx.globalAlpha = a * show;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(255,255,255,0.35)";
  ctx.shadowBlur = 30 * u;
  const logo = 140 * u;
  if (assets.logo) ctx.drawImage(assets.logo, cx - logo / 2, base - 200 * u, logo, logo);
  ctx.font = `400 ${112 * u * textScale}px ${SERIF}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(BRAND, cx, base + 30 * u);
  ctx.shadowBlur = 0;
  const message = frame.title.text.trim() || t("Jetzt kostenlos auf {BRAND_DOMAIN}", { BRAND_DOMAIN });
  const fit = fitText(ctx, tokens(message), L.textMax, 2, 46 * u * textScale, (sz) => `600 ${sz}px ${SANS}`, (sz) => `800 ${sz}px ${SANS}`);
  ctx.font = `600 ${fit.size}px ${SANS}`;
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  fit.lines.forEach((line, i) => ctx.fillText(line.map((tk) => tk.word).join(" "), cx, base + 100 * u + i * fit.size * 1.3));
  ctx.font = `500 ${26 * u}px ${SANS}`;
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillText(BRAND_DOMAIN, cx, base + 120 * u + fit.lines.length * fit.size * 1.3 + 20 * u);
  ctx.restore();
}
