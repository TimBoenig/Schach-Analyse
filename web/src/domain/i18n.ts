// German display labels for internal domain keys (port of src/utils/translations.py).
// Internal keys stay English because they are persisted and compared in logic.

export const CLASSIFICATION_LABELS: Record<string, string> = {
  Brilliant: "Brillant",
  Great: "Großartig",
  Best: "Bester Zug",
  Excellent: "Exzellent",
  Good: "Gut",
  Inaccuracy: "Ungenauigkeit",
  Mistake: "Fehler",
  Blunder: "Patzer",
  Miss: "Verpasst",
  Book: "Buchzug",
  Forced: "Erzwungen",
  "Clean Game": "Fehlerfreie Partie",
  "Lost Lead": "Vorteil verspielt",
  "Drawn Lead": "Vorteil nur remis",
  Comeback: "Aufholjagd",
  "Comeback Win": "Sieg nach Rückstand",
  "Comeback Draw": "Remis nach Rückstand",
};

export const PHASE_LABELS: Record<string, string> = {
  opening: "Eröffnung",
  middlegame: "Mittelspiel",
  endgame: "Endspiel",
};

// Dative form for sentences like "Fehler im Mittelspiel" / "in der Eröffnung".
export const PHASE_IN_LABELS: Record<string, string> = {
  opening: "in der Eröffnung",
  middlegame: "im Mittelspiel",
  endgame: "im Endspiel",
};

export const COLOR_LABELS: Record<string, string> = {
  white: "Weiß",
  black: "Schwarz",
};

export const PIECE_LABELS: Record<string, string> = {
  pawn: "Bauer",
  knight: "Springer",
  bishop: "Läufer",
  rook: "Turm",
  queen: "Dame",
  king: "König",
};

export const PIECE_LABELS_PLURAL: Record<string, string> = {
  pawn: "Bauern",
  knight: "Springer",
  bishop: "Läufer",
  rook: "Türme",
  queen: "Damen",
  king: "Könige",
};

export const MOTIF_LABELS: Record<string, string> = {
  fork: "Gabel",
  pin: "Fesselung",
  skewer: "Spieß",
  discovered_attack: "Abzugsangriff",
  sacrifice: "Opfer",
  back_rank: "Grundreihe",
};

export const SPEED_LABELS: Record<string, string> = {
  UltraBullet: "UltraBullet",
  Bullet: "Bullet",
  Blitz: "Blitz",
  Rapid: "Schnellschach",
  Classical: "Klassisch",
  Daily: "Fernschach",
  Correspondence: "Fernschach",
  Chess960: "Chess960",
  Other: "Sonstige",
  Unknown: "Unbekannt",
  Standard: "Standard",
};

export const TERMINATION_LABELS: Record<string, string> = {
  Checkmate: "Schachmatt",
  Resignation: "Aufgabe",
  Time: "Zeitüberschreitung",
  Abandon: "Abbruch",
  Draw: "Remis",
  "3-Fold Repetition": "Dreifache Wiederholung",
  Agreement: "Einigung",
  Stalemate: "Patt",
  "Insufficient vs Timeout": "Zeit vs. ungenügendes Material",
  "Insufficient Material": "Ungenügendes Material",
  "50-Move Rule": "50-Züge-Regel",
};

export const OUTCOME_LABELS: Record<string, string> = {
  win: "Sieg",
  draw: "Remis",
  loss: "Niederlage",
};

// Filter option values are stored/compared in English; these are their labels.
export const FILTER_LABELS: Record<string, string> = {
  "All Colors": "Alle Farben",
  White: "Weiß",
  Black: "Schwarz",
  "All Formats": "Alle Formate",
  "Freestyle (Chess960)": "Freestyle (Chess960)",
  "All Sources": "Alle Quellen",
  "Chess.com": "Chess.com",
  Lichess: "Lichess",
  File: "Datei",
  "PGN File": "PGN-Datei",
  "All Time": "Gesamter Zeitraum",
  "Last 24 Hours": "Letzte 24 Stunden",
  "Last 7 Days": "Letzte 7 Tage",
  "Last 14 Days": "Letzte 14 Tage",
  "Last 30 Days": "Letzte 30 Tage",
  "Last 90 Days": "Letzte 90 Tage",
  "Last 180 Days": "Letzte 6 Monate",
  "Last 365 Days": "Letzte 12 Monate",
  "This Year": "Dieses Jahr",
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
  new Date(seconds * 1000).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

/** "range:<start>:<end>" (seconds, end exclusive) → "01.09.2026 – 22.10.2026". */
function rangeLabel(key: string): string {
  const [, a, b] = key.split(":");
  const start = a ? Number(a) : null;
  // The end is exclusive (midnight after the last day), so show the day before it.
  const end = b ? Number(b) - 1 : null;
  if (start !== null && end !== null) return `${dayDe(start)} – ${dayDe(end)}`;
  if (start !== null) return `ab ${dayDe(start)}`;
  if (end !== null) return `bis ${dayDe(end)}`;
  return "Gesamter Zeitraum";
}
