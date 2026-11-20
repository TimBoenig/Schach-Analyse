// Shared frame of the statistics pages (Überblick, Ergebnisse, Züge & Fehler,
// Eröffnungen): labelled sections. Every
// statistic has exactly one home, listed in STAT_SECTIONS, so the command
// palette can find a card by its name. The tabs between the pages come from
// the area definition in Layout.tsx.
import type { ComponentChildren } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";

import { IconChevron } from "./icons";
import { AREAS, ShellContext } from "./Layout";
import { navigate, type Route } from "./router";
import { useNarrow } from "./useNarrow";
import { t } from "../i18n";

export type StatsView = "profile" | "moves" | "insights" | "openings";

export const STATS_PAGES: { view: StatsView; label: string; about: string }[] = AREAS.find((a) => a.id === "stats")!.sub.map((s) => ({
  view: s.route.view as StatsView,
  label: s.label,
  about: s.about,
}));

export interface StatSection {
  id: string;
  title: string;
  sub: string;
  /** Card titles in the section, so search finds e.g. "Tageszeit". */
  cards: string[];
}

export const STAT_SECTIONS: Record<"profile" | "insights" | "moves", StatSection[]> = {
  profile: [
    { id: "ueberblick", title: t("Überblick"), sub: t("Wertung, Bilanz, Erwartung und Genauigkeit"), cards: [t("Wertung"), t("Bilanz"), t("Punkte gegen Erwartung")] },
    { id: "faehigkeiten", title: t("Fähigkeiten"), sub: t("von 0 bis 100, verglichen mit Spielern deiner Wertung"), cards: [t("Fähigkeiten-Netz"), t("Fähigkeiten im Detail")] },
    { id: "staerken", title: t("Stärken und Schwächen"), sub: t("nur was viele Partien klar zeigen"), cards: [t("Stärken"), t("Schwächen")] },
    { id: "stil", title: t("Stil und Muster"), sub: t("wie du spielst und was immer wieder passiert"), cards: [t("Spielstil"), t("Wiederkehrende Muster")] },
    { id: "verlauf", title: t("Wertung und Genauigkeit"), sub: t("wie sich beides über die Monate entwickelt"), cards: [t("Wertungsverlauf"), t("Genauigkeit im Verlauf")] },
  ],
  insights: [
    { id: "blick", title: t("Auf einen Blick"), sub: t("die wichtigsten Befunde aus deinen Partien"), cards: [t("Persönliches Feedback"), t("Das Wichtigste")] },
    { id: "entwicklung", title: t("Entwicklung"), sub: t("wird dein Spiel besser?"), cards: [t("Deine Entwicklung"), t("Was sich verändert hat")] },
    { id: "ergebnisse", title: t("Gegner und Partietyp"), sub: t("wo du Punkte holst und wo du sie liegen lässt"), cards: [t("Gegen die Erwartung"), t("Nach Gegnerstärke"), t("Nach Partietyp"), t("Nach Bedenkzeit"), t("Nach Farbe"), t("Nach Partielänge")] },
    { id: "verlauf", title: t("Partieverlauf"), sub: t("wann Partien kippen und wie konstant du spielst"), cards: [t("Wo deine Partien kippen"), t("Wendepunkte"), t("Konstanz"), t("Genauigkeit nach Ergebnis")] },
    { id: "gewohnheiten", title: t("Zeit und Gewohnheiten"), sub: t("Bedenkzeit, Tageszeit, Serien und Tilt"), cards: [t("Bedenkzeit pro Zug"), t("Unter Druck"), t("Tageszeit"), t("Wochentag"), t("Nach dem letzten Ergebnis"), t("Partie in der Serie")] },
  ],
  moves: [
    { id: "bilanz", title: t("Zugbilanz"), sub: t("jede Bewertung aus deinen analysierten Partien"), cards: [t("Alle Zugarten"), t("Was die Zahlen zeigen"), t("Wenn dein Gegner patzt")] },
    { id: "verlauf", title: t("Verlauf"), sub: t("werden deine Züge besser?"), cards: [t("Bester Zug oder besser"), t("Grobe Fehler je 100 Züge")] },
    { id: "phasen", title: t("Partiephasen"), sub: t("Eröffnung, Mittelspiel und Endspiel im Vergleich"), cards: [t("Genauigkeit nach Phase"), t("Zugarten nach Phase")] },
    { id: "fehler", title: t("Fehler"), sub: t("wann, womit und in welcher Lage du patzt"), cards: [t("Wo deine Fehler passieren"), t("Fehler-Landkarte"), t("Was dich Patzer kosten")] },
    { id: "glanz", title: t("Glanzzüge und Rekorde"), sub: t("deine besten Momente"), cards: [t("Rekorde"), t("Deine Glanzzüge"), t("Deine glänzendsten Partien")] },
  ],
};

// A section asked for from another page (command palette, start page); the
// target page scrolls there once its sections are on screen.
let pendingSection: string | null = null;

export function openSection(view: StatsView, id: string): void {
  pendingSection = id;
  navigate({ view } as Route);
  // Same page: no remount, so scroll right away.
  window.setTimeout(() => scrollToSection(id), 60);
}

export function scrollToSection(id: string): boolean {
  const el = document.getElementById(`s-${id}`);
  if (!el) return false;
  // On phones the section may be folded: open it, then scroll once its cards are there.
  window.dispatchEvent(new CustomEvent(UNFOLD_EVENT, { detail: id }));
  window.setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  pendingSection = null;
  return true;
}

// ---------- folded sections on phones ----------
//
// A statistics page is five sections of several cards each: on a phone that is
// a column of 7,000 pixels and more. There each section folds down to its
// heading, so the page opens as a short table of contents and only the
// sections someone asks for are built.

const UNFOLD_EVENT = "stats:unfold";
const FOLD_KEY = "schach.sections";

function readFolds(): Record<string, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(FOLD_KEY) ?? "{}");
    return raw && typeof raw === "object" ? (raw as Record<string, boolean>) : {};
  } catch {
    // Storage blocked (private mode): every visit starts with the defaults.
    return {};
  }
}

let folds: Record<string, boolean> | null = null;

function saveFold(key: string, open: boolean): void {
  folds = { ...(folds ?? readFolds()), [key]: open };
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify(folds));
  } catch {
    // Not saved: the choice still holds until the page is closed.
  }
}

/** Whether a section is open on this device; the choice is kept per page and section. */
function useFold(key: string, defaultOpen: boolean, id: string): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => (folds ??= readFolds())[key] ?? defaultOpen);
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail === id) setOpen(true);
    };
    window.addEventListener(UNFOLD_EVENT, on);
    return () => window.removeEventListener(UNFOLD_EVENT, on);
  }, [id]);
  return [
    open,
    (next) => {
      setOpen(next);
      saveFold(key, next);
    },
  ];
}

/**
 * Scrolls to a section asked for from another page once this page's sections
 * are on screen. Renders nothing: the tabs of the area are the only bar in the
 * header, and the section headings (folding ones on phones) are the index.
 */
export function SectionJump({ sections }: { sections: StatSection[] }) {
  useEffect(() => {
    if (pendingSection && sections.some((s) => s.id === pendingSection)) {
      const id = pendingSection;
      window.setTimeout(() => scrollToSection(id), 80);
    }
  }, [sections.map((s) => s.id).join()]);
  return null;
}

/**
 * Heading of one section inside a `.dash` grid; the cards follow as siblings.
 * `quiet` keeps only the jump target: a section that opens with a hero needs
 * no second headline above it.
 */
export function SectionHead({ section, children, quiet }: { section: StatSection; children?: ComponentChildren; quiet?: boolean }) {
  if (quiet) return <div class="section-anchor span-12" id={`s-${section.id}`} />;
  return (
    <div class="section-head span-12" id={`s-${section.id}`}>
      <h2>{section.title}</h2>
      <span class="tile-sub">{section.sub}</span>
      {children && <span class="spacer" />}
      {children}
    </div>
  );
}

/**
 * One section of a `.dash` grid: its heading and, as siblings, its cards. On
 * phones the heading is a button that folds the cards away; on wider screens
 * everything is always shown.
 */
export function Section({
  section,
  children,
  quiet,
  defaultOpen = false,
  phoneOnly = false,
}: {
  section: StatSection;
  children?: ComponentChildren;
  /** Opens with a hero instead of a headline; never folds. */
  quiet?: boolean;
  /** Open on a phone until the user folds it. */
  defaultOpen?: boolean;
  /** A grouping only phones need: wider screens show the cards without a heading. */
  phoneOnly?: boolean;
}) {
  const { route } = useContext(ShellContext);
  const narrow = useNarrow();
  const [open, setOpen] = useFold(`${route.view}:${section.id}`, defaultOpen, section.id);
  if (quiet) {
    return (
      <>
        <SectionHead section={section} quiet />
        {children}
      </>
    );
  }
  if (!narrow) {
    return (
      <>
        {!phoneOnly && <SectionHead section={section} />}
        {children}
      </>
    );
  }
  return (
    <>
      <div class={`section-head section-fold span-12${open ? " open" : ""}`} id={`s-${section.id}`}>
        <button
          class="section-toggle"
          aria-expanded={open}
          onClick={(e) => {
            const head = e.currentTarget;
            setOpen(!open);
            window.setTimeout(() => {
              const top = head.getBoundingClientRect().top;
              // Folding a long section away must not leave the reader in the middle of the next one;
              // opening one low on the screen brings its cards up from behind the tab bar.
              if (open ? top < 0 : top > window.innerHeight * 0.4) head.scrollIntoView({ behavior: open ? "auto" : "smooth", block: "start" });
            }, 0);
          }}
        >
          <span class="section-toggle-text">
            <h2>{section.title}</h2>
            <span class="tile-sub">{section.sub}</span>
          </span>
          <span class="section-toggle-icon" aria-hidden="true">
            <IconChevron />
          </span>
        </button>
      </div>
      {open && children}
    </>
  );
}

export type ProfileSection = "ueberblick" | "faehigkeiten" | "staerken" | "stil" | "verlauf";
export type InsightsSection = "blick" | "entwicklung" | "ergebnisse" | "verlauf" | "gewohnheiten";
export type MovesSection = "bilanz" | "verlauf" | "phasen" | "fehler" | "glanz";

/** Looks a section up by its (type-checked) id. */
export function sectionOf(view: "profile", id: ProfileSection): StatSection;
export function sectionOf(view: "insights", id: InsightsSection): StatSection;
export function sectionOf(view: "moves", id: MovesSection): StatSection;
export function sectionOf(view: "profile" | "insights" | "moves", id: string): StatSection {
  return STAT_SECTIONS[view].find((x) => x.id === id) ?? { id, title: id, sub: "", cards: [] };
}
