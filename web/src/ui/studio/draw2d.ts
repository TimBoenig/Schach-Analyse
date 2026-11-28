// Shared 2D drawing helpers for the studio's text layers: word wrapping and fitting,
// figurine moves, rounded boxes and colours. Used by compose and the format looks.
import type { Assets } from "./compose";

export const SANS = '"Geist", -apple-system, "Segoe UI", sans-serif';
export const SERIF = '"Instrument Serif", Georgia, serif';

export const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
export const easeOut = (k: number) => 1 - Math.pow(1 - clamp01(k), 3);
export const backOut = (k: number) => {
  const c = 1.9;
  const x = clamp01(k) - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
};

export interface Token {
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

export const gap = (tq: Token, k: number, space: number) => (k && !tq.glue ? space : 0);

export function wrap(ctx: CanvasRenderingContext2D, list: Token[], max: number, emphFont?: string): Token[][] {
  const lines: Token[][] = [];
  let line: Token[] = [];
  let width = 0;
  const space = ctx.measureText(" ").width;
  const base = ctx.font;
  for (const tq of list) {
    if (tq.emph && emphFont) ctx.font = emphFont;
    const w = ctx.measureText(tq.word).width;
    ctx.font = base;
    if (line.length && !tq.glue && width + space + w > max) {
      lines.push(line);
      line = [];
      width = 0;
    }
    width += (line.length && !tq.glue ? space : 0) + w;
    line.push(tq);
  }
  if (line.length) lines.push(line);
  return lines;
}

/**
 * Wraps a text into at most `maxLines`: first the given size, then smaller in
 * steps down to `minScale` of it. Only a text that is far too long for even the
 * smallest size loses its end, and then visibly with "…", never silently.
 */
export function fitText(ctx: CanvasRenderingContext2D, list: Token[], max: number, maxLines: number, size: number, font: (size: number) => string, emphFont?: (size: number) => string, minScale = 0.62): { lines: Token[][]; size: number } {
  let sz = size;
  for (;;) {
    ctx.font = font(sz);
    const lines = wrap(ctx, list, max, emphFont?.(sz));
    if (lines.length <= maxLines) return { lines, size: sz };
    if (sz <= size * minScale + 0.01) {
      const kept = lines.slice(0, maxLines);
      const last = kept[kept.length - 1];
      last[last.length - 1] = { ...last[last.length - 1], word: `${last[last.length - 1].word.replace(/[.,;:!?]+$/, "")}…` };
      return { lines: kept, size: sz };
    }
    sz = Math.max(size * minScale, sz * 0.92);
  }
}

/** One line of text, made smaller until it fits `max` (never squeezed). Returns the size to use. */
export function fitLine(ctx: CanvasRenderingContext2D, text: string, max: number, size: number, font: (size: number) => string, minScale = 0.6): number {
  let sz = size;
  ctx.font = font(sz);
  while (sz > size * minScale && ctx.measureText(text).width > max) {
    sz *= 0.94;
    ctx.font = font(sz);
  }
  return sz;
}

export const FIGURINE: Record<string, string> = { K: "king", D: "queen", T: "rook", L: "bishop", S: "knight" };

/** "3. Lb5" → number, piece letter (drawn as the piece itself) and the rest. Pawn moves and castling carry no piece. */
export function moveParts(label: string): { no: string; piece: string; rest: string; black: boolean } {
  const m = label.match(/^(\d+(?:\.+|…)\s*)?(?:([KDTLS])(?=[a-h]?[1-8]?x?[a-h][1-8]))?(.*)$/s)!;
  return { no: m[1] ?? "", piece: m[2] ?? "", rest: m[3] ?? "", black: /…|\.\.\./.test(m[1] ?? "") };
}

/**
 * Draws a move in figurine notation: the piece letter becomes a small picture
 * of the piece, so "Lb5" reads as "(bishop) b5" even for people who don't know
 * the German letters. Uses the current font; returns the width.
 */
export function drawMove(ctx: CanvasRenderingContext2D, label: string, x: number, y: number, size: number, assets: Assets, black: boolean | null, draw = true, surface: "dark" | "paper" = "dark"): number {
  // surface "paper": the lesson page, where white pieces need the dark chip.
  const p = moveParts(label);
  const isBlack = black ?? p.black;
  const img = p.piece ? assets.pieces[`${isBlack ? "black" : "white"}-${FIGURINE[p.piece]}`] : undefined;
  const align = ctx.textAlign;
  ctx.textAlign = "left";
  let cx = x;
  if (p.no) {
    if (draw) ctx.fillText(p.no, cx, y);
    cx += ctx.measureText(p.no).width;
  }
  if (img) {
    const s = size * 1.18;
    if (draw) {
      // The picture sits on the text's middle line; black pieces get a light chip so they show on dark backgrounds.
      const mid = ctx.textBaseline === "middle" ? y : y - size * 0.36;
      if (isBlack !== (surface === "paper")) {
        ctx.save();
        ctx.fillStyle = surface === "paper" ? "rgba(24,25,28,0.88)" : "rgba(255,255,255,0.86)";
        ctx.beginPath();
        ctx.arc(cx + s / 2, mid, s * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.drawImage(img, cx, mid - s / 2, s, s);
    }
    cx += s + size * 0.06;
  } else if (p.piece) {
    if (draw) ctx.fillText(p.piece, cx, y);
    cx += ctx.measureText(p.piece).width;
  }
  if (draw) ctx.fillText(p.rest, cx, y);
  cx += ctx.measureText(p.rest).width;
  ctx.textAlign = align;
  return cx - x;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Draws wrapped text centred on `cx`, word by word rising into place
 * (`age` = seconds since the text appeared). Returns the block height.
 */
export function animatedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  o: { cx: number; top: number; max: number; size: number; font: string; weight: number; color: string; accent: string; age: number; alpha: number; line?: number; u: number; maxLines?: number },
): number {
  if (!text.trim() || o.alpha <= 0) return 0;
  const fit = fitText(ctx, tokens(text), o.max, o.maxLines ?? 4, o.size, (sz) => `${o.weight} ${sz}px ${o.font}`);
  const size = fit.size;
  ctx.font = `${o.weight} ${size}px ${o.font}`;
  const lines = fit.lines;
  const lh = size * (o.line ?? 1.12);
  const space = ctx.measureText(" ").width;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  let i = 0;
  lines.forEach((line, li) => {
    const width = line.reduce((s, tq, k) => s + ctx.measureText(tq.word).width + gap(tq, k, space), 0);
    let x = o.cx - width / 2;
    const y = o.top + lh * li + size * 0.86;
    for (const [k, tq] of line.entries()) {
      x += gap(tq, k, space);
      const rise = easeOut((o.age - i * 0.045) / 0.5);
      ctx.globalAlpha = o.alpha * rise;
      ctx.fillStyle = tq.emph ? o.accent : o.color;
      ctx.fillText(tq.word, x, y + (1 - rise) * 28 * o.u);
      x += ctx.measureText(tq.word).width;
      i += 1;
    }
  });
  ctx.globalAlpha = 1;
  return lh * lines.length;
}

