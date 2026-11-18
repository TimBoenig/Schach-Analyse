// A small MP4 writer for the fast export: takes H.264 and AAC samples from the
// browser's own encoders (WebCodecs) and lays them out as a normal .mp4 file.
// Plain (not fragmented) layout: ftyp, mdat with all samples, moov at the end.
// Own code instead of a muxer package, so the app stays free of extra licences.

export interface Mp4Sample {
  data: Uint8Array;
  /** In the track's timescale. */
  duration: number;
  key: boolean;
}

export interface Mp4Track {
  kind: "video" | "audio";
  timescale: number;
  /** avcC record (video) or AudioSpecificConfig (audio), from the encoder's decoderConfig.description. */
  config: Uint8Array;
  samples: Mp4Sample[];
  width?: number;
  height?: number;
  channels?: number;
  sampleRate?: number;
  /** Audio codec; Opus is the fallback where the browser cannot encode AAC. */
  codec?: "aac" | "opus";
}

class Writer {
  private parts: Uint8Array[] = [];
  size = 0;
  bytes(b: Uint8Array | number[]): this {
    const a = b instanceof Uint8Array ? b : new Uint8Array(b);
    this.parts.push(a);
    this.size += a.length;
    return this;
  }
  u8(v: number): this {
    return this.bytes([v & 255]);
  }
  u16(v: number): this {
    return this.bytes([(v >> 8) & 255, v & 255]);
  }
  u24(v: number): this {
    return this.bytes([(v >> 16) & 255, (v >> 8) & 255, v & 255]);
  }
  u32(v: number): this {
    return this.bytes([(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  }
  str(s: string): this {
    return this.bytes([...s].map((c) => c.charCodeAt(0)));
  }
  zeros(n: number): this {
    return this.bytes(new Uint8Array(n));
  }
  done(): Uint8Array {
    const out = new Uint8Array(this.size);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

function box(type: string, ...content: Uint8Array[]): Uint8Array {
  const w = new Writer();
  const len = content.reduce((s, c) => s + c.length, 0);
  w.u32(8 + len).str(type);
  for (const c of content) w.bytes(c);
  return w.done();
}

const full = (type: string, version: number, flags: number, body: Writer) => box(type, new Writer().u8(version).u24(flags).done(), body.done());

const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

function descriptor(tag: number, body: Uint8Array): Uint8Array {
  // Length in the 4-byte form, which every reader accepts.
  const len = body.length;
  return new Writer().u8(tag).u8(0x80 | ((len >> 21) & 0x7f)).u8(0x80 | ((len >> 14) & 0x7f)).u8(0x80 | ((len >> 7) & 0x7f)).u8(len & 0x7f).bytes(body).done();
}

function sampleEntry(t: Mp4Track): Uint8Array {
  if (t.kind === "video") {
    const w = new Writer().zeros(6).u16(1).u16(0).u16(0).zeros(12).u16(t.width ?? 0).u16(t.height ?? 0).u32(0x00480000).u32(0x00480000).u32(0).u16(1).zeros(32).u16(0x18).u16(0xffff);
    return box("avc1", w.done(), box("avcC", t.config));
  }
  if (t.codec === "opus") {
    // OpusHead from the encoder is little-endian; the dOps box wants the same fields big-endian.
    const head = t.config;
    const preSkip = head.length >= 12 ? head[10] | (head[11] << 8) : 312;
    const dops = new Writer().u8(0).u8(t.channels ?? 2).u16(preSkip).u32(t.sampleRate ?? 48000).u16(0).u8(0).done();
    const w = new Writer().zeros(6).u16(1).zeros(8).u16(t.channels ?? 2).u16(16).u16(0).u16(0).u32((t.sampleRate ?? 48000) * 65536);
    return box("Opus", w.done(), box("dOps", dops));
  }
  const dec = new Writer().u8(0x40).u8(0x15).u24(0).u32(0).u32(0).bytes(descriptor(5, t.config)).done();
  const es = new Writer().u16(0).u8(0).bytes(descriptor(4, dec)).bytes(descriptor(6, new Uint8Array([2]))).done();
  const w = new Writer()
    .zeros(6)
    .u16(1)
    .zeros(8)
    .u16(t.channels ?? 2)
    .u16(16)
    .u16(0)
    .u16(0)
    .u32((t.sampleRate ?? 48000) * 65536);
  return box("mp4a", w.done(), full("esds", 0, 0, new Writer().bytes(es)));
}

function trackDuration(t: Mp4Track): number {
  return t.samples.reduce((s, x) => s + x.duration, 0);
}

function trak(t: Mp4Track, id: number, offsets: number[]): Uint8Array {
  const dur = trackDuration(t);
  const movieDur = Math.round((dur / t.timescale) * 1000);
  const tkhd = new Writer().u32(0).u32(0).u32(id).u32(0).u32(movieDur).zeros(8).u16(0).u16(0).u16(t.kind === "audio" ? 0x0100 : 0).u16(0);
  for (const m of MATRIX) tkhd.u32(m);
  tkhd.u32((t.width ?? 0) * 65536).u32((t.height ?? 0) * 65536);
  const mdhd = new Writer().u32(0).u32(0).u32(t.timescale).u32(dur).u16(0x55c4).u16(0);
  const hdlr = new Writer().u32(0).str(t.kind === "video" ? "vide" : "soun").zeros(12).str(t.kind === "video" ? "VideoHandler\0" : "SoundHandler\0");
  const media = t.kind === "video" ? full("vmhd", 0, 1, new Writer().u16(0).u16(0).u16(0).u16(0)) : full("smhd", 0, 0, new Writer().u16(0).u16(0));
  const dinf = box("dinf", full("dref", 0, 0, new Writer().u32(1).bytes(full("url ", 0, 1, new Writer()))));
  // Durations run-length encoded.
  const runs: [number, number][] = [];
  for (const s of t.samples) {
    const last = runs[runs.length - 1];
    if (last && last[1] === s.duration) last[0]++;
    else runs.push([1, s.duration]);
  }
  const stts = new Writer().u32(runs.length);
  for (const [n, d] of runs) stts.u32(n).u32(d);
  const stsz = new Writer().u32(0).u32(t.samples.length);
  for (const s of t.samples) stsz.u32(s.data.length);
  // One sample per chunk: simple and valid.
  const stsc = new Writer().u32(1).u32(1).u32(1).u32(1);
  const stco = new Writer().u32(offsets.length);
  for (const o of offsets) stco.u32(o);
  const tables = [box("stsd", new Writer().u32(0).u32(1).done(), sampleEntry(t)), full("stts", 0, 0, stts), full("stsc", 0, 0, stsc), full("stsz", 0, 0, stsz), full("stco", 0, 0, stco)];
  if (t.kind === "video") {
    const keys = t.samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
    const stss = new Writer().u32(keys.length);
    for (const k of keys) stss.u32(k);
    tables.push(full("stss", 0, 0, stss));
  }
  return box("trak", full("tkhd", 0, 3, tkhd), box("mdia", full("mdhd", 0, 0, mdhd), full("hdlr", 0, 0, hdlr), box("minf", media, dinf, box("stbl", ...tables))));
}

/** The finished .mp4 file. */
export function muxMp4(tracks: Mp4Track[]): Uint8Array {
  const ftyp = box("ftyp", new Writer().str("isom").u32(512).str("isom").str("iso2").str("avc1").str("mp41").done());
  const dataLen = tracks.reduce((s, t) => s + t.samples.reduce((a, x) => a + x.data.length, 0), 0);
  // mdat header: plain 32-bit size (an export never gets near 4 GB).
  const mdatHead = new Writer().u32(8 + dataLen).str("mdat").done();
  let offset = ftyp.length + mdatHead.length;
  const offsets = tracks.map((t) =>
    t.samples.map((s) => {
      const o = offset;
      offset += s.data.length;
      return o;
    }),
  );
  const seconds = Math.max(...tracks.map((t) => trackDuration(t) / t.timescale));
  const mvhd = new Writer().u32(0).u32(0).u32(1000).u32(Math.round(seconds * 1000)).u32(0x00010000).u16(0x0100).zeros(10);
  for (const m of MATRIX) mvhd.u32(m);
  mvhd.zeros(24).u32(tracks.length + 1);
  const moov = box("moov", full("mvhd", 0, 0, mvhd), ...tracks.map((t, i) => trak(t, i + 1, offsets[i])));
  const out = new Writer().bytes(ftyp).bytes(mdatHead);
  for (const t of tracks) for (const s of t.samples) out.bytes(s.data);
  return out.bytes(moov).done();
}
