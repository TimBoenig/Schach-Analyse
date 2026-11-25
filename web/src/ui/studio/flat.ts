// The flat 2D board: the same frame as the 3D renderer (pieces mid-flight,
// arrows, marks, effects), drawn from straight above like a diagram in a chess
// book. Beginners and small phone screens read it best, so it is the default
// for long YouTube lessons. It hands compose() a picture and a matrix just like
// the 3D renderer, so every overlay (badges, poll letters, spotlight) still
// lands on the right square.
import type { PieceSymbol } from "chess.js";

import { softBlob } from "./shadow";
import { layout } from "./compose";
import { screenToBoard, toScreen, type Mat4 } from "./math3d";
import { toneColor, type StudioStyle } from "./model";
import { arrowMesh } from "./renderer";
import { squareXZ, xzSquare, type Frame } from "./timeline";

/** Width of the frame around the squares, in squares. Coordinates sit on it. */
export const FRAME = 0.42;

export interface Slot {
  cx: number;
  cy: number;
  size: number;
}

/**
 * Where the flat board sits in the video: between headline and subtitles in a
 * tall or square video, in the left part of a lesson. Sizes include the frame.
 */
export function boardSlot(W: number, H: number, lesson: boolean): Slot {
  const L = layout(W, H);
  const u = L.u;
  if (lesson) {
    const size = Math.min(H - 110 * u, W * 0.6 - 120 * u);
    return { cx: W * 0.3, cy: H / 2 + 14 * u, size };
  }
  if (L.portrait) {
    // Under the move pill and its words, above a three-line subtitle box.
    const top = L.pillY + 118 * u;
    const bottom = L.subCenter - 128 * u;
    return { cx: W / 2, cy: (top + bottom) / 2, size: Math.min(W - 60 * u, bottom - top) };
  }
  const top = L.pillY + 84 * u;
  const bottom = L.subCenter - 92 * u;
  return { cx: W / 2, cy: (top + bottom) / 2, size: Math.min(W - 60 * u, bottom - top) };
}

/** Board seen from Black when the camera looks from rank 8 (perspective black, or "Von gegenüber"). */
const flipped = (yaw: number) => Math.cos((yaw * Math.PI) / 180) < 0;

/**
 * The 2D camera: square size and where the board's centre lands. The flat
 * board always shows all 64 squares: the 3D camera's leaning in, zooms and
 * turns would only cut pieces off at the edge. What stays is the side it is
 * seen from and the opening move, where the board grows into place.
 */
export function flatView(frame: Frame, slot: Slot): { S: number; cx: number; cy: number; dir: 1 | -1 } {
  const cam = frame.camera;
  const dir = flipped(cam.yaw) ? -1 : 1;
  const zoom = Math.max(1, Math.min(3, cam.zoom));
  return { S: slot.size / (8 + 2 * FRAME) / zoom, cx: slot.cx, cy: slot.cy, dir };
}

/** A matrix toScreen() and screenToBoard() understand: board x/z to the picture, height y lifts a point up. */
export function flatMatrix(W: number, H: number, v: { S: number; cx: number; cy: number; dir: number }): Mat4 {
  const m = new Float32Array(16);
  m[0] = (2 * v.dir * v.S) / W;
  m[12] = (2 * v.cx) / W - 1;
  m[5] = v.S / H;
  m[9] = (-2 * v.dir * v.S) / H;
  m[13] = 1 - (2 * v.cy) / H;
  // Height also goes to depth, so the matrix can be inverted for clicks.
  m[6] = 1;
  m[15] = 1;
  return m;
}

const NAMES: Record<PieceSymbol, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
export const pieceKey = (color: "w" | "b", type: PieceSymbol) => `${color === "w" ? "white" : "black"}-${NAMES[type]}`;

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export class FlatBoard {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  viewProj: Mat4 = new Float32Array(16);

  constructor() {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d")!;
  }

  resize(w: number, h: number): void {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  squareAt(sx: number, sy: number): string | null {
    const hit = screenToBoard(this.viewProj, sx, sy);
    return hit ? xzSquare(hit.x, hit.z) : null;
  }

  render(frame: Frame, style: StudioStyle, pieces: Record<string, HTMLImageElement>): void {
    const ctx = this.ctx;
    const { width: W, height: H } = this.canvas;
    ctx.clearRect(0, 0, W, H);
    const slot = boardSlot(W, H, frame.lesson);
    const view = flatView(frame, slot);
    this.viewProj = flatMatrix(W, H, view);
    const { S, dir } = view;
    const u = Math.min(W, H) / 1080;
    // Centre of a board point (x, z) on the picture.
    const at = (x: number, z: number): [number, number] => [view.cx + dir * x * S, view.cy + dir * z * S];
    const sqCentre = (sq: string) => {
      const [x, z] = squareXZ(sq);
      return at(x, z);
    };
    const fillSquare = (sq: string, colour: string) => {
      const [x, y] = sqCentre(sq);
      ctx.fillStyle = colour;
      ctx.fillRect(x - S / 2, y - S / 2, S, S);
    };

    // ---- frame and squares
    const half = 4 * S;
    const fr = FRAME * S;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 50 * u;
    ctx.shadowOffsetY = 16 * u;
    roundRect(ctx, view.cx - half - fr, view.cy - half - fr, 2 * (half + fr), 2 * (half + fr), fr * 0.7);
    ctx.fillStyle = style.frame;
    ctx.fill();
    ctx.restore();
    for (let f = 0; f < 8; f++) {
      for (let r = 0; r < 8; r++) fillSquare(`${String.fromCharCode(97 + f)}${r + 1}`, (f + r) % 2 === 0 ? style.dark : style.light);
    }
    if (style.coords) {
      // On the frame, upright and readable: letters under the board, numbers to the left.
      ctx.font = `700 ${Math.max(14 * u, fr * 0.62)}px "Geist", -apple-system, "Segoe UI", sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let i = 0; i < 8; i++) {
        const [fx] = at(i - 3.5, 0);
        ctx.fillText("abcdefgh"[i], fx, view.cy + half + fr / 2);
        const [, ry] = at(0, 3.5 - i);
        ctx.fillText(String(i + 1), view.cx - half - fr / 2, ry);
      }
    }

    // ---- square highlights
    if (frame.lastMove && frame.lastMove.alpha > 0) {
      for (const sq of [frame.lastMove.from, frame.lastMove.to]) fillSquare(sq, rgba(style.accent, 0.42 * frame.lastMove.alpha));
    }
    for (const m of frame.marks) {
      const c = toneColor(m.tone, style);
      fillSquare(m.square, rgba(c, 0.5 * m.alpha));
      const [x, y] = sqCentre(m.square);
      ctx.strokeStyle = rgba(c, 0.95 * m.alpha);
      ctx.lineWidth = S * 0.07;
      ctx.strokeRect(x - S / 2 + S * 0.035, y - S / 2 + S * 0.035, S * 0.93, S * 0.93);
    }
    for (const h of frame.hints) {
      const [x, y] = sqCentre(h.square);
      const g = ctx.createRadialGradient(x, y, 0, x, y, S * 0.9);
      g.addColorStop(0, rgba(style.accent, 0.55 * h.alpha));
      g.addColorStop(1, rgba(style.accent, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - S, y - S, 2 * S, 2 * S);
    }
    const ring = (sq: string, radius: number, colour: string, alpha: number, width: number) => {
      if (alpha <= 0) return;
      const [x, y] = sqCentre(sq);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(colour, alpha);
      ctx.lineWidth = width;
      ctx.stroke();
    };
    const red = toneColor("bad", style);
    const threatAge = frame.fx.find((f) => f.kind === "threat")?.age;
    if (threatAge !== undefined) {
      const fadeIn = Math.min(1, threatAge / 0.3);
      for (const sq of frame.threats) {
        fillSquare(sq, rgba(red, (0.35 + 0.25 * Math.sin(threatAge * 7)) * fadeIn));
        for (const off of [0, 0.5]) {
          const k = (threatAge * 1.1 + off) % 1;
          ring(sq, S * (0.35 + k * 0.6), red, 0.85 * (1 - k) * fadeIn, S * 0.08);
        }
      }
    }
    const mateAge = frame.fx.find((f) => f.kind === "mate")?.age;
    if (mateAge !== undefined && frame.mate) {
      fillSquare(frame.mate.king, rgba(red, 0.85 * Math.min(1, mateAge / 0.2)));
      for (const delay of [0.3, 0.55]) {
        const k = (mateAge - delay) / 1.1;
        if (k > 0 && k < 1) ring(frame.mate.king, S * (0.6 + k * 5), red, 0.9 * (1 - k), S * 0.14);
      }
    }
    if (frame.landing) ring(frame.landing.square, S * (0.45 + frame.landing.k * 0.4), style.accent, 0.9 * (1 - frame.landing.k), S * 0.09);

    // ---- pieces: standing ones first, a piece in the air on top with its shadow
    const ordered = [...frame.pieces].filter((p) => p.alpha > 0.01).sort((a, b) => a.y - b.y || b.alpha - a.alpha);
    for (const p of ordered) {
      const img = pieces[pieceKey(p.color, p.type)];
      if (!img) continue;
      const [x, y] = at(p.x, p.z);
      // The falling king is lifted in 3D only so its base does not sink into the board.
      const lift = p.tilt ? 0 : Math.max(0, p.y);
      const size = S * p.scale * (1 + 0.14 * lift);
      if (lift > 0.02) {
        // The hop's shadow stays on the ground and shrinks as the piece rises.
        ctx.save();
        ctx.globalAlpha = p.alpha;
        softBlob(ctx, x, y + S * 0.3, S * 0.5 * (1 - 0.25 * lift), S * 0.2 * (1 - 0.25 * lift), 0.55);
        ctx.restore();
      }
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(x, y - lift * S * 0.22);
      if (p.tilt) {
        // The mated king falls over, away from the piece that gives mate.
        const side = Math.sin(p.tiltYaw ?? 0) * dir;
        ctx.translate(0, size * 0.42);
        ctx.rotate((side >= 0 ? 1 : -1) * p.tilt);
        ctx.translate(0, -size * 0.42);
      }
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
      ctx.restore();
    }

    // ---- arrows on top of the pieces, like on lichess: easy to see where a piece goes
    frame.arrows.forEach((a) => {
      if (a.progress <= 0 || a.alpha <= 0) return;
      const tri = arrowMesh(a.from, a.to, a.progress, 1.9, 0);
      ctx.beginPath();
      for (let i = 0; i + 14 < tri.length; i += 15) {
        const p1 = at(tri[i], tri[i + 2]);
        let p2 = at(tri[i + 5], tri[i + 7]);
        let p3 = at(tri[i + 10], tri[i + 12]);
        // Same winding for every triangle, so the overlaps add up instead of cancelling out.
        if ((p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]) < 0) [p2, p3] = [p3, p2];
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.lineTo(p3[0], p3[1]);
        ctx.closePath();
      }
      ctx.fillStyle = rgba(a.colour ?? toneColor(a.tone, style), 0.82 * a.alpha);
      ctx.fill("nonzero");
    });
  }
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

/**
 * "3D board, 2D pieces": the site's flat pieces stand on the 3D board like
 * cardboard standees and always face the camera, so they read like a diagram
 * while the board still turns and zooms. Sized by the camera's sideways
 * direction, so a piece keeps its size even when the camera looks from straight above.
 */
/** Where the piece pictures (45 × 45, Cburnett) have their middle and their foot, as a share of the height. */
export const STANDEE_MIDDLE = 0.54;
export const STANDEE_FOOT = 0.88;

export function drawStandees(ctx: CanvasRenderingContext2D, frame: Frame, viewProj: Mat4, pieces: Record<string, HTMLImageElement>): void {
  const { width: W, height: H } = ctx.canvas;
  const yaw = (frame.camera.yaw * Math.PI) / 180;
  const right: [number, number] = [Math.cos(yaw), -Math.sin(yaw)];
  // Distance along the view (clip w): far pieces first, so near ones overlap them.
  const depth = (p: Frame["pieces"][number]) => viewProj[3] * p.x + viewProj[7] * p.y + viewProj[11] * p.z + viewProj[15];
  const list = frame.pieces.filter((p) => p.alpha > 0.01).sort((a, b) => depth(b) - depth(a));
  for (const p of list) {
    const img = pieces[pieceKey(p.color, p.type)];
    if (!img) continue;
    const base = toScreen(viewProj, [p.x, Math.max(0, p.y), p.z]);
    const side = toScreen(viewProj, [p.x + right[0] * 0.5, Math.max(0, p.y), p.z + right[1] * 0.5]);
    if (!base || !side) continue;
    const bx = base.x * W;
    const by = base.y * H;
    // How flat the view is: 0 from straight above, near 1 from low down.
    const flat = Math.cos((Math.max(5, Math.min(89, frame.camera.pitch)) * Math.PI) / 180);
    const square = Math.hypot(side.x * W - bx, side.y * H - by) * 2;
    // From above a piece fits inside its square; from low down it may stand a little taller, like a real one.
    const size = square * (0.9 + 0.14 * flat) * p.scale;
    ctx.save();
    ctx.globalAlpha = p.alpha;
    // Which point of the picture sits on the square's centre: the middle of the piece when the camera looks
    // from above (so it covers its own square, not the one behind), sliding to its foot (88 % down the
    // picture) as the camera gets lower, so it still stands on the square instead of floating.
    const anchor = STANDEE_MIDDLE + (STANDEE_FOOT - STANDEE_MIDDLE) * flat;
    ctx.translate(bx, by + size * (1 - anchor));
    if (p.tilt) {
      const sx = Math.sin((p.tiltYaw ?? 0) - yaw);
      ctx.rotate((sx >= 0 ? 1 : -1) * p.tilt);
    }
    // The contact shadow on the board comes from the GL pass; a blurred copy of the picture here only costs time.
    ctx.drawImage(img, -size / 2, -size, size, size);
    ctx.restore();
  }
}
