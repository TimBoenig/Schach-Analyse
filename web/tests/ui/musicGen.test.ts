import { describe, expect, it } from "vitest";

import { measureLufs, normalizeLoudness } from "../../src/ui/studio/loudness";
import { autoStyle, fitBpm, generateMusic, LOOP_FROM, LOOP_LEN, planKey, planMusic, STYLE_IDS, tempoFor, type StyleId } from "../../src/ui/studio/musicGen";
import { fromMoves } from "../../src/ui/studio/model";
import { compile } from "../../src/ui/studio/timeline";

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

describe("long videos", () => {
  // 40 one-move scenes of 3 s: a lesson of two minutes, over LOOP_FROM.
  const long = () => {
    const { project } = fromMoves("l", "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7", undefined, false);
    project.scenes = project.scenes.map((s) => ({ ...s, duration: 6 }));
    return project;
  };

  it("get a short repeating bed instead of a track as long as the video, and editing a scene does not change it", () => {
    const project = long();
    const timeline = compile(project);
    expect(timeline.total).toBeGreaterThan(LOOP_FROM);
    const plan = planMusic(project, timeline, 44100);
    expect(plan.loop).toBe(true);
    expect(plan.duration).toBe(LOOP_LEN);
    expect(plan.cues).toEqual([]);
    // Another text in one scene: same key, so the player keeps the rendered bed instead of rendering minutes of audio again.
    const edited = { ...project, scenes: project.scenes.map((s, i) => (i === 3 ? { ...s, text: "ganz anderer Text", duration: 7 } : s)) };
    expect(planKey(planMusic(edited, compile(edited), 44100))).toBe(planKey(plan));
  });

  it("render a seamless loop of whole bars: finite, the tail of the last bar folded onto the start, no final fade-out", async () => {
    const g = await generateMusic({ ...spec("ambient"), duration: 20, loop: true, bpm: 100 });
    const bar = (60 / 100) * 4;
    expect(g.left.length).toBe(Math.round(Math.round(20 / bar) * bar * RATE));
    expect([...g.left, ...g.right].every(Number.isFinite)).toBe(true);
    // A track would fade out at its end; a loop must keep its level up to the join.
    expect(rms(g.left, 18.2, 19.2)).toBeGreaterThan(rms(g.left, 6, 7) * 0.5);
  }, 60000);
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
