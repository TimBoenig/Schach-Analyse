// How a brilliant move is celebrated. Syncs like other settings; a localStorage
// mirror keeps reads synchronous, because the celebration starts with the move.
import { getSetting, onDataChanged, setSetting } from "../storage/db";

export type BrilliantStyle = "normal" | "ultra";

export interface FxPrefs {
  brilliant: BrilliantStyle;
  /** Fanfare and vibration with the ultra celebration. */
  sound: boolean;
}

export const BRILLIANT_STYLE_LABELS: Record<BrilliantStyle, string> = { normal: "Normal", ultra: "Ultra" };

const MIRROR_KEY = "schach.fx";
const DEFAULTS: FxPrefs = { brilliant: "normal", sound: false };

let cache: FxPrefs | null = null;
let watching = false;

/** Only known values survive: the mirror and the synced setting are both untrusted input. */
export function normalizeFxPrefs(v: unknown): FxPrefs {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { brilliant: o.brilliant === "ultra" ? "ultra" : "normal", sound: o.sound === true };
}

function mirror(p: FxPrefs): void {
  cache = p;
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(p));
  } catch {
    // Private mode: the IndexedDB value still applies once loaded.
  }
}

async function load(): Promise<FxPrefs> {
  const p = normalizeFxPrefs({
    brilliant: await getSetting<BrilliantStyle>("ui.brilliant", DEFAULTS.brilliant),
    sound: await getSetting<boolean>("ui.brilliantSound", DEFAULTS.sound),
  });
  mirror(p);
  return p;
}

/** The current preference, without waiting for IndexedDB. */
export function fxPrefs(): FxPrefs {
  if (!cache) {
    try {
      cache = normalizeFxPrefs(JSON.parse(localStorage.getItem(MIRROR_KEY) ?? "{}"));
    } catch {
      cache = { ...DEFAULTS };
    }
  }
  if (!watching) {
    watching = true;
    void load();
    // A synced change from another device applies to the next celebration.
    onDataChanged(() => void load());
  }
  return cache;
}

export function loadFxPrefs(): Promise<FxPrefs> {
  return load();
}

export async function setFxPrefs(next: FxPrefs): Promise<void> {
  mirror(next);
  await setSetting("ui.brilliant", next.brilliant);
  await setSetting("ui.brilliantSound", next.sound);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}
