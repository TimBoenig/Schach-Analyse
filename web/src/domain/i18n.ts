// German display labels for internal domain keys (port of src/utils/translations.py).
// Internal keys stay English because they are persisted and compared in logic.
import { t, locale } from "../i18n";


export const CLASSIFICATION_LABELS: Record<string, string> = {
  Brilliant: t("Brillant"),
  Great: t("Großartig"),
  Best: t("Bester Zug"),
  Excellent: t("Exzellent"),
  Good: t("Gut"),
  Inaccuracy: t("Ungenauigkeit"),
  Mistake: t("Fehler"),
  Blunder: t("Patzer"),
  Miss: t("Verpasst"),
  Book: t("Buchzug"),
  Forced: t("Erzwungen"),
  "Clean Game": t("Fehlerfreie Partie"),
  "Lost Lead": t("Vorteil verspielt"),
  "Drawn Lead": t("Vorteil nur remis"),
  Comeback: t("Aufholjagd"),
  "Comeback Win": t("Sieg nach Rückstand"),
  "Comeback Draw": t("Remis nach Rückstand"),
};

export const PHASE_LABELS: Record<string, string> = {
  opening: t("Eröffnung"),
  middlegame: t("Mittelspiel"),
  endgame: t("Endspiel"),
};

// Dative form for sentences like "Fehler im Mittelspiel" / "in der Eröffnung".
export const PHASE_IN_LABELS: Record<string, string> = {
  opening: t("in der Eröffnung"),
  middlegame: t("im Mittelspiel"),
  endgame: t("im Endspiel"),
};

export const COLOR_LABELS: Record<string, string> = {
  white: t("Weiß"),
  black: t("Schwarz"),
};

export const PIECE_LABELS: Record<string, string> = {
  pawn: t("Bauer"),
  knight: t("Springer"),
  bishop: t("Läufer"),
  rook: t("Turm"),
  queen: t("Dame"),
  king: t("König"),
};

export const PIECE_LABELS_PLURAL: Record<string, string> = {
  pawn: t("Bauern"),
  knight: t("Springer"),
  bishop: t("Läufer"),
  rook: t("Türme"),
  queen: t("Damen"),
  king: t("Könige"),
};

export const MOTIF_LABELS: Record<string, string> = {
  fork: t("Gabel"),
  pin: t("Fesselung"),
  skewer: t("Spieß"),
  discovered_attack: t("Abzugsangriff"),
  sacrifice: t("Opfer"),
  back_rank: t("Grundreihe"),
};

export const SPEED_LABELS: Record<string, string> = {
  UltraBullet: "UltraBullet",
  Bullet: "Bullet",
  Blitz: "Blitz",
  Rapid: t("Schnellschach"),
  Classical: t("Klassisch"),
  Daily: t("Fernschach"),
  Correspondence: t("Fernschach"),
  Chess960: "Chess960",
  Untimed: t("Ohne Zeitangabe"),
  Other: t("Sonstige"),
  Unknown: t("Unbekannt"),
  Standard: "Standard",
};

export const TERMINATION_LABELS: Record<string, string> = {
  Checkmate: t("Schachmatt"),
  Resignation: t("Aufgabe"),
  Time: t("Zeitüberschreitung"),
  Abandon: t("Abbruch"),
  Draw: t("Remis"),
  "3-Fold Repetition": t("Dreifache Wiederholung"),
  Agreement: t("Einigung"),
  Stalemate: t("Patt"),
  "Insufficient vs Timeout": t("Zeit vs. ungenügendes Material"),
  "Insufficient Material": t("Ungenügendes Material"),
  "50-Move Rule": t("50-Züge-Regel"),
};

export const OUTCOME_LABELS: Record<string, string> = {
  win: t("Sieg"),
  draw: t("Remis"),
  loss: t("Niederlage"),
};

// Filter option values are stored/compared in English; these are their labels.
export const FILTER_LABELS: Record<string, string> = {
  "All Colors": t("Alle Farben"),
  White: t("Weiß"),
  Black: t("Schwarz"),
  "All Formats": t("Alle Formate"),
  "No Bullet": t("Ohne Bullet"),
  "Freestyle (Chess960)": "Freestyle (Chess960)",
  "All Sources": t("Alle Quellen"),
  "Chess.com": "Chess.com",
  Lichess: "Lichess",
  File: t("Datei"),
  "PGN File": t("PGN-Datei"),
  "All Time": t("Gesamter Zeitraum"),
  "Last 24 Hours": t("Letzte 24 Stunden"),
  "Last 7 Days": t("Letzte 7 Tage"),
  "Last 14 Days": t("Letzte 14 Tage"),
  "Last 30 Days": t("Letzte 30 Tage"),
  "Last 90 Days": t("Letzte 90 Tage"),
  "Last 180 Days": t("Letzte 6 Monate"),
  "Last 365 Days": t("Letzte 12 Monate"),
  "This Year": t("Dieses Jahr"),
  ...SPEED_LABELS,
};

function lookup(table: Record<string, string>, key: string | null | undefined): string {
  if (!key) return "";
  if (key in table) return table[key];
  const lowered = key.toLowerCase();
  for (const [k, v] of Object.entries(table)) {
    if (k.toLowerCase() === lowered) return v;
  }
  return key;
}

export const trClassification = (key: string | null | undefined): string =>
  lookup(CLASSIFICATION_LABELS, key);
export const trPhase = (key: string | null | undefined): string => lookup(PHASE_LABELS, key);
export const trPhaseIn = (key: string | null | undefined): string => lookup(PHASE_IN_LABELS, key);
export const trColor = (key: string | null | undefined): string => lookup(COLOR_LABELS, key);
export const trPiece = (key: string | null | undefined, plural = false): string =>
  lookup(plural ? PIECE_LABELS_PLURAL : PIECE_LABELS, key);
export const trMotif = (key: string | null | undefined): string => lookup(MOTIF_LABELS, key);
export const trSpeed = (key: string | null | undefined): string => lookup(SPEED_LABELS, key);
export const trTermination = (key: string | null | undefined): string =>
  lookup(TERMINATION_LABELS, key);
export const trOutcome = (key: string | null | undefined): string => lookup(OUTCOME_LABELS, key);
export const trFilter = (key: string | null | undefined): string =>
  key?.startsWith("range:") ? rangeLabel(key) : lookup(FILTER_LABELS, key);

const dayDe = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", year: "numeric" });

/** "range:<start>:<end>" (seconds, end exclusive) → "01.09.2026 – 22.10.2026". */
function rangeLabel(key: string): string {
  const [, a, b] = key.split(":");
  const start = a ? Number(a) : null;
  // The end is exclusive (midnight after the last day), so show the day before it.
  const end = b ? Number(b) - 1 : null;
  if (start !== null && end !== null) return `${dayDe(start)} – ${dayDe(end)}`;
  if (start !== null) return t("ab {dayDe}", { dayDe: dayDe(start) });
  if (end !== null) return t("bis {dayDe}", { dayDe: dayDe(end) });
  return t("Gesamter Zeitraum");
}
