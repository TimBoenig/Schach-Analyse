// Post effects of an impact, painted on the finished picture of any look: the
// whip's motion blur, the RGB split (chromatic aberration), the inverted flash
// and the stamped word. What is on and how strong is decided by the timeline
// (Frame.impact); this file only draws it, so preview and export match.
import type { Frame, Impact } from "./timeline";
import { STAMP_T } from "./timeline";

const SANS = '"Geist", -apple-system, "Segoe UI", sans-serif';

const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
/** Overshoots a little, then settles: the stamp slams onto the picture. */
const backOut = (k: number) => {
  const x = clamp01(k) - 1;
  return 1 + 2.7 * x * x * x + 1.7 * x * x;
};

/** Deterministic 0..1 so a glitch band sits in the same place in preview and export. */
const rnd = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

let scratch: HTMLCanvasElement[] = [];
/** A canvas of the picture's size to work on; kept between frames. */
function work(i: number, w: number, h: number): CanvasRenderingContext2D {
  let cv = scratch[i];
  if (!cv) cv = scratch[i] = document.createElement("canvas");
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  const c = cv.getContext("2d")!;
  c.globalCompositeOperation = "source-over";
  c.globalAlpha = 1;
  c.clearRect(0, 0, w, h);
  return c;
}

/** Streaks the picture along (dx, dy): the average of several shifted copies. */
function blurPicture(ctx: CanvasRenderingContext2D, blur: NonNullable<Impact["blur"]>): void {
  const { width: W, height: H } = ctx.canvas;
  const snap = work(0, W, H);
  snap.drawImage(ctx.canvas, 0, 0);
  const reach = 0.05 * W * blur.amount;
  const taps = 15;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  for (let i = 0; i < taps; i++) {
    const o = (i / (taps - 1) - 0.5) * reach;
    // Alpha 1/(i+1) turns the stack of copies into their plain average.
    ctx.globalAlpha = 1 / (i + 1);
    ctx.drawImage(snap.canvas, o * blur.dx, o * blur.dy);
  }
  ctx.restore();
}

/** Red a little larger, blue a little smaller than green: colour fringes that grow towards the edges, plus a few torn bands. */
function splitPicture(ctx: CanvasRenderingContext2D, strength: number, age: number): void {
  const { width: W, height: H } = ctx.canvas;
  const snap = work(0, W, H);
  snap.drawImage(ctx.canvas, 0, 0);
  const channel = (slot: number, colour: string, grow: number) => {
    const c = work(slot, W, H);
    c.drawImage(snap.canvas, 0, 0);
    c.globalCompositeOperation = "multiply";
    c.fillStyle = colour;
    c.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const s = 1 + grow * strength;
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.drawImage(c.canvas, -W / 2, -H / 2);
    ctx.restore();
  };
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  channel(1, "#ff0000", 0.022);
  channel(2, "#00ff00", 0);
  channel(3, "#0000ff", -0.022);
  // Torn bands: a few strips of the original slide sideways, a new set every 1/30 s.
  const step = Math.floor(age * 30);
  for (let i = 0; i < 3; i++) {
    const y = rnd(step * 7 + i) * H * 0.9;
    const h = (0.02 + rnd(step * 3 + i) * 0.05) * H;
    const shift = (rnd(step * 11 + i) - 0.5) * 0.12 * W * strength;
    ctx.drawImage(snap.canvas, 0, y, W, h, shift, y, W, h);
  }
}

/** The word, huge, slammed in the middle of the picture, with colour fringes and a glow in its colour. */
function drawStamp(ctx: CanvasRenderingContext2D, stamp: NonNullable<Impact["stamp"]>): void {
  const { width: W, height: H } = ctx.canvas;
  const u = Math.min(W, H) / 1080;
  const text = stamp.text.toUpperCase();
  const k = backOut(stamp.age / 0.09);
  const out = clamp01((STAMP_T - stamp.age) / 0.08);
  if (k <= 0 || out <= 0) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // As big as the picture is wide, but never taller than 40 % of it.
  let size = 330 * u;
  ctx.font = `900 ${size}px ${SANS}`;
  const wide = ctx.measureText(text).width;
  size *= Math.min(1, (W * 0.88) / Math.max(1, wide));
  ctx.font = `900 ${size}px ${SANS}`;
  const grow = 1 + 0.1 * (stamp.age / STAMP_T);
  ctx.translate(W / 2, H * 0.4);
  ctx.rotate((-5 * Math.PI) / 180);
  ctx.scale(k * grow, k * grow);
  ctx.globalAlpha = out;
  ctx.lineJoin = "round";
  // The fringes: the same word in cyan and red, a little apart, only while it lands.
  const split = (1 - clamp01(stamp.age / 0.18)) * 14 * u;
  if (split > 0.5) {
    ctx.fillStyle = "#19e0e0";
    ctx.fillText(text, -split, 0);
    ctx.fillStyle = "#ff2a2a";
    ctx.fillText(text, split, 0);
  }
  ctx.shadowColor = stamp.colour;
  ctx.shadowBlur = 50 * u;
  ctx.lineWidth = size * 0.07;
  ctx.strokeStyle = "#000000";
  ctx.strokeText(text, 0, 0);
  ctx.shadowBlur = 0;
  ctx.fillStyle = stamp.colour;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** Paints the impact's effects over the finished picture; does nothing when none is on. */
export function paintImpact(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const im = frame.impact;
  const { width: W, height: H } = ctx.canvas;
  if (im.blur && im.blur.amount > 0.02) blurPicture(ctx, im.blur);
  if (im.glitch > 0.02) splitPicture(ctx, im.glitch, im.age);
  if (im.invert > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = "difference";
    ctx.globalAlpha = im.invert;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  if (im.stamp) drawStamp(ctx, im.stamp);
}
