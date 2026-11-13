// How much of the device the analysis may use: number of engines
// running side by side and the hash table each one gets.
//
// The bundled engine is the single-threaded WASM build (it runs on iOS Safari
// without cross-origin isolation), so more CPU is used by running several
// engines in parallel, each on its own core, instead of one engine with threads.
// Headless: the app layer stores the choice per device.

export type PerfPreset = "eco" | "balanced" | "high" | "max";

/** A stored choice: a preset, or "custom" with its own engine count and hash. */
export interface PerfChoice {
  preset: PerfPreset | "custom";
  engines?: number;
  hashMb?: number;
}

export interface PerfSettings {
  /** Engines searching at the same time (one CPU core each). */
  engines: number;
  /** Hash table per engine in MB. */
  hashMb: number;
}

export interface DeviceInfo {
  /** Logical CPU cores (navigator.hardwareConcurrency). */
  cores: number;
  /** Phones and tablets: heat and battery matter more than speed. */
  mobile: boolean;
}

export interface PerfPresetInfo {
  name: string;
  hint: string;
}

export const PERF_PRESETS: Record<PerfPreset, PerfPresetInfo> = {
  eco: { name: "Sparsam", hint: "1 Kern, kühl und leise" },
  balanced: { name: "Ausgewogen", hint: "etwa ein Viertel der Kerne" },
  high: { name: "Stark", hint: "etwa die Hälfte der Kerne" },
  max: { name: "Sehr stark", hint: "fast alle Kerne" },
};

export const PERF_ORDER: PerfPreset[] = ["eco", "balanced", "high", "max"];

export const HASH_OPTIONS = [16, 32, 64, 128, 256, 512] as const;

// Every engine is its own WASM instance with its own memory; beyond this many
// the browser tab runs out of memory long before the CPU is the limit.
export const MAX_ENGINES = 32;
// All hash tables together stay below this, so even "Sehr stark" on a
// 32-core PC keeps the tab well under the browser's memory limit.
const TOTAL_HASH_CAP_MB = 1024;

const PRESET_HASH: Record<PerfPreset, number> = { eco: 32, balanced: 64, high: 128, max: 128 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Usable core count: at least 1, at most MAX_ENGINES. */
export function usableCores(device: DeviceInfo): number {
  return clamp(Math.floor(device.cores) || 1, 1, MAX_ENGINES);
}

/** Largest engine count the custom slider offers on this device. */
export const maxEnginesFor = (device: DeviceInfo) => usableCores(device);

/** Phones and small machines start economical; desktops with 6+ cores start balanced. */
export function defaultPerfChoice(device: DeviceInfo): PerfChoice {
  return { preset: device.mobile || usableCores(device) < 6 ? "eco" : "balanced" };
}

function presetEngines(preset: PerfPreset, cores: number): number {
  switch (preset) {
    case "eco":
      return 1;
    case "balanced":
      return clamp(Math.round(cores / 4), Math.min(2, cores), cores);
    case "high":
      return clamp(Math.round(cores / 2), Math.min(2, cores), cores);
    case "max":
      // One core stays free for the page itself, so scrolling stays smooth
      // (never fewer engines than "Stark", though).
      return Math.max(presetEngines("high", cores), cores - 1);
  }
}

/** Largest power of two not above `mb`, at least 16. */
function powerOfTwoBelow(mb: number): number {
  let p = 16;
  while (p * 2 <= mb) p *= 2;
  return p;
}

/** Reads a stored choice; anything unknown falls back to the device default. */
export function normalizePerfChoice(raw: unknown, device: DeviceInfo): PerfChoice {
  if (raw && typeof raw === "object") {
    const c = raw as Partial<PerfChoice>;
    if (c.preset && c.preset in PERF_PRESETS) return { preset: c.preset };
    if (c.preset === "custom") {
      const engines = Number.isFinite(c.engines) ? Math.round(c.engines as number) : 1;
      const hash = Number.isFinite(c.hashMb) ? (c.hashMb as number) : 32;
      return {
        preset: "custom",
        engines: clamp(engines, 1, maxEnginesFor(device)),
        hashMb: HASH_OPTIONS.reduce((best, h) => (Math.abs(h - hash) < Math.abs(best - hash) ? h : best), HASH_OPTIONS[0]),
      };
    }
  }
  return defaultPerfChoice(device);
}

/** Engine count and hash for a choice on this device. */
export function resolvePerf(choice: PerfChoice, device: DeviceInfo): PerfSettings {
  const c = normalizePerfChoice(choice, device);
  const cores = usableCores(device);
  if (c.preset === "custom") {
    const engines = c.engines!;
    return { engines, hashMb: Math.min(c.hashMb!, powerOfTwoBelow(Math.max(16, TOTAL_HASH_CAP_MB / engines))) };
  }
  const engines = presetEngines(c.preset, cores);
  return { engines, hashMb: Math.min(PRESET_HASH[c.preset], powerOfTwoBelow(TOTAL_HASH_CAP_MB / engines)) };
}

/** "Sehr stark" or "Eigene". */
export function perfName(choice: PerfChoice): string {
  return choice.preset === "custom" ? "Eigene" : PERF_PRESETS[choice.preset].name;
}

/** "4 Engines · 128 MB Hash je Engine". */
export function perfLabel(p: PerfSettings): string {
  return `${p.engines} ${p.engines === 1 ? "Engine" : "Engines"} · ${p.hashMb} MB Hash${p.engines > 1 ? " je Engine" : ""}`;
}
