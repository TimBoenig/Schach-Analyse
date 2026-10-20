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
