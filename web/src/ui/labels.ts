import { openingLabel, openingMain } from "../domain/profile/openings";
import type { Classification, MoveData } from "../domain/types";
import { t } from "../i18n";

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
  Brilliant: t("Brillant"),
  Great: t("Großartig"),
  Best: t("Bester Zug"),
  Excellent: t("Exzellent"),
  Good: t("Gut"),
  Book: t("Buchzug"),
  Inaccuracy: t("Ungenauigkeit"),
  Mistake: t("Fehler"),
  Miss: t("Verpasst"),
  Blunder: t("Patzer"),
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

/** Text and mark colour per classification (chess.com colours). */
export const CLASS_COLOR: Partial<Record<string, string>> = {
  Brilliant: "var(--brilliant)",
  Great: "var(--great)",
  Best: "var(--best)",
  Excellent: "var(--best)",
  Good: "var(--good)",
  Book: "var(--book)",
  Inaccuracy: "var(--inacc)",
  Mistake: "var(--mistake)",
  Miss: "var(--blunder)",
  Blunder: "var(--blunder)",
};

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
  Rapid: t("Schnellschach"),
  Classical: t("Klassisch"),
  Daily: t("Fernschach"),
  Correspondence: t("Fernschach"),
  Untimed: t("Ohne Zeitangabe"),
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
  const short = name.split(",")[0].trim();
  // German main name like on the openings page; the variation stays as the book names it.
  const main = openingMain(short);
  return openingLabel(main) + short.slice(main.length);
}

const MONTHS_DE = [t("Januar"), t("Februar"), t("März"), t("April"), t("Mai"), t("Juni"), t("Juli"), t("August"), t("September"), t("Oktober"), t("November"), t("Dezember")];

/** PGN date "2026.04.03" → "April 2026"; unknown dates group under "Ohne Datum". */
export function monthLabel(date: string): string {
  const m = /^(\d{4})\.(\d{2})/.exec(date ?? "");
  if (!m || m[2] === "??") return t("Ohne Datum");
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? `${MONTHS_DE[month - 1]} ${m[1]}` : m[1];
}

/** "1 Sieg · 2 Remis · 1 Niederlage": the balance in words, with the singular where it applies. */
export function balanceText(wins: number, draws: number, losses: number, sep = " · "): string {
  return [`${wins} ${wins === 1 ? t("Sieg") : t("Siege")}`, t("{draws} Remis", { draws }), `${losses} ${losses === 1 ? t("Niederlage") : t("Niederlagen")}`].join(sep);
}

/**
 * Run of equal results at the newest end, e.g. "3 Siege in Folge"; null below
 * two. Scores are newest first: 1 win, 0.5 draw, 0 loss, null unfinished.
 */
export function streakText(scores: (number | null)[]): string | null {
  const first = scores[0];
  if (first === null || first === undefined) return null;
  let n = 0;
  while (n < scores.length && scores[n] === first) n++;
  if (n < 2) return null;
  return t("{n} {1} in Folge", { n, 1: first === 1 ? t("Siege") : first === 0 ? t("Niederlagen") : t("Remis") });
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
  { label: t("Brillant & bester Zug"), keys: ["Brilliant", "Great", "Best"], color: "var(--best)" },
  { label: t("Exzellent, gut & Buch"), keys: ["Excellent", "Good", "Book"], color: "var(--good)" },
  { label: t("Ungenauigkeiten"), keys: ["Inaccuracy"], color: "var(--inacc)" },
  { label: t("Fehler & Verpasstes"), keys: ["Mistake", "Miss"], color: "var(--mistake)" },
  { label: t("Patzer"), keys: ["Blunder"], color: "var(--blunder)" },
];

/** Classification counts grouped for the quality distribution bar. */
export function qualitySegments(counts: Partial<Record<string, number>>): { label: string; value: number; color: string }[] {
  return QUALITY_GROUPS.map((g) => ({
    label: g.label,
    value: g.keys.reduce((s, k) => s + Number(counts[k] ?? 0), 0),
    color: g.color,
  }));
}

// Finer split for the move tally: every class with its own colour; the two
// pairs that share a colour in the move list are folded together.
const DETAIL_GROUPS: { label: string; keys: Classification[]; color: string }[] = [
  { label: t("Brillant"), keys: ["Brilliant"], color: "var(--brilliant)" },
  { label: t("Großartig"), keys: ["Great"], color: "var(--great)" },
  { label: t("Bester Zug & exzellent"), keys: ["Best", "Excellent"], color: "var(--best)" },
  { label: t("Gut"), keys: ["Good"], color: "var(--good)" },
  { label: t("Buchzug"), keys: ["Book"], color: "var(--book)" },
  { label: t("Ungenauigkeit"), keys: ["Inaccuracy"], color: "var(--inacc)" },
  { label: t("Fehler"), keys: ["Mistake"], color: "var(--mistake)" },
  { label: t("Patzer & verpasst"), keys: ["Blunder", "Miss"], color: "var(--blunder)" },
];

/** Classification counts in eight colour groups (donut of the move tally). */
export function detailSegments(counts: Partial<Record<string, number>>): { label: string; value: number; color: string }[] {
  return DETAIL_GROUPS.map((g) => ({
    label: g.label,
    value: g.keys.reduce((s, k) => s + Number(counts[k] ?? 0), 0),
    color: g.color,
  }));
}

/** Lucena's one-line verdict for a move, chess.com review style. */
export function moveVerdict(move: Pick<MoveData, "move_number" | "fen_before" | "san" | "classification">): string {
  const m = `${move.move_number}${move.fen_before.split(" ")[1] === "w" ? "." : "..."} ${move.san}`;
  switch (move.classification) {
    case "Brilliant":
      return t("Wow, {m} ist brillant!", { m });
    case "Great":
      return t("{m} ist ein großartiger Zug!", { m });
    case "Best":
      return t("{m} ist der beste Zug.", { m });
    case "Excellent":
      return t("{m} ist exzellent.", { m });
    case "Good":
      return t("{m} ist ein guter Zug.", { m });
    case "Book":
      return t("{m} ist ein Theoriezug.", { m });
    case "Inaccuracy":
      return t("{m} ist ungenau.", { m });
    case "Mistake":
      return t("{m} ist ein Fehler.", { m });
    case "Miss":
      return t("{m} verpasst eine Chance.", { m });
    case "Blunder":
      return t("Autsch, {m} ist ein Patzer.", { m });
    default:
      return m;
  }
}

/** "heute", "gestern", "vor 5 Tagen": how fresh a player's games are. */
export function loadedAgo(ms: number | null, now = Date.now()): string {
  if (!ms) return t("noch nie geladen");
  const day = (tk: number) => Math.floor((tk - new Date(tk).getTimezoneOffset() * 60_000) / 86_400_000);
  const d = day(now) - day(ms);
  if (d <= 0) return t("heute geladen");
  if (d === 1) return t("gestern geladen");
  return t("vor {d} Tagen geladen", { d });
}

/**
 * Splits a finding into its claim and the numbers behind it. The profile
 * appends the evidence as a closing bracket after the sentence; a bracket
 * inside the sentence is part of the claim and stays there.
 */
export function splitProof(text: string): [claim: string, proof: string | null] {
  const m = /^(.*?[.!?])\s+\((.+)\)\s*$/s.exec(text);
  return m ? [m[1], m[2]] : [text, null];
}
