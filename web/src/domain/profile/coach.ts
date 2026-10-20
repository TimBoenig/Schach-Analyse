// Prompt building for the optional AI coach. The model only gets numbers and
// findings this app computed (engine evaluations, classifications, profile
// stats), so its answer explains real data instead of inventing chess.

import type { GameReview, PlayerProfile } from "./models";
import type { OpeningStat } from "./openings";

export interface CoachMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export const COACH_SYSTEM = [
  "Du bist ein erfahrener, freundlicher Schachtrainer.",
  "Antworte immer auf Deutsch und sprich den Spieler mit „du“ an.",
  "Stütze dich ausschließlich auf die Daten, die du bekommst. Sie stammen aus einer Stockfish-Analyse.",
  "Erfinde keine Züge, Varianten oder Zahlen, die nicht in den Daten stehen.",
  "Schreibe kurz und konkret, in einfachem Markdown (Überschriften mit ###, Listen mit -).",
].join(" ");

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${Math.round(v)} %`);

export interface GameContext {
  white: string;
  black: string;
  result: string;
  opening: string;
  userColor: "white" | "black";
  userAccuracy: number | null;
  opponentAccuracy: number | null;
  userRating: number | null;
  opponentRating: number | null;
}

export function gameCoachMessages(review: GameReview, ctx: GameContext): CoachMessage[] {
  const me = ctx.userColor === "white" ? "Weiß" : "Schwarz";
  const lines = [
    `Partie: ${ctx.white} gegen ${ctx.black}, Ergebnis ${ctx.result}. Ich spiele ${me}.`,
    ctx.opening ? `Eröffnung: ${ctx.opening}.` : "",
    ctx.userRating && ctx.opponentRating ? `Wertung: ich ${ctx.userRating}, Gegner ${ctx.opponentRating}.` : "",
    `Genauigkeit: ich ${pct(ctx.userAccuracy)}, Gegner ${pct(ctx.opponentAccuracy)}. Note: ${review.grade}.`,
    `Fazit der App: ${review.headline}`,
    "",
    "Phasen:",
    ...review.phases.map((p) => `- ${p.name}: ${pct(p.accuracy)} Genauigkeit, ${p.errors} Fehler in ${p.moves} Zügen (${p.grade})`),
    "",
    "Schlüsselmomente:",
    ...review.key_moments.slice(0, 6).map(
      (k) =>
        `- ${k.move_label} (${k.by_user ? "mein Zug" : "Zug des Gegners"}, ${k.classification}): Gewinnchance ${Math.round(k.wp_before * 100)} % → ${Math.round(k.wp_after * 100)} %${k.best_move_san ? `, besser war ${k.best_move_san}` : ""}`,
    ),
    review.positives.length ? `\nGut: ${review.positives.join(" ")}` : "",
    review.negatives.length ? `Schlecht: ${review.negatives.join(" ")}` : "",
    "",
    "Erkläre mir diese Partie wie ein Trainer nach dem Spiel, mit genau diesen drei Abschnitten:",
    "### Was passiert ist (2–3 Sätze)",
    "### Der entscheidende Moment (welcher Zug, warum er so viel gekostet hat, was der Plan hinter dem besseren Zug ist)",
    "### Das nimmst du mit (2–3 konkrete Punkte für die nächste Partie)",
  ];
  return [
    { role: "system", content: COACH_SYSTEM },
    { role: "user", content: lines.filter((l) => l !== "").join("\n") },
  ];
}

/** Compact, model-friendly summary of the profile (keeps the prompt small). */
export function profileSummary(p: PlayerProfile): string {
  const o = p.overview;
  const rc = p.rating;
  const out = [
    `Partien: ${p.total_games} (${p.analyzed_games} analysiert), Bilanz ${o.wins} Siege, ${o.draws} Remis, ${o.losses} Niederlagen, Punktequote ${pct(o.score_pct)}.`,
    `Durchschnittliche Genauigkeit: ${pct(o.avg_accuracy)}.`,
  ];
  if (rc) {
    out.push(
      `Wertung ${rc.rating} (${rc.speed}), Performance ${rc.performance ?? "–"}, Ø Gegner ${rc.avg_opponent ?? "–"}, Punkte ${rc.score} statt erwartet ${rc.expected_score ?? "–"}. Typische Genauigkeit für diese Wertung (Schätzung): ${pct(rc.typical_accuracy)}.`,
    );
  }
  out.push(
    "Fähigkeiten (0–100, in Klammern typisch für die Wertung):",
    ...p.skills
      .filter((s) => s.sample > 0)
      .map((s) => `- ${s.name}: ${Math.round(s.score)}${s.typical !== null && s.typical !== undefined ? ` (${Math.round(s.typical)})` : ""}`),
  );
  if (p.strengths.length) out.push(`Stärken: ${p.strengths.map((s) => s.title).join(", ")}.`);
  if (p.weaknesses.length) out.push(`Schwächen: ${p.weaknesses.map((s) => s.title).join(", ")}.`);
  if (p.patterns.length) out.push("Muster:", ...p.patterns.slice(0, 5).map((x) => `- ${x.title}: ${x.text}`));
  if (p.deep?.facts.length) out.push("Weitere Befunde:", ...p.deep.facts.map((f) => `- ${f}`));
  if (p.openings_worst.length) out.push(`Schwache Eröffnungen: ${p.openings_worst.map((l) => `${l.name} (${l.color}, ${pct(l.score_pct)})`).join(", ")}.`);
  if (p.openings_best.length) out.push(`Starke Eröffnungen: ${p.openings_best.map((l) => `${l.name} (${l.color}, ${pct(l.score_pct)})`).join(", ")}.`);
  if (p.style) out.push(`Spielstil: ${p.style.label}.`);
  const op = p.openings;
  if (op) {
    const line = (l: OpeningStat) =>
      `${l.name} (${l.games} Partien, ${pct(l.score_pct)} Punkte${l.wp_after_opening !== null ? `, Gewinnchance nach der Eröffnung ${pct(l.wp_after_opening)}` : ""}${l.first_error_move !== null ? `, erster schwerer Fehler im Schnitt Zug ${Math.round(l.first_error_move)}` : ""})`;
    if (op.white.length) out.push(`Repertoire mit Weiß: ${op.white.slice(0, 6).map(line).join("; ")}.`);
    if (op.black.length) out.push(`Repertoire mit Schwarz: ${op.black.slice(0, 6).map(line).join("; ")}.`);
    if (op.white_first.length) out.push(`Erste Züge mit Weiß: ${op.white_first.map((c) => `1. ${c.san} (${c.games}×, ${pct(c.score_pct)})`).join(", ")}.`);
    for (const v of op.black_vs.slice(0, 3)) {
      out.push(`Mit Schwarz gegen 1. ${v.san}: ${v.replies.map((r) => `1… ${r.san} (${r.games}×, ${pct(r.score_pct)})`).join(", ")}.`);
    }
    if (op.facts.length) out.push("Befunde zu Eröffnungen:", ...op.facts.map((f) => `- ${f}`));
  }
  return out.join("\n");
}

export const PROFILE_QUESTIONS = [
  "Erstelle mir einen Trainingsplan für die nächste Woche.",
  "Was ist der eine Punkt, der mir am schnellsten mehr Wertung bringt?",
  "Welche Eröffnungen sollte ich behalten und welche ersetzen?",
  "Erkläre mir meine größte Schwäche und wie ich sie trainiere.",
];

export const OPENING_QUESTIONS = [
  "Welche Eröffnung sollte ich als Erstes verbessern?",
  "Stell mir ein schlankes Repertoire für Weiß und Schwarz zusammen.",
  "Warum stehe ich nach der Eröffnung oft schlechter?",
  "Was soll ich gegen 1. d4 spielen?",
];

export function profileCoachMessages(p: PlayerProfile, history: CoachMessage[], question: string): CoachMessage[] {
  return [
    { role: "system", content: `${COACH_SYSTEM}\n\nDas sind die Daten des Spielers:\n${profileSummary(p)}` },
    ...history.filter((m) => m.role !== "system"),
    { role: "user", content: question },
  ];
}
