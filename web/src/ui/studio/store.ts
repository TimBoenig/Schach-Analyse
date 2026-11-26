// Where the studio keeps its saved video projects (small JSON in localStorage, never synced).
//
// Saving never loses work from another tab: the list on disk is merged project by project with what
// this tab holds (the newer `updatedAt` wins), and only projects this tab deleted are dropped. A
// project another tab created stays. The editor saves shortly after each change and once more when
// the page is hidden or left, so closing the tab right after typing keeps the last change.
import { normalizeProject, spanishTemplate, type StudioProject } from "./model";

export const PROJECTS_KEY = "schach.studio.projects";
const CURRENT_KEY = "schach.studio.current";

function readStored(): StudioProject[] | null {
  try {
    const raw = JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? "[]");
    if (Array.isArray(raw) && raw.length) return raw.map(normalizeProject);
  } catch {
    // broken storage: treated as empty
  }
  return null;
}

export function loadProjects(): StudioProject[] {
  return (readStored() ?? [spanishTemplate()]).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The projects of this tab merged with those on disk: per id the newer version wins, projects only on disk stay
 * (another tab made them) unless this tab deleted them. Order: this tab's list first, then the others.
 */
export function mergeProjects(mine: StudioProject[], stored: StudioProject[], removed: ReadonlySet<string> = new Set()): StudioProject[] {
  const theirs = new Map(stored.map((p) => [p.id, p]));
  const out = mine.map((p) => {
    const other = theirs.get(p.id);
    return other && other.updatedAt > p.updatedAt ? other : p;
  });
  const have = new Set(out.map((p) => p.id));
  for (const p of stored) if (!have.has(p.id) && !removed.has(p.id)) out.push(p);
  return out;
}

/** Writes the projects (merged with the ones on disk). Returns the merged list, or null when the storage refused (full, private mode). */
export function saveProjects(list: StudioProject[], removed: ReadonlySet<string> = new Set()): StudioProject[] | null {
  const merged = mergeProjects(list, readStored() ?? [], removed);
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    return null;
  }
}

/** The projects on disk right now (after another tab saved), or null when there are none. */
export function storedProjects(): StudioProject[] | null {
  return readStored();
}

export function currentId(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

export function setCurrentId(id: string): void {
  try {
    localStorage.setItem(CURRENT_KEY, id);
  } catch {
    // not important
  }
}
