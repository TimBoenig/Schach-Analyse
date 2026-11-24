// Background music made in code (no sound files, so no rights questions): a short
// loop of chords, bass and drums per mood, written straight into PCM samples.
import { t } from "../../i18n";


export type MusicId = "none" | "lofi" | "tension" | "epic" | "beat" | "generated" | "file";

export const MUSIC_LABEL: Record<MusicId, string> = {
  none: t("Keine"),
  lofi: "Lo-fi",
  tension: t("Spannung"),
  epic: t("Episch"),
  beat: "Beat 90",
  generated: t("Passend zum Video"),
  file: t("Eigene Datei"),
};

interface Groove {
  bpm: number;
  /** Chord roots in semitones from A (one chord per bar). */
  roots: number[];
  minor: boolean;
  wave: "sine" | "triangle" | "saw";
  kick: number[];
  hat: number[];
  pad: number;
  bass: number;
}

// 16 steps per bar; 1 = hit.
const GROOVES: Record<Exclude<MusicId, "none" | "file" | "generated">, Groove> = {
  lofi: { bpm: 78, roots: [0, -4, 3, -2], minor: true, wave: "sine", kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0], hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1], pad: 0.16, bass: 0.22 },
  tension: { bpm: 112, roots: [0, 0, 1, -1], minor: true, wave: "saw", kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], hat: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1], pad: 0.08, bass: 0.26 },
  // 90 BPM = one beat every 2/3 s, the grid the reel look cuts on (REEL_BEAT in timeline.ts).
  beat: { bpm: 90, roots: [0, 0, -2, -4], minor: true, wave: "saw", kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1], hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0], pad: 0.07, bass: 0.3 },
  epic: { bpm: 92, roots: [0, -4, -9, -2], minor: true, wave: "triangle", kick: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0], hat: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], pad: 0.2, bass: 0.24 },
};

const hz = (semis: number) => 220 * 2 ** (semis / 12);

function osc(wave: Groove["wave"], phase: number): number {
  const p = phase - Math.floor(phase);
  if (wave === "sine") return Math.sin(2 * Math.PI * p);
  if (wave === "triangle") return 1 - 4 * Math.abs(p - 0.5);
  return 2 * p - 1;
}

/** Length in seconds of one loop (four bars). */
export function loopSeconds(id: Exclude<MusicId, "none" | "file" | "generated">): number {
  return (4 * 4 * 60) / GROOVES[id].bpm;
}

/** One seamless four-bar loop as mono samples in -1..1. */
export function synthLoop(id: Exclude<MusicId, "none" | "file" | "generated">, rate: number): Float32Array<ArrayBuffer> {
  const g = GROOVES[id];
  const n = Math.round(loopSeconds(id) * rate);
  const out = new Float32Array(n);
  const bar = n / 4;
  const step = bar / 16;
  const third = g.minor ? 3 : 4;
  let seed = 11;
  for (let i = 0; i < n; i++) {
    const tk = i / rate;
    const b = Math.floor(i / bar);
    const inBar = (i - b * bar) / bar;
    const root = g.roots[b];
    // Pad: soft triad that swells in and out within each bar, so the loop seam is silent.
    const swell = Math.sin(Math.PI * inBar) ** 2;
    let v = 0;
    for (const iv of [0, third, 7]) v += osc(g.wave === "saw" ? "triangle" : g.wave, hz(root + iv) * tk);
    v *= (g.pad / 3) * swell;
    // Bass on the beats.
    const s = Math.floor(i / step) % 16;
    const inStep = (i % step) / step;
    if (s % 4 === 0) v += osc(g.wave, (hz(root - 24) * (i % (step * 4))) / rate) * g.bass * Math.exp(-inStep * 1.2);
    // Kick: falling sine thump.
    if (g.kick[s]) {
      const kt = (i % step) / rate;
      v += Math.sin(2 * Math.PI * (55 * kt + 60 * (1 - Math.exp(-kt * 30)) / 30)) * Math.exp(-kt * 14) * 0.5;
    }
    // Hi-hat: short noise burst.
    seed = (seed * 16807) % 2147483647;
    if (g.hat[s]) v += ((seed / 2147483647) * 2 - 1) * Math.exp(-((i % step) / rate) * 60) * 0.07;
    out[i] = Math.max(-1, Math.min(1, v));
  }
  return out;
}

/** Music volume under the voice: quieter while someone talks. */
export function duckedVolume(music: number, hasVoice: boolean): number {
  return hasVoice ? music * 0.35 : music;
}
