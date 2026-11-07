// Shared frame of the statistics pages (Profil, Zugbilanz, Einblicke,
// Eröffnungen): tabs between the pages, a sticky "Auf dieser Seite" index and
// labelled sections. Every statistic has exactly one home, listed in
// STAT_SECTIONS, so the command palette can find a card by its name.
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

import { navigate, type Route } from "./router";

export type StatsView = "profile" | "moves" | "insights" | "openings";

export const STATS_PAGES: { view: StatsView; label: string; about: string }[] = [
  { view: "profile", label: "Profil", about: "Wer du als Spieler bist: Fähigkeiten, Stärken und Schwächen, Stil, Trainingsschwerpunkte." },
  { view: "moves", label: "Zugbilanz", about: "Jeder deiner Züge gezählt, von brillant bis Patzer, mit Rekorden und Verlauf." },
  { view: "insights", label: "Einblicke", about: "Alle Detailzahlen: Entwicklung, Ergebnisse, Fehler, Zeit und Gewohnheiten." },
  { view: "openings", label: "Eröffnungen", about: "Dein Repertoire: Erfolg je Eröffnung, Eröffnungsbaum und Lücken." },
];

export interface StatSection {
  id: string;
  title: string;
  sub: string;
  /** Card titles in the section, so search finds e.g. "Tageszeit". */
  cards: string[];
}

export const STAT_SECTIONS: Record<"profile" | "insights", StatSection[]> = {
  profile: [
    { id: "ueberblick", title: "Überblick", sub: "Wertung, Bilanz, Erwartung und Genauigkeit", cards: ["Wertung", "Bilanz", "Punkte gegen Erwartung"] },
    { id: "faehigkeiten", title: "Fähigkeiten", sub: "von 0 bis 100, verglichen mit Spielern deiner Wertung", cards: ["Fähigkeiten-Netz", "Fähigkeiten im Detail"] },
    { id: "staerken", title: "Stärken und Schwächen", sub: "nur was viele Partien klar zeigen", cards: ["Stärken", "Schwächen"] },
    { id: "stil", title: "Stil und Muster", sub: "wie du spielst und was immer wieder passiert", cards: ["Spielstil", "Wiederkehrende Muster"] },
    { id: "genauigkeit", title: "Genauigkeit und Wertung", sub: "Phasen, Zugqualität und Verlauf über die Zeit", cards: ["Genauigkeit nach Phase", "Zugqualität", "Genauigkeit im Verlauf", "Wertungsverlauf"] },
    { id: "eroeffnungen", title: "Eröffnungen", sub: "beste und schwächste Linien, alles Weitere auf der Eröffnungsseite", cards: ["Erfolgreichste Eröffnungen"] },
    { id: "training", title: "Training", sub: "woran du als Nächstes arbeiten solltest", cards: ["Trainingsschwerpunkte"] },
  ],
  insights: [
    { id: "blick", title: "Auf einen Blick", sub: "die wichtigsten Befunde aus deinen Partien", cards: ["Persönliches Feedback", "Das Wichtigste"] },
    { id: "entwicklung", title: "Entwicklung", sub: "wird dein Spiel besser?", cards: ["Deine Entwicklung", "Was sich verändert hat"] },
    { id: "ergebnisse", title: "Ergebnisse", sub: "wo du Punkte holst und wo du sie liegen lässt", cards: ["Gegen die Erwartung", "Nach Gegnerstärke", "Nach Partietyp", "Nach Bedenkzeit", "Nach Farbe", "Nach Partielänge"] },
    { id: "verlauf", title: "Partieverlauf", sub: "wann Partien kippen und wie konstant du spielst", cards: ["Wo deine Partien kippen", "Wendepunkte", "Konstanz", "Genauigkeit nach Ergebnis"] },
    { id: "fehler", title: "Fehler", sub: "wann, wo und womit du patzt", cards: ["Fehler pro Partie", "Wann du patzt", "Fehler nach Figur", "Fehler-Landkarte", "Nach Stellungslage"] },
    { id: "gewohnheiten", title: "Zeit und Gewohnheiten", sub: "Bedenkzeit, Tageszeit, Serien und Tilt", cards: ["Bedenkzeit pro Zug", "Unter Druck", "Tageszeit", "Wochentag", "Nach dem letzten Ergebnis", "Partie in der Serie"] },
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

/** Tabs between the statistics pages with a line on what the current one holds. */
export function StatsTabs({ current }: { current: StatsView }) {
  const page = STATS_PAGES.find((p) => p.view === current);
  return (
    <div class="stats-tabs">
      <nav class="stats-tabs-row" aria-label="Statistik-Seiten">
        {STATS_PAGES.map((p) => (
          <button
            key={p.view}
            class={p.view === current ? "active" : ""}
            aria-current={p.view === current ? "page" : undefined}
            onClick={() => navigate({ view: p.view } as Route)}
          >
            {p.label}
          </button>
        ))}
      </nav>
      {page && <p class="stats-about small muted">{page.about}</p>}
    </div>
  );
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

export type ProfileSection = "ueberblick" | "faehigkeiten" | "staerken" | "stil" | "genauigkeit" | "eroeffnungen" | "training";
export type InsightsSection = "blick" | "entwicklung" | "ergebnisse" | "verlauf" | "fehler" | "gewohnheiten";

/** Looks a section up by its (type-checked) id. */
export function sectionOf(view: "profile", id: ProfileSection): StatSection;
export function sectionOf(view: "insights", id: InsightsSection): StatSection;
export function sectionOf(view: "profile" | "insights", id: string): StatSection {
  return STAT_SECTIONS[view].find((x) => x.id === id) ?? { id, title: id, sub: "", cards: [] };
}
