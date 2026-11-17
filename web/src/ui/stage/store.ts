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

/** Whether a show with this id ("onboarding", "page:profile") ran on this device before. */
export function wasSeen(id: string, store: SeenStore | null = storage()): boolean {
  return readSeen(store).includes(id);
}

export function markSeen(id: string, store: SeenStore | null = storage()): void {
  try {
    const seen = readSeen(store);
    if (!seen.includes(id)) store?.setItem(SEEN_KEY, JSON.stringify([...seen, id]));
  } catch {
    // Private mode: the show just comes back next time.
  }
}

/** Brings every introduction back (Einstellungen: "Erklärungen wieder zeigen"). */
export function resetSeen(store: SeenStore | null = storage()): void {
  try {
    store?.removeItem(SEEN_KEY);
  } catch {
    // Nothing was stored either.
  }
}
