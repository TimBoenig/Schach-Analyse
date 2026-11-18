// Move sounds made on the fly with Web Audio (no sound files): a wooden "tock"
// when a piece lands, a sharper one for captures and a bright ping for check.
// The same sounds go to the speakers in the preview and into the video file.
import type { Timeline } from "./timeline";

export class MoveSounds {
  readonly ctx: AudioContext;
  /** Feed for the video recorder. */
  readonly stream: MediaStreamAudioDestinationNode;
  private out: GainNode;
  private noise: AudioBuffer;
  private live: AudioScheduledSourceNode[] = [];

  constructor() {
    this.ctx = new AudioContext();
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.9;
    this.stream = this.ctx.createMediaStreamDestination();
    this.out.connect(this.ctx.destination);
    this.out.connect(this.stream);
    const len = Math.floor(this.ctx.sampleRate * 0.12);
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 7;
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      data[i] = (seed / 2147483647) * 2 - 1;
    }
  }

  /** Mutes the speakers while recording keeps the sound (or the other way round). */
  speakers(on: boolean): void {
    try {
      if (on) this.out.connect(this.ctx.destination);
      else this.out.disconnect(this.ctx.destination);
    } catch {
      // already in that state
    }
  }

  private tock(at: number, kind: "move" | "capture" | "check"): void {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const band = c.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = kind === "capture" ? 1400 : 1900;
    band.Q.value = 1.4;
    const g = c.createGain();
    const peak = kind === "capture" ? 0.95 : 0.6;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, at + (kind === "capture" ? 0.11 : 0.07));
    src.connect(band).connect(g).connect(this.out);
    src.start(at);
    src.stop(at + 0.13);
    const body = c.createOscillator();
    body.frequency.setValueAtTime(kind === "capture" ? 190 : 230, at);
    body.frequency.exponentialRampToValueAtTime(90, at + 0.09);
    const bg = c.createGain();
    bg.gain.setValueAtTime(0, at);
    bg.gain.linearRampToValueAtTime(kind === "capture" ? 0.55 : 0.35, at + 0.004);
    bg.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
    body.connect(bg).connect(this.out);
    body.start(at);
    body.stop(at + 0.14);
    this.live.push(src, body);
    if (kind === "check") {
      const ping = c.createOscillator();
      ping.type = "sine";
      ping.frequency.value = 1320;
      const pg = c.createGain();
      pg.gain.setValueAtTime(0, at + 0.02);
      pg.gain.linearRampToValueAtTime(0.18, at + 0.03);
      pg.gain.exponentialRampToValueAtTime(0.001, at + 0.45);
      ping.connect(pg).connect(this.out);
      ping.start(at + 0.02);
      ping.stop(at + 0.5);
      this.live.push(ping);
    }
  }

  /** Effect sounds: a deep hit for mate, a rising swoosh for zoom and flash, a glitter for confetti. */
  private effect(at: number, kind: "boom" | "whoosh" | "sparkle"): void {
    const c = this.ctx;
    if (kind === "boom") {
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(110, at);
      o.frequency.exponentialRampToValueAtTime(38, at + 0.6);
      const g = c.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.9, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.9);
      o.connect(g).connect(this.out);
      o.start(at);
      o.stop(at + 0.95);
      this.live.push(o);
    }
    if (kind === "boom" || kind === "whoosh") {
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = kind === "boom" ? "lowpass" : "bandpass";
      f.Q.value = 0.8;
      f.frequency.setValueAtTime(kind === "boom" ? 900 : 400, at);
      f.frequency.exponentialRampToValueAtTime(kind === "boom" ? 120 : 3200, at + (kind === "boom" ? 0.5 : 0.35));
      const g = c.createGain();
      const len = kind === "boom" ? 0.7 : 0.4;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(kind === "boom" ? 0.6 : 0.25, at + (kind === "boom" ? 0.01 : 0.25));
      g.gain.exponentialRampToValueAtTime(0.001, at + len);
      src.connect(f).connect(g).connect(this.out);
      src.start(at);
      src.stop(at + len + 0.05);
      this.live.push(src);
    }
    if (kind === "sparkle") {
      for (let i = 0; i < 6; i++) {
        const t = at + i * 0.06;
        const o = c.createOscillator();
        o.type = "triangle";
        o.frequency.value = 1600 + ((i * 7) % 5) * 380;
        const g = c.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.09, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        o.connect(g).connect(this.out);
        o.start(t);
        o.stop(t + 0.3);
        this.live.push(o);
      }
    }
  }

  /** Plans every landing sound from video second `from` on, starting now. */
  schedule(timeline: Timeline, from: number): void {
    this.cancel();
    void this.ctx.resume();
    const now = this.ctx.currentTime + 0.02;
    for (const s of timeline.sounds) {
      if (s.t < from) continue;
      if (s.kind === "boom" || s.kind === "whoosh" || s.kind === "sparkle") this.effect(now + (s.t - from), s.kind);
      else this.tock(now + (s.t - from), s.kind);
    }
  }

  cancel(): void {
    for (const n of this.live) {
      try {
        n.stop();
      } catch {
        // not started yet or already over
      }
    }
    this.live = [];
  }

  close(): void {
    this.cancel();
    void this.ctx.close();
  }
}
