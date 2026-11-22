// Everything on the landing page that is a promise or a person's words, in one
// place, so it can be checked and changed without touching the layout.
// Rule: nothing invented. Quotes only from real users, with their consent.
import { t } from "../../i18n";

export interface Quote {
  text: string;
  /** How the person wants to be named, e.g. "Jonas, Blitz um 1400". */
  who: string;
}

/**
 * Real feedback from players. The section stays hidden while this is empty,
 * because made-up praise does more harm than none.
 */
export const QUOTES: Quote[] = [];

/** What the app costs today. */
export const PRICE = {
  headline: "Kostenlos.",
  text: t("Analyse, Statistik, Training und Liga: alles, was du hier siehst, ist heute kostenlos. Kein Abo, keine Werbung, keine Kreditkarte."),
  points: [t("Unbegrenzt viele Partien analysieren"), t("Tägliches Training aus deinen Fehlern"), t("Liga und Vergleich mit Freunden"), t("Konto nur, wenn du mehrere Geräte nutzen willst")],
};

/** Who is behind the site; the same person as in the Impressum. */
export const MAKER = {
  name: "Tim Bönig", // i18n: name
  initials: "TB",
  place: "Hamburg",
  text: t("EndGameKing ist ein Projekt von Tim aus Hamburg. Kein Konzern und keine Werbeplattform, sondern ein Schachwerkzeug, das ein Mensch baut und pflegt. Fragen, Ideen und Fehlermeldungen landen direkt bei ihm."),
  source: "https://github.com/TimBoenig/Schach-Analyse",
};
