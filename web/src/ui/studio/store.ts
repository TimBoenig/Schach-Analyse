// Where the studio keeps its saved video projects (small JSON in localStorage, never synced).
import { normalizeProject, spanishTemplate, type StudioProject } from "./model";

const PROJECTS_KEY = "schach.studio.projects";
const CURRENT_KEY = "schach.studio.current";

export function loadProjects(): StudioProject[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? "[]");
    if (Array.isArray(raw) && raw.length) return raw.map(normalizeProject).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    // broken storage: start fresh below
  }
  return [spanishTemplate()];
}

export function saveProjects(list: StudioProject[]): boolean {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
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
