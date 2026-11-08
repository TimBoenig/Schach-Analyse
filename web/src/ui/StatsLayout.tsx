// Shared frame of the statistics pages (Überblick, Ergebnisse, Züge & Fehler,
// Eröffnungen): a sticky "Springe zu" index and labelled sections. Every
// statistic has exactly one home, listed in STAT_SECTIONS, so the command
// palette can find a card by its name. The tabs between the pages come from
// the area definition in Layout.tsx.
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

import { AREAS } from "./Layout";
import { navigate, type Route } from "./router";

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
    { id: "ueberblick", title: "Überblick", sub: "Wertung, Bilanz, Erwartung und Genauigkeit", cards: ["Wertung", "Bilanz", "Punkte gegen Erwartung"] },
    { id: "faehigkeiten", title: "Fähigkeiten", sub: "von 0 bis 100, verglichen mit Spielern deiner Wertung", cards: ["Fähigkeiten-Netz", "Fähigkeiten im Detail"] },
    { id: "staerken", title: "Stärken und Schwächen", sub: "nur was viele Partien klar zeigen", cards: ["Stärken", "Schwächen"] },
    { id: "stil", title: "Stil und Muster", sub: "wie du spielst und was immer wieder passiert", cards: ["Spielstil", "Wiederkehrende Muster"] },
    { id: "verlauf", title: "Wertung und Genauigkeit", sub: "wie sich beides über die Monate entwickelt", cards: ["Wertungsverlauf", "Genauigkeit im Verlauf"] },
  ],
  insights: [
    { id: "blick", title: "Auf einen Blick", sub: "die wichtigsten Befunde aus deinen Partien", cards: ["Persönliches Feedback", "Das Wichtigste"] },
    { id: "entwicklung", title: "Entwicklung", sub: "wird dein Spiel besser?", cards: ["Deine Entwicklung", "Was sich verändert hat"] },
    { id: "ergebnisse", title: "Gegner und Partietyp", sub: "wo du Punkte holst und wo du sie liegen lässt", cards: ["Gegen die Erwartung", "Nach Gegnerstärke", "Nach Partietyp", "Nach Bedenkzeit", "Nach Farbe", "Nach Partielänge"] },
    { id: "verlauf", title: "Partieverlauf", sub: "wann Partien kippen und wie konstant du spielst", cards: ["Wo deine Partien kippen", "Wendepunkte", "Konstanz", "Genauigkeit nach Ergebnis"] },
    { id: "gewohnheiten", title: "Zeit und Gewohnheiten", sub: "Bedenkzeit, Tageszeit, Serien und Tilt", cards: ["Bedenkzeit pro Zug", "Unter Druck", "Tageszeit", "Wochentag", "Nach dem letzten Ergebnis", "Partie in der Serie"] },
  ],
  moves: [
    { id: "bilanz", title: "Zugbilanz", sub: "jede Bewertung aus deinen analysierten Partien", cards: ["Alle Bewertungen", "Du gegen deine Gegner", "Was die Zahlen zeigen"] },
    { id: "verlauf", title: "Verlauf", sub: "werden deine Züge besser?", cards: ["Zugqualität im Verlauf"] },
    { id: "phasen", title: "Partiephasen", sub: "Eröffnung, Mittelspiel und Endspiel im Vergleich", cards: ["Genauigkeit nach Phase", "Nach Partiephase"] },
    { id: "fehler", title: "Fehler", sub: "wann, wo und womit du patzt", cards: ["Fehler pro Partie", "Wann du patzt", "Fehler nach Figur", "Fehler-Landkarte", "Nach Stellungslage"] },
    { id: "glanz", title: "Glanzzüge und Rekorde", sub: "deine besten Momente", cards: ["Rekorde", "Deine Glanzzüge", "Deine glänzendsten Partien"] },
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

function scrollToSection(id: string): boolean {
  const el = document.getElementById(`s-${id}`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  pendingSection = null;
  return true;
}

/** Sticky index of the sections on this page; marks the one in view. */
export function SectionNav({ sections }: { sections: StatSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  useEffect(() => {
    if (pendingSection && sections.some((s) => s.id === pendingSection)) {
      const id = pendingSection;
      window.setTimeout(() => scrollToSection(id), 80);
    }
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id.slice(2));
      },
      // A heading counts as current while it is in the upper part of the screen.
      { rootMargin: "-10% 0px -70% 0px" },
    );
    for (const s of sections) {
      const el = document.getElementById(`s-${s.id}`);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [sections.map((s) => s.id).join()]);
  return (
    <nav class="section-nav" aria-label="Auf dieser Seite">
      <span class="section-nav-label faint small">Springe zu</span>
      {sections.map((s) => (
        <button key={s.id} class={`chip${active === s.id ? " on" : ""}`} onClick={() => scrollToSection(s.id)}>
          {s.title}
        </button>
      ))}
    </nav>
  );
}

/** Heading of one section inside a `.dash` grid; the cards follow as siblings. */
export function SectionHead({ section, children }: { section: StatSection; children?: ComponentChildren }) {
  return (
    <div class="section-head span-12" id={`s-${section.id}`}>
      <h2>{section.title}</h2>
      <span class="tile-sub">{section.sub}</span>
      {children && <span class="spacer" />}
      {children}
    </div>
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
