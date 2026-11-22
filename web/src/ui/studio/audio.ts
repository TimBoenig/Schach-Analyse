// The studio's sound: background music, the creator's own voice and optional
// effect sounds (mate hit, swoosh, glitter), all made or played with Web Audio.
// The same mix goes to the speakers in the preview and into the video file.
// Pieces moving make no sound on purpose.
import { duckedVolume, synthLoop, type MusicId } from "./music";
import type { Timeline } from "./timeline";

export interface AudioMix {
  music: MusicId;
  musicVolume: number;
  musicFile: AudioBuffer | null;
  voice: AudioBuffer | null;
  voiceVolume: number;
  effects: boolean;
}

export class StudioAudio {
  readonly ctx: BaseAudioContext;
  /** Feed for the video recorder. */
  readonly stream: MediaStreamAudioDestinationNode | null;
  private out: GainNode;
  private noise: AudioBuffer;
  private live: AudioScheduledSourceNode[] = [];
  private loops = new Map<string, AudioBuffer>();

  /** Pass an OfflineAudioContext to render the whole mix faster than real time (fast export). */
  constructor(ctx?: BaseAudioContext) {
    this.ctx = ctx ?? new AudioContext();
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.9;
    this.stream = this.ctx instanceof AudioContext ? this.ctx.createMediaStreamDestination() : null;
    this.out.connect(this.ctx.destination);
    if (this.stream) this.out.connect(this.stream);
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

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(data);
  }

  private loop(id: Exclude<MusicId, "none" | "file">): AudioBuffer {
    let b = this.loops.get(id);
    if (!b) {
      const pcm = synthLoop(id, this.ctx.sampleRate);
      b = this.ctx.createBuffer(1, pcm.length, this.ctx.sampleRate);
      b.copyToChannel(pcm, 0);
      this.loops.set(id, b);
    }
    return b;
  }

  /** Plays a buffer from video second `from`, starting at context time `now`. */
  private play(buf: AudioBuffer, now: number, from: number, volume: number, loop: boolean, total: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    const g = this.ctx.createGain();
    const rest = total - from;
    g.gain.setValueAtTime(volume, now);
    // Music fades out over the last second of the video.
    if (loop && rest > 1) {
      g.gain.setValueAtTime(volume, now + rest - 1);
      g.gain.linearRampToValueAtTime(0.0001, now + rest);
    }
    src.connect(g).connect(this.out);
    const offset = loop ? from % buf.duration : from;
    if (!loop && offset >= buf.duration) return;
    src.start(now, offset);
    src.stop(now + Math.max(0.05, rest));
    this.live.push(src);
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
        const tk = at + i * 0.06;
        const o = c.createOscillator();
        o.type = "triangle";
        o.frequency.value = 1600 + ((i * 7) % 5) * 380;
        const g = c.createGain();
        g.gain.setValueAtTime(0, tk);
        g.gain.linearRampToValueAtTime(0.09, tk + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, tk + 0.25);
        o.connect(g).connect(this.out);
        o.start(tk);
        o.stop(tk + 0.3);
        this.live.push(o);
      }
    }
  }

  /** Starts the whole mix from video second `from`, now. */
  schedule(timeline: Timeline, from: number, mix: AudioMix): void {
    this.cancel();
    if (this.ctx instanceof AudioContext) void this.ctx.resume();
    const now = this.ctx.currentTime + 0.03;
    const music = mix.music === "file" ? mix.musicFile : mix.music === "none" ? null : this.loop(mix.music);
    if (music && mix.musicVolume > 0) this.play(music, now, from, duckedVolume(mix.musicVolume, !!mix.voice), true, timeline.total);
    if (mix.voice && mix.voiceVolume > 0) this.play(mix.voice, now, from, mix.voiceVolume, false, timeline.total);
    if (!mix.effects) return;
    for (const s of timeline.sounds) {
      if (s.t < from) continue;
      if (s.kind === "boom" || s.kind === "whoosh" || s.kind === "sparkle") this.effect(now + (s.t - from), s.kind);
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
    if (this.ctx instanceof AudioContext) void this.ctx.close();
  }
}
