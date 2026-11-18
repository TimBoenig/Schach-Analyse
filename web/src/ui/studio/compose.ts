// Paints one finished video frame: background, the 3D board picture, then the
// 2D layer on top (headline, subtitles, move pill, cards, branding, Lucena).
// Sizes are in "units" of a 1080-pixel-wide video, so every format scales.
import { BRAND, BRAND_DOMAIN } from "../../brand";
import { toScreen, type Mat4 } from "./math3d";
import { PLATFORM_LABEL, POLL_COLOURS, type Platform, type StudioProject } from "./model";

/** Areas the apps cover with their own buttons and captions, in units of a 1080 x 1920 video. */
const SAFE: Record<Platform, { top: number; bottom: number; right: number }> = {
  tiktok: { top: 130, bottom: 380, right: 140 },
  reels: { top: 110, bottom: 420, right: 130 },
  shorts: { top: 120, bottom: 360, right: 130 },
  youtube: { top: 0, bottom: 0, right: 0 },
};
import type { Frame } from "./timeline";

export interface Assets {
  logo: HTMLImageElement | null;
  /** Lucena, painted by her own canvas renderer. */
  orb: HTMLCanvasElement | null;
  /** Move badges by kind ("brilliant" …), loaded from public/badges. */
  badges: Record<string, HTMLImageElement>;
}

export interface ComposeOptions {
  safeZones?: boolean;
  /** Hover feedback while drawing arrows in the editor. */
  hover?: { square: string; from?: string } | null;
}

const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
const easeOut = (k: number) => 1 - Math.pow(1 - clamp01(k), 3);
const backOut = (k: number) => {
  const c = 1.9;
  const x = clamp01(k) - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
};

interface Token {
  word: string;
  emph: boolean;
  /** Sticks to the word before (punctuation right after a *starred* word). */
  glue?: boolean;
}

/** Words of a text; *starred* words are emphasised. */
export function tokens(text: string): Token[] {
  const out: Token[] = [];
  let emph = false;
  let prevEndsWord = false;
  for (const part of text.split(/(\*)/)) {
    if (part === "*") {
      emph = !emph;
      continue;
    }
    const words = part.split(/\s+/);
    words.forEach((w, i) => {
      if (!w) return;
      out.push({ word: w, emph, glue: i === 0 && prevEndsWord && out.length > 0 });
    });
    if (part) prevEndsWord = !/\s$/.test(part);
  }
  return out;
}

const gap = (t: Token, k: number, space: number) => (k && !t.glue ? space : 0);

function wrap(ctx: CanvasRenderingContext2D, list: Token[], max: number, emphFont?: string): Token[][] {
  const lines: Token[][] = [];
  let line: Token[] = [];
  let width = 0;
  const space = ctx.measureText(" ").width;
  const base = ctx.font;
  for (const t of list) {
    if (t.emph && emphFont) ctx.font = emphFont;
    const w = ctx.measureText(t.word).width;
    ctx.font = base;
    if (line.length && !t.glue && width + space + w > max) {
      lines.push(line);
      line = [];
      width = 0;
    }
    width += (line.length && !t.glue ? space : 0) + w;
    line.push(t);
  }
  if (line.length) lines.push(line);
  return lines;
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

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Draws wrapped text centred on `cx`, word by word rising into place
 * (`age` = seconds since the text appeared). Returns the block height.
 */
function animatedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  o: { cx: number; top: number; max: number; size: number; font: string; weight: number; color: string; accent: string; age: number; alpha: number; line?: number; u: number; maxLines?: number },
): number {
  if (!text.trim() || o.alpha <= 0) return 0;
  ctx.font = `${o.weight} ${o.size}px ${o.font}`;
  const lines = wrap(ctx, tokens(text), o.max).slice(0, o.maxLines ?? 4);
  const lh = o.size * (o.line ?? 1.12);
  const space = ctx.measureText(" ").width;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  let i = 0;
  lines.forEach((line, li) => {
    const width = line.reduce((s, t, k) => s + ctx.measureText(t.word).width + gap(t, k, space), 0);
    let x = o.cx - width / 2;
    const y = o.top + lh * li + o.size * 0.86;
    for (const [k, t] of line.entries()) {
      x += gap(t, k, space);
      const rise = easeOut((o.age - i * 0.045) / 0.5);
      ctx.globalAlpha = o.alpha * rise;
      ctx.fillStyle = t.emph ? o.accent : o.color;
      ctx.fillText(t.word, x, y + (1 - rise) * 28 * o.u);
      x += ctx.measureText(t.word).width;
      i += 1;
    }
  });
  ctx.globalAlpha = 1;
  return lh * lines.length;
}

interface Layout {
  u: number;
  portrait: boolean;
  brandY: number;
  titleTop: number;
  pillY: number;
  subCenter: number;
  textMax: number;
}

function layout(W: number, H: number): Layout {
  const u = Math.min(W, H) / 1080;
  const ratio = H / W;
  if (ratio > 1.4) return { u, portrait: true, brandY: 170 * u, titleTop: 262 * u, pillY: 500 * u, subCenter: H - 470 * u, textMax: 860 * u };
  if (ratio > 0.9) return { u, portrait: false, brandY: 70 * u, titleTop: 120 * u, pillY: 270 * u, subCenter: H - 140 * u, textMax: 900 * u };
  return { u, portrait: false, brandY: 66 * u, titleTop: 104 * u, pillY: 236 * u, subCenter: H - 120 * u, textMax: 1300 * u };
}

const SANS = '"Geist", -apple-system, "Segoe UI", sans-serif';
const SERIF = '"Instrument Serif", Georgia, serif';

function background(ctx: CanvasRenderingContext2D, W: number, H: number, p: StudioProject, t: number): void {
  const st = p.style;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, st.bgTop);
  g.addColorStop(1, st.bgBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const r = ctx.createRadialGradient(W / 2, H * 0.52, 0, W / 2, H * 0.52, Math.max(W, H) * 0.6);
  r.addColorStop(0, rgba(st.accent, 0.16));
  r.addColorStop(1, rgba(st.accent, 0));
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, W, H);
  // Slow floating light specks: always the same for the same second, so preview and export match.
  const u = Math.min(W, H) / 1080;
  for (let i = 0; i < 22; i++) {
    const sx = ((Math.sin(i * 91.7) * 0.5 + 0.5) * W + Math.sin(t * 0.13 + i) * 40 * u + W) % W;
    const sy = ((Math.cos(i * 37.3) * 0.5 + 0.5) * H - t * (6 + (i % 5) * 3) * u + H * 4) % H;
    const rad = (8 + (i % 7) * 7) * u;
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad);
    sg.addColorStop(0, rgba(i % 3 ? "#ffffff" : st.accent, 0.07));
    sg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
  }
}

function vignette(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

function brandPill(ctx: CanvasRenderingContext2D, cx: number, cy: number, u: number, logo: HTMLImageElement | null, scale = 1): void {
  const s = u * scale;
  ctx.font = `600 ${34 * s}px ${SANS}`;
  const tw = ctx.measureText(BRAND).width;
  const logoSize = 50 * s;
  const w = logoSize + 18 * s + tw + 46 * s;
  const h = 74 * s;
  const x = cx - w / 2;
  roundRect(ctx, x, cy - h / 2, w, h, h / 2);
  ctx.fillStyle = "rgba(8,10,16,0.55)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1.5 * s;
  ctx.stroke();
  if (logo) ctx.drawImage(logo, x + 13 * s, cy - logoSize / 2, logoSize, logoSize);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(BRAND, x + 13 * s + logoSize + 16 * s, cy + 1 * s);
}

export function compose(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  project: StudioProject,
  board: HTMLCanvasElement,
  viewProj: Mat4,
  assets: Assets,
  opts: ComposeOptions = {},
): void {
  const { width: W, height: H } = ctx.canvas;
  const L = layout(W, H);
  const { u } = L;
  const st = project.style;
  const v = project.video;
  background(ctx, W, H, project, frame.time);
  ctx.drawImage(board, 0, 0, W, H);

  // Board letters and numbers, drawn flat on the frame of the 3D board.
  if (st.coords) {
    ctx.font = `600 ${22 * u}px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    for (let i = 0; i < 8; i++) {
      const a = toScreen(viewProj, [i - 3.5, 0, 4.22]);
      if (a) ctx.fillText("abcdefgh"[i], a.x * W, a.y * H);
      const b = toScreen(viewProj, [-4.22, 0, 3.5 - i]);
      if (b) ctx.fillText(String(i + 1), b.x * W, b.y * H);
    }
  }

  // Editor-only: square under the pointer while drawing arrows or marks.
  if (opts.hover) {
    for (const sq of [opts.hover.from, opts.hover.square]) {
      if (!sq) continue;
      const f = sq.charCodeAt(0) - 97;
      const r = Number(sq[1]) - 1;
      const pts = [
        [f - 4, 4 - r],
        [f - 3, 4 - r],
        [f - 3, 3 - r],
        [f - 4, 3 - r],
      ].map(([x, z]) => toScreen(viewProj, [x, 0.01, z]));
      if (pts.some((p) => !p)) continue;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p!.x * W, p!.y * H) : ctx.moveTo(p!.x * W, p!.y * H)));
      ctx.closePath();
      ctx.strokeStyle = st.accent;
      ctx.lineWidth = 4 * u;
      ctx.stroke();
    }
  }

  const fxAge = (kind: Frame["fx"][number]["kind"]) => frame.fx.find((f) => f.kind === kind)?.age;
  const mateAge = fxAge("mate");
  const squareOnScreen = (sq: string, y = 0) => {
    const [x, z] = [sq.charCodeAt(0) - 97 - 3.5, 3.5 - (Number(sq[1]) - 1)];
    const p = toScreen(viewProj, [x, y, z]);
    return p ? { x: p.x * W, y: p.y * H } : null;
  };

  // ---- spotlight: everything but the square that matters goes dark
  const spot = fxAge("spotlight");
  if (spot !== undefined && frame.fxSquare) {
    const p = squareOnScreen(frame.fxSquare, 0.4);
    if (p) {
      const k = easeOut(spot / 0.5);
      const r = Math.min(W, H) * 0.16;
      const g = ctx.createRadialGradient(p.x, p.y, r * 0.6, p.x, p.y, r * 2.6);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${0.72 * k})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  vignette(ctx, W, H);

  // ---- threat and mate: the edges of the picture glow red
  const threat = fxAge("threat");
  const danger = mateAge !== undefined ? Math.min(1, mateAge / 0.3) * 0.9 : threat !== undefined ? Math.min(1, threat / 0.4) * (0.45 + 0.25 * Math.sin(threat * 6)) : 0;
  if (danger > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, "rgba(255,60,60,0)");
    g.addColorStop(1, `rgba(255,60,60,${0.38 * danger})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // ---- move badge (!!, ??) floating over the square the move landed on
  if (frame.badge) {
    const p = squareOnScreen(frame.badge.square, 1.25);
    const img = assets.badges[frame.badge.kind];
    if (p && img) drawBadge(ctx, p.x, p.y, img, frame.badge.age, u);
  }

  // ---- poll answers: a letter bubble at the end of each coloured arrow
  for (const pm of frame.pollMarks) {
    if (pm.alpha <= 0.01) continue;
    const p = squareOnScreen(pm.square, 0.9);
    if (!p) continue;
    const r = 34 * u;
    ctx.save();
    ctx.globalAlpha = pm.alpha;
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 16 * u;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = pm.colour;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 4 * u;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.fillStyle = "#0a0c11";
    ctx.font = `800 ${36 * u}px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(pm.letter, p.x, p.y + 2 * u);
    ctx.restore();
  }

  const card = frame.card;
  const cardA = card.alpha;
  const titleFont = st.titleFont === "serif" ? SERIF : SANS;
  const titleWeight = st.titleFont === "serif" ? 400 : 900;
  const titleScale = st.titleFont === "serif" ? 1.2 : 1;
  const textAlphaBase = card.kind === "none" ? 1 : 1 - cardA;

  // ---- kicker ("Variante 2") and headline
  if (frame.label && textAlphaBase > 0.01) {
    const k = easeOut(frame.title.age / 0.4);
    ctx.save();
    ctx.globalAlpha = frame.title.alpha * textAlphaBase * k;
    ctx.font = `700 ${28 * u}px ${SANS}`;
    const text = frame.label.toUpperCase();
    const w = ctx.measureText(text).width + 40 * u;
    const h = 50 * u;
    const y = L.titleTop - 64 * u;
    roundRect(ctx, W / 2 - w / 2, y, w, h, h / 2);
    ctx.fillStyle = st.accent;
    ctx.fill();
    ctx.fillStyle = "#0a0c11";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, W / 2, y + h / 2 + 1 * u);
    ctx.restore();
  }
  if (textAlphaBase > 0.01) {
    ctx.save();
    // TikTok-style headline: heavy, big and with a hard dark shadow so it reads over any background.
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 10 * u;
    ctx.shadowOffsetY = 5 * u;
    animatedText(ctx, frame.title.text, {
      cx: W / 2,
      top: L.titleTop,
      max: L.textMax,
      size: 84 * u * titleScale * st.textScale,
      font: titleFont,
      weight: titleWeight,
      color: "#ffffff",
      accent: st.accent,
      age: frame.title.age,
      alpha: frame.title.alpha * textAlphaBase,
      line: 1.08,
      u,
      maxLines: 2,
    });
    ctx.restore();
  }

  // ---- move pill
  if (v.movePill && frame.pill && textAlphaBase > 0.01 && !(mateAge !== undefined && mateAge > 0.25)) {
    const k = backOut(frame.pill.age / 0.45);
    const a = clamp01(frame.pill.age / 0.2) * textAlphaBase;
    ctx.save();
    ctx.translate(W / 2, L.pillY);
    ctx.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k);
    ctx.font = `800 ${54 * u}px ${SANS}`;
    const tw = ctx.measureText(frame.pill.text).width;
    const dot = 30 * u;
    const pw = tw + 64 * u + dot + 14 * u;
    const ph = 94 * u;
    ctx.globalAlpha = a;
    ctx.shadowColor = rgba(st.accent, 0.6);
    ctx.shadowBlur = 40 * u;
    roundRect(ctx, -pw / 2, -ph / 2, pw, ph, ph / 2);
    ctx.fillStyle = rgba(st.accent, 0.22);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = rgba(st.accent, 0.9);
    ctx.lineWidth = 2.5 * u;
    ctx.stroke();
    // A white or black dot says whose move it is.
    const dx = -pw / 2 + 32 * u + dot / 2;
    ctx.beginPath();
    ctx.arc(dx, 0, dot / 2, 0, Math.PI * 2);
    ctx.fillStyle = frame.pill.side === "w" ? "#f6f4ee" : "#15161b";
    ctx.fill();
    ctx.lineWidth = 2.5 * u;
    ctx.strokeStyle = frame.pill.side === "w" ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.7)";
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(frame.pill.text, dx + dot / 2 + 14 * u, 2 * u);
    if (v.plainMoves && frame.pill.plain) {
      ctx.font = `700 ${34 * u}px ${SANS}`;
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "rgba(0,0,0,0.7)";
      ctx.shadowBlur = 14 * u;
      ctx.fillText(`${frame.pill.side === "w" ? "Weiß" : "Schwarz"}: ${frame.pill.plain}`, 0, ph / 2 + 34 * u);
    }
    ctx.restore();
  }

  // ---- subtitle box, with Lucena speaking it
  const hasLucena = v.lucena && assets.orb;
  if (frame.text.text.trim() && textAlphaBase > 0.01) {
    const a = frame.text.alpha * textAlphaBase * clamp01(frame.text.age / 0.3);
    const orbSize = hasLucena ? 132 * u : 0;
    const cap = st.captionStyle;
    const size = 47 * u * st.textScale * (cap === "punch" ? 1.25 : 1);
    const maxW = L.textMax - orbSize - (hasLucena ? 24 * u : 0);
    const regular = cap === "box" ? `650 ${size}px ${SANS}` : `800 ${size}px ${SANS}`;
    const bold = `900 ${size}px ${SANS}`;
    ctx.font = regular;
    const lines = wrap(ctx, tokens(frame.text.text), maxW - 64 * u, bold).slice(0, cap === "punch" ? 2 : 3);
    const lh = size * 1.28;
    const space = ctx.measureText(" ").width;
    const widthOf = (tk: Token) => {
      ctx.font = tk.emph ? bold : regular;
      const w = ctx.measureText(tk.word).width;
      ctx.font = regular;
      return w;
    };
    const contentW = Math.max(...lines.map((l) => l.reduce((s, t2, k) => s + widthOf(t2) + gap(t2, k, space), 0)));
    const boxW = contentW + 64 * u;
    const boxH = lh * lines.length + 46 * u;
    const total = boxW + (hasLucena ? orbSize + 18 * u : 0);
    const x0 = W / 2 - total / 2;
    const bx = x0 + (hasLucena ? orbSize + 18 * u : 0);
    const by = L.subCenter - boxH / 2 + (1 - easeOut(frame.text.age / 0.4)) * 30 * u;
    ctx.save();
    ctx.globalAlpha = a;
    if (cap === "box") {
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 30 * u;
      roundRect(ctx, bx, by, boxW, boxH, 30 * u);
      ctx.fillStyle = "rgba(6,7,12,0.86)";
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1.5 * u;
      ctx.stroke();
    }
    ctx.lineJoin = "round";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    lines.forEach((line, li) => {
      let x = bx + 32 * u;
      const y = by + 23 * u + lh * li + size * 0.95;
      for (const [k, tk] of line.entries()) {
        x += gap(tk, k, space);
        ctx.fillStyle = tk.emph ? st.accent : "#ffffff";
        ctx.font = tk.emph ? bold : regular;
        if (cap !== "box") {
          // Without a box the text carries a thick dark outline, like TikTok's own captions.
          ctx.strokeStyle = "rgba(0,0,0,0.92)";
          ctx.lineWidth = size * (cap === "punch" ? 0.2 : 0.16);
          ctx.strokeText(tk.word, x, y);
        }
        ctx.fillText(tk.word, x, y);
        x += ctx.measureText(tk.word).width;
      }
    });
    if (hasLucena) ctx.drawImage(assets.orb!, x0, L.subCenter - orbSize / 2, orbSize, orbSize);
    ctx.restore();
    if (v.watermark && L.portrait) {
      ctx.font = `500 ${26 * u}px ${SANS}`;
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.globalAlpha = textAlphaBase;
      ctx.fillText(BRAND_DOMAIN, W / 2, by + boxH + 26 * u);
      ctx.globalAlpha = 1;
    }
  } else if (v.watermark && textAlphaBase > 0.01) {
    ctx.font = `500 ${26 * u}px ${SANS}`;
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = textAlphaBase;
    ctx.fillText(BRAND_DOMAIN, W / 2, L.subCenter);
    ctx.globalAlpha = 1;
  }

  // ---- mate stamp
  if (mateAge !== undefined && mateAge > 0.25) {
    const a = mateAge - 0.25;
    const k = backOut(a / 0.5);
    ctx.save();
    // Where the move pill was: the board and the falling king stay visible.
    ctx.translate(W / 2, L.pillY + 10 * u);
    ctx.rotate(-0.06);
    ctx.scale(2.2 - 1.2 * k, 2.2 - 1.2 * k);
    ctx.globalAlpha = clamp01(a / 0.2) * textAlphaBase;
    ctx.font = `900 ${112 * u}px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(255,60,60,0.9)";
    ctx.shadowBlur = 60 * u;
    ctx.lineWidth = 10 * u;
    ctx.strokeStyle = "rgba(120,0,10,0.85)";
    ctx.strokeText("SCHACHMATT", 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillText("SCHACHMATT", 0, 0);
    ctx.restore();
  }

  // ---- cards
  if (card.kind !== "none" && cardA > 0.01) drawCard(ctx, frame, project, assets, L, W, H);

  // ---- confetti burst from the square of the move
  const conf = fxAge("confetti");
  if (conf !== undefined && conf < 3.2) {
    const origin = (frame.fxSquare && squareOnScreen(frame.fxSquare, 0.6)) || { x: W / 2, y: H * 0.5 };
    drawConfetti(ctx, origin.x, origin.y, conf, u, [st.accent, "#34d3a1", "#ffb84d", "#ff6b6b", "#ffffff", "#8d9aff"]);
  }

  // ---- flash on the moment of the move
  const flash = fxAge("flash");
  if (flash !== undefined && flash < 0.45) {
    ctx.fillStyle = `rgba(255,255,255,${0.75 * (1 - flash / 0.45) ** 2})`;
    ctx.fillRect(0, 0, W, H);
  }

  // ---- branding and progress (always on top)
  if (v.brand && !(card.kind === "outro" && cardA > 0.5)) brandPill(ctx, L.portrait ? W / 2 : 170 * u, L.brandY, u, assets.logo, L.portrait ? 1 : 0.8);
  if (v.progress) {
    const y = L.portrait ? 112 * u : 22 * u;
    const x = 90 * u;
    const w = W - 180 * u;
    roundRect(ctx, x, y, w, 6 * u, 3 * u);
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fill();
    roundRect(ctx, x, y, Math.max(6 * u, w * frame.progress), 6 * u, 3 * u);
    ctx.fillStyle = st.accent;
    ctx.fill();
  }

  if (opts.safeZones && L.portrait) {
    ctx.save();
    ctx.fillStyle = "rgba(255,80,80,0.13)";
    ctx.strokeStyle = "rgba(255,120,120,0.7)";
    ctx.setLineDash([12 * u, 10 * u]);
    ctx.lineWidth = 2 * u;
    const z = SAFE[v.platform] ?? SAFE.tiktok;
    const zones: [number, number, number, number][] = [
      [0, 0, W, z.top * u],
      [0, H - z.bottom * u, W, z.bottom * u],
      [W - z.right * u, H * 0.42, z.right * u, H * 0.58 - z.bottom * u],
    ];
    for (const [x, y, w, h] of zones) {
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,200,200,0.9)";
    ctx.font = `600 ${24 * u}px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`Hier liegen die Knöpfe von ${PLATFORM_LABEL[v.platform]}`, W / 2, H - z.bottom * u / 2);
    ctx.restore();
  }
}

function drawCard(ctx: CanvasRenderingContext2D, frame: Frame, project: StudioProject, assets: Assets, L: Layout, W: number, H: number): void {
  const { u } = L;
  const st = project.style;
  const a = frame.card.alpha;
  const age = frame.card.age;
  const titleFont = st.titleFont === "serif" ? SERIF : SANS;
  const titleWeight = st.titleFont === "serif" ? 400 : 800;
  const serifScale = st.titleFont === "serif" ? 1.18 : 1;
  ctx.save();
  const dim = frame.card.kind === "outro" ? 0.78 : frame.card.kind === "intro" ? 0.5 : frame.card.kind === "poll" ? 0.18 : 0.35;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `rgba(4,5,9,${dim * a})`);
  g.addColorStop(0.5, `rgba(4,5,9,${dim * 0.75 * a})`);
  g.addColorStop(1, `rgba(4,5,9,${dim * a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  const cx = W / 2;
  if (frame.card.kind === "intro") {
    const top = L.portrait ? H * 0.155 : H * 0.16;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 40 * u;
    const kicker = `${BRAND} erklärt`;
    ctx.font = `600 ${30 * u}px ${SANS}`;
    ctx.fillStyle = st.accent;
    ctx.globalAlpha = a * clamp01(age / 0.4);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(kicker.toUpperCase().split("").join(String.fromCharCode(8202)), cx, top);
    const h = animatedText(ctx, frame.title.text, { cx, top: top + 30 * u, max: L.textMax, size: 112 * u * serifScale, font: titleFont, weight: titleWeight, color: "#ffffff", accent: st.accent, age: age - 0.15, alpha: a, line: 1.02, u, maxLines: 3 });
    animatedText(ctx, frame.text.text, { cx, top: top + 60 * u + h, max: L.textMax, size: 46 * u, font: SANS, weight: 500, color: "rgba(235,238,248,0.88)", accent: st.accent, age: age - 0.5, alpha: a, u, maxLines: 2 });
    ctx.restore();
    return;
  }
  if (frame.card.kind === "poll") {
    const top = L.portrait ? H * 0.15 : H * 0.1;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 30 * u;
    const h = animatedText(ctx, frame.title.text, { cx, top, max: L.textMax, size: 78 * u * serifScale, font: titleFont, weight: titleWeight, color: "#ffffff", accent: st.accent, age, alpha: a, u, maxLines: 2 });
    ctx.restore();
    // Answers sit in one row under the board, so the coloured arrows on the board stay visible.
    const opts = frame.scene.options;
    const gap = 18 * u;
    const n = Math.max(1, opts.length);
    const bw = Math.min((L.textMax - gap * (n - 1)) / n, 330 * u);
    const bh = 96 * u;
    const rowY = L.portrait ? L.subCenter - bh / 2 : H - bh - 60 * u;
    const rowX = cx - (bw * n + gap * (n - 1)) / 2;
    opts.forEach((o, i) => {
      const k = backOut((age - 0.35 - i * 0.12) / 0.5);
      if (k <= 0) return;
      const colour = POLL_COLOURS[i % POLL_COLOURS.length];
      ctx.save();
      ctx.globalAlpha = a * Math.min(1, k);
      ctx.translate(rowX + i * (bw + gap) + bw / 2, rowY + bh / 2);
      ctx.scale(0.85 + 0.15 * k, 0.85 + 0.15 * k);
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 24 * u;
      roundRect(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2);
      ctx.fillStyle = "rgba(10,12,18,0.86)";
      ctx.fill();
      ctx.shadowBlur = 0;
      // Same colour as the answer's arrow on the board.
      ctx.lineWidth = 5 * u;
      ctx.strokeStyle = colour;
      ctx.stroke();
      const m = o.match(/^\s*([A-Za-z])\s*[).:]\s*(.+)$/);
      const letter = m ? m[1].toUpperCase() : String.fromCharCode(65 + i);
      const label = (m ? m[2] : o).trim();
      const bubble = 62 * u;
      ctx.font = `700 ${42 * u}px ${SANS}`;
      const tw = Math.min(ctx.measureText(label).width, bw - bubble - 48 * u);
      const x0 = -(bubble + 14 * u + tw) / 2;
      ctx.beginPath();
      ctx.arc(x0 + bubble / 2, 0, bubble / 2, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.fillStyle = "#0a0c11";
      ctx.font = `800 ${34 * u}px ${SANS}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(letter, x0 + bubble / 2, 2 * u);
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${42 * u}px ${SANS}`;
      ctx.textAlign = "left";
      ctx.fillText(label, x0 + bubble + 14 * u, 2 * u, bw - bubble - 48 * u);
      ctx.restore();
    });
    animatedText(ctx, frame.text.text, { cx, top: rowY + bh + 26 * u, max: L.textMax, size: 34 * u, font: SANS, weight: 600, color: "rgba(235,238,248,0.85)", accent: st.accent, age: age - 0.8, alpha: a, u, maxLines: 1 });
    if (frame.countdown !== null && frame.countdown > 0) {
      // Under the question, where the move pill usually is.
      const total = frame.scene.countdown;
      const R = 50 * u;
      const ccy = Math.max(top + h + R + 24 * u, L.pillY);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(cx, ccy, R, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(8,10,16,0.75)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, ccy, R, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * frame.countdown) / total);
      ctx.strokeStyle = st.accent;
      ctx.lineWidth = 8 * u;
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = `800 ${56 * u}px ${SANS}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(Math.ceil(frame.countdown)), cx, ccy + 3 * u);
      ctx.restore();
    }
    return;
  }
  if (frame.card.kind === "question") {
    const top = L.portrait ? H * 0.17 : H * 0.12;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 30 * u;
    const h = animatedText(ctx, frame.title.text, { cx, top, max: L.textMax, size: 84 * u * serifScale, font: titleFont, weight: titleWeight, color: "#ffffff", accent: st.accent, age, alpha: a, u, maxLines: 2 });
    animatedText(ctx, frame.text.text, { cx, top: top + h + 20 * u, max: L.textMax, size: 50 * u, font: SANS, weight: 600, color: st.accent, accent: "#ffffff", age: age - 0.3, alpha: a, u, maxLines: 2 });
    ctx.restore();
    if (frame.countdown !== null && frame.countdown > 0) {
      const total = frame.scene.countdown;
      const n = Math.ceil(frame.countdown);
      const within = frame.countdown - Math.floor(frame.countdown);
      const cy = L.portrait ? H * 0.74 : H * 0.8;
      const R = 92 * u;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(8,10,16,0.7)";
      ctx.fill();
      ctx.lineWidth = 10 * u;
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * frame.countdown) / total);
      ctx.strokeStyle = st.accent;
      ctx.lineCap = "round";
      ctx.stroke();
      const pop = 1 + 0.25 * Math.pow(within, 6);
      ctx.translate(cx, cy);
      ctx.scale(pop, pop);
      ctx.fillStyle = "#ffffff";
      ctx.font = `800 ${110 * u}px ${SANS}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(n), 0, 6 * u);
      ctx.restore();
    }
    return;
  }
  // Outro: logo, name, message and the address, as the last picture people see.
  const cy = L.portrait ? H * 0.34 : H * 0.3;
  const k = backOut(age / 0.7);
  const size = (L.portrait ? 230 : 170) * u * (0.7 + 0.3 * k);
  ctx.save();
  ctx.globalAlpha = a;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 1.4);
  glow.addColorStop(0, rgba(st.accent, 0.35 + 0.1 * Math.sin(age * 3)));
  glow.addColorStop(1, rgba(st.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(cx - size * 1.5, cy - size * 1.5, size * 3, size * 3);
  if (assets.logo) ctx.drawImage(assets.logo, cx - size / 2, cy - size / 2, size, size);
  ctx.font = `800 ${84 * u}px ${SANS}`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = a * clamp01((age - 0.2) / 0.4);
  ctx.fillText(BRAND, cx, cy + size / 2 + 110 * u);
  ctx.restore();
  let y = cy + size / 2 + 160 * u;
  y += animatedText(ctx, frame.title.text, { cx, top: y, max: L.textMax, size: 54 * u, font: SANS, weight: 600, color: "#ffffff", accent: st.accent, age: age - 0.4, alpha: a, u, maxLines: 2 });
  y += 16 * u;
  y += animatedText(ctx, frame.text.text, { cx, top: y, max: L.textMax, size: 40 * u, font: SANS, weight: 500, color: "rgba(230,234,245,0.85)", accent: st.accent, age: age - 0.6, alpha: a, u, maxLines: 3 });
  // Call-to-action button.
  const bk = easeOut((age - 0.9) / 0.5);
  if (bk > 0) {
    const label = `Jetzt kostenlos auf ${BRAND_DOMAIN}`;
    ctx.save();
    ctx.globalAlpha = a * bk;
    ctx.font = `700 ${38 * u}px ${SANS}`;
    const bw = ctx.measureText(label).width + 90 * u;
    const bh = 96 * u;
    const by = y + 50 * u + (1 - bk) * 30 * u;
    ctx.shadowColor = rgba(st.accent, 0.55);
    ctx.shadowBlur = 50 * u;
    roundRect(ctx, cx - bw / 2, by, bw, bh, bh / 2);
    const bg = ctx.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
    bg.addColorStop(0, st.accent);
    bg.addColorStop(1, "#3fd2ea");
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#0a0c11";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, by + bh / 2 + 2 * u);
    ctx.restore();
  }
}

function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, img: HTMLImageElement, age: number, u: number): void {
  const k = backOut(age / 0.45);
  if (k <= 0) return;
  const size = 118 * u;
  ctx.save();
  ctx.translate(x, y - (1 - clamp01(age / 0.45)) * 30 * u);
  ctx.scale(k, k);
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 24 * u;
  // A white ring keeps the badge readable on light and wooden boards.
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.drawImage(img, -size * 0.45, -size * 0.45, size * 0.9, size * 0.9);
  ctx.restore();
}

/** Deterministic confetti: the same age always draws the same picture, so preview and export match. */
function drawConfetti(ctx: CanvasRenderingContext2D, ox: number, oy: number, age: number, u: number, colours: string[]): void {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  ctx.save();
  for (let i = 0; i < 110; i++) {
    const angle = -Math.PI / 2 + (rnd() - 0.5) * Math.PI * 1.5;
    const speed = (900 + rnd() * 1300) * u;
    const spin = (rnd() - 0.5) * 18;
    const w = (10 + rnd() * 12) * u;
    const h = w * (0.4 + rnd() * 0.4);
    const colour = colours[Math.floor(rnd() * colours.length)];
    const drag = Math.exp(-age * 1.6);
    const travel = (1 - drag) / 1.6;
    const x = ox + Math.cos(angle) * speed * travel + Math.sin(age * 3 + i) * 20 * u * age;
    const y = oy + Math.sin(angle) * speed * travel + 0.5 * 1400 * u * age * age * 0.55;
    const a = clamp01((3.2 - age) / 0.8);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = colour;
    ctx.translate(x, y);
    ctx.rotate(spin * age);
    ctx.fillRect(-w / 2, -h / 2, w, h * Math.abs(Math.cos(age * 6 + i)));
    ctx.restore();
  }
  ctx.restore();
}
