// Lucena's fullscreen stage: one show at a time, opened from anywhere in the
// app (first start, the sidebar, a page header, a finished game) and drawn by
// StageHost at the top of the shell. No DOM here, so the rules are testable.

export type ShowKind = "onboarding" | "tour" | "page" | "report" | "session";

export interface Show {
  kind: ShowKind;
  /** What the show is about: a page id for "page", a game id for "report". */
  subject?: string;
  /** Step to start on (the tour can resume where it was left). */
  step?: number;
}

type Listener = (show: Show | null) => void;

let current: Show | null = null;
const listeners = new Set<Listener>();

const emit = () => listeners.forEach((l) => l(current));

export function currentShow(): Show | null {
  return current;
}

/** Opens a show. A running show is replaced: the newest request wins. */
export function openStage(show: Show): void {
  current = show;
  emit();
}

export function closeStage(): void {
  if (!current) return;
  current = null;
  emit();
}

export function subscribeStage(l: Listener): () => void {
  listeners.add(l);
  l(current);
  return () => {
    listeners.delete(l);
  };
}

// ---------- what was already shown ----------

const SEEN_KEY = "schach.stage.seen";

export interface SeenStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): SeenStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Storage blocked (private mode): every show simply counts as new.
    return null;
  }
}

function readSeen(store: SeenStore | null): string[] {
  try {
    const raw = store?.getItem(SEEN_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeSeen(list: string[], store: SeenStore | null): void {
  try {
    store?.setItem(SEEN_KEY, JSON.stringify(list));
  } catch {
    // Private mode: the show just comes back next time.
  }
}

/**
 * Shows that tell the same thing, so seeing one counts for the other: the
 * first game report and the guide of the analysis page open on the same
 * screen, and two explanations in a row there felt like one too many.
 */
const SAME_STORY: Record<string, string[]> = {
  "report:first": ["page:analysis"],
  "page:analysis": ["report:first"],
};

/** The ids a show counts for: itself and what tells the same story. */
export function seenWith(id: string): string[] {
  return [id, ...(SAME_STORY[id] ?? [])];
}

type SeenListener = (seen: string[]) => void;
const seenListeners = new Set<SeenListener>();

/** Called with the whole list whenever a show is marked or the list is reset (mirrored into the synced settings). */
export function onSeenChange(l: SeenListener): () => void {
  seenListeners.add(l);
  return () => {
    seenListeners.delete(l);
  };
}

/** Every show id that ran on this device ("onboarding", "page:profile", …). */
export function seenList(store: SeenStore | null = storage()): string[] {
  return readSeen(store);
}

/** Whether a show with this id ("onboarding", "page:profile") ran on this device before. */
export function wasSeen(id: string, store: SeenStore | null = storage()): boolean {
  return readSeen(store).includes(id);
}

export function markSeen(id: string, store: SeenStore | null = storage()): void {
  const seen = readSeen(store);
  const added = seenWith(id).filter((x) => !seen.includes(x));
  if (!added.length) return;
  const next = [...seen, ...added];
  writeSeen(next, store);
  seenListeners.forEach((l) => l(next));
}

/**
 * Adds ids seen elsewhere (another device, through the synced settings).
 * Returns whether anything was new. Listeners stay quiet: the ids came from
 * the settings in the first place.
 */
export function mergeSeen(ids: string[], store: SeenStore | null = storage()): boolean {
  const seen = readSeen(store);
  const added = [...new Set(ids)].filter((x) => !seen.includes(x));
  if (added.length) writeSeen([...seen, ...added], store);
  return added.length > 0;
}

// ---------- one show by herself per visit ----------

const AUTO_KEY = "schach.stage.auto";
// Fallback when sessionStorage is blocked: then "this visit" is this page load.
let autoUsedHere = false;

function sessionStore(): SeenStore | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Whether Lucena may still open something by herself in this visit (a
 * browser session). At most one show opens unasked per visit: the first
 * start, one page guide or the first report. Everything else waits for the
 * next visit or for the "Erklären" button, so explanations never pile up.
 */
export function autoFree(session: SeenStore | null = sessionStore()): boolean {
  if (!session) return !autoUsedHere;
  try {
    return session.getItem(AUTO_KEY) !== "1";
  } catch {
    return !autoUsedHere;
  }
}

/** Claims this visit's one unasked show; false when it is already taken. */
export function takeAuto(session: SeenStore | null = sessionStore()): boolean {
  if (!autoFree(session)) return false;
  autoUsedHere = true;
  try {
    session?.setItem(AUTO_KEY, "1");
  } catch {
    // The in-memory flag holds for this page load.
  }
  return true;
}

/** Brings every introduction back (Einstellungen: "Erklärungen wieder zeigen"). */
export function resetSeen(store: SeenStore | null = storage(), session: SeenStore | null = sessionStore()): void {
  try {
    store?.removeItem(SEEN_KEY);
    session?.removeItem(AUTO_KEY);
  } catch {
    // Nothing was stored either.
  }
  autoUsedHere = false;
  seenListeners.forEach((l) => l([]));
}
