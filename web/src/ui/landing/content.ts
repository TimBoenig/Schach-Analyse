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
  text: t("Ja, komplett. Analyse, Statistik, Training und Liga kosten nichts: kein Abo, keine Werbung, keine Kreditkarte, unbegrenzt viele Partien."),
};

/** Who is behind the site; the same person as in the Impressum. Shown only when the visitor opens it. */
export const MAKER = {
  name: "Tim Bönig", // i18n: name
  initials: "TB",
  place: "Hamburg",
  text: t("Ich bin Tim und baue EndGameKing allein, in Hamburg. Ich wollte nicht nur wissen, welchen Zug ich in einer Partie verpasst habe, sondern woran ich insgesamt arbeiten muss. Dahinter steht kein Konzern und keine Werbeplattform. Fragen, Ideen und Fehlermeldungen lese ich selbst."),
};
