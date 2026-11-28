// The lesson look for long YouTube videos (16:9): board on a flat stage, a paper page
// beside it with chapter rail, headline, explanation, takeaway and the move list.
import { BRAND, BRAND_DOMAIN } from "../../brand";
import { t } from "../../i18n";
import type { Assets } from "./compose";
import { backOut, clamp01, drawMove, easeOut, fitLine, fitText, gap, rgba, roundRect, SANS, SERIF, tokens, wrap, type Token } from "./draw2d";
import { POLL_COLOURS, type StudioProject } from "./model";
import type { Frame } from "./timeline";

// ---------------------------------------------------------------------------
// Lesson look (long YouTube videos): a calm "textbook page". The board stands on a
// flat dark stage on the left; the right is a paper-coloured page with a chapter
// rail on top, a serif headline, the explanation with highlighter marks and the
// moves played. No glow, no particles, no gradients: it should look made by a
// person who teaches chess, not generated.
// ---------------------------------------------------------------------------
const PAPER = "#f3efe5";
const INK = "#18191c";
const INK_SOFT = "rgba(24,25,28,0.62)";
const RULE = "rgba(24,25,28,0.16)";
export const STAGE = "#17181b";

/** The theme's accent, darkened until it reads as ink on paper. */
function inkAccent(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * 0.52));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export interface Chapter {
  name: string;
  start: number;
  end: number;
}

/** Chapters = runs of scenes with the same small line ("Kapitel 2: Die Falle"). Scenes before the first one are the intro. */
export function chaptersOf(project: StudioProject): Chapter[] {
  const out: Chapter[] = [];
  // Labels the studio writes itself for side lines are not chapters.
  const auto = /^(variante|variation|line|zurück|back)/i;
  const numbered = /^(kapitel|chapter|teil|part)\s*\d+/i;
  const explicit = project.scenes.some((s) => numbered.test(s.label.trim()));
  project.scenes.forEach((s, i) => {
    const raw = s.label.trim();
    if (!raw || auto.test(raw) || (explicit && !numbered.test(raw))) return;
    const name = raw.replace(/^(kapitel|chapter|teil|part)\s*\d+\s*[:.\-–—]\s*/i, "").trim() || raw;
    const last = out[out.length - 1];
    if (last && last.name === name) last.end = i + 1;
    else out.push({ name, start: i, end: i + 1 });
  });
  // A chapter reaches up to the next one; closing cards belong to the last.
  out.forEach((c, k) => (c.end = k + 1 < out.length ? out[k + 1].start : project.scenes.length));
  return out;
}

/** The page: stage shadow, paper and the chapter rail. Returns the content's left edge, width and top. */
function lessonPage(ctx: CanvasRenderingContext2D, frame: Frame, project: StudioProject, W: number, H: number, u: number, base: number) {
  const st = project.style;
  const px = Math.round(W * 0.585);
  const pad = 72 * u;
  const x0 = px + pad;
  const maxW = W - x0 - pad;
  ctx.save();
  // The page throws a soft shadow onto the stage, so it reads as a sheet laid next to the board.
  const sh = ctx.createLinearGradient(px - 36 * u, 0, px, 0);
  sh.addColorStop(0, "rgba(0,0,0,0)");
  sh.addColorStop(1, "rgba(0,0,0,0.32)");
  ctx.fillStyle = sh;
  ctx.fillRect(px - 36 * u, 0, 36 * u, H);
  ctx.fillStyle = PAPER;
  ctx.fillRect(px, 0, W - px, H);

  const chapters = chaptersOf(project);
  const accent = inkAccent(st.accent);
  const cur = chapters.findIndex((c) => frame.index >= c.start && frame.index < c.end);
  ctx.globalAlpha = base;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const barY = 78 * u;
  const kick = (txt: string) => {
    ctx.font = `700 ${19 * u}px ${SANS}`;
    ctx.fillStyle = accent;
    ctx.fillText(txt.toUpperCase().split("").join(String.fromCharCode(8202)), x0, barY - 22 * u);
  };
  if (chapters.length) {
    kick(cur >= 0 ? t("Kapitel {0} von {1}", { 0: cur + 1, 1: chapters.length }) : frame.card.kind === "none" ? t("Vorschau") : t("Einstieg"));
    const gap = 8 * u;
    const w = (maxW - gap * (chapters.length - 1)) / chapters.length;
    chapters.forEach((c, k) => {
      const x = x0 + k * (w + gap);
      ctx.fillStyle = RULE;
      ctx.fillRect(x, barY, w, 6 * u);
      const done = frame.index >= c.end ? 1 : frame.index < c.start ? 0 : (frame.index - c.start + clamp01(frame.local / Math.max(0.1, frame.dur))) / Math.max(1, c.end - c.start);
      ctx.fillStyle = k === cur ? INK : "rgba(24,25,28,0.55)";
      ctx.fillRect(x, barY, w * done, 6 * u);
    });
  } else {
    kick(t("Lernvideo"));
    ctx.fillStyle = RULE;
    ctx.fillRect(x0, barY, maxW, 6 * u);
    ctx.fillStyle = INK;
    ctx.fillRect(x0, barY, maxW * frame.progress, 6 * u);
  }

  // Footer: the brand, small and quiet.
  const fy = H - 52 * u;
  ctx.fillStyle = RULE;
  ctx.fillRect(x0, fy - 38 * u, maxW, 2 * u);
  if (project.video.brand) {
    ctx.textBaseline = "middle";
    ctx.font = `700 ${22 * u}px ${SANS}`;
    ctx.fillStyle = INK;
    ctx.fillText(BRAND, x0 + 42 * u, fy);
  }
  ctx.restore();
  return { x0, maxW, accent, chapters, cur, fy };
}

/** Moves in figurine notation on paper: white pieces get a dark chip, black pieces need none. */
function paperMove(ctx: CanvasRenderingContext2D, label: string, x: number, y: number, size: number, assets: Assets, black: boolean | null, draw = true, onChip = false): number {
  return drawMove(ctx, label, x, y, size, assets, black, draw, onChip ? "dark" : "paper");
}

/** The reading page next to the board: headline, the whole explanation, the move in words and the move list. */
export function lessonPanel(ctx: CanvasRenderingContext2D, frame: Frame, project: StudioProject, assets: Assets, W: number, H: number, u: number, base: number): void {
  const st = project.style;
  const ts = st.textScale;
  const { x0, maxW, accent, chapters, cur, fy } = lessonPage(ctx, frame, project, W, H, u, base);
  // The first seconds of a chapter belong to its title: number and name, big, then the page comes back.
  const brk = cur >= 0 && frame.index === chapters[cur].start ? chapterBreak(frame.local) : 0;
  const pageBase = base;
  base *= 1 - brk;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let y = 150 * u;
  // Chapter name under the rail, so the structure is always readable.
  const chapterName = cur >= 0 ? chapters[cur].name : frame.label;
  if (chapterName) {
    ctx.globalAlpha = base;
    const size = fitLine(ctx, chapterName, maxW, 28 * u * ts, (sz) => `600 ${sz}px ${SANS}`);
    ctx.font = `600 ${size}px ${SANS}`;
    ctx.fillStyle = INK_SOFT;
    ctx.fillText(chapterName, x0, y);
  }
  y += 24 * u;
  // Headline in the serif: up to three lines.
  ctx.globalAlpha = base * frame.title.alpha * clamp01(frame.title.age / 0.5);
  const tFont = (sz: number) => `400 ${sz}px ${SERIF}`;
  const tFit = fitText(ctx, tokens(frame.title.text.replace(/\*/g, "")), maxW, 3, 84 * u * ts, tFont);
  ctx.font = tFont(tFit.size);
  ctx.fillStyle = INK;
  for (const line of tFit.lines) {
    y += tFit.size * 1.08;
    ctx.fillText(line.map((tq, k) => (k && !tq.glue ? " " : "") + tq.word).join(""), x0, y);
  }
  y += 34 * u;

  // The bottom block: the move just played in words, then the move list.
  const moves = frame.moveList.slice(-10);
  const listTop = fy - 38 * u - (moves.length ? 150 : 40) * u;
  const nowTop = listTop - (frame.pill ? 124 * u : 0);

  // The takeaway: a note with an ink bar, above the move block. Its room is kept from the start so nothing jumps.
  const take = frame.scene.takeaway.trim();
  let noteH = 0;
  let noteFit: { lines: Token[][]; size: number } | null = null;
  if (take) {
    noteFit = fitText(ctx, tokens(take), maxW - 60 * u, 3, 32 * u * ts, (sz) => `650 ${sz}px ${SANS}`);
    noteH = 70 * u + noteFit.lines.length * noteFit.size * 1.32;
  }
  const noteTop = nowTop - 72 * u - noteH;

  // Explanation: the whole text at once at reading size, *words* highlighted like with a marker.
  const bodySize = 42 * u * ts;
  const room = (take ? noteTop - 30 * u : nowTop - 40 * u) - y;
  let size = bodySize;
  let lines: Token[][] = [];
  const src = tokens(frame.text.text.replace(/\|/g, " "));
  for (;;) {
    ctx.font = `450 ${size}px ${SANS}`;
    lines = wrap(ctx, src, maxW, `700 ${size}px ${SANS}`);
    if (lines.length * size * 1.45 <= room || size <= bodySize * 0.66) break;
    size *= 0.94;
  }
  const fitAll = Math.max(3, Math.floor(room / (size * 1.45)));
  if (lines.length > fitAll) lines = fitText(ctx, src, maxW, fitAll, size, (sz) => `450 ${sz}px ${SANS}`, (sz) => `700 ${sz}px ${SANS}`, 1).lines;
  const regular = `450 ${size}px ${SANS}`;
  const bold = `700 ${size}px ${SANS}`;
  ctx.font = regular;
  const space = ctx.measureText(" ").width;
  const textA = base * frame.text.alpha * clamp01(frame.text.age / 0.5);
  // Reading along: the sentence being spoken is full ink, what is still to come waits in grey.
  const sentenceOf = sentenceIndex(src);
  const now = currentSentence(src, frame.text.age, frame.text.dur);
  lines.forEach((line) => {
    y += size * 1.45;
    let x = x0;
    for (const [k, tk] of line.entries()) {
      x += gap(tk, k, space);
      ctx.font = tk.emph ? bold : regular;
      const w = ctx.measureText(tk.word).width;
      const si = sentenceOf.get(tk) ?? now;
      ctx.globalAlpha = textA * (si > now ? 0.34 : 1);
      if (tk.emph) {
        ctx.fillStyle = rgba(st.accent, si > now ? 0.16 : 0.34);
        ctx.fillRect(x - 5 * u, y - size * 0.84, w + 10 * u, size * 1.08);
      }
      ctx.fillStyle = tk.emph || si === now ? INK : "rgba(24,25,28,0.8)";
      ctx.fillText(tk.word, x, y);
      x += w;
    }
  });

  if (take && noteFit) {
    // It lands once the explanation has been heard, like a teacher writing the rule on the board.
    const at = Math.min(frame.dur * 0.5, 4);
    const k = easeOut((frame.local - at) / 0.45);
    if (k > 0) {
      ctx.globalAlpha = base * frame.text.alpha * k;
      const nx = x0 + (1 - k) * 24 * u;
      ctx.fillStyle = rgba(st.accent, 0.16);
      ctx.fillRect(nx, noteTop, maxW, noteH);
      ctx.fillStyle = INK;
      ctx.fillRect(nx, noteTop, 6 * u, noteH);
      ctx.font = `800 ${18 * u}px ${SANS}`;
      ctx.fillStyle = accent;
      ctx.fillText(t("MERKSATZ").split("").join(String.fromCharCode(8202)), nx + 30 * u, noteTop + 38 * u);
      ctx.font = `650 ${noteFit.size}px ${SANS}`;
      ctx.fillStyle = INK;
      const sp = ctx.measureText(" ").width;
      noteFit.lines.forEach((line, i) => {
        let lx = nx + 30 * u;
        const ly = noteTop + 50 * u + (i + 1) * noteFit!.size * 1.32 - noteFit!.size * 0.3;
        for (const [j, tk] of line.entries()) {
          lx += gap(tk, j, sp);
          ctx.fillText(tk.word, lx, ly);
          lx += ctx.measureText(tk.word).width;
        }
      });
    }
  }

  // The move on the board right now, as a symbol and in plain words, for viewers who don't read notation.
  if (frame.pill) {
    ctx.globalAlpha = base * clamp01(frame.pill.age / 0.3);
    const black = frame.pill.side === "b";
    ctx.fillStyle = RULE;
    ctx.fillRect(x0, nowTop - 38 * u, maxW, 2 * u);
    ctx.font = `700 ${20 * u}px ${SANS}`;
    ctx.fillStyle = accent;
    ctx.fillText(t("ZUG VON {0}", { 0: black ? t("SCHWARZ") : t("WEISS") }).split("").join(String.fromCharCode(8202)), x0, nowTop - 4 * u);
    ctx.font = `800 ${42 * u}px ${SANS}`;
    ctx.fillStyle = INK;
    const mw = paperMove(ctx, frame.pill.text, x0, nowTop + 58 * u, 42 * u, assets, black);
    const words = frame.pill.plain;
    const wsize = fitLine(ctx, words, maxW - mw - 26 * u, 28 * u, (sz) => `500 ${sz}px ${SANS}`);
    ctx.font = `500 ${wsize}px ${SANS}`;
    ctx.fillStyle = INK_SOFT;
    ctx.fillText(words, x0 + mw + 24 * u, nowTop + 56 * u);
  }

  // Move list: the last moves as a score sheet, the current one on a dark chip.
  if (moves.length) {
    ctx.globalAlpha = base;
    ctx.fillStyle = RULE;
    ctx.fillRect(x0, listTop - 4 * u, maxW, 2 * u);
    const msize = 27 * u;
    ctx.font = `600 ${msize}px ${SANS}`;
    let x = x0;
    let row = listTop + 44 * u;
    moves.forEach((m, i) => {
      const now = i === moves.length - 1;
      const w = paperMove(ctx, m, 0, 0, msize, assets, null, false) + 28 * u;
      if (x + w > x0 + maxW) {
        x = x0;
        row += 46 * u;
      }
      if (now) {
        roundRect(ctx, x - 12 * u, row - 32 * u, w, 46 * u, 8 * u);
        ctx.fillStyle = INK;
        ctx.fill();
      }
      ctx.fillStyle = now ? PAPER : INK_SOFT;
      paperMove(ctx, m, x, row, msize, assets, null, true, now);
      x += w + 6 * u;
    });
  }
  if (project.video.lucena && assets.orb) {
    ctx.globalAlpha = base;
    ctx.drawImage(assets.orb, W - 150 * u, H - 150 * u, 110 * u, 110 * u);
  }
  ctx.restore();
  if (brk > 0) drawChapterBreak(ctx, cur, chapters[cur].name, x0, maxW, H, u, pageBase * brk, frame.local);
  // Logo next to the footer's brand name.
  if (project.video.brand && assets.logo) ctx.drawImage(assets.logo, x0, fy - 15 * u, 30 * u, 30 * u);
}

/** How much of the chapter title is on the page at this second of the chapter's first scene (1 = all, 0 = the normal page). */
export function chapterBreak(local: number): number {
  if (local < 0) return 0;
  if (local < 1.3) return 1;
  return clamp01(1 - (local - 1.3) / 0.5);
}

/** For every word, the number of the sentence it belongs to (a word ending in . ! ? or … closes a sentence). */
function sentenceIndex(list: Token[]): Map<Token, number> {
  const out = new Map<Token, number>();
  let n = 0;
  for (const tk of list) {
    out.set(tk, n);
    if (/[.!?…]["“”»)]*$/.test(tk.word)) n += 1;
  }
  return out;
}

/**
 * The sentence being spoken: the text's time is shared out by sentence length over most of the part,
 * so long sentences stay lit longer. Pure, so it can be tested.
 */
export function currentSentence(list: Token[], age: number, dur: number): number {
  const lengths: number[] = [];
  let len = 0;
  for (const tk of list) {
    len += tk.word.length + 1;
    if (/[.!?…]["“”»)]*$/.test(tk.word)) {
      lengths.push(len);
      len = 0;
    }
  }
  if (len) lengths.push(len);
  if (lengths.length <= 1) return 0;
  const total = lengths.reduce((s, x) => s + x, 0);
  const span = Math.max(0.5, dur * 0.88);
  let acc = 0;
  for (let i = 0; i < lengths.length; i++) {
    acc += lengths[i];
    if (age < (acc / total) * span) return i;
  }
  return lengths.length - 1;
}

/** The chapter title on the page: a big number, the word "Kapitel" and the name, rising in. */
function drawChapterBreak(ctx: CanvasRenderingContext2D, cur: number, name: string, x0: number, maxW: number, H: number, u: number, alpha: number, local: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const k = easeOut(local / 0.6);
  const rise = (1 - k) * 40 * u;
  ctx.font = `400 ${300 * u}px ${SERIF}`;
  ctx.fillStyle = INK;
  ctx.fillText(String(cur + 1).padStart(2, "0"), x0 - 8 * u, H * 0.3 + 270 * u + rise);
  ctx.fillStyle = INK;
  ctx.fillRect(x0, H * 0.3 + 310 * u + rise, maxW * k, 3 * u);
  const fit = fitText(ctx, tokens(name), maxW, 2, 84 * u, (sz) => `400 ${sz}px ${SERIF}`);
  ctx.font = `400 ${fit.size}px ${SERIF}`;
  fit.lines.forEach((line, i) => {
    ctx.globalAlpha = alpha * easeOut((local - 0.2) / 0.5);
    ctx.fillText(line.map((tq, j) => (j && !tq.glue ? " " : "") + tq.word).join(""), x0, H * 0.3 + 400 * u + i * fit.size * 1.05 + rise);
  });
  ctx.restore();
}

/**
 * Cards in the lesson look live on the page, not over the board: the board stays
 * fully visible. Title card = headline plus the chapters as an agenda, question =
 * pause riddle with a countdown ring, poll = lettered answers, outro = brand,
 * message and a plain call-to-action.
 */
export function lessonCard(ctx: CanvasRenderingContext2D, frame: Frame, project: StudioProject, assets: Assets, W: number, H: number, u: number): void {
  const st = project.style;
  const a = frame.card.alpha;
  const age = frame.card.age;
  const { x0, maxW, accent, chapters, fy } = lessonPage(ctx, frame, project, W, H, u, a);
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = a;
  const kind = frame.card.kind;
  let y = 170 * u;
  const rise = (delay: number) => easeOut((age - delay) / 0.45);
  const heading = (txt: string, size: number, delay: number, lines = 3) => {
    const fit = fitText(ctx, tokens(txt.replace(/\*/g, "")), maxW, lines, size, (sz) => `400 ${sz}px ${SERIF}`);
    ctx.font = `400 ${fit.size}px ${SERIF}`;
    ctx.fillStyle = INK;
    const k = rise(delay);
    ctx.globalAlpha = a * k;
    for (const line of fit.lines) {
      y += fit.size * 1.06;
      ctx.fillText(line.map((tq, i) => (i && !tq.glue ? " " : "") + tq.word).join(""), x0, y + (1 - k) * 18 * u);
    }
  };
  const body = (txt: string, size: number, delay: number, lines = 3) => {
    if (!txt.trim()) return;
    const fit = fitText(ctx, tokens(txt), maxW, lines, size, (sz) => `450 ${sz}px ${SANS}`, (sz) => `700 ${sz}px ${SANS}`);
    const k = rise(delay);
    ctx.globalAlpha = a * k;
    ctx.font = `450 ${fit.size}px ${SANS}`;
    const space = ctx.measureText(" ").width;
    for (const line of fit.lines) {
      y += fit.size * 1.45;
      let x = x0;
      for (const [i, tk] of line.entries()) {
        x += gap(tk, i, space);
        ctx.font = `${tk.emph ? 700 : 450} ${fit.size}px ${SANS}`;
        const w = ctx.measureText(tk.word).width;
        if (tk.emph) {
          ctx.fillStyle = rgba(st.accent, 0.34);
          ctx.fillRect(x - 5 * u, y - fit.size * 0.84, w + 10 * u, fit.size * 1.08);
        }
        ctx.fillStyle = INK;
        ctx.fillText(tk.word, x, y + (1 - k) * 14 * u);
        x += w;
      }
    }
  };
  const label = (txt: string) => {
    ctx.font = `700 ${19 * u}px ${SANS}`;
    ctx.fillStyle = accent;
    ctx.globalAlpha = a * rise(0);
    ctx.fillText(txt.toUpperCase().split("").join(String.fromCharCode(8202)), x0, y);
  };

  if (kind === "intro") {
    y = 230 * u;
    label(t("{BRAND} erklärt", { BRAND }));
    y += 16 * u;
    heading(frame.title.text, 104 * u, 0.1);
    y += 22 * u;
    body(frame.text.text, 36 * u, 0.4, 2);
    // The agenda: what the video covers, in order. Gives the viewer a map before the first lesson.
    if (chapters.length) {
      y += 54 * u;
      ctx.globalAlpha = a * rise(0.7);
      ctx.fillStyle = RULE;
      ctx.fillRect(x0, y, maxW, 2 * u);
      y += 14 * u;
      chapters.slice(0, 5).forEach((c, i) => {
        const k = rise(0.8 + i * 0.12);
        ctx.globalAlpha = a * k;
        y += 58 * u;
        ctx.font = `700 ${22 * u}px ${SANS}`;
        ctx.fillStyle = accent;
        ctx.fillText(String(i + 1).padStart(2, "0"), x0, y + (1 - k) * 10 * u);
        const size = fitLine(ctx, c.name, maxW - 70 * u, 31 * u, (sz) => `600 ${sz}px ${SANS}`);
        ctx.font = `600 ${size}px ${SANS}`;
        ctx.fillStyle = INK;
        ctx.fillText(c.name, x0 + 62 * u, y + (1 - k) * 10 * u);
        ctx.fillStyle = RULE;
        ctx.fillRect(x0, y + 16 * u, maxW, 1.5 * u);
      });
    }
  } else if (kind === "question" || kind === "poll") {
    y = 230 * u;
    label(kind === "poll" ? t("Du bist dran") : t("Pause: denk mit"));
    y += 16 * u;
    heading(frame.title.text, 78 * u, 0.1, 3);
    if (kind === "poll") {
      const opts = frame.scene.options;
      y += 34 * u;
      opts.forEach((o, i) => {
        const k = rise(0.4 + i * 0.12);
        const colour = POLL_COLOURS[i % POLL_COLOURS.length];
        const m = o.match(/^\s*([A-Za-z])\s*[).:]\s*(.+)$/);
        const letter = m ? m[1].toUpperCase() : String.fromCharCode(65 + i);
        const text = (m ? m[2] : o).trim();
        const rh = 84 * u;
        ctx.globalAlpha = a * k;
        roundRect(ctx, x0, y, maxW, rh, 10 * u);
        ctx.fillStyle = "#fffdf7";
        ctx.fill();
        ctx.strokeStyle = RULE;
        ctx.lineWidth = 2 * u;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x0 + 14 * u + 28 * u, y + rh / 2, 28 * u, 0, Math.PI * 2);
        ctx.fillStyle = colour;
        ctx.fill();
        ctx.fillStyle = "#0a0c11";
        ctx.font = `800 ${28 * u}px ${SANS}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(letter, x0 + 42 * u, y + rh / 2 + 2 * u);
        ctx.textAlign = "left";
        ctx.fillStyle = INK;
        ctx.font = `700 ${36 * u}px ${SANS}`;
        paperMove(ctx, text, x0 + 96 * u, y + rh / 2 + 2 * u, 36 * u, assets, null);
        ctx.textBaseline = "alphabetic";
        y += rh + 14 * u;
      });
    }
    y += 6 * u;
    body(frame.text.text, 36 * u, 0.6, 3);
    if (frame.countdown !== null && frame.countdown > 0) {
      const total = frame.scene.countdown;
      const R = 62 * u;
      const cx = x0 + R;
      const cy = Math.min(fy - 90 * u - R, Math.max(y + 60 * u + R, H * 0.64));
      ctx.globalAlpha = a;
      ctx.lineWidth = 9 * u;
      ctx.strokeStyle = RULE;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * frame.countdown) / total);
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.font = `800 ${64 * u}px ${SANS}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(Math.ceil(frame.countdown)), cx, cy + 4 * u);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = `500 ${24 * u}px ${SANS}`;
      ctx.fillStyle = INK_SOFT;
      ctx.fillText(t("Sekunden zum Überlegen"), cx + R + 28 * u, cy + 8 * u);
    }
  } else {
    // Outro: the recap of every takeaway first (what the viewer learned), then the line and the button.
    const recap = project.scenes.map((sc) => sc.takeaway.trim()).filter(Boolean).slice(0, 5);
    if (recap.length) {
      y = 150 * u;
      label(t("Das nimmst du mit"));
      y += 20 * u;
      recap.forEach((r, i) => {
        const k = rise(0.2 + i * 0.25);
        ctx.globalAlpha = a * k;
        const fit = fitText(ctx, tokens(r), maxW - 76 * u, 2, 32 * u, (sz) => `600 ${sz}px ${SANS}`);
        const top = y + 18 * u;
        ctx.beginPath();
        ctx.arc(x0 + 22 * u, top + 26 * u, 22 * u, 0, Math.PI * 2);
        ctx.fillStyle = INK;
        ctx.fill();
        ctx.fillStyle = PAPER;
        ctx.font = `800 ${22 * u}px ${SANS}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), x0 + 22 * u, top + 27 * u);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.font = `600 ${fit.size}px ${SANS}`;
        ctx.fillStyle = INK;
        fit.lines.forEach((line, j) => ctx.fillText(line.map((tq, m) => (m && !tq.glue ? " " : "") + tq.word).join(""), x0 + 66 * u + (1 - k) * 16 * u, top + 36 * u + j * fit.size * 1.3));
        y = top + 36 * u + (fit.lines.length - 1) * fit.size * 1.3 + 22 * u;
        ctx.fillStyle = RULE;
        ctx.fillRect(x0, y, maxW, 1.5 * u);
      });
      y += 40 * u;
      heading(frame.title.text, 58 * u, 0.3 + recap.length * 0.25, 2);
      y += 10 * u;
      body(frame.text.text, 30 * u, 0.5 + recap.length * 0.25, 2);
    } else {
      y = 210 * u;
      const k = backOut(age / 0.6);
      const size = 96 * u * (0.7 + 0.3 * k);
      ctx.globalAlpha = a;
      if (assets.logo) ctx.drawImage(assets.logo, x0, y, size, size);
      y += size + 36 * u;
      heading(frame.title.text, 78 * u, 0.2, 3);
      y += 20 * u;
      body(frame.text.text, 36 * u, 0.5, 3);
    }
    const bk = easeOut((age - 0.9) / 0.5);
    if (bk > 0) {
      const text = t("Jetzt kostenlos auf {BRAND_DOMAIN}", { BRAND_DOMAIN });
      ctx.font = `700 ${30 * u}px ${SANS}`;
      const bw = Math.min(maxW, ctx.measureText(text).width + 72 * u);
      const bh = 76 * u;
      const by = y + 56 * u + (1 - bk) * 20 * u;
      ctx.globalAlpha = a * bk;
      roundRect(ctx, x0, by, bw, bh, 8 * u);
      ctx.fillStyle = INK;
      ctx.fill();
      ctx.fillStyle = PAPER;
      ctx.textBaseline = "middle";
      ctx.fillText(text, x0 + 36 * u, by + bh / 2 + 2 * u);
    }
  }
  ctx.restore();
  if (project.video.brand && assets.logo) ctx.drawImage(assets.logo, x0, fy - 15 * u, 30 * u, 30 * u);
}
