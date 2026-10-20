import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import type { StoredGame } from "../domain/types";
import { getSetting, listGames } from "../storage/db";
import { IconSearch } from "./icons";
import { MOD } from "./keys";
import { formatDate, resultText, shortOpening } from "./labels";
import { navigate, type Route } from "./router";
import { setTheme } from "./theme";

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

export const PAGES: { view: Route["view"]; label: string; key: string }[] = [
  { view: "games", label: "Partien", key: "1" },
  { view: "analysis", label: "Analyse", key: "2" },
  { view: "profile", label: "Profil", key: "3" },
  { view: "insights", label: "Einblicke", key: "4" },
  { view: "training", label: "Training", key: "5" },
  { view: "settings", label: "Einstellungen", key: "6" },
];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Fuzzy-ish match: every word of the query appears somewhere in the text. */
function matches(text: string, query: string): boolean {
  const t = norm(text);
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => t.includes(w));
}

export function CommandPalette({
  onClose,
  onShortcuts,
  lastGame,
}: {
  onClose: () => void;
  onShortcuts: () => void;
  lastGame: string | null;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [games, setGames] = useState<StoredGame[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    input.current?.focus();
    void listGames().then(setGames);
    void getSetting<string[]>("usernames", []).then(setNames);
  }, []);

  const go = (r: Route) => () => navigate(r);
  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      ...PAGES.map((p) => ({
        id: `page-${p.view}`,
        group: "Seiten",
        label: p.label,
        hint: p.key,
        run: go(p.view === "analysis" ? { view: "analysis", gameId: lastGame ?? undefined } : ({ view: p.view } as Route)),
      })),
      { id: "import", group: "Aktionen", label: "Partien importieren", keywords: "chess.com lichess pgn laden", run: go({ view: "games", import: true }) },
      { id: "theme-dark", group: "Aktionen", label: "Dunkles Design", keywords: "theme dark nacht", run: () => void setTheme("dark") },
      { id: "theme-light", group: "Aktionen", label: "Helles Design", keywords: "theme light tag", run: () => void setTheme("light") },
      { id: "theme-system", group: "Aktionen", label: "Design automatisch", keywords: "theme system", run: () => void setTheme("system") },
      { id: "keys", group: "Aktionen", label: "Tastenkürzel anzeigen", hint: "?", keywords: "shortcuts hilfe", run: onShortcuts },
    ];
    const lower = names.map((n) => n.toLowerCase());
    const opp = (g: StoredGame) => (lower.includes(g.white.toLowerCase()) ? g.black : g.white);
    const gameCmds: Command[] = games.map((g) => ({
      id: `game-${g.id}`,
      group: "Partien",
      label: `${g.white} – ${g.black} ${resultText(g.result)}`,
      hint: formatDate(g.date),
      keywords: `${opp(g)} ${g.opening ?? ""} ${g.date}`,
      run: go({ view: "analysis", gameId: g.id }),
    }));
    if (!query.trim()) return [...base, ...gameCmds.slice(0, 5)];
    return [...base, ...gameCmds].filter((c) => matches(`${c.label} ${c.keywords ?? ""} ${c.group}`, query)).slice(0, 30);
  }, [games, names, query, lastGame]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(".cmd.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  let lastGroup = "";
  return (
    <div class="overlay palette-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="palette" role="dialog" aria-label="Befehle">
        <div class="palette-input">
          <IconSearch />
          <input
            ref={input}
            value={query}
            placeholder="Seite, Aktion oder Partie suchen …"
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(commands.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(commands[active]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div class="palette-list" ref={list}>
          {commands.length === 0 && <div class="muted small palette-empty">Nichts gefunden.</div>}
          {commands.map((c, i) => {
            const head = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {head && <div class="palette-group">{head}</div>}
                <button
                  class={`cmd${i === active ? " active" : ""}`}
                  onPointerMove={() => setActive(i)}
                  onClick={() => run(c)}
                >
                  <span class="cmd-label">{c.label}</span>
                  {c.group === "Partien" && (
                    <span class="cmd-sub">{shortOpening(games.find((g) => `game-${g.id}` === c.id)?.opening ?? "")}</span>
                  )}
                  {c.hint && <span class="cmd-hint">{c.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div class="palette-foot faint">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> wählen
          </span>
          <span>
            <kbd>↵</kbd> öffnen
          </span>
          <span>
            <kbd>{MOD}</kbd>
            <kbd>K</kbd> Befehle
          </span>
        </div>
      </div>
    </div>
  );
}

const SHORTCUTS: [string, [string, string][]][] = [
  [
    "Überall",
    [
      [`${MOD} K`, "Befehle und Suche"],
      ["1 – 6", "Seite wechseln"],
      ["?", "Diese Übersicht"],
    ],
  ],
  [
    "Partien",
    [["/", "Suche"]],
  ],
  [
    "Analyse",
    [
      ["← →", "Zug zurück / vor"],
      ["Pos1 / Ende", "Anfang / Ende der Partie"],
      ["N / ⇧ N", "Nächster / vorheriger eigener Fehler"],
      ["F", "Brett drehen"],
      ["B", "Bericht ein- und ausblenden"],
      ["Esc", "Eigene Variante verlassen"],
    ],
  ],
];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  return (
    <div class="overlay palette-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="palette shortcuts" role="dialog" aria-label="Tastenkürzel">
        <div class="tile-head" style={{ padding: "16px 18px 0" }}>
          <h3 style={{ margin: 0 }}>Tastenkürzel</h3>
          <button class="btn small ghost" onClick={onClose}>
            Schließen
          </button>
        </div>
        <div class="shortcut-groups">
          {SHORTCUTS.map(([group, rows]) => (
            <div key={group}>
              <div class="palette-group">{group}</div>
              {rows.map(([k, label]) => (
                <div class="shortcut-row" key={label}>
                  <span>{label}</span>
                  <kbd>{k}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
