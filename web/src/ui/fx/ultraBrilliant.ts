// The "ultra" celebration for a brilliant move: a deliberately over-the-top,
// full-screen takeover (shockwaves, light pillar, fireworks, confetti cannons,
// raining pieces and a slammed-in headline). Opt-in via the settings; it is
// drawn imperatively on its own layer so no page layout can clip it.
import { badgeFor } from "../labels";
import "./ultra.css";

export interface UltraOptions {
  /** Viewport position of the square the move landed on. */
  x: number;
  y: number;
  /** Element shaken on impact (the board). */
  shake?: HTMLElement | null;
  /** Fanfare and vibration. */
  sound?: boolean;
  /** The move, e.g. "Txf7". */
  san?: string;
}

/** Seconds until the fade-out starts, and how long that takes. */
const HOLD = 4.3;
const FADE = 0.6;

const QUIPS = [
  "Lucena fällt gerade vom Stuhl.",
  "Die Schachgöttin höchstpersönlich applaudiert.",
  "Dieser Zug gehört in ein Museum.",
  "Bitte einrahmen und an die Wand hängen.",
  "Das Brett bittet um ein Autogramm.",
  "Irgendwo weint ein Springer vor Glück.",
  "Opfer angenommen. Applaus auch.",
  "So spielt man, wenn niemand hinschaut. Nur eben mit Zuschauern.",
];

type Rgb = [number, number, number];
const WHITE: Rgb = [255, 255, 255];
const MINT: Rgb = [170, 255, 244];
const GOLD: Rgb = [255, 209, 102];
const PINK: Rgb = [255, 107, 168];
const VIOLET: Rgb = [146, 126, 255];
const rgb = (c: Rgb) => `rgb(${c[0]},${c[1]},${c[2]})`;
const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** The app's own brilliant colour, so the show matches the badge in every theme. */
function brilliantColor(): Rgb {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--brilliant").trim();
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (!m) return [43, 181, 173];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

interface Particle {
  kind: "spark" | "confetti" | "glyph" | "star";
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: string;
  gravity: number;
  drag: number;
  rot: number;
  spin: number;
  text?: string;
}

interface Wave {
  at: number;
  x: number;
  y: number;
  color: Rgb;
  width: number;
  dur: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
const easeOut = (p: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);
/** 0 → 1 → 0 envelope: rises until `a`, holds, falls from `b` to `c`. */
const envelope = (t: number, a: number, b: number, c: number) => (t < a ? t / a : t < b ? 1 : Math.max(0, 1 - (t - b) / (c - b)));

/** Short synthesized fanfare: impact, rising arpeggio, held chord. */
function fanfare(): () => void {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return () => undefined;
  let ac: AudioContext;
  try {
    ac = new AC();
  } catch {
    return () => undefined;
  }
  const out = ac.createGain();
  out.gain.value = 0.2;
  out.connect(ac.destination);
  const t0 = ac.currentTime + 0.02;
  const tone = (type: OscillatorType, f0: number, f1: number, at: number, dur: number, vol: number) => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0 + at);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + at + dur);
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    o.connect(g).connect(out);
    o.start(t0 + at);
    o.stop(t0 + at + dur + 0.05);
  };
  tone("sine", 170, 38, 0, 0.55, 1);
  [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98].forEach((f, k) => tone("triangle", f, f, 0.12 + k * 0.075, 0.32, 0.5));
  [1046.5, 1318.51, 1567.98, 2093].forEach((f) => tone("triangle", f, f, 0.62, 1.5, 0.3));
  [2637, 3136, 3951, 4186].forEach((f, k) => tone("sine", f, f, 0.8 + k * 0.11, 0.5, 0.12));
  const timer = window.setTimeout(() => void ac.close().catch(() => undefined), 3200);
  return () => {
    window.clearTimeout(timer);
    void ac.close().catch(() => undefined);
  };
}

function buildTitle(san: string | undefined): HTMLElement {
  const title = document.createElement("div");
  title.className = "ultra-title";
  const badge = document.createElement("div");
  badge.className = "ultra-badge";
  const halo = document.createElement("span");
  halo.className = "ultra-halo";
  const img = document.createElement("img");
  img.src = badgeFor("Brilliant") ?? "";
  img.alt = "";
  badge.append(halo, img);
  const word = document.createElement("div");
  word.className = "ultra-word";
  [..."BRILLANT!!"].forEach((ch, k) => {
    const s = document.createElement("span");
    s.textContent = ch;
    if (ch === "!") s.className = "ultra-bang";
    s.style.setProperty("--i", String(k));
    s.style.setProperty("--r", `${rand(-28, 28).toFixed(0)}deg`);
    word.append(s);
  });
  title.append(badge, word);
  if (san) {
    const chip = document.createElement("div");
    chip.className = "ultra-san";
    chip.textContent = `${san}!!`;
    title.append(chip);
  }
  const quip = document.createElement("div");
  quip.className = "ultra-quip";
  quip.textContent = pick(QUIPS);
  title.append(quip);
  return title;
}

/**
 * Starts the celebration and returns a function that ends it early. It also
 * ends itself: after the show, on a click or tap anywhere, and on Escape.
 */
export function playUltraBrilliant(o: UltraOptions): () => void {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const TEAL = brilliantColor();
  const palette = [TEAL, MINT, GOLD, WHITE, PINK, VIOLET];

  const root = document.createElement("div");
  root.className = "ultra-fx";
  root.setAttribute("aria-hidden", "true");
  root.style.setProperty("--ux", `${o.x}px`);
  root.style.setProperty("--uy", `${o.y}px`);
  const dim = document.createElement("div");
  dim.className = "ultra-dim";
  const canvas = document.createElement("canvas");
  const flash = document.createElement("div");
  flash.className = "ultra-flash";
  root.append(dim, canvas, buildTitle(o.san), flash);
  document.body.append(root);

  // Very large screens render at a lower resolution: the show stays smooth and nobody counts pixels in a firework.
  const dpr = Math.max(0.6, Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4.5e6 / (W * H))));
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext("2d");

  // Sizes follow the screen; a phone gets fewer, smaller particles than a desktop.
  const s = Math.max(0.6, Math.min(1.5, Math.min(W, H) / 760));
  const amount = Math.max(0.45, Math.min(1.25, (W * H) / (1280 * 800)));
  const count = (n: number) => Math.round(n * amount);
  const reach = Math.hypot(Math.max(o.x, W - o.x), Math.max(o.y, H - o.y));

  const particles: Particle[] = [];
  const waves: Wave[] = [];

  const burst = (x: number, y: number, n: number, speed: number, colors: Rgb[], life = 1.1) => {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.25 + Math.random() * 0.75) * s;
      particles.push({
        kind: "spark",
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        age: 0,
        life: life * rand(0.6, 1.2),
        size: rand(1.4, 3.4) * s,
        color: rgb(pick(colors)),
        gravity: 260 * s,
        drag: 1.5,
        rot: 0,
        spin: 0,
      });
    }
  };
  const stars = (x: number, y: number, n: number, speed: number) => {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * rand(0.3, 1) * s;
      particles.push({
        kind: "star",
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        age: 0,
        life: rand(1.2, 2.2),
        size: rand(5, 12) * s,
        color: rgb(pick([WHITE, GOLD, MINT])),
        gravity: 40 * s,
        drag: 1.8,
        rot: Math.random() * Math.PI,
        spin: rand(-3, 3),
      });
    }
  };
  const cannon = (x: number, y: number, angle: number, n: number) => {
    for (let k = 0; k < n; k++) {
      const a = angle + rand(-0.38, 0.38);
      const v = rand(650, 1500) * s * Math.max(0.8, Math.min(1.25, H / 800));
      particles.push({
        kind: "confetti",
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        age: 0,
        life: rand(2.4, 3.6),
        size: rand(7, 13) * s,
        color: rgb(pick(palette)),
        gravity: 900 * s,
        drag: 1.1,
        rot: Math.random() * Math.PI * 2,
        spin: rand(-9, 9),
      });
    }
  };
  const rain = (n: number) => {
    for (let k = 0; k < n; k++) {
      particles.push({
        kind: "glyph",
        x: rand(0, W),
        y: rand(-H * 0.5, -30),
        vx: rand(-30, 30),
        vy: rand(260, 520) * s,
        age: 0,
        life: 4,
        size: rand(22, 46) * s,
        color: rgb(pick([TEAL, MINT, GOLD, WHITE])),
        gravity: 120 * s,
        drag: 0,
        rot: rand(-0.5, 0.5),
        spin: rand(-2.2, 2.2),
        text: pick(["!!", "!!", "♛", "♞", "♜", "♝", "♚"]),
      });
    }
  };
  const firework = (x: number, y: number) => {
    const c = pick([TEAL, GOLD, PINK, VIOLET, MINT]);
    waves.push({ at: clock, x, y, color: c, width: 5, dur: 0.7 });
    burst(x, y, count(80), 560, [c, WHITE], 1.3);
    stars(x, y, count(8), 260);
  };

  let clock = 0;
  // The show's score: what happens when, in seconds after the move.
  const script: [number, () => void][] = [
    [
      0,
      () => {
        waves.push({ at: 0, x: o.x, y: o.y, color: WHITE, width: 14, dur: 1.0 });
        waves.push({ at: 0.12, x: o.x, y: o.y, color: TEAL, width: 11, dur: 1.2 });
        waves.push({ at: 0.28, x: o.x, y: o.y, color: GOLD, width: 8, dur: 1.4 });
        burst(o.x, o.y, count(280), 1250, [TEAL, MINT, WHITE, GOLD], 1.2);
        stars(o.x, o.y, count(22), 520);
      },
    ],
    [
      0.55,
      () => {
        cannon(0, H, -Math.PI / 3.2, count(110));
        cannon(W, H, -Math.PI + Math.PI / 3.2, count(110));
      },
    ],
    [0.9, () => rain(count(46))],
    ...[1.0, 1.3, 1.6, 1.9, 2.2, 2.5].map((at): [number, () => void] => [at, () => firework(rand(W * 0.1, W * 0.9), rand(H * 0.1, H * 0.5))]),
    [
      2.85,
      () => {
        // Finale: one more wave from the headline and a golden crown of sparks.
        waves.push({ at: clock, x: W / 2, y: H * 0.44, color: GOLD, width: 12, dur: 1.2 });
        waves.push({ at: clock + 0.1, x: W / 2, y: H * 0.44, color: WHITE, width: 6, dur: 1.3 });
        burst(W / 2, H * 0.44, count(240), 1100, [GOLD, WHITE, TEAL], 1.3);
        stars(W / 2, H * 0.44, count(26), 620);
        cannon(W * 0.5, H, -Math.PI / 2, count(70));
      },
    ],
  ];
  let next = 0;

  const drawRays = (t: number) => {
    if (!ctx) return;
    const a = envelope(t, 0.5, 3.3, HOLD + FADE);
    if (a <= 0) return;
    const R = reach * 1.15;
    for (const [n, speed, color, strength, fill] of [
      [14, 0.22, TEAL, 0.5, 0.42],
      [9, -0.16, GOLD, 0.3, 0.22],
    ] as [number, number, Rgb, number, number][]) {
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.rotate(t * speed);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
      g.addColorStop(0, rgba(color, strength * a));
      g.addColorStop(0.55, rgba(color, strength * 0.25 * a));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      const step = (Math.PI * 2) / n;
      for (let k = 0; k < n; k++) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, R, k * step, k * step + step * fill);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  };

  const drawPillar = (t: number) => {
    if (!ctx) return;
    const a = envelope(t, 0.06, 0.5, 1.7);
    if (a <= 0) return;
    const w = (40 + 150 * (1 - easeOut(t / 1.2))) * s;
    const g = ctx.createLinearGradient(o.x - w, 0, o.x + w, 0);
    g.addColorStop(0, rgba(TEAL, 0));
    g.addColorStop(0.35, rgba(TEAL, 0.55 * a));
    g.addColorStop(0.5, rgba(WHITE, 0.95 * a));
    g.addColorStop(0.65, rgba(TEAL, 0.55 * a));
    g.addColorStop(1, rgba(TEAL, 0));
    ctx.fillStyle = g;
    ctx.fillRect(o.x - w, 0, w * 2, H);
    // The glowing core where the piece landed.
    const core = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, 170 * s);
    core.addColorStop(0, rgba(WHITE, a));
    core.addColorStop(0.3, rgba(MINT, 0.6 * a));
    core.addColorStop(1, rgba(TEAL, 0));
    ctx.fillStyle = core;
    ctx.fillRect(o.x - 170 * s, o.y - 170 * s, 340 * s, 340 * s);
  };

  const drawWaves = (t: number) => {
    if (!ctx) return;
    for (const w of waves) {
      const p = (t - w.at) / w.dur;
      if (p <= 0 || p >= 1) continue;
      ctx.beginPath();
      ctx.arc(w.x, w.y, easeOut(p) * reach, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(w.color, (1 - p) * 0.9);
      ctx.lineWidth = (w.width * (1 - p) + 1) * s;
      ctx.stroke();
    }
  };

  const drawParticles = (dt: number) => {
    if (!ctx) return;
    for (let k = particles.length - 1; k >= 0; k--) {
      const p = particles[k];
      p.age += dt;
      if (p.age >= p.life || p.y > H + 80) {
        particles[k] = particles[particles.length - 1];
        particles.pop();
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy = p.vy * d + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
    ctx.lineCap = "round";
    ctx.globalCompositeOperation = "lighter";
    for (const p of particles) {
      if (p.kind !== "spark") continue;
      ctx.globalAlpha = Math.pow(1 - p.age / p.life, 1.4);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size;
      ctx.beginPath();
      ctx.moveTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    for (const p of particles) {
      if (p.kind !== "star") continue;
      const left = 1 - p.age / p.life;
      ctx.globalAlpha = left * (0.55 + 0.45 * Math.sin(p.age * 18 + p.rot));
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      const r = p.size;
      ctx.beginPath();
      for (let q = 0; q < 8; q++) {
        const rr = q % 2 ? r * 0.28 : r;
        ctx.lineTo(Math.cos((q * Math.PI) / 4) * rr, Math.sin((q * Math.PI) / 4) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const p of particles) {
      if (p.kind !== "confetti" && p.kind !== "glyph") continue;
      ctx.globalAlpha = Math.min(1, (1 - p.age / p.life) * 4);
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.kind === "confetti") {
        // Paper flutters: the piece turns over while it falls.
        ctx.scale(1, Math.cos(p.age * 9 + p.rot));
        ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
      } else {
        ctx.font = `900 ${p.size}px system-ui, sans-serif`;
        ctx.fillText(p.text ?? "", 0, 0);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  };

  let raf = 0;
  let last = performance.now();
  const start = last;
  let ended = false;
  let fadeTimer = 0;
  let stopSound: () => void = () => undefined;

  const cleanup = () => {
    cancelAnimationFrame(raf);
    window.clearTimeout(fadeTimer);
    window.removeEventListener("pointerdown", dismiss, true);
    window.removeEventListener("keydown", onKey, true);
    root.remove();
  };
  const end = (fade: number) => {
    if (ended) return;
    ended = true;
    stopSound();
    root.style.transitionDuration = `${fade}s`;
    root.classList.add("out");
    fadeTimer = window.setTimeout(cleanup, fade * 1000 + 40);
  };
  function dismiss() {
    end(0.22);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") dismiss();
  }

  const frame = (now: number) => {
    // A tab that was in the background must not jump the physics forward in one step.
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock = (now - start) / 1000;
    while (next < script.length && script[next][0] <= clock) script[next++][1]();
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      drawRays(clock);
      drawPillar(clock);
      drawWaves(clock);
      drawParticles(dt);
    }
    if (clock >= HOLD) end(FADE);
    if (clock < HOLD + FADE) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  // Impact: the board itself takes the hit.
  if (o.shake?.animate) {
    const frames: Keyframe[] = [{ transform: "none" }];
    for (let k = 1; k < 12; k++) {
      const amp = 14 * (1 - k / 12);
      frames.push({ transform: `translate(${rand(-amp, amp).toFixed(1)}px, ${rand(-amp, amp).toFixed(1)}px) rotate(${rand(-amp, amp) / 9}deg) scale(${1 + amp / 400})` });
    }
    frames.push({ transform: "none" });
    o.shake.animate(frames, { duration: 680, easing: "linear" });
  }
  if (o.sound) {
    stopSound = fanfare();
    try {
      navigator.vibrate?.([40, 50, 40, 50, 160]);
    } catch {
      // Vibration is a bonus; many browsers refuse it.
    }
  }

  // The click or key that caused the move has already happened; later ones end the show without being swallowed.
  window.addEventListener("pointerdown", dismiss, true);
  window.addEventListener("keydown", onKey, true);

  return () => end(0.18);
}
