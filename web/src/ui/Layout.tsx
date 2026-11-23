// The app's information architecture in one place: five areas (Start,
// Partien, Statistik, Training, Spieler) plus Einstellungen, each with its
// sub-pages. The sidebar, the phone tab bar, the tabs under every page title
// and the command palette all read AREAS, so a page is always found in the
// same spot.
import type { ComponentChildren, JSX } from "preact";
import { createContext } from "preact";
import { useContext, useEffect, useRef } from "preact/hooks";

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
import { ENGINE_NAME } from "../engine/info";
import { t } from "../i18n";

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
    label: t("Start"),
    hint: t("Dein Tag auf einen Blick"),
    icon: IconHome,
    sub: [{ label: t("Start"), about: "", route: { view: "home" }, match: is("home") }],
  },
  {
    id: "games",
    label: t("Partien"),
    hint: t("Importieren, analysieren, nachspielen"),
    icon: IconGames,
    sub: [
      // A game opens from the list; its analysis counts as part of this page.
      {
        label: t("Alle Partien"),
        about: t("Deine Partien importieren, analysieren lassen und durchsehen."),
        route: { view: "games" },
        match: (r) => r.view === "games" || r.view === "analysis",
      },
      { label: t("Analysebrett"), about: t("Stellungen frei ausprobieren, mit {ENGINE_NAME}.", { ENGINE_NAME }), route: { view: "board" }, match: is("board") },
    ],
  },
  {
    id: "stats",
    label: t("Statistik"),
    hint: t("Profil, Ergebnisse, Züge, Eröffnungen"),
    icon: IconInsights,
    sub: [
      {
        label: t("Überblick"),
        about: t("Wer du als Spieler bist: Wertung, Fähigkeiten, Stärken und Schwächen, Stil."),
        route: { view: "profile" },
        match: is("profile"),
      },
      {
        label: t("Ergebnisse"),
        about: t("Wo du Punkte holst und liegen lässt: Entwicklung, Gegner, Bedenkzeit, Partieverlauf, Gewohnheiten."),
        route: { view: "insights" },
        match: is("insights"),
      },
      {
        label: t("Züge & Fehler"),
        about: t("Jeder Zug gezählt, von brillant bis Patzer, und wann, wo und womit Fehler passieren."),
        route: { view: "moves" },
        match: is("moves"),
      },
      {
        label: t("Eröffnungen"),
        about: t("Dein Repertoire: Erfolg je Eröffnung, Eröffnungsbaum und Lücken."),
        route: { view: "openings" },
        match: is("openings"),
      },
    ],
  },
  {
    id: "training",
    label: "Training",
    hint: t("Tagesplan, Übungen, Fortschritt"),
    icon: IconTraining,
    sub: [
      { label: t("Heute"), about: "", route: { view: "training" }, match: is("training", (r) => !r.tab || r.tab === "heute") },
      { label: t("Übungen"), about: "", route: { view: "training", tab: "uebungen" }, match: is("training", (r) => r.tab === "uebungen") },
      { label: t("Fortschritt"), about: "", route: { view: "training", tab: "fortschritt" }, match: is("training", (r) => r.tab === "fortschritt") },
    ],
  },
  {
    id: "players",
    label: t("Spieler"),
    hint: t("Freunde, Gegner, Rangliste, Trophäen"),
    icon: IconPlayers,
    sub: [
      { label: t("Rangliste"), about: "", route: { view: "players", tab: "rangliste" }, match: is("players", (r) => r.tab === "rangliste") },
      { label: t("Gegner & Freunde"), about: "", route: { view: "players" }, match: is("players", (r) => r.tab !== "rangliste") },
      { label: t("Trophäen"), about: "", route: { view: "trophies" }, match: is("trophies") },
    ],
  },
  {
    id: "settings",
    label: t("Einstellungen"),
    hint: t("Namen, Analyse, Daten, Konto"),
    icon: IconSettings,
    sub: [
      { label: t("Allgemein"), about: "", route: { view: "settings" }, match: is("settings", (r) => !r.tab) },
      { label: t("Analyse"), about: "", route: { view: "settings", tab: "analyse" }, match: is("settings", (r) => r.tab === "analyse") },
      { label: t("Daten & Export"), about: "", route: { view: "settings", tab: "daten" }, match: is("settings", (r) => r.tab === "daten") },
      { label: t("Konto"), about: "", route: { view: "account" }, match: is("account") },
      { label: t("Rechtliches"), about: "", route: { view: "legal" }, match: is("legal") },
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
export function AreaTabs() {
  const { route } = useContext(ShellContext);
  const area = areaOf(route);
  const current = subPageOf(route);
  const row = useRef<HTMLElement>(null);
  // On a phone the row can be wider than the screen: keep the open tab in
  // view and mark the side that holds more, so CSS can fade it out.
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const mark = () => {
      const start = el.scrollLeft > 4;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
      el.dataset.more = start && end ? "both" : start ? "start" : end ? "end" : "";
    };
    const active = el.querySelector<HTMLElement>("button.active");
    if (active) el.scrollLeft = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2;
    mark();
    el.addEventListener("scroll", mark, { passive: true });
    window.addEventListener("resize", mark);
    return () => {
      el.removeEventListener("scroll", mark);
      window.removeEventListener("resize", mark);
    };
  }, [current?.label, area.id]);
  if (area.sub.length < 2) return null;
  return (
    <div class="area-tabs">
      <nav class="area-tabs-row" ref={row} aria-label={t("{label}: Bereiche", { label: area.label })}>
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
    </div>
  );
}

/**
 * Head of a page: the area as a small line, the page as the title, filters
 * and actions on the right, then the tabs of the area (where the sidebar does
 * not already list them).
 */
export function PageHeader({
  title,
  actions,
  toolbar,
  tabs = true,
  class: cls,
}: {
  title?: ComponentChildren;
  actions?: ComponentChildren;
  /** Filters: beside the title on wide screens, under the tabs on narrow ones. */
  toolbar?: ComponentChildren;
  tabs?: boolean;
  class?: string;
}) {
  const { route, openPalette } = useContext(ShellContext);
  const area = areaOf(route);
  const page = subPageOf(route);
  // An area with one page is its own title; otherwise the page names itself
  // and the area stands above it.
  const named = area.sub.length > 1 && page ? page.label : area.label;
  const eyebrow = title === undefined && area.sub.length > 1 ? area.label : null;
  return (
    <header class={`ph${cls ? ` ${cls}` : ""}`}>
      <div class="ph-row">
        <div class="ph-titles">
          {eyebrow && <span class="ph-eyebrow">{eyebrow}</span>}
          <h1 class="ph-title">{title ?? named}</h1>
        </div>
        <span class="ph-spacer" />
        {toolbar && <div class="ph-tools wide">{toolbar}</div>}
        {actions}
        <span class="ph-mobile">
          <button class="btn icon ghost" onClick={openPalette} aria-label={t("Suchen")}>
            <IconSearch />
          </button>
          {area.id !== "settings" && (
            <button class="btn icon ghost" onClick={() => navigate({ view: "settings" })} aria-label={t("Einstellungen")}>
              <IconSettings />
            </button>
          )}
        </span>
      </div>
      {tabs && <AreaTabs />}
      {toolbar && <div class="ph-tools narrow">{toolbar}</div>}
    </header>
  );
}
