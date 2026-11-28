// The three newer pictures of the reel (edit) look: cinema, neon and comic. Each is a whole style, not a colour swap: its own board,
// its own way of drawing a piece in the air, its own light over the finished picture and its own lettering. The camera grammar that
// belongs to each lives in reelRig.ts (cinema glides slowly, neon and comic cut hard).
//
// Board drawing happens in board units (one square = 1) inside paintReel's transformed layer; overlays and lettering in pixels.
import { fitText, tokens } from "./draw2d";
import type { Badge, ReelLook } from "./model";
import type { Frame } from "./timeline";

const SANS = '"Geist", -apple-system, "Segoe UI", sans-serif';
const SERIF = '"Instrument Serif", Georgia, serif';
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
const easeOut = (k: number) => 1 - Math.pow(1 - clamp01(k), 3);
const backOut = (k: number) => {
  const c = 1.9;
  const x = clamp01(k) - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
};
const rnd = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export type StyledLook = Extract<ReelLook, "cinema" | "neon" | "comic">;
export const isStyled = (look: ReelLook): look is StyledLook => look === "cinema" || look === "neon" || look === "comic";

/** Square colours of each look. */
export const STYLE_BOARD: Record<StyledLook, { light: string; dark: string; onDark: string; onLight: string }> = {
  // Warm graded wood tones: the grade over the picture pushes the shadows to teal.
  cinema: { light: "#d8c19c", dark: "#6e5340", onDark: "rgba(255,240,215,0.7)", onLight: "rgba(60,40,28,0.8)" },
  // A night board: two near-blacks, the grid lines carry the light.
  neon: { light: "#151830", dark: "#07070f", onDark: "rgba(90,240,255,0.75)", onLight: "rgba(255,80,220,0.75)" },
  // Paper and a printed blue.
  comic: { light: "#f7edd3", dark: "#4f78c4", onDark: "rgba(255,255,255,0.9)", onLight: "rgba(20,20,20,0.85)" },
};

/** The neon colours: White's pieces glow cyan, Black's magenta. */
export const NEON = { w: "#38f3ff", b: "#ff3fd8", grid: "#38f3ff" } as const;
/** How far a piece in the air grows towards the camera. */
export const LIFT: Record<StyledLook, number> = { cinema: 0.25, neon: 0.4, comic: 0.55 };
/** The darkness at the picture's edges. */
export const STYLE_VIGNETTE: Record<StyledLook, number> = { cinema: 0.85, neon: 0.6, comic: 0.18 };

/** Board-unit extras over the squares: the neon grid, the comic print, the cinema frame. `pulse` 0..1 flashes the neon grid on a landing. */
export function drawBoardExtras(ctx: CanvasRenderingContext2D, look: StyledLook, S: number, pulse: number): void {
  ctx.save();
  if (look === "neon") {
    ctx.strokeStyle = NEON.grid;
    ctx.shadowColor = NEON.grid;
    ctx.shadowBlur = (0.18 + 0.25 * pulse) * S;
    ctx.globalAlpha = 0.32 + 0.4 * pulse;
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    for (let i = 0; i <= 8; i++) {
      ctx.moveTo(i - 4, -4);
      ctx.lineTo(i - 4, 4);
      ctx.moveTo(-4, i - 4);
      ctx.lineTo(4, i - 4);
    }
    ctx.stroke();
    // The board's edge glows magenta, brighter than the grid.
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = NEON.b;
    ctx.shadowColor = NEON.b;
    ctx.lineWidth = 0.06;
    ctx.strokeRect(-4.03, -4.03, 8.06, 8.06);
  } else if (look === "comic") {
    // Halftone dots on the blue squares, a little bigger towards the lower right like a printed shadow.
    ctx.fillStyle = "rgba(20,30,70,0.22)";
    for (let f = 0; f < 8; f++) {
      for (let r = 0; r < 8; r++) {
        if ((f + r) % 2 !== 0) continue;
        // Same squares as paintReel's dark ones (rank 1 at the bottom); a flipped board keeps the colours, so this holds both ways.
        const x0 = f - 4;
        const z0 = 3 - r;
        for (let i = 0; i < 5; i++) {
          for (let j = 0; j < 5; j++) {
            const rad = 0.03 + 0.035 * ((i + j) / 8);
            ctx.beginPath();
            ctx.arc(x0 + 0.1 + i * 0.2, z0 + 0.1 + j * 0.2, rad, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    // Thick ink round the board.
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 0.12;
    ctx.strokeRect(-4.06, -4.06, 8.12, 8.12);
  } else {
    // Cinema: a dark wooden frame with a thin brass line, so the board reads as an object in a room.
    ctx.strokeStyle = "#2a1d14";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(-4.25, -4.25, 8.5, 8.5);
    ctx.strokeStyle = "rgba(214,170,100,0.55)";
    ctx.lineWidth = 0.03;
    ctx.strokeRect(-4.02, -4.02, 8.04, 8.04);
  }
  ctx.restore();
}

const inked = new Map<CanvasImageSource, HTMLCanvasElement>();
/** A comic piece: the drawing with a thick ink outline round it. Made once per piece picture. */
export function inkedPiece(img: HTMLImageElement | HTMLCanvasElement): HTMLCanvasElement | HTMLImageElement | HTMLCanvasElement {
  const hit = inked.get(img);
  if (hit) return hit;
  if (typeof document === "undefined") return img;
  const size = 256;
  const pad = 14;
  // The silhouette in black, stamped round the piece in a ring, then the piece itself on top.
  const sil = document.createElement("canvas");
  sil.width = sil.height = size;
  const s = sil.getContext("2d")!;
  s.drawImage(img, pad, pad, size - 2 * pad, size - 2 * pad);
  s.globalCompositeOperation = "source-in";
  s.fillStyle = "#111111";
  s.fillRect(0, 0, size, size);
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const c = cv.getContext("2d")!;
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    c.drawImage(sil, Math.cos(ang) * 7, Math.sin(ang) * 7);
  }
  c.drawImage(img, pad, pad, size - 2 * pad, size - 2 * pad);
  inked.set(img, cv);
  return cv;
}

/** Comic speed lines behind a piece in the air, opposite to where it flies (board units). */
export function drawSpeedLines(ctx: CanvasRenderingContext2D, x: number, z: number, fromX: number, fromZ: number, size: number, k: number, seed: number): void {
  const dx = x - fromX;
  const dz = z - fromZ;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return;
  const ux = dx / len;
  const uz = dz / len;
  ctx.save();
  ctx.strokeStyle = "#111111";
  ctx.lineCap = "round";
  ctx.globalAlpha = Math.sin(Math.PI * k);
  for (let i = 0; i < 6; i++) {
    const off = (i - 2.5) * 0.14 * size;
    const back = 0.35 + rnd(seed + i) * 0.6;
    const sx = x - ux * size * 0.45 - uz * off;
    const sz = z - uz * size * 0.45 + ux * off;
    ctx.lineWidth = 0.03 + 0.03 * rnd(seed + i * 3);
    ctx.beginPath();
    ctx.moveTo(sx, sz);
    ctx.lineTo(sx - ux * back * size * 1.6, sz - uz * back * size * 1.6);
    ctx.stroke();
  }
  ctx.restore();
}

/** The neon streak a piece leaves on its way (board units). */
export function drawNeonTrail(ctx: CanvasRenderingContext2D, x: number, z: number, fromX: number, fromZ: number, colour: string, S: number, k: number): void {
  ctx.save();
  const g = ctx.createLinearGradient(fromX, fromZ, x, z);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, colour);
  ctx.strokeStyle = g;
  ctx.shadowColor = colour;
  ctx.shadowBlur = 0.3 * S;
  ctx.lineCap = "round";
  ctx.lineWidth = 0.12 * Math.sin(Math.PI * k) + 0.03;
  ctx.beginPath();
  ctx.moveTo(fromX, fromZ);
  ctx.lineTo(x, z);
  ctx.stroke();
  ctx.restore();
}

/** The picture window of the cinema look: wide-screen bars cut the frame to 2.39:1 (wide), 1.6:1 (square) or 4:5 (phone). */
export function cinemaWindow(W: number, H: number): { top: number; h: number } {
  const ratio = W > H * 1.2 ? 2.39 : W > H * 0.8 ? 1.6 : 0.8;
  const h = Math.min(H, W / ratio);
  return { top: (H - h) / 2, h };
}

let grain: HTMLCanvasElement | null = null;
function grainTile(): HTMLCanvasElement | null {
  if (grain || typeof document === "undefined") return grain;
  grain = document.createElement("canvas");
  grain.width = grain.height = 192;
  const c = grain.getContext("2d")!;
  const img = c.createImageData(192, 192);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(rnd(i * 0.37) * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  return grain;
}

const halftones = new Map<string, HTMLCanvasElement>();
/** Comic: dots in the picture's corners, growing towards the edge, like a print's shading. Made once per picture size. */
function halftoneCorners(W: number, H: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const key = `${W}x${H}`;
  const hit = halftones.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d")!;
  const step = Math.max(10, Math.round(Math.min(W, H) / 70));
  c.fillStyle = "#111111";
  const R = Math.hypot(W, H) / 2;
  for (let y = step / 2; y < H; y += step) {
    for (let x = step / 2; x < W; x += step) {
      const d = Math.hypot(x - W / 2, y - H / 2) / R;
      const k = clamp01((d - 0.62) / 0.38);
      if (k <= 0) continue;
      c.beginPath();
      c.arc(x, y, step * 0.48 * k, 0, Math.PI * 2);
      c.fill();
    }
  }
  halftones.set(key, cv);
  return cv;
}

/** The sign a comic burst shouts for a rating, the mating blow or a check: symbols only, so the edit works in every language. */
export function burstSign(badge: Exclude<Badge, ""> | null, mate: boolean, check: boolean): string | null {
  if (mate) return "#";
  if (badge === "brilliant") return "!!";
  if (badge === "great" || badge === "best") return "!";
  if (badge === "blunder") return "??";
  if (badge === "mistake" || badge === "miss") return "?";
  if (badge === "inaccuracy") return "?!";
  if (check) return "+";
  return null;
}

/** A hit of the moment: where it happened on screen and how long ago. */
export interface Hit {
  x: number;
  y: number;
  age: number;
  sign: string | null;
  colour: string;
}

/** Picture-wide light of a look, painted over the board and under the lettering. */
export function drawStyleLight(ctx: CanvasRenderingContext2D, look: StyledLook, frame: Frame, W: number, H: number, hit: Hit | null): void {
  const m = Math.min(W, H);
  const u = m / 1080;
  ctx.save();
  if (look === "cinema") {
    // The grade: teal shadows, warm highlights.
    ctx.globalCompositeOperation = "overlay";
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "rgba(0,110,130,0.45)");
    g.addColorStop(1, "rgba(255,150,60,0.4)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    // An anamorphic flare through every hit: the long blue streak of a wide-screen lens.
    if (hit && hit.age < 1.1) {
      const k = 1 - hit.age / 1.1;
      const streak = ctx.createLinearGradient(0, 0, W, 0);
      streak.addColorStop(0, "rgba(90,160,255,0)");
      streak.addColorStop(clamp01(hit.x / W), `rgba(170,215,255,${0.85 * k})`);
      streak.addColorStop(1, "rgba(90,160,255,0)");
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = streak;
      const th = (5 + 10 * k) * u;
      ctx.fillRect(0, hit.y - th / 2, W, th);
      const glow = ctx.createRadialGradient(hit.x, hit.y, 0, hit.x, hit.y, 220 * u);
      glow.addColorStop(0, `rgba(255,220,170,${0.6 * k})`);
      glow.addColorStop(1, "rgba(255,220,170,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(hit.x - 220 * u, hit.y - 220 * u, 440 * u, 440 * u);
      ctx.globalCompositeOperation = "source-over";
    }
    // Film grain, a new pattern every film frame (24 a second).
    const tile = grainTile();
    if (tile) {
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = 0.12;
      const f = Math.floor(frame.time * 24);
      const ox = rnd(f) * 192;
      const oy = rnd(f + 7) * 192;
      const scale = Math.max(1, u * 1.5);
      ctx.translate(-ox, -oy);
      ctx.scale(scale, scale);
      ctx.fillStyle = ctx.createPattern(tile, "repeat")!;
      ctx.fillRect(0, 0, (W + 192) / scale + 192, (H + 192) / scale + 192);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    // The bars slide in over the first second and stay.
    const win = cinemaWindow(W, H);
    const k = easeOut(frame.time / 0.9);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, win.top * k);
    ctx.fillRect(0, H - win.top * k, W, win.top * k);
  } else if (look === "neon") {
    // Scan lines.
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    const step = Math.max(3, Math.round(4 * u));
    for (let y = 0; y < H; y += step) ctx.fillRect(0, y, W, Math.max(1, step / 3));
    // A bloom in the hit's colour.
    if (hit && hit.age < 0.8) {
      const k = 1 - hit.age / 0.8;
      ctx.globalCompositeOperation = "screen";
      const glow = ctx.createRadialGradient(hit.x, hit.y, 0, hit.x, hit.y, 380 * u);
      glow.addColorStop(0, hexA(hit.colour, 0.55 * k));
      glow.addColorStop(1, hexA(hit.colour, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
    }
  } else {
    const dots = halftoneCorners(W, H);
    if (dots) {
      ctx.globalAlpha = 0.5;
      ctx.drawImage(dots, 0, 0);
      ctx.globalAlpha = 1;
    }
    if (hit) drawBurst(ctx, hit, u);
    // The panel: a white gutter and an ink line round the picture.
    const g = 18 * u;
    ctx.fillStyle = "#f7f3e8";
    ctx.fillRect(0, 0, W, g);
    ctx.fillRect(0, H - g, W, g);
    ctx.fillRect(0, 0, g, H);
    ctx.fillRect(W - g, 0, g, H);
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 7 * u;
    ctx.strokeRect(g, g, W - 2 * g, H - 2 * g);
  }
  ctx.restore();
}

/** Comic: the star burst with the move's sign, popping in and fading after a second. */
function drawBurst(ctx: CanvasRenderingContext2D, hit: Hit, u: number): void {
  if (!hit.sign || hit.age > 1.15) return;
  const k = backOut(hit.age / 0.25) * (1 - clamp01((hit.age - 0.85) / 0.3));
  if (k <= 0.01) return;
  const r = 120 * u * k;
  // Off the square up and to the side, so the piece stays visible.
  const cx = hit.x + 110 * u;
  const cy = hit.y - 120 * u;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.12);
  ctx.beginPath();
  const spikes = 14;
  for (let i = 0; i < spikes * 2; i++) {
    const ang = (i / (spikes * 2)) * Math.PI * 2;
    const rr = i % 2 ? r * 0.62 : r * (0.95 + 0.12 * rnd(i));
    ctx.lineTo(Math.cos(ang) * rr * 1.25, Math.sin(ang) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = hit.colour;
  ctx.fill();
  ctx.lineWidth = 7 * u;
  ctx.strokeStyle = "#111111";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.font = `900 italic ${r * 0.85}px ${SANS}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 9 * u;
  ctx.strokeText(hit.sign, 0, r * 0.05);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(hit.sign, 0, r * 0.05);
  ctx.restore();
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Where the lettering of a look sits. */
interface TextBox {
  title: { text: string; alpha: number; age: number };
  text: { text: string; alpha: number; age: number };
}

/** The lettering of the styled looks: in the cinema bars, as neon signs, or in comic caption boxes. */
export function drawStyleText(ctx: CanvasRenderingContext2D, look: StyledLook, t: TextBox, W: number, H: number, textScale: number, portrait: boolean): void {
  const m = Math.min(W, H);
  const u = m / 1080;
  const maxW = W * (portrait ? 0.84 : 0.72);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (look === "cinema") {
    const win = cinemaWindow(W, H);
    const bar = Math.max(win.top, 70 * u);
    if (t.title.text.trim() && t.title.alpha > 0.01) {
      ctx.globalAlpha = t.title.alpha * easeOut(t.title.age / 0.8);
      const fit = fitText(ctx, tokens(t.title.text.toUpperCase()), maxW, 2, 44 * u * textScale, (sz) => `400 ${sz}px ${SERIF}`);
      ctx.font = `400 ${fit.size}px ${SERIF}`;
      ctx.fillStyle = "#efe4cf";
      const lh = fit.size * 1.1;
      // Low in the top bar: the brand line sits above it.
      const y0 = bar * 0.64 - ((fit.lines.length - 1) * lh) / 2;
      fit.lines.forEach((line, i) => spaced(ctx, line.map((tk) => tk.word).join(" "), W / 2, y0 + i * lh, fit.size * 0.18));
    }
    if (t.text.text.trim() && t.text.alpha > 0.01) {
      ctx.globalAlpha = t.text.alpha * easeOut(t.text.age / 0.5);
      const fit = fitText(ctx, tokens(t.text.text), maxW, 2, 34 * u * textScale, (sz) => `italic 400 ${sz}px ${SERIF}`);
      ctx.font = `italic 400 ${fit.size}px ${SERIF}`;
      ctx.fillStyle = "#e9dcc4";
      const lh = fit.size * 1.2;
      const y0 = H - bar / 2 - ((fit.lines.length - 1) * lh) / 2;
      fit.lines.forEach((line, i) => ctx.fillText(line.map((tk) => tk.word).join(" "), W / 2, y0 + i * lh));
    }
  } else if (look === "neon") {
    const sign = (text: string, y: number, size: number, colour: string, alpha: number, flick: number) => {
      const fit = fitText(ctx, tokens(text.toUpperCase()), maxW, 2, size, (sz) => `800 ${sz}px ${SANS}`);
      ctx.font = `800 ${fit.size}px ${SANS}`;
      const lh = fit.size * 1.12;
      const y0 = y - ((fit.lines.length - 1) * lh) / 2;
      // Neon tubes switch on with a short flicker.
      ctx.globalAlpha = alpha * (flick < 0.25 ? (Math.sin(flick * 90) > 0 ? 1 : 0.25) : 1);
      fit.lines.forEach((line, i) => {
        const s = line.map((tk) => tk.word).join(" ");
        ctx.shadowColor = colour;
        ctx.shadowBlur = 26 * u;
        ctx.fillStyle = colour;
        ctx.fillText(s, W / 2, y0 + i * lh);
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#ffffff";
        ctx.globalAlpha *= 0.85;
        ctx.fillText(s, W / 2, y0 + i * lh);
        ctx.globalAlpha /= 0.85;
      });
    };
    if (t.title.text.trim() && t.title.alpha > 0.01) sign(t.title.text, (portrait ? 230 : 90) * u, 64 * u * textScale, NEON.b, t.title.alpha, t.title.age);
    if (t.text.text.trim() && t.text.alpha > 0.01) sign(t.text.text, H - (portrait ? 330 : 90) * u, 40 * u * textScale, NEON.w, t.text.alpha, t.text.age);
  } else {
    // Comic captions: a yellow box in the upper left for the title, a white one at the bottom for the line.
    const box = (text: string, x: number, y: number, size: number, fill: string, alpha: number, age: number, anchorTop: boolean) => {
      const fit = fitText(ctx, tokens(text.toUpperCase()), maxW * 0.9, 3, size, (sz) => `900 italic ${sz}px ${SANS}`);
      ctx.font = `900 italic ${fit.size}px ${SANS}`;
      const lines = fit.lines.map((l) => l.map((tk) => tk.word).join(" "));
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 40 * u;
      const lh = fit.size * 1.15;
      const h = lines.length * lh + 26 * u;
      const k = backOut(age / 0.3);
      ctx.globalAlpha = alpha;
      ctx.save();
      const bx = Math.min(Math.max(x - w / 2, 34 * u), W - 34 * u - w);
      const by = anchorTop ? y : y - h;
      ctx.translate(bx + w / 2, by + h / 2);
      ctx.scale(k, k);
      ctx.rotate(anchorTop ? -0.02 : 0.015);
      ctx.fillStyle = "#111111";
      ctx.fillRect(-w / 2 + 8 * u, -h / 2 + 8 * u, w, h);
      ctx.fillStyle = fill;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.lineWidth = 5 * u;
      ctx.strokeStyle = "#111111";
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = "#111111";
      lines.forEach((l, i) => ctx.fillText(l, 0, -h / 2 + 13 * u + lh / 2 + i * lh));
      ctx.restore();
    };
    if (t.title.text.trim() && t.title.alpha > 0.01) box(t.title.text, portrait ? W / 2 : W * 0.3, (portrait ? 170 : 50) * u, 52 * u * textScale, "#ffd83d", t.title.alpha, t.title.age, true);
    if (t.text.text.trim() && t.text.alpha > 0.01) box(t.text.text, W / 2, H - (portrait ? 260 : 50) * u, 36 * u * textScale, "#ffffff", t.text.alpha, t.text.age, false);
  }
  ctx.restore();
}

/** Text with extra letter spacing (the cinema titles). */
function spaced(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, gap: number): void {
  const chars = [...text];
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1);
  let x = cx - total / 2;
  ctx.save();
  ctx.textAlign = "left";
  chars.forEach((ch, i) => {
    ctx.fillText(ch, x, y);
    x += widths[i] + gap;
  });
  ctx.restore();
}
