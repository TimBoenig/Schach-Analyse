// Appearance preferences. They sync like other settings; a localStorage mirror
// applies them before IndexedDB has opened, so the app never flashes the wrong theme.
import { getSetting, onDataChanged, setSetting } from "../storage/db";

export type ThemeMode = "system" | "dark" | "light";
export type BoardTheme = "holz" | "gruen" | "blau" | "grau";

export const THEME_LABELS: Record<ThemeMode, string> = { system: "Automatisch", dark: "Dunkel", light: "Hell" };

export const BOARD_THEMES: Record<BoardTheme, { label: string; light: string; dark: string }> = {
  holz: { label: "Holz", light: "#ecd9b9", dark: "#ae8a68" },
  gruen: { label: "Grün", light: "#eeeed2", dark: "#769656" },
  blau: { label: "Blau", light: "#dee3e6", dark: "#8ca2ad" },
  grau: { label: "Grau", light: "#d9d9d9", dark: "#8f8f8f" },
};

const MIRROR_KEY = "schach.appearance";

function apply(theme: ThemeMode, board: BoardTheme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.board = board;
  // Status bar / browser chrome follows the page background.
  requestAnimationFrame(() => {
    const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg || "#121418");
  });
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify({ theme, board }));
  } catch {
    // Private mode: the IndexedDB value still applies once loaded.
  }
}

/** Applies the mirrored preference synchronously, then follows the stored (synced) one. */
export function initAppearance(): void {
  let cached: { theme?: ThemeMode; board?: BoardTheme } = {};
  try {
    cached = JSON.parse(localStorage.getItem(MIRROR_KEY) ?? "{}");
  } catch {
    cached = {};
  }
  apply(cached.theme ?? "system", cached.board ?? "gruen");
  const load = async () =>
    apply(await getSetting<ThemeMode>("ui.theme", "system"), await getSetting<BoardTheme>("ui.board", "gruen"));
  void load();
  // A synced change from another device applies right away.
  onDataChanged(() => void load());
}

export async function setTheme(theme: ThemeMode): Promise<void> {
  apply(theme, (document.documentElement.dataset.board as BoardTheme) ?? "gruen");
  await setSetting("ui.theme", theme);
}

export async function setBoardTheme(board: BoardTheme): Promise<void> {
  apply((document.documentElement.dataset.theme as ThemeMode) ?? "system", board);
  await setSetting("ui.board", board);
}
