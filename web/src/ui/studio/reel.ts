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

import { BRAND, BRAND_DOMAIN } from "../../brand";
import { t } from "../../i18n";
import { drawCard, fitText, layout, tokens, type Assets } from "./compose";
import { pieceKey } from "./flat";
import type { Badge, Tone, StudioProject } from "./model";
import { squareXZ, xzSquare, type Frame, type FramePiece } from "./timeline";

const SANS = '"Geist", -apple-system, "Segoe UI", sans-serif';
const SERIF = '"Instrument Serif", Georgia, serif';

/** The only colours of the look. Everything else is grey. */
export const GLOW = { red: "#ff2a2a", green: "#1fdc3c", blue: "#5b6cff", cyan: "#19e0e0", amber: "#ffcf40", white: "#ffffff" } as const;
/** How solid each glow is: red and green are almost opaque, blue stays a soft tint. */
const SOLID: Record<string, number> = { [GLOW.red]: 0.92, [GLOW.green]: 0.85, [GLOW.cyan]: 0.82, [GLOW.blue]: 0.55, [GLOW.amber]: 0.8, [GLOW.white]: 0.6 };

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

/** Camera roll per scene in degrees: each cut leans the other way, like a hand-held shot. */
export const ROLLS = [-11, 8, -6, 13, -9, 5];
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

/** The camera of one frame: pure, so the cuts can be tested without a canvas. */
export function reelCamera(frame: Frame, W: number, H: number): ReelCam {
  const m = Math.min(W, H);
  const u = m / 1080;
  const s = frame.scene;
  const age = frame.local;
  const wide = m / 9.2;
  const close = m / 3.3;
  const fx = (kind: string) => frame.fx.find((f) => f.kind === kind)?.age;

  // How close the shot is: 0 = the whole tilted board, 1 = two or three squares.
  let cl = clamp01(0.55 + (1 - s.zoom) * 0.8);
  if (s.focus) cl += 0.15;
  if (fx("spotlight") !== undefined) cl += 0.1;
  if (s.card !== "none") cl = 0.08;
  cl = clamp01(cl);
  let S = Math.exp(lerp(Math.log(wide), Math.log(close), cl));
  // The arrows must fit: a long arrow pulls the shot back so both ends stay in the picture.
  let reach = 0;
  for (const a of frame.arrows) {
    if (a.path) continue;
    const [ax, az] = squareXZ(a.from);
    const [bx, bz] = squareXZ(a.to);
    reach = Math.max(reach, Math.hypot(bx - ax, bz - az));
  }
  if (reach > 0) S = Math.min(S, (0.72 * m) / (reach + 1.6));
  // Cuts alternate between punching in from too close and pushing in from too far.
  const start = frame.index % 2 === 0 ? 1.45 : 0.72;
  S *= 1 + (start - 1) * Math.exp(-age / 0.24);
  S *= 1 + 0.035 * age;
  const zoomAge = fx("zoom");
  if (zoomAge !== undefined) S *= 1 + 0.4 * easeOut(zoomAge / 0.3);
  // Every landing kicks the picture a little.
  if (frame.landing) S *= 1 + 0.05 * Math.exp(-frame.landing.k * 9);

  const sign = ROLLS[frame.index % ROLLS.length] < 0 ? -1 : 1;
  const roll = ((ROLLS[frame.index % ROLLS.length] + (s.orbit || sign * 1.4) * age + sign * 8 * Math.exp(-age / 0.2)) * Math.PI) / 180;

  // The camera flies from the piece's square to the one it lands on.
  let tx = 0;
  let tz = 0;
  if (frame.focus) {
    const [ax, az] = squareXZ(frame.focus.from);
    const [bx, bz] = squareXZ(frame.focus.to);
    const k = easeOut(age / Math.max(0.5, frame.dur * 0.5));
    tx = lerp(ax, bx, k);
    tz = lerp(az, bz, k);
  } else {
    const sq = frame.fxSquare ?? frame.marks[0]?.square ?? frame.arrows.find((a) => !a.path)?.to;
    if (sq) [tx, tz] = squareXZ(sq);
  }
  // A wide shot shows the whole board, so it stays centred.
  const hold = clamp01(((S - wide) / (close - wide)) * 1.4);
  tx *= hold;
  tz *= hold;

  let shake = 0;
  const sh = fx("shake");
  if (sh !== undefined) shake = Math.max(shake, 16 * Math.exp(-sh * 6));
  const mate = fx("mate");
  if (mate !== undefined) shake = Math.max(shake, 24 * Math.exp(-mate * 4));
  const shakeX = shake * u * Math.sin(age * 71);
  const shakeY = shake * u * Math.cos(age * 63);

  // White strobe on every cut, a big one on the "flash" effect and the mating blow.
  let flash = frame.index > 0 ? 0.5 * Math.exp(-age / 0.07) : 0;
  const fl = fx("flash");
  if (fl !== undefined && fl < 0.45) flash = Math.max(flash, 0.9 * (1 - fl / 0.45) ** 2);
  if (mate !== undefined && mate < 0.25) flash = Math.max(flash, 0.85 * (1 - mate / 0.25));
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
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
function glows(frame: Frame): Glow[] {
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
  if (threat !== undefined) for (const sq of frame.threats) put(sq, GLOW.red, Math.min(1, threat / 0.3) * (0.75 + 0.25 * Math.sin(threat * 8)));
  const mate = frame.fx.find((f) => f.kind === "mate")?.age;
  if (mate !== undefined && frame.mate) put(frame.mate.king, GLOW.red, Math.min(1, mate / 0.2));
  if (frame.badge) {
    const colour = BADGE_GLOW[frame.badge.kind];
    if (colour) put(frame.badge.square, colour, Math.min(1, frame.badge.age / 0.2));
  }
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
  const head = 0.66;
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
  for (const pass of [0, 1]) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = (pass ? 0.3 : 0.7) * S;
    ctx.strokeStyle = fill;
    ctx.fillStyle = fill;
    ctx.lineWidth = 0.25;
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
    ctx.lineTo(baseC[0] - tz * 0.42, baseC[1] + tx * 0.42);
    ctx.lineTo(baseC[0] + tz * 0.42, baseC[1] - tx * 0.42);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawPiece(ctx: CanvasRenderingContext2D, p: FramePiece, frame: Frame, assets: Assets, S: number, dir: number): void {
  const img = assets.pieces[pieceKey(p.color, p.type)];
  if (!img) return;
  const x = dir * p.x;
  const z = dir * p.z;
  let size = 0.96 * p.scale;
  let rot = 0;
  let flipX = 1;
  const w = WEIGHT[p.type];
  const flying = p.flight && p.flight.k > 0 && p.flight.k < 1 ? p.flight.k : null;
  ctx.save();
  ctx.globalAlpha = p.alpha;
  if (flying !== null) {
    // The piece swells towards the camera and flips like a coin, so every move feels thrown.
    const arc = Math.sin(Math.PI * flying);
    size *= 1 + 0.9 * w * arc;
    if (w >= 0.8) flipX = Math.cos(2 * Math.PI * flying);
    rot = arc * 0.35 * (p.id % 2 ? 1 : -1) * w;
    // Motion trail: fainter copies back along the path.
    if (w >= 0.6 && flying > 0.05) {
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
    ctx.shadowColor = "rgba(255,255,255,0.85)";
    ctx.shadowBlur = 0.5 * S;
  } else {
    // A piece that just landed squashes once.
    if (frame.landing && xzSquare(p.x, p.z) === frame.landing.square) size *= 1 + 0.14 * Math.sin(Math.min(1, frame.landing.k / 0.3) * Math.PI);
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 0.22 * S;
    ctx.shadowOffsetY = 0.07 * S;
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
  const cam = reelCamera(frame, W, H);
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
      ctx.fillStyle = (f + r) % 2 === 0 ? st.dark : st.light;
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
  for (const g of glows(frame)) {
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

  // ---- pieces: the ones on the board first, the flying ones on top
  const ordered = [...frame.pieces].filter((p) => p.alpha > 0.01).sort((a, b) => Number(Boolean(a.flight)) - Number(Boolean(b.flight)) || a.y - b.y);
  for (const p of ordered) drawPiece(ctx, p, frame, assets, S, dir);

  // ---- arrows: neutral ones black with a white glow, danger ones red and curved
  frame.arrows.forEach((a, i) => {
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

  // ---- "M1" tag above the mated king
  if (mateAge !== undefined && frame.mate) {
    const k = backOut((mateAge - 0.1) / 0.35);
    if (k > 0) {
      const [kx, kz] = squareXZ(frame.mate.king);
      const [mx, mz] = squareXZ(frame.mate.by);
      const ml = Math.hypot(mx - kx, mz - kz) || 1;
      ctx.save();
      // One square from the king towards the piece that gives mate.
      ctx.translate(dir * (kx + ((mx - kx) / ml) * 1.05), dir * (kz + ((mz - kz) / ml) * 1.05));
      ctx.scale(k, k);
      ctx.shadowColor = GLOW.red;
      ctx.shadowBlur = 0.6 * S;
      roundRect(ctx, -0.46, -0.34, 0.92, 0.68, 0.08);
      ctx.fillStyle = "rgba(255,226,226,0.95)";
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#3a0c0c";
      ctx.font = `400 0.42px ${SERIF}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("M1", 0, 0.03);
      ctx.restore();
    }
  }

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
    hole = lerp(0.42, 0.1, easeOut(spot / 0.4));
  }
  const vig = ctx.createRadialGradient(cx, cy, Math.min(W, H) * hole, cx, cy, Math.max(W, H) * 0.8);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, `rgba(0,0,0,${spot !== undefined ? 0.92 : 0.72})`);
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
  const danger = mateAge !== undefined ? Math.min(1, mateAge / 0.3) * Math.max(0.12, 0.34 - 0.1 * mateAge) * (1 + 0.2 * Math.sin(mateAge * 9)) : frame.badge && (frame.badge.kind === "blunder" || frame.badge.kind === "miss") ? 0.3 * Math.exp(-frame.badge.age * 3.5) : 0;
  if (danger > 0.01) {
    ctx.fillStyle = `rgba(150,0,0,${danger})`;
    ctx.fillRect(0, 0, W, H);
  }

  // ---- text: almost none. A quiet headline on top, a plain caption at the bottom.
  const card = frame.card;
  const quiet = card.kind === "none" ? 1 : 1 - card.alpha;
  ctx.save();
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 18 * u;
  if (!frame.lesson && frame.title.text.trim() && quiet > 0.01) {
    ctx.globalAlpha = frame.title.alpha * quiet * easeOut(frame.title.age / 0.4);
    const fit = fitText(ctx, tokens(frame.title.text), L.textMax, 2, 78 * u * st.textScale, (sz) => `400 ${sz}px ${SERIF}`);
    ctx.font = `400 ${fit.size}px ${SERIF}`;
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "alphabetic";
    fit.lines.forEach((line, i) => ctx.fillText(line.map((tk) => tk.word).join(" "), W / 2, L.titleTop - 10 * u + i * fit.size * 1.05));
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

  // ---- branding stays small and quiet: the name at the bottom, the address under it
  if (v.brand && !(card.kind === "outro" && card.alpha > 0.5)) {
    const size = 30 * u;
    const y = H - (L.portrait ? 250 * u : 54 * u);
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
 * The last picture: black, a knight that sweeps through the frame with a long
 * white smear behind it, then name, message and address.
 */
function drawOutro(ctx: CanvasRenderingContext2D, frame: Frame, assets: Assets, L: ReturnType<typeof layout>, W: number, H: number, textScale: number): void {
  const { u } = L;
  const a = frame.card.alpha;
  const age = frame.card.age;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);

  // The sweep: from the lower left to the upper right, fast first, then it hangs there.
  const k = easeOut(age / 1.3);
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
  const show = clamp01((age - 0.45) / 0.5);
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
