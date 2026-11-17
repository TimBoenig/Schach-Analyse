// Video export straight from the browser: the finished frames are played in
// real time onto a canvas whose picture (and the move sounds) MediaRecorder
// encodes. MP4 where the browser can (Chrome, Edge, Safari), WebM otherwise.

export interface VideoType {
  mime: string;
  ext: "mp4" | "webm";
}

const CANDIDATES: VideoType[] = [
  { mime: "video/mp4;codecs=avc1.640028,mp4a.40.2", ext: "mp4" },
  { mime: "video/mp4;codecs=avc1.4d0028,mp4a.40.2", ext: "mp4" },
  { mime: "video/mp4;codecs=avc1", ext: "mp4" },
  { mime: "video/mp4", ext: "mp4" },
  { mime: "video/webm;codecs=vp9,opus", ext: "webm" },
  { mime: "video/webm;codecs=vp8,opus", ext: "webm" },
  { mime: "video/webm", ext: "webm" },
];

export function videoType(): VideoType | null {
  if (typeof MediaRecorder === "undefined") return null;
  return CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c.mime)) ?? null;
}

export interface RecordJob {
  canvas: HTMLCanvasElement;
  fps: number;
  duration: number;
  /** Paints the frame for video second t. */
  paint: (t: number) => void;
  audio?: MediaStream | null;
  /** Called once when the clock starts, to start sounds in sync. */
  onStart?: () => void;
  onProgress?: (k: number) => void;
  isCancelled?: () => boolean;
}

export async function recordVideo(job: RecordJob): Promise<{ blob: Blob; type: VideoType }> {
  const type = videoType();
  if (!type) throw new Error("Dieser Browser kann keine Videos aufnehmen. Nimm Chrome, Edge oder Safari.");
  job.paint(0);
  const stream = job.canvas.captureStream(job.fps);
  for (const track of job.audio?.getAudioTracks() ?? []) stream.addTrack(track);
  const pixels = job.canvas.width * job.canvas.height;
  const recorder = new MediaRecorder(stream, {
    mimeType: type.mime,
    // Plenty for crisp moving text: about 16 Mbit/s at 1080x1920 and 30 fps.
    videoBitsPerSecond: Math.round(Math.min(40e6, (pixels * job.fps * 0.26) / 1)),
    audioBitsPerSecond: 160_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  recorder.start(500);
  await new Promise<void>((resolve) => {
    const start = performance.now();
    job.onStart?.();
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      if (job.isCancelled?.()) return resolve();
      job.paint(Math.min(t, job.duration));
      job.onProgress?.(Math.min(1, t / job.duration));
      // A short still at the end so players do not cut the last frame.
      if (t >= job.duration + 0.4) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  recorder.stop();
  await stopped;
  stream.getVideoTracks().forEach((tr) => tr.stop());
  const mime = type.mime.split(";")[0];
  return { blob: new Blob(chunks, { type: mime }), type };
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
