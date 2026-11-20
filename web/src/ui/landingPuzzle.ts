// The landing page's mini puzzle, kept apart from the view so a test can prove
// it really is a mate in one with exactly one solution.
/** Back-rank mate in one (Rd8#): small enough to read on a phone, satisfying to find. */
import { t } from "../i18n";

export const PUZZLE_FEN = "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1";
/** The arrow shown after two misses. */
export const PUZZLE_HINT = { from: "d1", to: "d8" } as const;

/**
 * The "how it works" demo: a short, well-known trap (Scholar's mate) that the
 * board plays on a loop while Lucena comments. Only labels that are plain chess
 * facts: 3...Sf6 allows mate in one, 4.Dxf7 is that mate.
 */
export const DEMO_LINE: { san: string; say: string; badge?: "Blunder" | "Best"; arrow?: { from: string; to: string } }[] = [
  { san: "e4", say: t("Ich spiele jede Partie Zug für Zug nach.") },
  { san: "e5", say: t("Für jede Stellung rechnet die Engine die besten Fortsetzungen aus.") },
  { san: "Bc4", say: t("Die ersten Züge vergleiche ich mit dem Eröffnungsbuch.") },
  { san: "Nc6", say: t("Weiß zielt mit Läufer und gleich der Dame auf f7.") },
  { san: "Qh5", say: t("Jetzt droht Matt auf f7. Was macht Schwarz?"), arrow: { from: "h5", to: "f7" } },
  { san: "Nf6", say: t("Sf6?? übersieht die Drohung. So einen Zug markiere ich als Patzer."), badge: "Blunder", arrow: { from: "h5", to: "f7" } },
  { san: "Qxf7#", say: t("Dxf7 ist Matt. Genau solche Muster sammle ich aus deinen Partien."), badge: "Best" },
];
