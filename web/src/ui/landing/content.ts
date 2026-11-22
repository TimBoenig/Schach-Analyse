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
  text: t("Analyse, Statistik, Training und Liga sind heute kostenlos. Kein Abo, keine Werbung, keine Kreditkarte, unbegrenzt viele Partien."),
};

/** Who is behind the site; the same person as in the Impressum. Shown only when the visitor opens it. */
export const MAKER = {
  name: "Tim Bönig", // i18n: name
  initials: "TB",
  place: "Hamburg",
  text: t("EndGameKing ist ein Projekt von Tim aus Hamburg. Kein Konzern und keine Werbeplattform, sondern ein Schachwerkzeug, das ein Mensch baut und pflegt, weil er selbst wissen wollte, woran er arbeiten muss. Fragen, Ideen und Fehlermeldungen landen direkt bei ihm."),
};
