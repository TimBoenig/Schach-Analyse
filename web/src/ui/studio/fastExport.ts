// Fast export: instead of playing the video in real time and filming it, every
// frame is painted as fast as the device can and handed to the browser's own
// H.264 encoder (WebCodecs). The sound is mixed offline in one go and encoded
// as AAC. Both go into an MP4 file (mp4.ts). Where the browser lacks any of
// this, the studio falls back to the real-time recording in record.ts.
import { StudioAudio, type AudioMix } from "./audio";
import { muxMp4, type Mp4Sample, type Mp4Track } from "./mp4";
import type { Timeline } from "./timeline";

const VIDEO_CODECS = ["avc1.640033", "avc1.4d0033", "avc1.640028", "avc1.42003e", "avc1.42001f"];
const SAMPLE_RATE = 48000;

export interface FastJob {
  canvas: HTMLCanvasElement;
  fps: number;
  duration: number;
  paint: (tk: number) => void;
  timeline: Timeline;
  mix: AudioMix | null;
  onProgress?: (k: number) => void;
  isCancelled?: () => boolean;
}

async function videoConfig(w: number, h: number, fps: number): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
  for (const codec of VIDEO_CODECS) {
    const config: VideoEncoderConfig = {
      codec,
      width: w,
      height: h,
      framerate: fps,
      // Plenty for crisp moving text: about 16 Mbit/s at 1080x1920 and 30 fps.
      bitrate: Math.round(Math.min(40e6, w * h * fps * 0.26)),
      avc: { format: "avc" },
      latencyMode: "quality",
    };
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
    } catch {
      // try the next one
    }
  }
  return null;
}

async function audioConfig(): Promise<AudioEncoderConfig | null> {
  if (typeof AudioEncoder === "undefined" || typeof OfflineAudioContext === "undefined") return null;
  // AAC plays everywhere; Opus (also valid in MP4) where the browser has no AAC encoder.
  for (const codec of ["mp4a.40.2", "opus"]) {
    const config: AudioEncoderConfig = { codec, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 160_000 };
    try {
      if ((await AudioEncoder.isConfigSupported(config)).supported) return config;
    } catch {
      // try the next one
    }
  }
  return null;
}

/** True when this browser can do the fast export (else the real-time one is used). */
export async function canExportFast(w: number, h: number, fps: number, withAudio: boolean): Promise<boolean> {
  return Boolean((await videoConfig(w, h, fps)) && (!withAudio || (await audioConfig())));
}

const copy = (chunk: EncodedVideoChunk | EncodedAudioChunk) => {
  const b = new Uint8Array(chunk.byteLength);
  chunk.copyTo(b);
  return b;
};

const descriptionOf = (meta?: EncodedVideoChunkMetadata | EncodedAudioChunkMetadata): Uint8Array | null => {
  const d = meta?.decoderConfig?.description;
  if (!d) return null;
  if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer);
  return new Uint8Array((d as ArrayBuffer).slice(0));
};

async function encodeAudio(job: FastJob, config: AudioEncoderConfig): Promise<Mp4Track | null> {
  if (!job.mix) return null;
  const frames = Math.ceil(job.duration * SAMPLE_RATE);
  const ctx = new OfflineAudioContext(2, frames, SAMPLE_RATE);
  new StudioAudio(ctx).schedule(job.timeline, 0, job.mix);
  const rendered = await ctx.startRendering();
  const samples: Mp4Sample[] = [];
  let desc: Uint8Array | null = null;
  let failed: unknown = null;
  const opus = config.codec === "opus";
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      desc ??= descriptionOf(meta);
      samples.push({ data: copy(chunk), duration: opus ? Math.round(((chunk.duration ?? 20000) * SAMPLE_RATE) / 1e6) : 1024, key: true });
    },
    error: (e) => (failed = e),
  });
  enc.configure(config);
  const left = rendered.getChannelData(0);
  const right = rendered.getChannelData(1);
  const block = 4096;
  for (let i = 0; i < frames; i += block) {
    const n = Math.min(block, frames - i);
    const planar = new Float32Array(n * 2);
    planar.set(left.subarray(i, i + n), 0);
    planar.set(right.subarray(i, i + n), n);
    const data = new AudioData({ format: "f32-planar", sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / SAMPLE_RATE) * 1e6), data: planar });
    enc.encode(data);
    data.close();
  }
  await enc.flush();
  enc.close();
  if (failed) throw failed;
  if (!desc && !opus) return null;
  return { kind: "audio", codec: opus ? "opus" : "aac", timescale: SAMPLE_RATE, config: desc ?? new Uint8Array(), samples, channels: 2, sampleRate: SAMPLE_RATE };
}

/** Renders and encodes the whole video as fast as possible. Returns null when cancelled. */
export async function exportFast(job: FastJob): Promise<Blob | null> {
  const { canvas, fps } = job;
  const vConfig = await videoConfig(canvas.width, canvas.height, fps);
  if (!vConfig) throw new Error("Schneller Export geht in diesem Browser nicht.");
  const aConfig = job.mix ? await audioConfig() : null;
  // Sound first: it takes a moment and is shown as the first bit of progress.
  const audio = aConfig ? await encodeAudio(job, aConfig) : null;
  job.onProgress?.(0.05);

  const samples: Mp4Sample[] = [];
  let desc: Uint8Array | null = null;
  let failed: unknown = null;
  // Timescale with whole ticks per frame at 30 and 60 fps.
  const timescale = fps * 1000;
  const enc = new VideoEncoder({
    output: (chunk, meta) => {
      desc ??= descriptionOf(meta);
      samples.push({ data: copy(chunk), duration: 1000, key: chunk.type === "key" });
    },
    error: (e) => (failed = e),
  });
  enc.configure(vConfig);
  const total = Math.max(1, Math.round(job.duration * fps));
  for (let i = 0; i < total; i++) {
    if (job.isCancelled?.()) {
      enc.close();
      return null;
    }
    if (failed) throw failed;
    job.paint(i / fps);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i / fps) * 1e6), duration: Math.round(1e6 / fps) });
    // A key frame every two seconds, so players can jump around.
    enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    // Keep the encoder queue short so memory stays flat, and let the page breathe.
    while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 1));
    if (i % 10 === 0) {
      job.onProgress?.(0.05 + 0.93 * (i / total));
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  await enc.flush();
  enc.close();
  if (failed) throw failed;
  if (!desc) throw new Error("Der Video-Encoder hat keine Daten geliefert.");
  const tracks: Mp4Track[] = [{ kind: "video", timescale, config: desc, samples, width: canvas.width, height: canvas.height }];
  if (audio) tracks.push(audio);
  job.onProgress?.(1);
  return new Blob([muxMp4(tracks) as Uint8Array<ArrayBuffer>], { type: "video/mp4" });
}
