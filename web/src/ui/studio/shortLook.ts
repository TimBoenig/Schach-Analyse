// The look of short explainer videos (TikTok, Reels, Shorts and wide clips that are no lesson).
// Made to read like a creator's edit, not like a template: story bar segments on top, a poster
// headline with marker blocks behind the key words, a solid move tag, word-by-word captions that
// light up while they are spoken, a sticky "remember" note, a puzzle card that asks for comments,
// and a plain outro. No glow, no gradient buttons, no pills.
import { BRAND, BRAND_DOMAIN } from "../../brand";
import { t } from "../../i18n";
import type { Assets, Layout } from "./compose";
import { backOut, clamp01, drawMove, easeOut, fitLine, fitText, gap, roundRect, SANS, SERIF, tokens, type Token } from "./draw2d";
import { POLL_COLOURS, type StudioProject } from "./model";
import type { Frame } from "./timeline";

/** Dark ink for text on the accent blocks and on white tags. */
const INK = "#101114";
/** The note colour: a real sticky note, not the theme accent, so it reads as a person's annotation. */
const NOTE = "#ffe46b";

/** Seconds into a subtitle part after which a scene's takeaway note replaces the captions. */
export function noteFrom(dur: number): number {
  return Math.max(1.2, dur * 0.55);
}

/**
 * When each word of a caption lights up: spread over the part's time by word length (long words take longer to say),
 * starting after a short beat and done a little before the part ends. Pure, so it can be tested.
 */
export function wordTimes(words: string[], dur: number): number[] {
  const lead = Math.min(0.25, dur * 0.1);
  const span = Math.max(0.3, dur * 0.82 - lead);
  const weights = words.map((w) => w.replace(/[^\p{L}\p{N}]/gu, "").length + 3);
  const total = weights.reduce((s, x) => s + x, 0) || 1;
  let acc = 0;
  return weights.map((w) => {
    const at = lead + (acc / total) * span;
    acc += w;
    return at;
  });
}

/** Whose move it is in a puzzle: after the move on screen, else the position's own side to move. */
export function sideToMove(frame: Pick<Frame, "pill" | "toMove">): "w" | "b" {
  if (frame.pill) return frame.pill.side === "w" ? "b" : "w";
  return frame.toMove;
}

/** Story-style segments: one per scene, so the viewer always sees how much is left. Then the brand under it. */
export function shortChrome(ctx: CanvasRenderingContext2D, frame: Frame, project: StudioProject, assets: Assets, L: Layout, W: number): void {
  const { u } = L;
  const v = project.video;
  const outro = frame.card.kind === "outro" && frame.card.alpha > 0.5;
  const top = L.portrait ? 128 * u : 30 * u;
  const x0 = L.portrait ? 48 * u : 60 * u;
  const width = W - 2 * x0;
  ctx.save();
  if (v.progress) {
    const n = Math.max(1, project.scenes.length);
    const g = (n > 24 ? 3 : 6) * u;
    const w = (width - g * (n - 1)) / n;
    const h = 7 * u;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (w + g);
      const done = i < frame.index ? 1 : i > frame.index ? 0 : clamp01(frame.local / Math.max(0.1, frame.dur));
      roundRect(ctx, x, top, w, h, h / 2);
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      ctx.fill();
      if (done > 0) {
        roundRect(ctx, x, top, Math.max(h, w * done), h, h / 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      }
    }
  }
  if (v.brand && !outro) {
    const y = top + 46 * u;
    const s = L.portrait ? 1 : 0.85;
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 10 * u;
    if (assets.logo) ctx.drawImage(assets.logo, x0, y - 21 * u * s, 42 * u * s, 42 * u * s);
    ctx.font = `800 ${28 * u * s}px ${SANS}`;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(BRAND, x0 + 54 * u * s, y + 1 * u);
  }
  ctx.restore();
}

/** A strip of tape with a word on it, slightly crooked, like stuck on by hand. */
function tape(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, u: number, colour: string, rot = -0.04, alpha = 1, scale = 1): number {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  ctx.font = `900 ${30 * u}px ${SANS}`;
  const label = text.toUpperCase();
  const w = ctx.measureText(label).width + 44 * u;
  const h = 54 * u;
  ctx.fillStyle = colour;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 0, 2 * u);
  ctx.restore();
  return h;
}

/**
 * The poster headline: heavy, centred, a hard offset shadow (printed, not glowing), and the *key words* knocked out
 * of a solid block in the accent colour. Words pop in one after another. Returns the height.
 */
export function posterText(
  ctx: CanvasRenderingContext2D,
  text: string,
  o: { cx: number; top: number; max: number; size: number; accent: string; age: number; alpha: number; u: number; maxLines: number; font?: string; weight?: number },
): number {
  if (!text.trim() || o.alpha <= 0.01) return 0;
  const weight = o.weight ?? 900;
  const family = o.font ?? SANS;
  const font = (sz: number) => `${weight} ${sz}px ${family}`;
  const fit = fitText(ctx, tokens(text), o.max, o.maxLines, o.size, font);
  const size = fit.size;
  ctx.font = font(size);
  const lh = size * 1.06;
  const space = ctx.measureText(" ").width + size * 0.05;
  // Marker blocks stick out on both sides: their neighbours keep a little more distance.
  const gapE = (line: Token[], k: number) => gap(line[k], k, space) + (k && !line[k].glue && (line[k].emph || line[k - 1].emph) ? 22 * o.u : 0);
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let i = 0;
  fit.lines.forEach((line, li) => {
    const width = line.reduce((s, tq, k) => s + ctx.measureText(tq.word).width + gapE(line, k), 0);
    let x = o.cx - width / 2;
    const y = o.top + lh * li + size * 0.86;
    for (const [k, tq] of line.entries()) {
      x += gapE(line, k);
      const w = ctx.measureText(tq.word).width;
      const p = clamp01((o.age - i * 0.06) / 0.32);
      if (p > 0) {
        const pop = 1 + 0.35 * (1 - backOut(p));
        ctx.save();
        ctx.globalAlpha = o.alpha * clamp01(p * 2);
        ctx.translate(x + w / 2, y - size * 0.32);
        ctx.scale(pop, pop);
        ctx.translate(-(x + w / 2), -(y - size * 0.32));
        if (tq.emph) {
          // The block sits a little crooked, as if drawn with a marker.
          ctx.save();
          ctx.translate(x + w / 2, y - size * 0.34);
          ctx.rotate((li + k) % 2 ? 0.02 : -0.025);
          ctx.fillStyle = o.accent;
          ctx.fillRect(-w / 2 - 12 * o.u, -size * 0.58, w + 24 * o.u, size * 1.08);
          ctx.restore();
          ctx.fillStyle = INK;
          ctx.fillText(tq.word, x, y);
        } else {
          ctx.fillStyle = "rgba(0,0,0,0.85)";
          ctx.fillText(tq.word, x + 5 * o.u, y + 6 * o.u);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(tq.word, x, y);
        }
        ctx.restore();
      }
      x += w;
      i += 1;
    }
  });
  ctx.restore();
  return lh * fit.lines.length;
}

/**
 * Captions that light up word by word, the way creators caption their talking: the whole chunk stands, the word being
 * said is in the accent colour and a bit bigger, the words still to come are dimmed. Returns the block's height.
 */
function karaoke(ctx: CanvasRenderingContext2D, frame: Frame, project: StudioProject, L: Layout, cx: number, maxW: number, alpha: number): number {
  const st = project.style;
  const { u } = L;
  const cap = st.captionStyle;
  const list = tokens(frame.text.text);
  if (!list.length) return 0;
  const base = 62 * u * st.textScale * (cap === "punch" ? 1.15 : 1);
  const font = (sz: number) => `900 ${sz}px ${SANS}`;
  const fit = fitText(ctx, list, maxW - (cap === "box" ? 60 * u : 0), cap === "punch" ? 2 : 3, base, font);
  const size = fit.size;
  ctx.font = font(size);
  // The thick outline eats into the gaps: words get extra room so they never run together.
  const space = ctx.measureText(" ").width + (cap === "box" ? 0.04 : 0.16) * size;
  const lh = size * 1.2;
  const flat: Token[] = fit.lines.flat();
  const times = wordTimes(
    flat.map((tq) => tq.word),
    frame.text.dur,
  );
  const now = frame.text.age;
  const blockH = lh * fit.lines.length;
  const top = L.subCenter - blockH / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  if (cap === "box") {
    const widest = Math.max(...fit.lines.map((l) => l.reduce((s, tq, k) => s + ctx.measureText(tq.word).width + gap(tq, k, space), 0)));
    roundRect(ctx, cx - widest / 2 - 30 * u, top - 22 * u, widest + 60 * u, blockH + 44 * u, 18 * u);
    ctx.fillStyle = "rgba(10,11,14,0.88)";
    ctx.fill();
  }
  let n = 0;
  fit.lines.forEach((line, li) => {
    const width = line.reduce((s, tq, k) => s + ctx.measureText(tq.word).width + gap(tq, k, space), 0);
    let x = cx - width / 2;
    const y = top + lh * li + size * 0.9;
    for (const [k, tq] of line.entries()) {
      x += gap(tq, k, space);
      const w = ctx.measureText(tq.word).width;
      const at = times[n];
      const next = n + 1 < times.length ? times[n + 1] : frame.text.dur;
      const said = now >= at;
      const speaking = said && now < next + 0.05;
      const k2 = speaking ? backOut(clamp01((now - at) / 0.18)) : 0;
      const scale = 1 + 0.12 * k2 * (speaking ? 1 : 0);
      ctx.save();
      ctx.translate(x + w / 2, y - size * 0.35);
      ctx.scale(scale, scale);
      ctx.translate(-(x + w / 2), -(y - size * 0.35));
      ctx.globalAlpha = alpha * (said ? 1 : 0.5);
      if (cap !== "box") {
        ctx.strokeStyle = "rgba(0,0,0,0.95)";
        ctx.lineWidth = size * 0.2;
        ctx.strokeText(tq.word, x, y);
      }
      ctx.fillStyle = speaking || (tq.emph && said) ? st.accent : "#ffffff";
      ctx.fillText(tq.word, x, y);
      ctx.restore();
      x += w;
      n += 1;
    }
  });
  ctx.restore();
  return blockH;
}

/** The scene's takeaway as a sticky note: "MERKEN" and the rule, a little crooked. */
function stickyNote(ctx: CanvasRenderingContext2D, text: string, L: Layout, cx: number, maxW: number, age: number, alpha: number): void {
  const { u } = L;
  const k = backOut(clamp01(age / 0.4));
  if (k <= 0) return;
  const w = Math.min(maxW, 860 * u);
  const fit = fitText(ctx, tokens(text), w - 80 * u, 3, 50 * u, (sz) => `800 ${sz}px ${SANS}`);
  const h = 96 * u + fit.lines.length * fit.size * 1.18;
  ctx.save();
  ctx.globalAlpha = alpha * clamp01(age / 0.15);
  ctx.translate(cx, L.subCenter);
  ctx.rotate(-0.025);
  ctx.scale(0.7 + 0.3 * k, 0.7 + 0.3 * k);
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 24 * u;
  ctx.shadowOffsetY = 10 * u;
  ctx.fillStyle = NOTE;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.shadowColor = "transparent";
  // A strip of clear tape holding the note.
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fillRect(-70 * u, -h / 2 - 18 * u, 140 * u, 36 * u);
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `900 ${26 * u}px ${SANS}`;
  ctx.fillText(t("MERKEN").split("").join(String.fromCharCode(8202)), -w / 2 + 40 * u, -h / 2 + 52 * u);
  ctx.font = `800 ${fit.size}px ${SANS}`;
  const space = ctx.measureText(" ").width;
  fit.lines.forEach((line, i) => {
    let x = -w / 2 + 40 * u;
    const y = -h / 2 + 76 * u + (i + 1) * fit.size * 1.18 - fit.size * 0.18;
    for (const [j, tq] of line.entries()) {
      x += gap(tq, j, space);
      ctx.fillText(tq.word, x, y);
      x += ctx.measureText(tq.word).width;
    }
  });
  ctx.restore();
}

/** Headline, kicker, move tag and captions of a normal (non-card) moment. */
export function shortText(ctx: CanvasRenderingContext2D, frame: Frame, project: StudioProject, assets: Assets, L: Layout, W: number, base: number, hideTag: boolean): void {
  if (base <= 0.01) return;
  const { u } = L;
  const st = project.style;
  const v = project.video;
  const serif = st.titleFont === "serif";
  // ---- kicker on tape and the poster headline
  let titleTop = L.titleTop + (L.portrait ? 24 * u : 0);
  if (frame.label) {
    const k = easeOut(frame.title.age / 0.35);
    tape(ctx, frame.label, W / 2, titleTop - 44 * u, u, st.accent, -0.035, base * frame.title.alpha * k, 0.9 + 0.1 * k);
    titleTop += 8 * u;
  }
  const titleH = posterText(ctx, frame.title.text, {
    cx: W / 2,
    top: titleTop,
    max: L.textMax,
    size: (L.portrait ? 96 : 80) * u * st.textScale * (serif ? 1.15 : 1),
    accent: st.accent,
    age: frame.title.age,
    alpha: frame.title.alpha * base,
    u,
    maxLines: 2,
    font: serif ? SERIF : SANS,
    weight: serif ? 400 : 900,
  });

  // ---- move tag: a solid card in the colour of the side that moved
  if (v.movePill && frame.pill && !hideTag) {
    const black = frame.pill.side === "b";
    const k = backOut(frame.pill.age / 0.4);
    const a = clamp01(frame.pill.age / 0.15) * base;
    const size = (L.portrait ? 56 : 46) * u;
    const y = Math.max(L.pillY, titleTop + titleH + 70 * u);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(W / 2, y);
    ctx.rotate(black ? 0.02 : -0.02);
    ctx.scale(0.7 + 0.3 * k, 0.7 + 0.3 * k);
    ctx.font = `900 ${size}px ${SANS}`;
    const tw = drawMove(ctx, frame.pill.text, 0, 0, size, assets, black, false, black ? "dark" : "paper");
    const pw = tw + 60 * u;
    const ph = size * 1.65;
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowOffsetY = 8 * u;
    ctx.shadowBlur = 0;
    roundRect(ctx, -pw / 2, -ph / 2, pw, ph, 14 * u);
    ctx.fillStyle = black ? INK : "#ffffff";
    ctx.fill();
    ctx.shadowColor = "transparent";
    if (black) {
      ctx.lineWidth = 3 * u;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.stroke();
    }
    ctx.fillStyle = black ? "#ffffff" : INK;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    drawMove(ctx, frame.pill.text, -tw / 2, 3 * u, size, assets, black, true, black ? "dark" : "paper");
    ctx.restore();
    if (frame.pill.plain) {
      const words = `${black ? t("Schwarz") : t("Weiß")}: ${frame.pill.plain}`;
      const ws = fitLine(ctx, words, W - 120 * u, 32 * u, (sz) => `800 ${sz}px ${SANS}`);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `800 ${ws}px ${SANS}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.lineWidth = ws * 0.22;
      ctx.strokeText(words, W / 2, y + size * 0.82 + 34 * u);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(words, W / 2, y + size * 0.82 + 34 * u);
      ctx.restore();
    }
  }

  // ---- captions, or the takeaway note in the second half of the scene
  const hasLucena = v.lucena && assets.orb;
  const orb = hasLucena ? 120 * u : 0;
  const take = frame.scene.takeaway.trim();
  const from = noteFrom(frame.text.dur);
  const showNote = take !== "" && frame.card.kind === "none" && frame.local >= from;
  const cx = W / 2 + (hasLucena ? orb / 2 + 10 * u : 0);
  const maxW = L.textMax - (hasLucena ? orb + 20 * u : 0);
  if (showNote) {
    stickyNote(ctx, take, L, W / 2, L.textMax, frame.local - from, base * frame.text.alpha);
  } else if (frame.text.text.trim()) {
    const a = base * frame.text.alpha * clamp01(frame.text.age / 0.2) * (take ? clamp01((from - frame.local) / 0.2) : 1);
    const h = karaoke(ctx, frame, project, L, cx, maxW, a);
    if (hasLucena) {
      ctx.save();
      ctx.globalAlpha = a;
      ctx.drawImage(assets.orb!, W / 2 - L.textMax / 2 - 10 * u, L.subCenter - orb / 2, orb, orb);
      ctx.restore();
    }
    if (v.watermark && L.portrait) {
      ctx.save();
      ctx.globalAlpha = base * 0.6;
      ctx.font = `600 ${24 * u}px ${SANS}`;
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(BRAND_DOMAIN, W / 2, L.subCenter + h / 2 + 34 * u);
      ctx.restore();
    }
  } else if (v.watermark) {
    ctx.save();
    ctx.globalAlpha = base * 0.6;
    ctx.font = `600 ${24 * u}px ${SANS}`;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(BRAND_DOMAIN, W / 2, L.subCenter);
    ctx.restore();
  }
}

/** Cards of the short look: intro, puzzle question, poll and outro. */
export function shortCard(ctx: CanvasRenderingContext2D, frame: Frame, project: StudioProject, assets: Assets, L: Layout, W: number, H: number): void {
  const { u } = L;
  const st = project.style;
  const a = frame.card.alpha;
  const age = frame.card.age;
  const kind = frame.card.kind;
  const cx = W / 2;
  const serif = st.titleFont === "serif";
  const font = serif ? SERIF : SANS;
  const weight = serif ? 400 : 900;
  ctx.save();
  // Flat dimming, darker where the text stands; the board stays visible under puzzles.
  const dim = kind === "outro" ? 0.86 : kind === "intro" ? 0.55 : kind === "poll" ? 0.15 : 0.3;
  ctx.fillStyle = `rgba(6,7,9,${dim * a})`;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  if (kind === "intro") {
    let y = L.portrait ? H * 0.2 : H * 0.18;
    tape(ctx, frame.label || t("{BRAND} erklärt", { BRAND }), cx, y, u, st.accent, -0.04, a * easeOut(age / 0.3));
    y += 60 * u;
    y += posterText(ctx, frame.title.text, { cx, top: y, max: L.textMax, size: (L.portrait ? 128 : 104) * u * (serif ? 1.15 : 1), accent: st.accent, age: age - 0.1, alpha: a, u, maxLines: 3, font, weight });
    y += 28 * u;
    if (frame.text.text.trim()) {
      ctx.save();
      ctx.globalAlpha = a * easeOut((age - 0.5) / 0.4);
      const fit = fitText(ctx, tokens(frame.text.text), L.textMax, 2, 52 * u, (sz) => `800 ${sz}px ${SANS}`);
      ctx.font = `800 ${fit.size}px ${SANS}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineJoin = "round";
      fit.lines.forEach((line, i) => {
        const txt = line.map((tq, k) => (k && !tq.glue ? " " : "") + tq.word).join("");
        ctx.strokeStyle = "rgba(0,0,0,0.9)";
        ctx.lineWidth = fit.size * 0.2;
        ctx.strokeText(txt, cx, y + i * fit.size * 1.2);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(txt, cx, y + i * fit.size * 1.2);
      });
      ctx.restore();
    }
    return;
  }

  if (kind === "question" || kind === "poll") {
    let y = L.titleTop - 10 * u;
    const side = sideToMove(frame);
    const banner = kind === "poll" ? t("Was spielst du?") : t("Rätsel");
    tape(ctx, banner, cx, y - 30 * u, u, NOTE, -0.04, a * easeOut(age / 0.3));
    y += 20 * u;
    y += posterText(ctx, frame.title.text, { cx, top: y, max: L.textMax, size: (L.portrait ? 92 : 76) * u * (serif ? 1.15 : 1), accent: st.accent, age: age - 0.1, alpha: a, u, maxLines: 2, font, weight });
    // Whose move: a white or black chip, so nobody solves it for the wrong side.
    {
      const label = side === "w" ? t("Weiß am Zug") : t("Schwarz am Zug");
      ctx.save();
      ctx.globalAlpha = a * easeOut((age - 0.3) / 0.3);
      ctx.font = `800 ${32 * u}px ${SANS}`;
      const w = ctx.measureText(label).width + 90 * u;
      const h = 60 * u;
      const top = y + 26 * u;
      roundRect(ctx, cx - w / 2, top, w, h, 12 * u);
      ctx.fillStyle = side === "w" ? "#ffffff" : INK;
      ctx.fill();
      if (side === "b") {
        ctx.lineWidth = 3 * u;
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx - w / 2 + 34 * u, top + h / 2, 12 * u, 0, Math.PI * 2);
      ctx.fillStyle = side === "w" ? INK : "#ffffff";
      ctx.fill();
      ctx.fillStyle = side === "w" ? INK : "#ffffff";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(label, cx - w / 2 + 58 * u, top + h / 2 + 2 * u);
      ctx.restore();
    }

    if (kind === "poll") {
      // Answers as solid tiles in a row under the board, in the colours of their arrows on the board.
      const opts = frame.scene.options;
      const g = 16 * u;
      const n = Math.max(1, opts.length);
      const bw = Math.min((L.textMax - g * (n - 1)) / n, 320 * u);
      const bh = 104 * u;
      const rowY = L.portrait ? L.subCenter - bh / 2 : H - bh - 70 * u;
      const rowX = cx - (bw * n + g * (n - 1)) / 2;
      opts.forEach((o, i) => {
        const k = backOut((age - 0.35 - i * 0.1) / 0.4);
        if (k <= 0) return;
        const colour = POLL_COLOURS[i % POLL_COLOURS.length];
        const m = o.match(/^\s*([A-Za-z])\s*[).:]\s*(.+)$/);
        const letter = m ? m[1].toUpperCase() : String.fromCharCode(65 + i);
        const label = (m ? m[2] : o).trim();
        ctx.save();
        ctx.globalAlpha = a * Math.min(1, k);
        ctx.translate(rowX + i * (bw + g) + bw / 2, rowY + bh / 2);
        ctx.rotate((i - (n - 1) / 2) * 0.015);
        ctx.scale(0.8 + 0.2 * k, 0.8 + 0.2 * k);
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowOffsetY = 8 * u;
        roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 16 * u);
        ctx.fillStyle = colour;
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.fillStyle = INK;
        ctx.font = `900 ${30 * u}px ${SANS}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(letter, -bw / 2 + 22 * u, 2 * u);
        let size = 44 * u;
        ctx.font = `900 ${size}px ${SANS}`;
        const room = bw - 80 * u;
        while (size > 24 * u && drawMove(ctx, label, 0, 0, size, assets, null, false) > room) {
          size *= 0.93;
          ctx.font = `900 ${size}px ${SANS}`;
        }
        const tw = drawMove(ctx, label, 0, 0, size, assets, null, false);
        drawMove(ctx, label, -bw / 2 + 56 * u + (room - tw) / 2, 3 * u, size, assets, null, true, "paper");
        ctx.restore();
      });
      commentLine(ctx, t("Schreib A, B oder C in die Kommentare"), cx, rowY + bh + 54 * u, u, a * easeOut((age - 0.9) / 0.4), L.textMax);
    } else {
      // The puzzle timer in one row under the board, where the captions sit: a big number and a bar that runs out.
      // The board above stays free to look at, the comment line under it stays above the app's buttons.
      const cy = L.portrait ? L.subCenter - 20 * u : H * 0.8;
      if (frame.countdown !== null && frame.countdown > 0) {
        const total = Math.max(0.1, frame.scene.countdown);
        const left = frame.countdown / total;
        const n = Math.ceil(frame.countdown);
        const within = frame.countdown - Math.floor(frame.countdown);
        const rowW = Math.min(L.textMax, 760 * u);
        const numW = 120 * u;
        const bx = cx - rowW / 2 + numW + 20 * u;
        const bw = rowW - numW - 20 * u;
        ctx.save();
        ctx.globalAlpha = a;
        const pop = 1 + 0.2 * Math.pow(within, 8);
        ctx.font = `900 ${120 * u}px ${SANS}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.translate(cx - rowW / 2 + numW / 2, cy + 4 * u);
        ctx.scale(pop, pop);
        ctx.fillStyle = "rgba(0,0,0,0.85)";
        ctx.fillText(String(n), 6 * u, 7 * u);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(String(n), 0, 0);
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = a;
        roundRect(ctx, bx, cy - 12 * u, bw, 24 * u, 12 * u);
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.fill();
        roundRect(ctx, bx, cy - 12 * u, Math.max(24 * u, bw * left), 24 * u, 12 * u);
        ctx.fillStyle = left < 0.34 ? "#ff5a4f" : NOTE;
        ctx.fill();
        ctx.restore();
      }
      const hint = frame.text.text.trim() || t("Schreib deine Lösung in die Kommentare");
      commentLine(ctx, hint, cx, cy + 90 * u, u, a * easeOut((age - 0.6) / 0.4), L.textMax);
    }
    return;
  }

  // Outro: plain and confident. Logo, the line, a white button.
  let y = L.portrait ? H * 0.26 : H * 0.18;
  const k = backOut(age / 0.5);
  const size = (L.portrait ? 170 : 130) * u * (0.75 + 0.25 * k);
  ctx.save();
  ctx.globalAlpha = a;
  if (assets.logo) ctx.drawImage(assets.logo, cx - size / 2, y, size, size);
  ctx.restore();
  y += size + 40 * u;
  ctx.save();
  ctx.globalAlpha = a * easeOut((age - 0.15) / 0.3);
  ctx.font = `800 ${40 * u}px ${SANS}`;
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(BRAND, cx, y);
  ctx.restore();
  y += 80 * u;
  y += posterText(ctx, frame.title.text, { cx, top: y, max: L.textMax, size: (L.portrait ? 96 : 80) * u * (serif ? 1.15 : 1), accent: st.accent, age: age - 0.25, alpha: a, u, maxLines: 3, font, weight });
  y += 24 * u;
  if (frame.text.text.trim()) {
    ctx.save();
    ctx.globalAlpha = a * easeOut((age - 0.5) / 0.4);
    const fit = fitText(ctx, tokens(frame.text.text), L.textMax, 2, 44 * u, (sz) => `700 ${sz}px ${SANS}`);
    ctx.font = `700 ${fit.size}px ${SANS}`;
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    fit.lines.forEach((line, i) => ctx.fillText(line.map((tq, j) => (j && !tq.glue ? " " : "") + tq.word).join(""), cx, y + i * fit.size * 1.25));
    y += fit.lines.length * fit.size * 1.25;
    ctx.restore();
  }
  const bk = easeOut((age - 0.8) / 0.4);
  if (bk > 0) {
    const label = BRAND_DOMAIN;
    ctx.save();
    ctx.globalAlpha = a * bk;
    ctx.font = `900 ${40 * u}px ${SANS}`;
    const bw = ctx.measureText(label).width + 100 * u;
    const bh = 100 * u;
    const by = y + 50 * u + (1 - bk) * 24 * u;
    ctx.translate(cx, by + bh / 2);
    ctx.rotate(-0.02);
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowOffsetY = 10 * u;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
    ctx.shadowColor = "transparent";
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 3 * u);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = a * bk * 0.75;
    ctx.font = `700 ${30 * u}px ${SANS}`;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(t("Kostenlos deine Partien analysieren"), cx, by + bh + 30 * u);
    ctx.restore();
  }
}

/** One outlined line that asks for a comment (comments push a video in every feed). */
function commentLine(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, u: number, alpha: number, max: number): void {
  if (alpha <= 0.01) return;
  const size = fitLine(ctx, text, max, 40 * u, (sz) => `800 ${sz}px ${SANS}`);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `800 ${size}px ${SANS}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.92)";
  ctx.lineWidth = size * 0.22;
  ctx.strokeText(text, cx, y);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, cx, y);
  ctx.restore();
}

