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
import { t } from "../../i18n";
import { animatedText, backOut, clamp01, drawMove, easeOut, rgba, roundRect, SANS, SERIF } from "./draw2d";
export { fitText, moveParts, tokens, type Token } from "./draw2d";
import { lessonCard, lessonPanel, STAGE } from "./lessonLook";
import { shortCard, shortChrome, shortText } from "./shortLook";

export interface Assets {
  logo: HTMLImageElement | null;
  /** Lucena, painted by her own canvas renderer. */
  orb: HTMLCanvasElement | null;
  /** Move badges by kind ("brilliant" …), loaded from public/badges. */
  badges: Record<string, HTMLImageElement>;
  /** The site's 2D pieces by "white-knight" …: flat board and move symbols. */
  pieces: Record<string, HTMLImageElement>;
}

export interface ComposeOptions {
  safeZones?: boolean;
  /** Hover feedback while drawing arrows in the editor. */
  hover?: { square: string; from?: string } | null;
}

export interface Layout {
  u: number;
  portrait: boolean;
  brandY: number;
  titleTop: number;
  pillY: number;
  subCenter: number;
  textMax: number;
}

export function layout(W: number, H: number): Layout {
  const u = Math.min(W, H) / 1080;
  const ratio = H / W;
  if (ratio > 1.4) return { u, portrait: true, brandY: 170 * u, titleTop: 262 * u, pillY: 500 * u, subCenter: H - 470 * u, textMax: 860 * u };
  if (ratio > 0.9) return { u, portrait: false, brandY: 70 * u, titleTop: 120 * u, pillY: 270 * u, subCenter: H - 140 * u, textMax: 900 * u };
  return { u, portrait: false, brandY: 66 * u, titleTop: 104 * u, pillY: 236 * u, subCenter: H - 120 * u, textMax: 1300 * u };
}


function background(ctx: CanvasRenderingContext2D, W: number, H: number, p: StudioProject): void {
  const st = p.style;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, st.bgTop);
  g.addColorStop(1, st.bgBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Flat colour, no glow and no floating specks: those made every video look like the same template.
}

function vignette(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

export function compose(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  project: StudioProject,
  board: HTMLCanvasElement,
  viewProj: Mat4,
  assets: Assets,
  opts: ComposeOptions = {},
  /** Paints flat pieces standing on the 3D board, right after the board picture. */
  pieces?: (ctx: CanvasRenderingContext2D) => void,
): void {
  const { width: W, height: H } = ctx.canvas;
  const L = layout(W, H);
  const { u } = L;
  const st = project.style;
  const v = project.video;
  if (frame.lesson) {
    ctx.fillStyle = STAGE;
    ctx.fillRect(0, 0, W, H);
  } else background(ctx, W, H, project);
  ctx.drawImage(board, 0, 0, W, H);

  // Board letters and numbers, drawn flat on the frame of the 3D board (the 2D board draws its own).
  if (st.coords && st.view !== "2d") {
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

  // Standees stand in front of the frame's letters, as real pieces would.
  pieces?.(ctx);

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

  if (!frame.lesson) vignette(ctx, W, H);

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
  const textAlphaBase = card.kind === "none" ? 1 : 1 - cardA;

  // ---- texts: the lesson page, or the short look's headline, move tag and captions
  if (frame.lesson) {
    if (frame.card.kind !== "none" && frame.card.alpha > 0.01) lessonCard(ctx, frame, project, assets, W, H, u);
    else if (textAlphaBase > 0.01) lessonPanel(ctx, frame, project, assets, W, H, u, textAlphaBase);
  } else {
    shortText(ctx, frame, project, assets, L, W, textAlphaBase, mateAge !== undefined && mateAge > 0.25);
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
    const mateWord = t("SCHACHMATT");
    ctx.strokeText(mateWord, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(mateWord, 0, 0);
    ctx.restore();
  }

  // ---- cards
  if (card.kind !== "none" && cardA > 0.01 && !frame.lesson) shortCard(ctx, frame, project, assets, L, W, H);

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

  // ---- story bar and brand (always on top); the lesson page carries its own
  if (!frame.lesson) shortChrome(ctx, frame, project, assets, L, W);

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
    ctx.fillText(t("Hier liegen die Knöpfe von {0}", { 0: PLATFORM_LABEL[v.platform] }), W / 2, H - z.bottom * u / 2);
    ctx.restore();
  }
}

export function drawCard(ctx: CanvasRenderingContext2D, frame: Frame, project: StudioProject, assets: Assets, L: Layout, W: number, H: number): void {
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
    const kicker = t("{BRAND} erklärt", { BRAND });
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
      // Move answers show the piece as a picture ("Lb5" → bishop b5); a long answer gets smaller instead of squeezed.
      const room = bw - bubble - 48 * u;
      let lsize = 42 * u;
      ctx.font = `700 ${lsize}px ${SANS}`;
      while (lsize > 24 * u && drawMove(ctx, label, 0, 0, lsize, assets, null, false) > room) {
        lsize *= 0.94;
        ctx.font = `700 ${lsize}px ${SANS}`;
      }
      const tw = Math.min(drawMove(ctx, label, 0, 0, lsize, assets, null, false), room);
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
      ctx.font = `700 ${lsize}px ${SANS}`;
      ctx.textAlign = "left";
      drawMove(ctx, label, x0 + bubble + 14 * u, 2 * u, lsize, assets, null);
      ctx.restore();
    });
    animatedText(ctx, frame.text.text, { cx, top: rowY + bh + 26 * u, max: L.textMax, size: 34 * u, font: SANS, weight: 600, color: "rgba(235,238,248,0.85)", accent: st.accent, age: age - 0.8, alpha: a, u, maxLines: 2 });
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
    const label = t("Jetzt kostenlos auf {BRAND_DOMAIN}", { BRAND_DOMAIN });
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

