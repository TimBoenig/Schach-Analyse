// Loudness for the exported file: BS.1770 integrated loudness (K-weighted, gated),
// a gain to a target such as -14 LUFS (what TikTok, Instagram and YouTube play at
// without turning the video down) and a soft limiter so nothing clips.

type Biquad = [number, number, number, number, number]; // b0 b1 b2 a1 a2

/** The two K-weighting filters (shelf + high-pass) for any sample rate. */
function kFilters(fs: number): Biquad[] {
  const f0 = 1681.974450955533;
  const g = 3.999843853973347;
  const q = 0.7071752369554196;
  let k = Math.tan((Math.PI * f0) / fs);
  const vh = 10 ** (g / 20);
  const vb = vh ** 0.4996667741545416;
  let a0 = 1 + k / q + k * k;
  const shelf: Biquad = [(vh + (vb * k) / q + k * k) / a0, (2 * (k * k - vh)) / a0, (vh - (vb * k) / q + k * k) / a0, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0];
  const f1 = 38.13547087602444;
  const q1 = 0.5003270373238773;
  k = Math.tan((Math.PI * f1) / fs);
  a0 = 1 + k / q1 + k * k;
  const high: Biquad = [1, -2, 1, (2 * (k * k - 1)) / a0, (1 - k / q1 + k * k) / a0];
  return [shelf, high];
}

function weighted(x: Float32Array, fs: number): Float64Array {
  const out = Float64Array.from(x);
  for (const [b0, b1, b2, a1, a2] of kFilters(fs)) {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < out.length; i++) {
      const xi = out[i];
      const y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = xi;
      y2 = y1;
      y1 = y;
      out[i] = y;
    }
  }
  return out;
}

/** Integrated loudness in LUFS (-Infinity for silence). */
export function measureLufs(channels: Float32Array[], fs: number): number {
  const w = channels.map((c) => weighted(c, fs));
  const block = Math.round(0.4 * fs);
  const hop = Math.round(0.1 * fs);
  const blocks: number[] = [];
  for (let s = 0; s + block <= w[0].length; s += hop) {
    let sum = 0;
    for (const ch of w) {
      let e = 0;
      for (let i = s; i < s + block; i++) e += ch[i] * ch[i];
      sum += e / block;
    }
    blocks.push(sum);
  }
  if (!blocks.length) {
    // Shorter than one block: measure the whole thing.
    let sum = 0;
    for (const ch of w) {
      let e = 0;
      for (const v of ch) e += v * v;
      sum += e / Math.max(1, ch.length);
    }
    blocks.push(sum);
  }
  const lk = (e: number) => -0.691 + 10 * Math.log10(e);
  const absGated = blocks.filter((e) => e > 0 && lk(e) > -70);
  if (!absGated.length) return -Infinity;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const rel = lk(mean(absGated)) - 10;
  const gated = absGated.filter((e) => lk(e) > rel);
  return lk(mean(gated.length ? gated : absGated));
}

/** Soft limiter: the gain follows the loudest sample ahead and recovers slowly, so peaks stay under the ceiling without clicks. */
export function limit(channels: Float32Array[], fs: number, ceilingDb: number): void {
  const ceiling = 10 ** (ceilingDb / 20);
  const n = channels[0].length;
  const look = Math.round(0.005 * fs);
  const release = Math.exp(-1 / (0.15 * fs));
  // Target gain per sample from a running max over the look-ahead window.
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const c of channels) p = Math.max(p, Math.abs(c[i]));
    need[i] = p > ceiling ? ceiling / p : 1;
  }
  let g = 1;
  const smooth = new Float32Array(n);
  // Backwards pass: the gain starts to fall `look` samples before the peak.
  let ahead = 1;
  for (let i = n - 1; i >= 0; i--) {
    ahead = Math.min(need[i], ahead + (1 - ahead) * (1 - Math.exp(-1 / look)) * 0.5);
    smooth[i] = ahead;
  }
  for (let i = 0; i < n; i++) {
    g = Math.min(smooth[i], need[i], g + (1 - g) * (1 - release));
    for (const c of channels) c[i] *= g;
  }
  // Safety net: nothing may pass the ceiling.
  for (const c of channels) for (let i = 0; i < n; i++) c[i] = Math.max(-ceiling, Math.min(ceiling, c[i]));
}

/** Brings the mix to the target loudness (gain limited to [minGainDb, maxGainDb]) and under the ceiling. Edits the channels in place. */
export function normalizeLoudness(channels: Float32Array[], fs: number, targetLufs: number, opts: { maxGainDb?: number; minGainDb?: number; ceilingDb?: number } = {}): { before: number; gainDb: number } {
  const before = measureLufs(channels, fs);
  if (!Number.isFinite(before)) return { before, gainDb: 0 };
  const gainDb = Math.max(opts.minGainDb ?? -24, Math.min(opts.maxGainDb ?? 12, targetLufs - before));
  const gain = 10 ** (gainDb / 20);
  for (const c of channels) for (let i = 0; i < c.length; i++) c[i] *= gain;
  limit(channels, fs, opts.ceilingDb ?? -1);
  return { before, gainDb };
}
