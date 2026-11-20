import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { PAGE_PERIODS } from "../domain/periods";
import type { StoredGame } from "../domain/types";
import { exportData, exportForAi } from "../app/exporter";
import { getSetting, listGames } from "../storage/db";
import { IconSearch } from "./icons";
import { MOD } from "./keys";
import { formatDate, resultText, shortOpening } from "./labels";
import { navigate, type Route } from "./router";
import { openSection, STAT_SECTIONS, STATS_PAGES } from "./StatsLayout";
import { setTheme } from "./theme";
import { ENGINE_NAME } from "../engine/info";
import { t } from "../i18n";

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

export const PAGES: { view: Route["view"]; label: string; key: string; keywords?: string }[] = [
  { view: "home", label: t("Start"), key: "1" },
  { view: "games", label: t("Partien"), key: "2" },
  { view: "board", label: t("Partien › Analysebrett"), key: "9" },
  { view: "profile", label: t("Statistik › Überblick"), key: "4", keywords: t("profil fähigkeiten stärken schwächen stil") },
  { view: "insights", label: t("Statistik › Ergebnisse"), key: "5", keywords: "einblicke entwicklung gegner bedenkzeit gewohnheiten" },
  { view: "moves", label: t("Statistik › Züge & Fehler"), key: "3", keywords: t("zugbilanz brillant großartig patzer fehler zugbewertungen") },
  { view: "openings", label: t("Statistik › Eröffnungen"), key: "6", keywords: t("repertoire eröffnungsbaum") },
  { view: "training", label: "Training", key: "7" },
  { view: "players", label: t("Spieler & Rangliste"), key: "0", keywords: "freunde gegner vergleich" },
  { view: "settings", label: t("Einstellungen"), key: "8" },
  { view: "account", label: t("Einstellungen › Konto & Sync"), key: "k" },
];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Fuzzy-ish match: every word of the query appears somewhere in the text. */
function matches(text: string, query: string): boolean {
  const tk = norm(text);
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => tk.includes(w));
}

export function CommandPalette({
  onClose,
  onShortcuts,
}: {
  onClose: () => void;
  onShortcuts: () => void;
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
        group: t("Seiten"),
        label: p.label,
        hint: p.key || undefined,
        keywords: p.keywords,
        run: go({ view: p.view } as Route),
      })),
      { id: "import", group: t("Aktionen"), label: t("Partien importieren"), keywords: t("chess.com lichess pgn laden"), run: go({ view: "games", import: true }) },
      {
        id: "export",
        group: t("Aktionen"),
        label: t("Alle Daten exportieren"),
        keywords: "export sicherung backup json csv pgn datei",
        run: () => void exportData("json", "All Time"),
      },
      {
        id: "export-ai",
        group: t("Aktionen"),
        label: t("Für KI exportieren (letzte 90 Tage)"),
        keywords: "ki ai chatgpt claude gemini export analyse markdown datei",
        run: () => void exportForAi(PAGE_PERIODS.aiExport),
      },
      { id: "theme-dark", group: t("Aktionen"), label: t("Dunkles Design"), keywords: "theme dark nacht", run: () => void setTheme("dark") },
      { id: "theme-light", group: t("Aktionen"), label: t("Helles Design"), keywords: "theme light tag", run: () => void setTheme("light") },
      { id: "theme-system", group: t("Aktionen"), label: t("Design automatisch"), keywords: "theme system", run: () => void setTheme("system") },
      { id: "keys", group: t("Aktionen"), label: t("Tastenkürzel anzeigen"), hint: "?", keywords: "shortcuts hilfe", run: onShortcuts },
    ];
    const lower = names.map((n) => n.toLowerCase());
    const opp = (g: StoredGame) => (lower.includes(g.white.toLowerCase()) ? g.black : g.white);
    const gameCmds: Command[] = games.map((g) => ({
      id: `game-${g.id}`,
      group: t("Partien"),
      label: `${g.white} – ${g.black} ${resultText(g.result)}`,
      hint: formatDate(g.date),
      keywords: `${opp(g)} ${g.opening ?? ""} ${g.date}`,
      run: go({ view: "analysis", gameId: g.id }),
    }));
    // Every statistic by name ("Tageszeit", "Wertungsverlauf"), so nobody has to remember which page holds it.
    const sectionCmds: Command[] = (["profile", "insights", "moves"] as const).flatMap((view) =>
      STAT_SECTIONS[view].map((sec) => ({
        id: `section-${view}-${sec.id}`,
        group: t("Statistiken"),
        label: t("Statistik › {label} › {title}", { label: STATS_PAGES.find((p) => p.view === view)?.label, title: sec.title }),
        hint: sec.cards.slice(0, 3).join(", "),
        keywords: `${sec.sub} ${sec.cards.join(" ")}`,
        run: () => openSection(view, sec.id),
      })),
    );
    if (!query.trim()) return [...base, ...gameCmds.slice(0, 5)];
    return [...base, ...sectionCmds, ...gameCmds].filter((c) => matches(`${c.label} ${c.keywords ?? ""} ${c.group}`, query)).slice(0, 30);
  }, [games, names, query]);

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
      <div class="palette" role="dialog" aria-label={t("Befehle")}>
        <div class="palette-input">
          <IconSearch />
          <input
            ref={input}
            value={query}
            placeholder={t("Seite, Aktion oder Partie suchen …")}
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
          {commands.length === 0 && <div class="muted small palette-empty">{t("Nichts gefunden.")}</div>}
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
            <kbd>↓</kbd>  {t("wählen")}
          </span>
          <span>
            <kbd>↵</kbd>  {t("öffnen")}
          </span>
          <span>
            <kbd>{MOD}</kbd>
            <kbd>K</kbd>  {t("Befehle")}
          </span>
        </div>
      </div>
    </div>
  );
}

const SHORTCUTS: [string, [string, string][]][] = [
  [
    t("Überall"),
    [
      [`${MOD} K`, t("Befehle und Suche")],
      ["1 – 7", t("Seite wechseln")],
      ["?", t("Diese Übersicht")],
    ],
  ],
  [
    t("Partien"),
    [["/", t("Suche")]],
  ],
  [
    t("Analyse"),
    [
      ["← →", t("Zug zurück / vor")],
      [t("Pos1 / Ende, ↑ ↓"), t("Anfang / Ende der Partie")],
      [t("Leertaste"), t("Besten Engine-Zug spielen")],
      ["L", t("{ENGINE_NAME} live ein / aus", { ENGINE_NAME })],
      ["X", t("Drohung zeigen")],
      ["A", t("Pfeile ein / aus")],
      ["N / ⇧ N", t("Nächster / vorheriger eigener Fehler")],
      ["F", t("Brett drehen")],
      ["B", t("Bericht ein- und ausblenden")],
      ["Esc", t("Eigene Variante verlassen (bleibt in der Zugliste)")],
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
      <div class="palette shortcuts" role="dialog" aria-label={t("Tastenkürzel")}>
        <div class="tile-head" style={{ padding: "16px 18px 0" }}>
          <h3 style={{ margin: 0 }}>{t("Tastenkürzel")}</h3>
          <button class="btn small ghost" onClick={onClose}>
            
            {t("Schließen")}
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
