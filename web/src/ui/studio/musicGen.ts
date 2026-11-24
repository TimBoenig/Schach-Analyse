// The studio's music generator: writes a whole soundtrack for one video, in
// stereo, from nothing but maths (no samples, no files, so no rights questions).
// The style, a seed (for variants), an intensity and the video's own moments
// decide what is played:
//  - the tempo follows the video (90 BPM on the reel grid, otherwise the tempo of
//    the style's range that puts the scene changes closest to a beat),
//  - hits in the video (mate, hit-stop, invert) get a riser before them, a short
//    breakdown and a drop with impact and 808 on them,
//  - the track is exactly as long as the video and ends on a fade or a ring-out.
// Loudness is brought to a music-bed level here; the export evens out the whole
// mix to -14 LUFS (loudness.ts).
import { t } from "../../i18n";
import { measureLufs, limit } from "./loudness";
import type { StudioProject } from "./model";
import type { Timeline } from "./timeline";

export type StyleId = "chill" | "ambient" | "phonk" | "epic" | "thriller";
export const STYLE_IDS: StyleId[] = ["chill", "ambient", "phonk", "epic", "thriller"];

export const STYLE_LABEL: Record<StyleId, string> = {
  chill: "Lo-fi Chill",
  ambient: "Ambient",
  phonk: "Phonk",
  epic: t("Episch"),
  thriller: "Thriller",
};

export const STYLE_HINT: Record<StyleId, string> = {
  chill: t("Warme E-Piano-Akkorde und weicher Beat. Für entspannte Eröffnungsvideos auf Instagram."),
  ambient: t("Ruhige Flächen und sanfte Glocken ohne Schlagzeug. Für lange YouTube-Lektionen, die Stimme bleibt klar."),
  phonk: t("Dunkler 808-Bass, Cowbell, harte Drops. Für schnelle Edits, TikTok und Reels."),
  epic: t("Pauken, Streicher und große Schläge. Für Meisterpartien und Matt-Finale."),
  thriller: t("Treibender Puls und Spannung. Für Fallen und Matt-Rätsel."),
};

export interface Cue {
  t: number;
  /** "mate" ends the video on a ring-out, "drop" is any other hard hit. */
  kind: "drop" | "mate";
}

export interface GenSpec {
  style: StyleId;
  seed: number;
  /** 0 = calm, 1 = full. */
  intensity: number;
  duration: number;
  rate: number;
  /** Fixed tempo (the reel grid); otherwise it is fitted from `sceneStarts`. */
  bpm?: number;
  sceneStarts?: number[];
  cues: Cue[];
}

interface Look {
  bpm: [number, number];
  /** Chord progressions: root semitones from the key and chord quality, one chord per bar. */
  progressions: [number, Quality][][];
  reverb: number;
  swing: number;
}
type Quality = "min7" | "maj7" | "min" | "maj" | "sus";
const CHORD: Record<Quality, number[]> = { min7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], min: [0, 3, 7], maj: [0, 4, 7], sus: [0, 5, 7] };

const LOOKS: Record<StyleId, Look> = {
  chill: {
    bpm: [72, 84],
    progressions: [
      [[0, "min7"], [5, "maj7"], [3, "maj7"], [7, "min7"]],
      [[0, "min7"], [-2, "maj7"], [-4, "maj7"], [-5, "min7"]],
      [[5, "maj7"], [3, "maj7"], [0, "min7"], [7, "sus"]],
    ],
    reverb: 0.3,
    swing: 0.12,
  },
  ambient: {
    bpm: [60, 72],
    progressions: [
      [[0, "min7"], [-4, "maj7"], [-2, "maj7"], [-5, "min7"]],
      [[0, "sus"], [5, "maj7"], [3, "maj7"], [-2, "sus"]],
    ],
    reverb: 0.6,
    swing: 0,
  },
  phonk: {
    bpm: [126, 144],
    progressions: [
      [[0, "min"], [0, "min"], [-2, "maj"], [-4, "maj"]],
      [[0, "min"], [-4, "maj"], [-2, "maj"], [-5, "min"]],
      [[0, "min"], [1, "maj"], [0, "min"], [-2, "maj"]],
    ],
    reverb: 0.18,
    swing: 0,
  },
  epic: {
    bpm: [84, 100],
    progressions: [
      [[0, "min"], [-4, "maj"], [-9, "maj"], [-2, "maj"]],
      [[0, "min"], [-2, "maj"], [-4, "maj"], [-5, "min"]],
    ],
    reverb: 0.4,
    swing: 0,
  },
  thriller: {
    bpm: [100, 118],
    progressions: [
      [[0, "min"], [0, "min"], [1, "maj"], [-1, "maj"]],
      [[0, "min"], [-1, "maj"], [0, "min"], [1, "maj"]],
    ],
    reverb: 0.3,
    swing: 0,
  },
};

/** The style that fits a video: reel edits get phonk, long lessons ambient, a mate finale epic, the rest chill. */
export function autoStyle(v: { reel: boolean; lesson: boolean; hasMate: boolean }): StyleId {
  if (v.reel) return "phonk";
  if (v.lesson) return "ambient";
  if (v.hasMate) return "epic";
  return "chill";
}

/** Hard moments of the video: mate (rings out) and hit-stop / invert impacts. */
export function musicCues(timeline: Timeline): Cue[] {
  const cues: Cue[] = [];
  for (const c of timeline.scenes) {
    if (c.mate) cues.push({ t: c.start + c.fxAt + 0.85, kind: "mate" });
    else if (c.hit !== null || c.scene.effects.includes("invert")) cues.push({ t: c.start + c.fxAt, kind: "drop" });
  }
  cues.sort((a, b) => a.t - b.t);
  // Two hits within a second are one drop.
  return cues.filter((c, i) => i === 0 || c.t - cues[i - 1].t > 1);
}

/** The tempo of the range whose beat grid lies closest to the scene starts (ties go to the middle). */
export function fitBpm(range: [number, number], starts: number[]): number {
  let best = Math.round((range[0] + range[1]) / 2);
  let bestScore = Infinity;
  for (let bpm = range[0]; bpm <= range[1]; bpm++) {
    const beat = 60 / bpm;
    let score = 0;
    for (const s of starts) {
      const k = s / beat;
      score += Math.abs(k - Math.round(k));
    }
    score += Math.abs(bpm - (range[0] + range[1]) / 2) * 1e-3;
    if (score < bestScore) {
      bestScore = score;
      best = bpm;
    }
  }
  return best;
}

/** Everything the generator needs for this project: style (auto or chosen), tempo, cues, length. */
export function planMusic(project: StudioProject, timeline: Timeline, rate: number): GenSpec & { auto: boolean } {
  const v = project.video;
  const reel = project.style.view === "reel";
  const chosen = v.musicStyle;
  const auto = chosen === "auto";
  const style = chosen === "auto" ? autoStyle({ reel, lesson: v.lesson, hasMate: timeline.scenes.some((c) => c.mate) }) : chosen;
  const sceneStarts = timeline.scenes.map((c) => c.start);
  return { style, seed: v.musicSeed, intensity: v.musicIntensity, duration: timeline.total, rate, bpm: tempoFor(style, reel, sceneStarts), sceneStarts, cues: musicCues(timeline), auto };
}

/** Same plan, same music: the key under which a rendered track is kept. */
export const planKey = (s: GenSpec): string => JSON.stringify([s.style, s.seed, s.intensity, Math.round(s.duration * 100), s.bpm, s.cues.map((c) => [Math.round(c.t * 100), c.kind])]);

export function tempoFor(style: StyleId, reel: boolean, sceneStarts: number[]): number {
  return reel ? 90 : fitBpm(LOOKS[style].bpm, sceneStarts);
}

function rng(seed: number): () => number {
  let a = (seed | 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const hz = (semis: number) => 55 * 2 ** (semis / 12);

class Bus {
  l: Float32Array;
  r: Float32Array;
  constructor(n: number) {
    this.l = new Float32Array(n);
    this.r = new Float32Array(n);
  }
}

/** Renders one voice at a time into the buses. */
class Mixer {
  readonly n: number;
  drums: Bus;
  bed: Bus;
  send: Float32Array;
  kicks: number[] = [];
  constructor(
    readonly rate: number,
    seconds: number,
  ) {
    this.n = Math.round(seconds * rate);
    this.drums = new Bus(this.n);
    this.bed = new Bus(this.n);
    this.send = new Float32Array(this.n);
  }

  private put(bus: Bus, t0: number, len: number, pan: number, wet: number, f: (tt: number, i: number) => number): void {
    const s0 = Math.round(t0 * this.rate);
    const m = Math.min(this.n - s0, Math.round(len * this.rate));
    const gl = Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = Math.sin(((pan + 1) * Math.PI) / 4);
    for (let i = 0; i < m; i++) {
      const v = f(i / this.rate, i);
      const k = s0 + i;
      if (k < 0) continue;
      bus.l[k] += v * gl;
      bus.r[k] += v * gr;
      this.send[k] += v * wet;
    }
  }

  kick(t0: number, vel: number): void {
    this.kicks.push(t0);
    let ph = 0;
    this.put(this.drums, t0, 0.4, 0, 0, (tt) => {
      ph += (TAU * (46 + 120 * Math.exp(-tt * 38))) / this.rate;
      return Math.tanh(1.6 * Math.sin(ph) * Math.exp(-tt * 8)) * vel * 0.9 + (tt < 0.003 ? (Math.sin(tt * 9000) * (0.003 - tt)) * 100 * vel : 0);
    });
  }

  /** Long sine bass with a slide, driven into soft clipping (the 808). */
  sub(t0: number, len: number, f0: number, vel: number, slide = 1): void {
    let ph = 0;
    this.put(this.drums, t0, len + 0.05, 0, 0, (tt) => {
      const f = f0 * (1 + (slide - 1) * Math.exp(-tt * 9));
      ph += (TAU * f) / this.rate;
      const env = Math.min(1, tt / 0.004) * Math.exp(-tt * (2.4 / Math.max(0.3, len))) * Math.min(1, (len - tt) / 0.05 + 0.0001);
      return Math.tanh(2.4 * Math.sin(ph)) * env * vel * 0.55;
    });
  }

  noise = (() => {
    const next = rng(99);
    return () => next() * 2 - 1;
  })();

  snare(t0: number, vel: number, pan = 0): void {
    let lp = 0;
    let ph = 0;
    this.put(this.drums, t0, 0.3, pan, 0.25, (tt) => {
      lp += (this.noise() - lp) * 0.55;
      ph += (TAU * 190) / this.rate;
      return (lp * Math.exp(-tt * 20) * 0.8 + Math.sin(ph) * Math.exp(-tt * 28) * 0.45) * vel;
    });
  }

  clap(t0: number, vel: number): void {
    let lp = 0;
    this.put(this.drums, t0, 0.32, 0, 0.35, (tt) => {
      lp += (this.noise() - lp) * 0.4;
      const burst = [0, 0.012, 0.024].reduce((a, o) => (tt >= o ? Math.max(a, Math.exp(-(tt - o) * 90)) : a), 0);
      return lp * (burst * 0.6 + Math.exp(-tt * 16) * 0.5) * vel;
    });
  }

  hat(t0: number, vel: number, open = false, pan = 0): void {
    let prev = 0;
    this.put(this.drums, t0, open ? 0.25 : 0.06, pan, 0.05, (tt) => {
      const n = this.noise();
      const hp = n - prev;
      prev = n;
      return hp * Math.exp(-tt * (open ? 16 : 75)) * vel * 0.28;
    });
  }

  cowbell(t0: number, f: number, vel: number): void {
    let p1 = 0;
    let p2 = 0;
    let lp = 0;
    this.put(this.drums, t0, 0.3, 0.15, 0.2, (tt) => {
      p1 += (TAU * f) / this.rate;
      p2 += (TAU * f * 1.4983) / this.rate;
      const sq = Math.sign(Math.sin(p1)) + Math.sign(Math.sin(p2));
      lp += (sq - lp) * 0.28;
      return lp * Math.exp(-tt * 13) * vel * 0.2;
    });
  }

  tom(t0: number, f: number, vel: number, pan = 0): void {
    let ph = 0;
    this.put(this.drums, t0, 0.7, pan, 0.4, (tt) => {
      ph += (TAU * f * (1 + 0.8 * Math.exp(-tt * 14))) / this.rate;
      return (Math.sin(ph) * Math.exp(-tt * 4.5) + this.noise() * Math.exp(-tt * 60) * 0.3) * vel * 0.7;
    });
  }

  /** Detuned saw ensemble through a one-pole low-pass: pads and strings. */
  pad(t0: number, len: number, freqs: number[], vel: number, bright: number, attack: number): void {
    for (const side of [-1, 1]) {
      freqs.forEach((f, ni) => {
        const phs = [0, 0.33, 0.66];
        let lp = 0;
        const dets = [1 - 0.004, 1, 1 + 0.004].map((d) => d * (1 + side * 0.0015));
        const a = 1 - Math.exp((-TAU * (500 + 2600 * bright)) / this.rate);
        const pan = side * 0.7;
        const gl = Math.cos(((pan + 1) * Math.PI) / 4);
        const gr = Math.sin(((pan + 1) * Math.PI) / 4);
        const s0 = Math.round(t0 * this.rate);
        const m = Math.min(this.n - s0, Math.round((len + 1) * this.rate));
        for (let i = 0; i < m; i++) {
          const tt = i / this.rate;
          let v = 0;
          for (let k = 0; k < 3; k++) {
            phs[k] = (phs[k] + (f * dets[k]) / this.rate) % 1;
            v += 2 * phs[k] - 1;
          }
          lp += (v / 3 - lp) * a;
          const env = Math.min(1, tt / attack) * (tt < len ? 1 : Math.max(0, 1 - (tt - len) / 1));
          const o = lp * env * vel * 0.07 * (ni === 0 ? 1.3 : 1);
          this.bed.l[s0 + i] += o * gl;
          this.bed.r[s0 + i] += o * gr;
          this.send[s0 + i] += o * 0.3;
        }
      });
    }
  }

  /** Electric-piano or bell tone: sine plus decaying overtones. */
  keys(t0: number, len: number, f: number, vel: number, pan: number, bell = false): void {
    let p = 0;
    const tail = bell ? 3.2 : 1.7;
    this.put(this.bed, t0, len, pan, bell ? 0.8 : 0.35, (tt) => {
      p += (TAU * f) / this.rate;
      const o2 = Math.sin(2 * p) * 0.4 * Math.exp(-tt * 6);
      const o3 = bell ? Math.sin(2.76 * p) * 0.3 * Math.exp(-tt * 4) : Math.sin(4 * p) * 0.14 * Math.exp(-tt * 9);
      const trem = bell ? 1 : 1 + 0.08 * Math.sin(tt * 38);
      return (Math.sin(p) + o2 + o3) * Math.min(1, tt / 0.006) * Math.exp(-tt * tail) * trem * vel * 0.2;
    });
  }

  /** Saw bass pulse for the thriller. */
  pulse(t0: number, len: number, f: number, vel: number): void {
    let ph = 0;
    let lp = 0;
    this.put(this.drums, t0, len, 0, 0.02, (tt) => {
      ph = (ph + f / this.rate) % 1;
      lp += ((2 * ph - 1) - lp) * 0.07;
      return lp * Math.min(1, tt / 0.004) * Math.exp(-tt * (3 / len)) * vel * 0.5;
    });
  }

  /** Rising noise and sine sweep leading into a hit. */
  riser(t0: number, t1: number, vel: number): void {
    const len = t1 - t0;
    let ph = 0;
    let lp = 0;
    this.put(this.bed, t0, len, 0, 0.3, (tt) => {
      const k = tt / len;
      lp += (this.noise() - lp) * (0.02 + 0.8 * k * k);
      ph += (TAU * (180 * 2 ** (k * 3.2))) / this.rate;
      return (lp * 1.6 + Math.sin(ph) * 0.25) * k * k * vel * 0.5;
    });
  }

  /** Big hit: sub boom, noise burst, long tail. */
  impact(t0: number, vel: number): void {
    let ph = 0;
    let lp = 0;
    this.put(this.drums, t0, 2.2, 0, 0.5, (tt) => {
      ph += (TAU * (30 + 60 * Math.exp(-tt * 5))) / this.rate;
      lp += (this.noise() - lp) * 0.25;
      return (Math.tanh(1.8 * Math.sin(ph)) * Math.exp(-tt * 2.1) * 0.8 + lp * Math.exp(-tt * 5) * 0.7) * vel;
    });
  }

  /** Vinyl dust for the chill style: hiss and sparse crackles. */
  vinyl(vel: number, next: () => number): void {
    let lp = 0;
    for (let i = 0; i < this.n; i++) {
      lp += (this.noise() - lp) * 0.3;
      const click = next() < 0.00018 ? (next() * 2 - 1) * 0.8 : 0;
      const v = (lp * 0.004 + click * 0.02) * vel;
      this.bed.l[i] += v;
      this.bed.r[i] += v * 0.9;
    }
  }
}

/** Schroeder reverb of the send bus, returned as a stereo pair. */
function reverb(send: Float32Array, rate: number, fb: number): Bus {
  const out = new Bus(send.length);
  const scale = rate / 44100;
  const channel = (target: Float32Array, spread: number) => {
    for (const d of [1557, 1617, 1491, 1422]) {
      const len = Math.round((d + spread) * scale);
      const buf = new Float32Array(len);
      let idx = 0;
      let damp = 0;
      for (let i = 0; i < send.length; i++) {
        const y = buf[idx];
        damp += (y - damp) * 0.35;
        buf[idx] = send[i] + damp * fb;
        idx = (idx + 1) % len;
        target[i] += y * 0.25;
      }
    }
    for (const d of [225, 556]) {
      const len = Math.round((d + spread / 3) * scale);
      const buf = new Float32Array(len);
      let idx = 0;
      for (let i = 0; i < send.length; i++) {
        const x = target[i];
        const y = buf[idx];
        buf[idx] = x + y * 0.5;
        target[i] = y - x * 0.5;
        idx = (idx + 1) % len;
      }
    }
  };
  channel(out.l, 0);
  channel(out.r, 23);
  return out;
}

const SECTION_YIELD = 0.5; // seconds of music per slice before the page may breathe

export interface Generated {
  left: Float32Array;
  right: Float32Array;
  bpm: number;
}

export async function generateMusic(spec: GenSpec): Promise<Generated> {
  const { style, rate, duration } = spec;
  const look = LOOKS[style];
  const rand = rng(spec.seed * 7919 + STYLE_IDS.indexOf(style) * 104729 + 17);
  const bpm = spec.bpm ?? fitBpm(look.bpm, spec.sceneStarts ?? []);
  const beat = 60 / bpm;
  const step = beat / 4;
  const bar = beat * 4;
  const intensity = Math.max(0, Math.min(1, spec.intensity));
  const key = Math.floor(rand() * 8) - 3;
  const prog = look.progressions[Math.floor(rand() * look.progressions.length)];
  const cues = spec.cues.filter((c) => c.t > 0.5 && c.t < duration);
  const mx = new Mixer(rate, duration + 2.5);
  const slice = Math.max(1, Math.round(SECTION_YIELD / bar));
  const bars = Math.ceil(duration / bar);

  // Energy 0..1 per moment: the intensity as base, a dip in the breakdown, a surge after each drop.
  const baseEnergy = 0.3 + 0.6 * intensity;
  const energyAt = (tk: number): number => {
    let e = baseEnergy;
    if (style !== "ambient" && tk < 2 * bar) e *= 0.6 + 0.2 * (tk / (2 * bar));
    for (const c of cues) {
      const since = tk - c.t;
      if (since >= 0 && since < 6 * beat) e = Math.min(1, e + 0.4 * (1 - since / (6 * beat)));
    }
    return e;
  };
  /** True during the beat and a half before a drop, when drums and bass drop out. */
  const breakdown = (tk: number): boolean => cues.some((c) => tk > c.t - 1.5 * beat && tk < c.t - 0.02);
  const hasLead = (c: Cue, prev: number) => c.t - prev > 3 * beat;
  const slideOf = (b: number) => (b % 4 === 3 ? 0.6 : 1);

  for (let b = 0; b < bars; b++) {
    const t0 = b * bar;
    const [rootSemi, quality] = prog[b % prog.length];
    const root = key + rootSemi;
    const tones = CHORD[quality].map((iv) => hz(root + iv + 24));
    const e0 = energyAt(t0);
    const long = style === "ambient" || style === "epic";
    // Harmony: held pad every bar (ambient and epic hold it two bars), keys comp for chill.
    if (long ? b % 2 === 0 : true) mx.pad(t0, long ? 2 * bar : bar, tones, (style === "ambient" ? 1.1 : 0.8) * (0.55 + 0.45 * e0), style === "epic" ? 0.9 : style === "phonk" ? 0.25 : 0.5, style === "ambient" ? 1.4 : style === "epic" ? 0.7 : 0.25);
    if (style === "chill") {
      const hits = [0, 6, 10, 13];
      hits.forEach((st, hi) => {
        const tk = t0 + st * step + (st % 4 === 2 ? look.swing * step : 0);
        if (tk >= duration) return;
        tones.slice(0, 4).forEach((f, ni) => mx.keys(tk + ni * 0.012, beat * 1.5, f * 0.5, (hi === 0 ? 0.9 : 0.55) * (0.7 + 0.3 * e0), -0.3 + ni * 0.2));
      });
      // A sparse melody note from the chord, different with every seed.
      if (rand() < 0.7) mx.keys(t0 + (2 + Math.floor(rand() * 3) * 4) * step, beat * 2, tones[Math.floor(rand() * tones.length)], 0.5, 0.35);
    }
    if (style === "ambient") {
      const notes = 3 + Math.floor(rand() * 3);
      for (let k = 0; k < notes; k++) {
        const tk = t0 + (k / notes) * bar + rand() * beat * 0.5;
        if (tk < duration) mx.keys(tk, beat * 3, tones[Math.floor(rand() * tones.length)] * 2, 0.5 * (0.5 + 0.5 * e0), rand() * 1.2 - 0.6, true);
      }
      if (b % 2 === 0) mx.sub(t0, bar * 2, hz(root + 12), 0.5 * (0.6 + 0.4 * e0), 1);
    }
    for (let s = 0; s < 16; s++) {
      const tk = t0 + s * step + (s % 2 === 1 ? look.swing * step : 0);
      if (tk >= duration - 0.02) break;
      const e = energyAt(tk);
      const gap = breakdown(tk);
      const vel = 0.55 + 0.45 * e;
      const down = s % 4 === 0;
      if (style === "chill") {
        if (!gap && (s === 0 || s === 10) && e > 0.3) mx.kick(tk, vel * 0.8);
        if (!gap && s === 8 && e > 0.3) mx.snare(tk, vel * 0.5, 0.1);
        if (!gap && s % 2 === 0 && e > 0.4) mx.hat(tk, (s % 4 === 2 ? 0.7 : 0.45) * vel, false, 0.2);
        if (s === 0 && e > 0.5) mx.sub(tk, beat * 1.6, hz(root + 12), 0.5 * vel, 1);
      } else if (style === "phonk") {
        const kickSteps = b % 2 === 0 ? [0, 6, 10] : [0, 3, 6, 11];
        if (!gap && e > 0.3 && kickSteps.includes(s)) {
          mx.kick(tk, vel);
          if (e > 0.4) mx.sub(tk, step * (s === 10 || s === 11 ? 5 : 3), hz(root + 12) * (s === 6 ? 1.5 : 1), vel, slideOf(b));
        }
        if (!gap && e > 0.35 && s === 8) mx.clap(tk, vel);
        if (!gap && e > 0.45) {
          mx.hat(tk, (s % 2 === 0 ? 0.75 : 0.4) * vel, false, s % 4 < 2 ? -0.2 : 0.2);
          // Hi-hat roll on the last beat of every second bar when it is loud enough.
          if (e > 0.7 && b % 2 === 1 && s >= 12 && s % 2 === 1) mx.hat(tk + step / 2, 0.5 * vel);
        }
        if (!gap && e > 0.6 && [0, 3, 6, 10, 12, 14].includes(s)) mx.cowbell(tk, s % 6 === 0 ? 545 : 815, vel);
        if (!gap && e > 0.8 && s === 15) mx.hat(tk, 0.8 * vel, true);
      } else if (style === "epic") {
        if (!gap && e > 0.3 && (s === 0 || s === 8)) mx.tom(tk, s === 0 ? 62 : 74, vel, s === 0 ? -0.15 : 0.15);
        if (!gap && e > 0.6 && (s === 4 || s === 12)) mx.tom(tk, 95, vel * 0.55, 0);
        if (!gap && e > 0.8 && s >= 12 && s % 2 === 0) mx.snare(tk, 0.5 * vel * (s / 16));
        if (s === 0 && e > 0.55 && b % 2 === 0) mx.impact(tk, 0.45 * vel);
      } else if (style === "thriller") {
        if (!gap && e > 0.3 && s % 2 === 0) mx.pulse(tk, step * 1.8, hz(root + 12 + (s % 8 === 6 ? 7 : 0)), vel * (down ? 1 : 0.7));
        if (!gap && e > 0.35 && (s === 0 || s === 8)) mx.kick(tk, vel * 0.9);
        if (!gap && e > 0.5 && s % 2 === 1) mx.hat(tk, 0.35 * vel, false, s % 4 === 1 ? -0.3 : 0.3);
        if (e > 0.6 && s === 4 && b % 2 === 0) mx.snare(tk, 0.5 * vel);
      }
    }
    if (b % slice === slice - 1) await new Promise((r) => setTimeout(r, 0));
  }

  // The video's hard moments: riser before, hit on them.
  let prev = 0;
  for (const c of cues) {
    if (hasLead(c, prev)) mx.riser(Math.max(prev + 0.1, c.t - Math.min(4 * beat, c.t - prev - 0.1)), c.t, 0.5 + 0.5 * intensity);
    mx.impact(c.t, c.kind === "mate" ? 1 : 0.8);
    mx.kick(c.t, 1);
    mx.sub(c.t, beat * (c.kind === "mate" ? 3 : 1.5), hz(key + 12), 0.9, 1.4);
    if (style !== "chill" && style !== "ambient") mx.snare(c.t, 0.7);
    prev = c.t;
  }

  const wet = reverb(mx.send, rate, 0.6 + look.reverb * 0.35);
  const n = Math.round(duration * rate);
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  // Sidechain: pads and keys dip for a moment at every kick.
  const duck = new Float32Array(n).fill(1);
  const depth = style === "ambient" ? 0.1 : 0.45;
  for (const k of mx.kicks) {
    const s0 = Math.round(k * rate);
    for (let i = 0; i < 0.3 * rate && s0 + i < n; i++) {
      const d = 1 - depth * Math.exp(-i / (0.09 * rate));
      if (d < duck[s0 + i]) duck[s0 + i] = d;
    }
  }
  const fadeStart = duration - (cues.some((c) => c.kind === "mate" && c.t > duration - 3) ? 1.6 : 1.2);
  for (let i = 0; i < n; i++) {
    const tk = i / rate;
    const fade = tk > fadeStart ? Math.cos(((tk - fadeStart) / (duration - fadeStart)) * (Math.PI / 2)) ** 2 : 1;
    const g = duck[i] * fade;
    const fadeOnly = fade;
    outL[i] = Math.tanh((mx.drums.l[i] * fadeOnly + mx.bed.l[i] * g) * 1.1 + wet.l[i] * look.reverb * fade);
    outR[i] = Math.tanh((mx.drums.r[i] * fadeOnly + mx.bed.r[i] * g) * 1.1 + wet.r[i] * look.reverb * fade);
  }
  if (style === "chill") {
    const dust = new Mixer(rate, duration);
    dust.vinyl(1, rand);
    for (let i = 0; i < n; i++) {
      outL[i] += dust.bed.l[i];
      outR[i] += dust.bed.r[i];
    }
  }
  // Tame the top end: noise hats and square cowbells are very bright (lo-fi is darkest, as it should be).
  const cutoff = style === "chill" ? 5500 : style === "ambient" ? 9000 : 13000;
  const lpA = 1 - Math.exp((-TAU * cutoff) / rate);
  for (const ch of [outL, outR]) {
    let y = 0;
    for (let i = 0; i < n; i++) {
      y += (ch[i] - y) * lpA;
      ch[i] = y;
    }
  }
  // Music-bed level: -16 LUFS before the volume slider, peaks under -1 dB.
  const lufs = measureLufs([outL, outR], rate);
  if (Number.isFinite(lufs)) {
    const gain = 10 ** ((-16 - lufs) / 20);
    for (let i = 0; i < n; i++) {
      outL[i] *= gain;
      outR[i] *= gain;
    }
  }
  limit([outL, outR], rate, -1);
  return { left: outL, right: outR, bpm };
}
