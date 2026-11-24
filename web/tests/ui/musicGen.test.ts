import { describe, expect, it } from "vitest";

import { measureLufs, normalizeLoudness } from "../../src/ui/studio/loudness";
import { autoStyle, fitBpm, generateMusic, STYLE_IDS, tempoFor, type StyleId } from "../../src/ui/studio/musicGen";

const RATE = 16000;
const spec = (style: StyleId, over = {}) => ({ style, seed: 3, intensity: 0.8, duration: 14, rate: RATE, bpm: 90, cues: [], ...over });
const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (a: Float32Array, from: number, to: number) => {
  let e = 0;
  for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i++) e += a[i] * a[i];
  return Math.sqrt(e / ((to - from) * RATE));
};

describe("music generator", () => {
  it("renders every style: exactly the video's length, finite, no clipping, at the music-bed loudness", async () => {
    for (const style of STYLE_IDS) {
      const g = await generateMusic(spec(style));
      expect(g.left.length).toBe(14 * RATE);
      expect([...g.left, ...g.right].every(Number.isFinite)).toBe(true);
      expect(Math.max(peak(g.left), peak(g.right))).toBeLessThanOrEqual(0.9 + 1e-6);
      expect(measureLufs([g.left, g.right], RATE)).toBeGreaterThan(-19);
      expect(measureLufs([g.left, g.right], RATE)).toBeLessThan(-13);
      // Fades out at the end.
      expect(rms(g.left, 13.5, 14)).toBeLessThan(rms(g.left, 6, 7) * 0.5);
    }
  }, 60000);

  it("same seed gives the same music, another seed another variant", async () => {
    const a = await generateMusic(spec("phonk"));
    const b = await generateMusic(spec("phonk"));
    const c = await generateMusic(spec("phonk", { seed: 4 }));
    expect(Array.from(a.left.slice(20000, 20050))).toEqual(Array.from(b.left.slice(20000, 20050)));
    expect(Array.from(a.left.slice(20000, 20050))).not.toEqual(Array.from(c.left.slice(20000, 20050)));
  }, 30000);

  it("puts a drop on the video's hit: breakdown just before, loud hit on it", async () => {
    const g = await generateMusic(spec("phonk", { cues: [{ t: 8, kind: "drop" }] }));
    const quiet = rms(g.left, 8 - 0.9 * (60 / 90), 8 - 0.05);
    const hit = rms(g.left, 8, 8.4);
    expect(hit).toBeGreaterThan(quiet * 2);
  }, 30000);

  it("fits the tempo to the scene changes, fixed on the reel grid, and picks a style for the video", () => {
    expect(fitBpm([72, 84], [0, 8, 16, 24])).toBeGreaterThanOrEqual(72);
    const starts = [0, 6, 12, 18]; // a beat every 1.5 s -> 80 BPM lands exactly
    expect(fitBpm([72, 84], starts)).toBe(80);
    expect(tempoFor("phonk", true, [0, 1.3])).toBe(90);
    expect(autoStyle({ reel: true, lesson: true, hasMate: true })).toBe("phonk");
    expect(autoStyle({ reel: false, lesson: true, hasMate: true })).toBe("ambient");
    expect(autoStyle({ reel: false, lesson: false, hasMate: true })).toBe("epic");
    expect(autoStyle({ reel: false, lesson: false, hasMate: false })).toBe("chill");
  });
});

describe("loudness", () => {
  it("brings a tone to the target and never past the ceiling", () => {
    const n = 48000 * 4;
    const tone = (amp: number) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / 48000));
    const quiet = [tone(0.15), tone(0.15)];
    normalizeLoudness(quiet, 48000, -14);
    expect(measureLufs(quiet, 48000)).toBeCloseTo(-14, 0);
    const hot = [tone(0.9), tone(0.9)];
    normalizeLoudness(hot, 48000, -14, { ceilingDb: -1 });
    expect(peak(hot[0])).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-6);
    expect(measureLufs([new Float32Array(48000), new Float32Array(48000)], 48000)).toBe(-Infinity);
  });
});
