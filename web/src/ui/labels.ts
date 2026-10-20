import type { Classification } from "../domain/types";

const BADGE_FILE: Partial<Record<Classification, string>> = {
  Brilliant: "brilliant.svg",
  Great: "great_find.svg",
  Best: "best_v2.svg",
  Excellent: "excellent.svg",
  Good: "good.svg",
  Book: "book.svg",
  Inaccuracy: "inaccuracy.svg",
  Mistake: "mistake.svg",
  Miss: "missed_win.svg",
  Blunder: "blunder.svg",
};

export const CLASSIFICATION_DE: Record<Exclude<Classification, "">, string> = {
  Brilliant: "Brillant",
  Great: "Großartig",
  Best: "Bester Zug",
  Excellent: "Exzellent",
  Good: "Gut",
  Book: "Buchzug",
  Inaccuracy: "Ungenauigkeit",
  Mistake: "Fehler",
  Miss: "Verpasst",
  Blunder: "Patzer",
};

export const CLASSIFICATION_ORDER: Exclude<Classification, "">[] = [
  "Brilliant",
  "Great",
  "Best",
  "Excellent",
  "Good",
  "Book",
  "Inaccuracy",
  "Mistake",
  "Miss",
  "Blunder",
];

export function badgeFor(c: Classification): string | null {
  const f = BADGE_FILE[c];
  return f ? `${import.meta.env.BASE_URL}badges/${f}` : null;
}

export function classLabel(c: Classification): string {
  return c ? CLASSIFICATION_DE[c] : "";
}

export function resultText(result: string): string {
  if (result === "1-0") return "1–0";
  if (result === "0-1") return "0–1";
  if (result === "1/2-1/2") return "½–½";
  return "*";
}

export function formatEval(cp: number | null, mate: number | null): string {
  if (mate !== null) return mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`;
  if (cp === null) return "–";
  const v = cp / 100;
  return (v > 0 ? "+" : "") + v.toFixed(1);
}

export function formatDate(date: string): string {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(date ?? "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : date || "";
}

export const SPEED_DE: Record<string, string> = {
  Bullet: "Bullet",
  Blitz: "Blitz",
  Rapid: "Schnellschach",
  Classical: "Klassisch",
  Daily: "Fernschach",
  Correspondence: "Fernschach",
};

/** Colour class for an accuracy value, matching the classification colours. */
export function accClass(acc: number | null | undefined): string {
  if (acc === null || acc === undefined) return "";
  if (acc >= 85) return "acc-high";
  if (acc >= 70) return "acc-mid";
  if (acc >= 55) return "acc-low";
  return "acc-bad";
}

/** "Sicilian Defense: Najdorf Variation, ..." → "Sicilian Defense: Najdorf Variation". */
export function shortOpening(name: string | null | undefined): string {
  if (!name) return "";
  return name.split(",")[0].trim();
}

const MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** PGN date "2026.04.03" → "April 2026"; unknown dates group under "Ohne Datum". */
export function monthLabel(date: string): string {
  const m = /^(\d{4})\.(\d{2})/.exec(date ?? "");
  if (!m || m[2] === "??") return "Ohne Datum";
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? `${MONTHS_DE[month - 1]} ${m[1]}` : m[1];
}

export type Outcome = "win" | "loss" | "draw" | null;

/** Result from the user's point of view, null when unknown or not the user's game. */
export function outcomeFor(result: string, color: "white" | "black" | null): Outcome {
  if (!color || result === "*" || !result) return null;
  if (result === "1/2-1/2") return "draw";
  return (result === "1-0") === (color === "white") ? "win" : "loss";
}

// Move quality folded into five steps, best to worst, in the classification colours.
const QUALITY_GROUPS: { label: string; keys: Classification[]; color: string }[] = [
  { label: "Brillant & bester Zug", keys: ["Brilliant", "Great", "Best"], color: "var(--best)" },
  { label: "Exzellent, gut & Buch", keys: ["Excellent", "Good", "Book"], color: "var(--good)" },
  { label: "Ungenauigkeiten", keys: ["Inaccuracy"], color: "var(--inacc)" },
  { label: "Fehler & Verpasstes", keys: ["Mistake", "Miss"], color: "var(--mistake)" },
  { label: "Patzer", keys: ["Blunder"], color: "var(--blunder)" },
];

/** Classification counts grouped for the quality distribution bar. */
export function qualitySegments(counts: Partial<Record<string, number>>): { label: string; value: number; color: string }[] {
  return QUALITY_GROUPS.map((g) => ({
    label: g.label,
    value: g.keys.reduce((s, k) => s + Number(counts[k] ?? 0), 0),
    color: g.color,
  }));
}
