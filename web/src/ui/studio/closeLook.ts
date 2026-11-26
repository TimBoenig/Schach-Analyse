// The "close" variant of the reel look, modelled on a reference edit: a white and black board cropped so tight
// that only about four squares are in the picture, soft tinted squares in the colour of the move's rating,
// a hand that drags the piece, wireframe flashes on the beat, and glass that cracks at the big hits.
//
// This file only holds the drawing helpers and the palette; reel.ts decides when they are used, so the picture
// still depends only on the frame (preview and export are identical). Everything random is seeded.
import type { Badge } from "./model";

/** Board colours of the variant: the whitest white and a black that lets the tinted squares glow. */
export const CLOSE_BOARD = { light: "#f3f3f1", dark: "#070707" } as const;

/** Tint under the badge's square, like the rating colours of the reference: tan book, lime best, purple blunder. */
export const CLOSE_BADGE: Record<Exclude<Badge, "">, string> = {
  book: "#d8a46a",
  brilliant: "#19e0d2",
  great: "#8cc8ff",
  best: "#a6e01c",
  excellent: "#a6e01c",
  good: "#a6e01c",
  inaccuracy: "#f2c230",
  mistake: "#ffa21f",
  miss: "#ff8a3d",
  blunder: "#a419ff",
};
/** The squares of an ordinary last move (no rating): a warm sand tint. */
export const CLOSE_SAND = "#d9b87a";
/** Threatened squares: solid, saturated red. */
export const CLOSE_RED = "#e8141c";

const clamp01 = (k: number) => Math.max(0, Math.min(1, k));

/** Deterministic 0..1. */
export const rnd = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/** The hand's parts when it points (grip 0) and when it holds a piece in its fist (grip 1): x, top and size of each finger, in hand units. */
const FINGERS = [
  { open: [-0.07, 0, 0.14, 0.52], fist: [-0.19, 0.12, 0.125, 0.3] },
  { open: [0.065, 0.2, 0.125, 0.4], fist: [-0.065, 0.09, 0.125, 0.3] },
  { open: [0.185, 0.24, 0.115, 0.36], fist: [0.06, 0.11, 0.125, 0.3] },
  { open: [0.295, 0.29, 0.1, 0.31], fist: [0.185, 0.16, 0.115, 0.26] },
] as const;
const PALM = { open: [-0.13, 0.36, 0.53, 0.42], fist: [-0.2, 0.28, 0.5, 0.45] } as const;
const THUMB = { open: [-0.17, 0.47, 0.22, 0.115, -0.55], fist: [-0.04, 0.43, 0.34, 0.125, -0.08] } as const;

const mix = (a: readonly number[], b: readonly number[], k: number) => a.map((v, i) => v + (b[i] - v) * k);

/**
 * The pointer hand, drawn in board units: an open pointing hand that closes into a fist as it grabs the piece.
 * White glove with a thin dark outline (the outline is drawn first under all parts, so the parts merge into one silhouette),
 * a soft shadow so it reads on white and black squares, and the knuckle lines of the fist fading in with the grip.
 * (x, z) is the tip of the index finger; `size` 1 is a hand about three quarters of a square tall.
 */
export function drawHand(ctx: CanvasRenderingContext2D, S: number, x: number, z: number, size: number, angle: number, alpha: number, grip: number): void {
  if (alpha <= 0.01) return;
  const g = clamp01(grip);
  ctx.save();
  ctx.globalAlpha *= clamp01(alpha);
  ctx.translate(x, z);
  ctx.rotate(angle);
  ctx.scale(size, size);
  // The closed hand sits a little higher and to the left of the index fingertip: its middle is what holds the piece.
  ctx.translate(-0.07 * g, -0.12 * g);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const parts: (() => void)[] = [];
  FINGERS.forEach((f) => {
    const [fx, ft, fw, fh] = mix(f.open, f.fist, g);
    parts.push(() => ctx.roundRect(fx, ft, fw, fh, fw / 2));
  });
  const [px, py, pw, ph] = mix(PALM.open, PALM.fist, g);
  parts.push(() => ctx.roundRect(px, py, pw, ph, [0.03, 0.03, 0.17, 0.15]));
  const [tx, tz, tw, th, ta] = mix(THUMB.open, THUMB.fist, g);
  parts.push(() => {
    ctx.save();
    ctx.translate(tx, tz);
    ctx.rotate(ta);
    ctx.roundRect(-tw / 2, -th / 2, tw, th, th / 2);
    ctx.restore();
  });
  const trace = () => {
    ctx.beginPath();
    parts.forEach((p) => p());
  };
  // Shadow: the whole silhouette once, blurred, to the lower right.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 0.09 * S * size;
  ctx.shadowOffsetX = 0.025 * S * size;
  ctx.shadowOffsetY = 0.05 * S * size;
  ctx.fillStyle = "#101010";
  trace();
  ctx.fill();
  ctx.restore();
  // Outline under, glove on top.
  ctx.strokeStyle = "#141414";
  ctx.lineWidth = 0.075;
  trace();
  ctx.stroke();
  ctx.fillStyle = "#fbfbfb";
  trace();
  ctx.fill();
  // Shading: the lower part of the glove a touch grey, so it has a body.
  const body = ctx.createLinearGradient(0, py, 0, py + ph);
  body.addColorStop(0, "rgba(120,120,130,0)");
  body.addColorStop(1, "rgba(120,120,130,0.28)");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, [0.03, 0.03, 0.17, 0.15]);
  ctx.fill();
  // Knuckle lines between the curled fingers, and the thumb's edge over them.
  if (g > 0.05) {
    ctx.strokeStyle = `rgba(20,20,20,${0.9 * g})`;
    ctx.lineWidth = 0.022;
    for (let i = 0; i < FINGERS.length - 1; i++) {
      const [fx, ft, fw, fh] = mix(FINGERS[i + 1].open, FINGERS[i + 1].fist, g);
      void fw;
      ctx.beginPath();
      ctx.moveTo(fx, ft + 0.06);
      ctx.lineTo(fx, ft + fh * 0.78);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.save();
    ctx.translate(tx, tz);
    ctx.rotate(ta);
    ctx.roundRect(-tw / 2, -th / 2, tw, th, th / 2);
    ctx.restore();
    ctx.fillStyle = "#fbfbfb";
    ctx.fill();
    ctx.lineWidth = 0.03;
    ctx.stroke();
  }
  ctx.restore();
}

let scratch: HTMLCanvasElement | null = null;
let scratch2: HTMLCanvasElement | null = null;
function work(which: 0 | 1, w: number, h: number): CanvasRenderingContext2D {
  let cv = which ? scratch2 : scratch;
  if (!cv) {
    cv = document.createElement("canvas");
    if (which) scratch2 = cv;
    else scratch = cv;
  }
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  const c = cv.getContext("2d")!;
  c.globalCompositeOperation = "source-over";
  c.globalAlpha = 1;
  c.filter = "none";
  c.clearRect(0, 0, w, h);
  return c;
}

/**
 * The wireframe flash: the finished picture turned into its edges in one colour on black (grid lines and outlined pieces),
 * with a soft bloom. `k` 0..1 is how much of the real picture is replaced.
 */
export function wireFlash(ctx: CanvasRenderingContext2D, colour: string, k: number): void {
  if (k <= 0.02) return;
  const { width: W, height: H } = ctx.canvas;
  const a = work(0, W, H);
  a.drawImage(ctx.canvas, 0, 0);
  // Edges = the picture minus itself shifted a hair: "difference" leaves only where the brightness changes.
  const d = Math.max(2, Math.round(Math.min(W, H) / 360));
  const edges = work(1, W, H);
  edges.drawImage(a.canvas, 0, 0);
  edges.globalCompositeOperation = "difference";
  edges.drawImage(a.canvas, d, d);
  // One colour: lift the weak edges, then tint.
  edges.globalCompositeOperation = "lighter";
  edges.drawImage(edges.canvas, 0, 0);
  edges.drawImage(edges.canvas, 0, 0);
  edges.globalCompositeOperation = "multiply";
  edges.fillStyle = colour;
  edges.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = clamp01(k);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(edges.canvas, 0, 0);
  // The bloom: the same lines, blurred, added once more.
  ctx.filter = `blur(${Math.max(2, Math.round(Math.min(W, H) / 120))}px)`;
  ctx.globalAlpha = clamp01(k) * 0.8;
  ctx.drawImage(edges.canvas, 0, 0);
  ctx.restore();
}

/** Where the cracks of one hit run: seeded, so the same hit always breaks the same way. */
function crackSegments(seed: number): { pts: [number, number][]; w: number }[] {
  const out: { pts: [number, number][]; w: number }[] = [];
  const arms = 11;
  for (let i = 0; i < arms; i++) {
    const ang = (i / arms) * Math.PI * 2 + rnd(seed + i) * 0.5;
    const pts: [number, number][] = [[0, 0]];
    let r = 0;
    let a = ang;
    const steps = 4 + Math.floor(rnd(seed + i * 3) * 4);
    for (let s = 0; s < steps; s++) {
      r += 0.12 + rnd(seed + i * 7 + s) * 0.22;
      a += (rnd(seed + i * 5 + s * 2) - 0.5) * 0.55;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    out.push({ pts, w: 1 - (i % 3) * 0.25 });
  }
  return out;
}

/**
 * Glass: cracks that run out from the point of impact and loose shards that tumble away and fall, plus a bright flash of splinters at the start.
 * `age` is seconds since the hit; `strength` 0..1. Drawn in screen space (cx, cy in pixels).
 */
export function drawGlass(ctx: CanvasRenderingContext2D, cx: number, cy: number, age: number, strength: number, seed: number): void {
  if (age < 0 || strength <= 0.02) return;
  const { width: W, height: H } = ctx.canvas;
  const m = Math.min(W, H);
  const life = 1.9;
  if (age > life) return;
  const fade = clamp01((life - age) / 0.6) * clamp01(strength);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Cracks: grow outwards in the first 0.12 s, then hang there.
  const grow = clamp01(age / 0.12);
  for (const c of crackSegments(seed)) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const n = Math.max(1, Math.round((c.pts.length - 1) * grow));
    for (let i = 1; i <= n; i++) ctx.lineTo(cx + c.pts[i][0] * m, cy + c.pts[i][1] * m);
    ctx.strokeStyle = `rgba(255,255,255,${0.75 * fade})`;
    ctx.lineWidth = Math.max(1, m * 0.003 * c.w);
    ctx.shadowColor = "rgba(255,255,255,0.8)";
    ctx.shadowBlur = m * 0.01;
    ctx.stroke();
  }
  // Shards: thin triangles that fly outwards, spin and drop.
  ctx.shadowBlur = 0;
  const shards = 26;
  for (let i = 0; i < shards; i++) {
    const ang = rnd(seed * 3 + i) * Math.PI * 2;
    const speed = 0.25 + rnd(seed * 5 + i) * 0.75;
    const t = Math.max(0, age - rnd(seed * 7 + i) * 0.08);
    const r = (1 - Math.exp(-t * 3.2)) * speed * m * 0.75;
    const x = cx + Math.cos(ang) * r;
    const y = cy + Math.sin(ang) * r + 0.18 * m * t * t;
    const sz = m * (0.02 + rnd(seed * 11 + i) * 0.05);
    const spin = ang + t * (rnd(seed * 13 + i) - 0.5) * 9;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin);
    ctx.beginPath();
    ctx.moveTo(-sz, sz * 0.3);
    ctx.lineTo(sz * 1.3, 0);
    ctx.lineTo(-sz * 0.2, -sz * 0.5);
    ctx.closePath();
    ctx.fillStyle = `rgba(210,225,240,${0.28 * fade})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${0.8 * fade})`;
    ctx.lineWidth = Math.max(1, m * 0.002);
    ctx.stroke();
    ctx.restore();
  }
  // The burst of light at the point of impact.
  const burst = Math.exp(-age * 9);
  if (burst > 0.02) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, m * 0.28);
    g.addColorStop(0, `rgba(255,255,255,${0.85 * burst})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

/** Slow specks of dust in the air, the grain of the reference's black. Drifting upwards, a few brighter than the rest. */
export function drawDust(ctx: CanvasRenderingContext2D, time: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const { width: W, height: H } = ctx.canvas;
  const m = Math.min(W, H);
  ctx.save();
  for (let i = 0; i < 28; i++) {
    const sp = 0.012 + rnd(i * 2.3) * 0.03;
    const y = (((rnd(i * 5.1) - time * sp) % 1) + 1) % 1;
    const x = rnd(i * 9.7) + Math.sin(time * 0.4 + i) * 0.01;
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(time * (0.8 + rnd(i) * 1.5) + i));
    ctx.fillStyle = `rgba(255,255,255,${alpha * tw * (0.18 + rnd(i * 3.3) * 0.35)})`;
    ctx.beginPath();
    ctx.arc(x * W, y * H, m * (0.0013 + rnd(i * 1.9) * 0.0028), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

const greyed = new Map<HTMLImageElement, HTMLCanvasElement>();
/**
 * The black pieces of the close variant, lifted to a dark grey (the black squares are nearly pure black, a black piece would vanish on them).
 * The detail lines of the drawing stay lighter than the body. Made once per piece picture.
 */
export function greyPiece(img: HTMLImageElement): HTMLCanvasElement | HTMLImageElement {
  const hit = greyed.get(img);
  if (hit) return hit;
  const size = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const c = cv.getContext("2d")!;
  c.drawImage(img, 0, 0, size, size);
  c.globalCompositeOperation = "source-atop";
  c.fillStyle = "rgba(140,140,140,0.62)";
  c.fillRect(0, 0, size, size);
  greyed.set(img, cv);
  return cv;
}
