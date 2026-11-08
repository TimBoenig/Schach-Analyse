// The app's information architecture in one place: five areas (Start,
// Partien, Statistik, Training, Spieler) plus Einstellungen, each with its
// sub-pages. The sidebar, the phone tab bar, the tabs under every page title
// and the command palette all read AREAS, so a page is always found in the
// same spot.
import type { ComponentChildren, JSX } from "preact";
import { createContext } from "preact";
import { useContext } from "preact/hooks";

import {
  IconGames,
  IconHome,
  IconInsights,
  IconPlayers,
  IconSearch,
  IconSettings,
  IconTraining,
} from "./icons";
import { navigate, type Route } from "./router";

export type AreaId = "home" | "games" | "stats" | "training" | "players" | "settings";

export interface SubPage {
  label: string;
  /** One line on what the page holds, shown under the tabs and in search. */
  about: string;
  route: Route;
  /** Whether the current route belongs to this sub-page. */
  match: (r: Route) => boolean;
}

export interface Area {
  id: AreaId;
  label: string;
  hint: string;
  icon: () => JSX.Element;
  sub: SubPage[];
}

const is = <V extends Route["view"]>(view: V, extra?: (r: Extract<Route, { view: V }>) => boolean) => (r: Route) =>
  r.view === view && (!extra || extra(r as Extract<Route, { view: V }>));

export const AREAS: Area[] = [
  {
    id: "home",
    label: "Start",
    hint: "Dein Tag auf einen Blick",
    icon: IconHome,
    sub: [{ label: "Start", about: "", route: { view: "home" }, match: is("home") }],
  },
  {
    id: "games",
    label: "Partien",
    hint: "Importieren, analysieren, nachspielen",
    icon: IconGames,
    sub: [
      // A game opens from the list; its analysis counts as part of this page.
      {
        label: "Alle Partien",
        about: "Deine Partien importieren, analysieren lassen und durchsehen.",
        route: { view: "games" },
        match: (r) => r.view === "games" || r.view === "analysis",
      },
      { label: "Analysebrett", about: "Stellungen frei ausprobieren, mit Stockfish.", route: { view: "board" }, match: is("board") },
    ],
  },
  {
    id: "stats",
    label: "Statistik",
    hint: "Profil, Ergebnisse, Züge, Eröffnungen",
    icon: IconInsights,
    sub: [
      {
        label: "Überblick",
        about: "Wer du als Spieler bist: Wertung, Fähigkeiten, Stärken und Schwächen, Stil.",
        route: { view: "profile" },
        match: is("profile"),
      },
      {
        label: "Ergebnisse",
        about: "Wo du Punkte holst und liegen lässt: Entwicklung, Gegner, Bedenkzeit, Partieverlauf, Gewohnheiten.",
        route: { view: "insights" },
        match: is("insights"),
      },
      {
        label: "Züge & Fehler",
        about: "Jeder Zug gezählt, von brillant bis Patzer, und wann, wo und womit Fehler passieren.",
        route: { view: "moves" },
        match: is("moves"),
      },
      {
        label: "Eröffnungen",
        about: "Dein Repertoire: Erfolg je Eröffnung, Eröffnungsbaum und Lücken.",
        route: { view: "openings" },
        match: is("openings"),
      },
    ],
  },
  {
    id: "training",
    label: "Training",
    hint: "Tagesplan, Übungen, Fortschritt",
    icon: IconTraining,
    sub: [
      { label: "Heute", about: "", route: { view: "training" }, match: is("training", (r) => !r.tab || r.tab === "heute") },
      { label: "Übungen", about: "", route: { view: "training", tab: "uebungen" }, match: is("training", (r) => r.tab === "uebungen") },
      { label: "Fortschritt", about: "", route: { view: "training", tab: "fortschritt" }, match: is("training", (r) => r.tab === "fortschritt") },
    ],
  },
  {
    id: "players",
    label: "Spieler",
    hint: "Freunde, Gegner, Rangliste",
    icon: IconPlayers,
    sub: [
      { label: "Gegner & Freunde", about: "", route: { view: "players" }, match: is("players", (r) => r.tab !== "rangliste") },
      { label: "Rangliste", about: "", route: { view: "players", tab: "rangliste" }, match: is("players", (r) => r.tab === "rangliste") },
    ],
  },
  {
    id: "settings",
    label: "Einstellungen",
    hint: "Namen, Analyse, Daten, Konto",
    icon: IconSettings,
    sub: [
      { label: "Allgemein", about: "", route: { view: "settings" }, match: is("settings", (r) => !r.tab) },
      { label: "Analyse", about: "", route: { view: "settings", tab: "analyse" }, match: is("settings", (r) => r.tab === "analyse") },
      { label: "Daten & Export", about: "", route: { view: "settings", tab: "daten" }, match: is("settings", (r) => r.tab === "daten") },
      { label: "Konto", about: "", route: { view: "account" }, match: is("account") },
    ],
  },
];

/** The main areas in the sidebar and the phone tab bar (Einstellungen sits apart). */
export const MAIN_AREAS = AREAS.filter((a) => a.id !== "settings");

export function areaOf(r: Route): Area {
  return AREAS.find((a) => a.sub.some((s) => s.match(r))) ?? AREAS[0];
}

export function subPageOf(r: Route): SubPage | undefined {
  return areaOf(r).sub.find((s) => s.match(r));
}

interface Shell {
  route: Route;
  openPalette: () => void;
}

export const ShellContext = createContext<Shell>({ route: { view: "home" }, openPalette: () => undefined });

/** Tabs between the sub-pages of the current area. */
export function AreaTabs({ about = true }: { about?: boolean }) {
  const { route } = useContext(ShellContext);
  const area = areaOf(route);
  const current = subPageOf(route);
  if (area.sub.length < 2) return null;
  return (
    <div class="area-tabs">
      <nav class="area-tabs-row" aria-label={`${area.label}: Bereiche`}>
        {area.sub.map((s) => {
          const on = s === current;
          return (
            <button
              key={s.label}
              class={on ? "active" : ""}
              aria-current={on ? "page" : undefined}
              onClick={() => navigate(s.route, s.route.view === route.view)}
            >
              {s.label}
            </button>
          );
        })}
      </nav>
      {about && current?.about && <p class="area-about small muted">{current.about}</p>}
    </div>
  );
}

/**
 * Title row of a page: area name (or a custom title), actions on the right,
 * search and settings on phones (the tab bar has no room for them), then the
 * tabs of the area.
 */
export function PageHeader({
  title,
  actions,
  toolbar,
  tabs = true,
  about = true,
  class: cls,
}: {
  title?: ComponentChildren;
  actions?: ComponentChildren;
  /** Filters: beside the title on wide screens, under the tabs on narrow ones. */
  toolbar?: ComponentChildren;
  tabs?: boolean;
  about?: boolean;
  class?: string;
}) {
  const { route, openPalette } = useContext(ShellContext);
  const area = areaOf(route);
  return (
    <header class={`page-head${cls ? ` ${cls}` : ""}`}>
      <div class="page-title">
        {title === undefined && (
          <span class="page-mark" aria-hidden="true">
            <area.icon />
          </span>
        )}
        {title ?? area.label}
        <span class="spacer" />
        {toolbar && <span class="page-toolbar wide">{toolbar}</span>}
        {actions}
        <span class="mobile-tools">
          <button class="btn icon ghost" onClick={openPalette} aria-label="Suchen">
            <IconSearch />
          </button>
          {area.id !== "settings" && (
            <button class="btn icon ghost" onClick={() => navigate({ view: "settings" })} aria-label="Einstellungen">
              <IconSettings />
            </button>
          )}
        </span>
      </div>
      {tabs && <AreaTabs about={about} />}
      {toolbar && <div class="page-toolbar narrow">{toolbar}</div>}
    </header>
  );
}

