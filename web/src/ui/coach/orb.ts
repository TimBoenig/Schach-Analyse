// Draws Lucena: a glass sphere with a living neural network inside and two eyes
// that follow the pointer. Plain 2D canvas with hand-made perspective, so it
// needs no 3D library, no WebGL context (pages show several Lucenas at once) and
// costs a fraction of a millisecond per frame.
import { blendLook, buildNet, MOODS, nodeCount, project, rng, rotate, type Mood, type MoodLook, type Net, type Rgb } from "./net";

interface Signal {
  edge: number;
  /** Node the signal started from on this edge. */
  from: number;
  /** Progress along the edge, 0..1. */
  t: number;
}

const rgba = (c: Rgb, alpha: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, alpha))})`;
const mixRgb = (x: Rgb, y: Rgb, k: number): Rgb => [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k];
const WHITE: Rgb = [255, 255, 255];
const INK: Rgb = [6, 8, 16];

// Soft dot of light, drawn once per colour and stamped for every neuron.
const sprites = new Map<string, HTMLCanvasElement>();
function glowSprite(colour: Rgb): HTMLCanvasElement {
  // Colours are rounded so a mood change creates a handful of sprites, not one per frame.
  const key = colour.map((v) => Math.round(v / 8) * 8).join(",");
  let sprite = sprites.get(key);
  if (!sprite) {
    if (sprites.size > 48) sprites.clear();
    sprite = document.createElement("canvas");
    sprite.width = sprite.height = 64;
    const g = sprite.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, rgba(colour, 1));
    grad.addColorStop(0.25, rgba(colour, 0.55));
    grad.addColorStop(1, rgba(colour, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    sprites.set(key, sprite);
  }
  return sprite;
}

// One pointer listener and one animation loop for all avatars on the page.
const pointer = { x: 0, y: 0, at: -1e9 };
const live = new Set<Orb>();
let raf = 0;
let listening = false;

function frame(now: number): void {
  raf = 0;
  let any = false;
  for (const orb of live) {
    if (!orb.visible) continue;
    any = true;
    orb.tick(now);
  }
  if (any && !document.hidden) raf = requestAnimationFrame(frame);
}

function wake(): void {
  if (!raf && live.size && !document.hidden) raf = requestAnimationFrame(frame);
}

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener(
    "pointermove",
    (e) => {
      // A finger on the screen scrolls; only a mouse or pen "points" at something.
      if (e.pointerType === "touch") return;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.at = performance.now();
    },
    { passive: true },
  );
  document.addEventListener("visibilitychange", wake);
}

export class Orb {
  visible = true;
  private ctx: CanvasRenderingContext2D;
  private net: Net;
  private look: MoodLook;
  private mood: Mood;
  private rand = rng(97);
  private signals: Signal[] = [];
  private fire: Float32Array;
  private px = 0;
  private small: boolean;
  private ring: boolean;
  private last = 0;
  private time = 0;
  private yaw = 0.6;
  private gaze: [number, number] = [0, 0];
  private blinkAt = 2.2;
  private blink = 1;
  private smileAt = 0.2;
  private burst = 1;
  private centre = { x: 0, y: 0, at: -1e9 };
  private observer: IntersectionObserver | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private size: number,
    mood: Mood,
    private still: boolean,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.mood = mood;
    this.look = { ...MOODS[mood] };
    this.small = size <= 32;
    this.ring = size >= 72;
    this.net = buildNet(nodeCount(size));
    this.fire = new Float32Array(this.net.nodes.length);
    this.gaze = [...this.look.gaze];
    if (mood === "wow") this.burst = 0;
    this.resize();
    if (still) {
      // Reduced motion: one finished picture, with a few signals caught mid-way.
      this.settle();
      this.draw();
      return;
    }
    listen();
    live.add(this);
    if (typeof IntersectionObserver !== "undefined") {
      this.observer = new IntersectionObserver((entries) => {
        this.visible = entries[entries.length - 1].isIntersecting;
        if (this.visible) wake();
      });
      this.observer.observe(canvas);
    }
    this.draw();
    wake();
  }

  setMood(mood: Mood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    if (this.still) {
      this.look = { ...MOODS[mood] };
      this.gaze = [...this.look.gaze];
      this.draw();
      return;
    }
    // Lucena blinks while his expression changes, and a "wow" sends out a ring.
    this.blinkAt = this.time;
    if (mood === "wow") this.burst = 0;
    if (mood === "happy") this.smileAt = this.time + 0.2;
  }

  destroy(): void {
    live.delete(this);
    this.observer?.disconnect();
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, this.size > 96 ? 2 : 3);
    this.px = Math.round(this.size * dpr);
    this.canvas.width = this.px;
    this.canvas.height = this.px;
  }

  private settle(): void {
    this.syncSignals();
    this.signals.forEach((s, i) => {
      s.t = (i * 0.37) % 1;
      this.fire[s.from] = 0.6;
    });
    this.time = 2.5;
  }

  private syncSignals(): void {
    const want = Math.max(1, Math.round(this.look.signals * (this.small ? 0.3 : this.size <= 60 ? 0.6 : 1)));
    while (this.signals.length < want) {
      const edge = Math.floor(this.rand() * this.net.edges.length);
      this.signals.push({ edge, from: this.net.edges[edge][0], t: this.rand() });
    }
    this.signals.length = want;
  }

  tick(now: number): void {
    if (!this.last) this.last = now;
    const elapsed = now - this.last;
    // Tiny avatars do not need more than 30 pictures a second.
    if (this.small && elapsed < 30) return;
    this.last = now;
    const dt = Math.min(0.05, elapsed / 1000);
    this.time += dt;
    const t = this.time;

    this.look = blendLook(this.look, MOODS[this.mood], 1 - Math.exp(-dt * 5));
    this.yaw += dt * this.look.spin * Math.PI * 2;
    this.burst = Math.min(1, this.burst + dt / 0.9);

    this.syncSignals();
    for (const s of this.signals) {
      s.t += dt * this.look.speed;
      if (s.t < 1) continue;
      const [a, b] = this.net.edges[s.edge];
      const at = s.from === a ? b : a;
      this.fire[at] = 1;
      const options = this.net.links[at];
      let next = options[Math.floor(this.rand() * options.length)];
      // Do not bounce straight back if there is another way on.
      if (next === s.edge && options.length > 1) next = options[(options.indexOf(next) + 1) % options.length];
      s.edge = next;
      s.from = at;
      s.t = 0;
    }
    const fade = Math.exp(-dt * 3.2);
    for (let i = 0; i < this.fire.length; i++) this.fire[i] *= fade;

    // Blink: closed for a moment, every few seconds.
    if (t >= this.blinkAt + 0.18) this.blinkAt = t + 2.4 + this.rand() * 3.6;
    this.blink = t >= this.blinkAt ? 1 - Math.sin(((t - this.blinkAt) / 0.18) * Math.PI) * 0.92 : 1;
    if (this.mood === "happy" && t > this.smileAt + 1.5) this.smileAt = t + 6 + this.rand() * 6;

    // Eyes: towards the pointer while it moves, otherwise where the mood looks, with a little wander.
    let gx = this.look.gaze[0] + Math.sin(t * 0.7) * 0.12;
    let gy = this.look.gaze[1] + Math.sin(t * 0.43 + 1) * 0.08;
    if (now - pointer.at < 2500 && this.mood !== "sad") {
      if (now - this.centre.at > 400) {
        const r = this.canvas.getBoundingClientRect();
        this.centre = { x: r.left + r.width / 2, y: r.top + r.height / 2, at: now };
      }
      const dx = pointer.x - this.centre.x;
      const dy = pointer.y - this.centre.y;
      const reach = Math.max(260, Math.hypot(dx, dy));
      gx = (dx / reach) * 1.1;
      gy = (-dy / reach) * 1.1;
    }
    const follow = 1 - Math.exp(-dt * 7);
    this.gaze[0] += (gx - this.gaze[0]) * follow;
    this.gaze[1] += (gy - this.gaze[1]) * follow;

    this.draw();
  }

  private draw(): void {
    const { ctx, px, look, small } = this;
    const t = this.time;
    const c = px / 2;
    const R = c * (small ? 0.95 : this.ring ? 0.8 : 0.86);
    const a = look.a;
    const b = look.b;
    const g = look.glow;
    const circle = (x: number, y: number, r: number) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
    };

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    ctx.globalCompositeOperation = "source-over";

    // Light the sphere throws around itself.
    if (!small) {
      const halo = ctx.createRadialGradient(c, c, R * 0.8, c, c, c);
      halo.addColorStop(0, rgba(a, 0.42 * g));
      halo.addColorStop(1, rgba(a, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, px, px);
    }

    // Orbit ring, far half: it passes behind the sphere.
    const tilt = -0.36 + Math.sin(t * 0.25) * 0.05;
    const orbit = t * 0.9;
    if (this.ring) this.drawRing(c, R, tilt, orbit, false);

    // Dark glass body, lit from the upper left.
    const body = ctx.createRadialGradient(c - R * 0.32, c - R * 0.4, R * 0.05, c, c, R);
    body.addColorStop(0, rgba(mixRgb(a, INK, 0.58), 1));
    body.addColorStop(0.5, "rgb(13,15,26)");
    body.addColorStop(1, "rgb(3,4,9)");
    circle(c, c, R);
    ctx.fillStyle = body;
    ctx.fill();

    ctx.save();
    circle(c, c, R);
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";

    // Two slow clouds of light inside the glass.
    const cloud = (x: number, y: number, colour: Rgb, alpha: number) => {
      const grad = ctx.createRadialGradient(x, y, 0, x, y, R * 0.95);
      grad.addColorStop(0, rgba(colour, alpha));
      grad.addColorStop(1, rgba(colour, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(c - R, c - R, R * 2, R * 2);
    };
    cloud(c + Math.cos(t * 0.4) * R * 0.34, c + Math.sin(t * 0.52) * R * 0.3, a, 0.26 * g);
    cloud(c - Math.cos(t * 0.33) * R * 0.38, c - Math.sin(t * 0.47) * R * 0.3, b, 0.22 * g);

    // The network. Additive light needs no depth sorting.
    const pitch = 0.3 + Math.sin(t * 0.31) * 0.1;
    const pts = this.net.nodes.map((n) => {
      const r = rotate(n, this.yaw, pitch);
      const p = project(r);
      // 0.3 (far side) .. 1 (near side)
      return { x: c + p.x * R, y: c + p.y * R, s: p.scale, d: 0.3 + 0.7 * (r[2] / 1.4 + 0.5) };
    });
    ctx.lineCap = "round";
    const hair = Math.max(px / this.size, R * 0.016);
    this.net.edges.forEach(([i, j]) => {
      const p = pts[i];
      const q = pts[j];
      const depth = (p.d + q.d) / 2;
      const hot = Math.max(this.fire[i], this.fire[j]);
      ctx.strokeStyle = rgba(mixRgb(b, a, depth), (0.1 + 0.34 * depth + 0.3 * hot) * g);
      ctx.lineWidth = hair * (0.7 + 0.6 * depth);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    });
    const nodeR = R * (small ? 0.07 : 0.032);
    const sprite = glowSprite(a);
    const stamp = (x: number, y: number, r: number, alpha: number) => {
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
    };
    pts.forEach((p, i) => {
      const hot = this.fire[i];
      stamp(p.x, p.y, nodeR * p.s * (4 + hot * 4), (0.45 + 0.55 * hot) * p.d * g);
      ctx.fillStyle = rgba(mixRgb(a, WHITE, 0.35 + 0.65 * hot), (0.55 + 0.45 * hot) * p.d);
      circle(p.x, p.y, nodeR * p.s * (1 + hot * 0.5));
      ctx.fill();
    });
    for (const s of this.signals) {
      const [i, j] = this.net.edges[s.edge];
      const p = pts[s.from];
      const q = pts[s.from === i ? j : i];
      const x = p.x + (q.x - p.x) * s.t;
      const y = p.y + (q.y - p.y) * s.t;
      const depth = p.d + (q.d - p.d) * s.t;
      stamp(x, y, nodeR * 5, 0.9 * depth);
      ctx.fillStyle = rgba(WHITE, 0.95 * depth);
      circle(x, y, nodeR * 0.9);
      ctx.fill();
    }

    this.drawEyes(c, R);
    ctx.restore();

    // Glass: coloured edge light, a rim line and the reflection of a window.
    ctx.globalCompositeOperation = "lighter";
    const rim = ctx.createRadialGradient(c, c, R * 0.62, c, c, R);
    rim.addColorStop(0, rgba(a, 0));
    rim.addColorStop(0.82, rgba(a, 0.12 * g));
    rim.addColorStop(1, rgba(mixRgb(a, WHITE, 0.25), 0.62 * g));
    circle(c, c, R);
    ctx.fillStyle = rim;
    ctx.fill();
    ctx.save();
    ctx.translate(c - R * 0.36, c - R * 0.5);
    ctx.rotate(-0.62);
    ctx.scale(1, 0.46);
    const shine = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.46);
    shine.addColorStop(0, "rgba(255,255,255,0.5)");
    shine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    circle(0, 0, R * 0.46);
    ctx.fill();
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = Math.max(1, px / this.size);
    circle(c, c, R - ctx.lineWidth / 2);
    ctx.stroke();

    if (this.ring) this.drawRing(c, R, tilt, orbit, true);

    // "Wow": a ring of light leaves the sphere once.
    if (this.burst < 1 && !small) {
      const k = 1 - (1 - this.burst) ** 3;
      ctx.strokeStyle = rgba(a, (1 - k) * 0.9);
      ctx.lineWidth = R * 0.08 * (1 - k) + 1;
      circle(c, c, Math.min(c - ctx.lineWidth, R * (1 + 0.22 * k)));
      ctx.stroke();
    }
  }

  /** Half of the tilted orbit (front or back) with its small satellite. */
  private drawRing(c: number, R: number, tilt: number, angle: number, front: boolean): void {
    const { ctx, look } = this;
    const rx = R * 1.2;
    const ry = R * 0.3;
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(tilt);
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = rgba(look.a, (front ? 0.5 : 0.22) * look.glow);
    ctx.lineWidth = Math.max(1, R * 0.014);
    ctx.beginPath();
    // Canvas angles run clockwise with y down: 0..π is the lower, nearer half.
    ctx.ellipse(0, 0, rx, ry, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
    ctx.stroke();
    const near = Math.sin(angle) > 0;
    if (near === front) {
      const x = Math.cos(angle) * rx;
      const y = Math.sin(angle) * ry;
      const size = R * (front ? 0.05 : 0.036);
      ctx.drawImage(glowSprite(look.a), x - size * 4, y - size * 4, size * 8, size * 8);
      ctx.fillStyle = rgba(mixRgb(look.a, WHITE, 0.7), front ? 1 : 0.6);
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawEyes(c: number, R: number): void {
    const { ctx, look } = this;
    const [gx, gy] = this.gaze;
    const ew = R * 0.15 * look.eyeW;
    const eh = Math.max(ew * 0.3, R * 0.33 * look.eyeH * this.blink);
    const smiling = this.mood === "happy" && this.time >= this.smileAt && this.time < this.smileAt + 1.5 && !this.still;
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowColor = rgba(look.a, 0.9);
    ctx.shadowBlur = R * 0.22;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#ffffff";
    for (const side of [-1, 1]) {
      // The eyes sit on the sphere: looking sideways pulls them together.
      const x = c + gx * R * 0.24 + side * R * 0.29 * (1 - 0.18 * Math.abs(gx));
      const y = c - gy * R * 0.2 + R * 0.02;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-side * look.droop);
      ctx.beginPath();
      if (smiling) {
        // Laughing eyes: two arches.
        ctx.lineWidth = ew * 0.72;
        ctx.lineCap = "round";
        ctx.arc(0, ew * 0.75, ew * 1.05, Math.PI * 1.13, Math.PI * 1.87);
        ctx.stroke();
      } else {
        // Capsule from two arcs (roundRect is missing in older Safari).
        const r = Math.min(ew, eh) / 2;
        const straight = eh / 2 - r;
        ctx.arc(0, -straight, r, Math.PI, 0);
        ctx.arc(0, straight, r, 0, Math.PI);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  }
}
