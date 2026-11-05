// How deep Stockfish looks at each position, chosen separately for the user's
// own games and for friends' games, plus the Bullet exclusion rules.
// Headless: the app layer stores the choices as settings.
import { DEFAULT_SETTINGS, verifySettings, type AnalysisSettings } from "./analyzer";
import { getUserColor, isBulletGame, NO_BULLET, type FilterableGame } from "./metrics/filters";

export { isBulletGame, NO_BULLET };

export type DepthPreset = "blitz" | "fast" | "normal" | "deep" | "max";
export type DepthScope = "own" | "friends";

/** A stored depth choice: a preset, or "custom" with its own depth and time per move. */
export interface DepthChoice {
  preset: DepthPreset | "custom";
  depth?: number;
  /** Seconds per position; the engine stops at whichever limit comes first. */
  seconds?: number;
}

export interface PresetInfo {
  name: string;
  hint: string;
  settings: AnalysisSettings;
}

// multiPv stays 2 everywhere: the classifier needs the second line for
// Great/Brilliant, and more lines would multiply the work (thermal safety).
export const DEPTH_PRESETS: Record<DepthPreset, PresetInfo> = {
  blitz: { name: "Blitzschnell", hint: "grober Überblick", settings: { depth: 10, movetimeMs: 200, multiPv: 2 } },
  fast: { name: "Schnell", hint: "gut für viele Partien", settings: { depth: 12, movetimeMs: 400, multiPv: 2 } },
  normal: { name: "Normal", hint: "guter Kompromiss", settings: DEFAULT_SETTINGS },
  deep: { name: "Gründlich", hint: "genauer, braucht Zeit", settings: { depth: 20, movetimeMs: 3000, multiPv: 2 } },
  max: { name: "Maximal", hint: "für einzelne Partien", settings: { depth: 24, movetimeMs: 8000, multiPv: 2 } },
};

export const PRESET_ORDER: DepthPreset[] = ["blitz", "fast", "normal", "deep", "max"];

export const CUSTOM_LIMITS = { depthMin: 8, depthMax: 26, secondsMin: 0.2, secondsMax: 10 } as const;

/** Setting keys; they sync across devices like the other settings. */
export const DEPTH_KEYS: Record<DepthScope, string> = {
  own: "analysis.strength",
  friends: "analysis.strength.friends",
};
/** Bulk and automatic analysis leave Bullet games out (a single game can still be analysed). */
export const SKIP_BULLET_KEY = "analysis.skipBullet";
/** Critical moves are re-searched deeper after the first pass (on by default). */
export const VERIFY_KEY = "analysis.verify";
/** Statistics, profile, friends and training leave Bullet games out. */
export const EXCLUDE_BULLET_KEY = "stats.excludeBullet";

// Friends' games mostly feed the comparison, which needs many games more than
// perfect evaluations, so they default to the faster preset.
export const DEFAULT_CHOICES: Record<DepthScope, DepthChoice> = {
  own: { preset: "normal" },
  friends: { preset: "fast" },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Reads a stored choice; older versions stored a bare preset name. */
export function normalizeChoice(raw: unknown, scope: DepthScope = "own"): DepthChoice {
  if (typeof raw === "string" && raw in DEPTH_PRESETS) return { preset: raw as DepthPreset };
  if (raw && typeof raw === "object") {
    const c = raw as Partial<DepthChoice>;
    if (c.preset && c.preset in DEPTH_PRESETS) return { preset: c.preset };
    if (c.preset === "custom") {
      const base = DEFAULT_SETTINGS;
      const depth = Number.isFinite(c.depth) ? Math.round(c.depth as number) : base.depth;
      const seconds = Number.isFinite(c.seconds) ? (c.seconds as number) : base.movetimeMs / 1000;
      return {
        preset: "custom",
        depth: clamp(depth, CUSTOM_LIMITS.depthMin, CUSTOM_LIMITS.depthMax),
        seconds: Math.round(clamp(seconds, CUSTOM_LIMITS.secondsMin, CUSTOM_LIMITS.secondsMax) * 10) / 10,
      };
    }
  }
  return DEFAULT_CHOICES[scope];
}

/** Engine limits for a choice. */
export function resolveSettings(choice: DepthChoice): AnalysisSettings {
  const c = normalizeChoice(choice);
  if (c.preset !== "custom") return DEPTH_PRESETS[c.preset].settings;
  return { depth: c.depth!, movetimeMs: Math.round(c.seconds! * 1000), multiPv: 2 };
}

/** "Schnell" or "Eigene" — the name shown for a choice. */
export function choiceName(choice: DepthChoice): string {
  const c = normalizeChoice(choice);
  return c.preset === "custom" ? "Eigene" : DEPTH_PRESETS[c.preset].name;
}

const secondsDe = (s: number) => (Math.round(s * 10) / 10).toString().replace(".", ",");

/** "Tiefe 12 · max. 0,4 s pro Zug". */
export function settingsLabel(s: Pick<AnalysisSettings, "depth" | "movetimeMs">): string {
  return `Tiefe ${s.depth} · max. ${secondsDe(s.movetimeMs / 1000)} s pro Zug`;
}

/** The next deeper preset than the given limits, for "genauer analysieren" (null at the top). */
export function deeperPreset(s: Pick<AnalysisSettings, "depth">): DepthPreset | null {
  return PRESET_ORDER.find((p) => DEPTH_PRESETS[p].settings.depth > s.depth) ?? null;
}

/** Own games use the own depth; everyone else's (friends, opponents) the friends depth. */
export function scopeOf(game: FilterableGame, usernames: Iterable<string>): DepthScope {
  return getUserColor(game, usernames) ? "own" : "friends";
}

// ---- Bullet ----

/** The format filter to apply: "Alle Formate" becomes "Ohne Bullet" when Bullet is excluded. */
export function statsFormat(format: string, excludeBullet: boolean): string {
  return excludeBullet && format === "All Formats" ? NO_BULLET : format;
}

// ---- timing ----

/** Measured engine speed per limit, kept per device (a phone is slower than a PC). */
export interface SpeedSample {
  positions: number;
  ms: number;
}
export type SpeedLog = Record<string, SpeedSample>;

/** Positions in a typical game of 40 moves, plus the start position. */
export const TYPICAL_POSITIONS = 81;

/** Deeper re-checks in a typical game: about five critical moves, two positions each. */
export const TYPICAL_VERIFY_POSITIONS = 10;

type SpeedSettings = Pick<AnalysisSettings, "depth" | "movetimeMs" | "verify">;

// Runs with and without the deeper re-check take different times, so they are logged apart.
export const speedKey = (s: SpeedSettings) => `d${s.depth}t${s.movetimeMs}${s.verify === false ? "" : "v"}`;

/** Adds one run to the log; the sample is capped so newer runs keep counting. */
export function recordSpeed(log: SpeedLog, s: SpeedSettings, positions: number, ms: number): SpeedLog {
  if (positions <= 0 || ms <= 0) return log;
  const key = speedKey(s);
  const prev = log[key] ?? { positions: 0, ms: 0 };
  // Older runs are scaled down to make room, so the sample follows the device
  // (e.g. a new browser version) instead of averaging forever.
  const CAP = 2000;
  const keep = Math.min(prev.positions, Math.max(0, CAP - positions));
  const old = prev.positions ? { positions: keep, ms: (prev.ms / prev.positions) * keep } : prev;
  return { ...log, [key]: { positions: old.positions + positions, ms: old.ms + ms } };
}

export interface GameEstimate {
  seconds: number;
  /** True when measured on this device, false for the upper bound from the time limit. */
  measured: boolean;
}

// A few positions are not enough to know the device's speed.
const MIN_MEASURED_POSITIONS = 30;

/** How long one typical game takes at these limits. */
export function estimateGame(s: SpeedSettings, log: SpeedLog = {}): GameEstimate {
  const sample = log[speedKey(s)];
  if (sample && sample.positions >= MIN_MEASURED_POSITIONS) {
    return { seconds: (sample.ms / sample.positions / 1000) * TYPICAL_POSITIONS, measured: true };
  }
  // Without a measurement only the time limit is known: an upper bound.
  const deep = verifySettings({ multiPv: 2, ...s });
  const verifyMs = deep ? deep.movetimeMs * TYPICAL_VERIFY_POSITIONS : 0;
  return { seconds: (s.movetimeMs * TYPICAL_POSITIONS + verifyMs) / 1000, measured: false };
}

/** "45 s", "3 min", "1 h 10 min". */
export function durationDe(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
}
