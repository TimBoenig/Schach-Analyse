// Prompt building for the optional AI coach. The model only gets numbers and
// findings this app computed (engine evaluations, classifications, profile
// stats, training progress), so its answer explains real data instead of
// inventing chess. How much of that data goes into a prompt is set by the
// detail level, because small local models have short context windows.

import { trClassification, trColor, trPhase, trSpeed, trTermination } from "../i18n";
import type { TrainingSummary } from "../training/progress";
import { CATEGORIES } from "../training/exercises";
import type { MoveData } from "../types";
import { sanForUci, userWp } from "./features";
import type { MoveBucket, ScoreBucket } from "./insights";
import type { GameDigest, GameReview, PlayerProfile } from "./models";
import { openingLabel, type OpeningStat } from "./openings";

export interface CoachMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type CoachDetail = "compact" | "normal" | "full";

/** Prompt size per detail level in characters (~4 characters per token) and answer length in tokens. */
export const DETAIL_LEVELS: Record<CoachDetail, { label: string; chars: number; maxTokens: number; games: number }> = {
  compact: { label: "Kompakt (kleine lokale Modelle)", chars: 6000, maxTokens: 900, games: 10 },
  normal: { label: "Ausführlich", chars: 16000, maxTokens: 1500, games: 25 },
  full: { label: "Alle Daten (große Modelle)", chars: 45000, maxTokens: 2500, games: 40 },
};

export const COACH_SYSTEM = [
  "Du bist ein erfahrener, freundlicher Schachtrainer und analysierst die Partien eines Schülers.",
  "Antworte immer auf Deutsch und sprich den Spieler mit „du“ an.",
  "Stütze dich ausschließlich auf die Daten, die du bekommst. Sie stammen aus einer Stockfish-Analyse seiner eigenen Partien.",
  "Erfinde keine Züge, Varianten, Partien oder Zahlen, die nicht in den Daten stehen.",
  "Arbeite wie ein Trainer: Finde zuerst die Ursachen, die die meisten Punkte kosten, und belege jede Aussage mit einer Zahl aus den Daten.",
  "Nenne wo möglich eine konkrete Partie als Beispiel (Datum, Gegner, Zug).",
  "Gib umsetzbare Ratschläge und verweise auf die Übungen der App: Blunder-Check, Chancen nutzen, Eröffnungsfehler, Repertoire üben, Endspiel-Aufgaben, Endspiel-Grundlagen, Vorteil verwerten, Zähe Verteidigung.",
  "Schreibe klar und konkret, in einfachem Markdown (Überschriften mit ###, Listen mit -, **fett**).",
].join(" ");

const GLOSSARY = [
  "So liest du die Daten:",
  "- Genauigkeit 0–100 % nach der Lichess-Formel; 80 % ist solide, über 90 % sehr stark.",
  "- Fähigkeiten 0–100; „typisch“ ist ein geschätzter Richtwert für Spieler mit derselben Wertung.",
  "- Gewinnchance in Prozent immer aus Sicht des Spielers.",
  "- Fehlerklassen: Ungenauigkeit < Fehler < Patzer; „Verpasst“ heißt, eine klare Chance (oft ein Gegnerfehler) blieb ungenutzt.",
  "- Schwere Fehler = Fehler, Patzer und verpasste Chancen.",
].join("\n");

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${Math.round(v)} %`);
const de = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",");
const resultWord = (s: number | null) => (s === 1 ? "Sieg" : s === 0.5 ? "Remis" : s === 0 ? "Niederlage" : "offen");

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

/** Whole game as compact move text; errors and strong moves carry the engine verdict. */
export function annotatedMoves(moves: MoveData[], userColor: "white" | "black"): string {
  const out: string[] = [];
  const isUserWhite = userColor === "white";
  let commented = false;
  moves.forEach((m, i) => {
    const white = i % 2 === 0;
    const n = m.move_number || Math.floor(i / 2) + 1;
    // After a comment Black's move repeats the move number, as in PGN.
    const num = white ? `${n}. ` : i === 0 || commented ? `${n}... ` : "";
    commented = false;
    let text = num + m.san;
    const cls = m.classification;
    if (cls && !["Best", "Excellent", "Good", "Book", ""].includes(cls)) {
      const before = Math.round(userWp(m.win_chance_before, isUserWhite) * 100);
      const after = Math.round(userWp(m.win_chance_after, isUserWhite) * 100);
      const best = m.best_move && m.best_move !== m.uci ? sanForUci(m.fen_before, m.best_move) : "";
      const who = white === isUserWhite ? "ich" : "Gegner";
      commented = true;
      text += ` {${who}: ${trClassification(cls)}, Gewinnchance ${before}→${after} %${best && ["Inaccuracy", "Mistake", "Blunder", "Miss"].includes(cls) ? `, besser ${best}` : ""}}`;
    }
    out.push(text);
  });
  return out.join(" ");
}

export function gameCoachMessages(
  review: GameReview,
  ctx: GameContext,
  extra: { moves?: MoveData[]; profile?: PlayerProfile | null } = {},
): CoachMessage[] {
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
    extra.moves?.length ? `\nAlle Züge mit Engine-Urteil in {}:\n${annotatedMoves(extra.moves, ctx.userColor)}` : "",
    extra.profile && !extra.profile.is_empty ? `\nMein Profil aus allen Partien (zum Vergleich):\n${profileBrief(extra.profile)}` : "",
    "",
    "Erkläre mir diese Partie wie ein Trainer nach dem Spiel, mit genau diesen vier Abschnitten:",
    "### Was passiert ist (2–3 Sätze zum Verlauf)",
    "### Der entscheidende Moment (welcher Zug, warum er so viel gekostet hat, was die Idee hinter dem besseren Zug ist)",
    extra.profile && !extra.profile.is_empty
      ? "### Typisch für dich? (passt der Fehler zu einem Muster aus meinem Profil oder war er ein Ausreißer?)"
      : "### Was gut war (1–2 Punkte)",
    "### Das nimmst du mit (2–3 konkrete Punkte für die nächste Partie, mit passender Übung aus der App)",
  ];
  return [
    { role: "system", content: COACH_SYSTEM },
    { role: "user", content: lines.filter((l) => l !== "").join("\n") },
  ];
}

/** A few lines about the player for prompts about something else (e.g. one game). */
export function profileBrief(p: PlayerProfile): string {
  const out = [`${p.analyzed_games} analysierte Partien, Ø Genauigkeit ${pct(p.overview.avg_accuracy)}.`];
  if (p.weaknesses.length) out.push(`Schwächen: ${p.weaknesses.map((w) => w.title).join(", ")}.`);
  if (p.strengths.length) out.push(`Stärken: ${p.strengths.map((s) => s.title).join(", ")}.`);
  const pats = p.patterns.filter((x) => x.severity === "hoch" || x.severity === "mittel");
  if (pats.length) out.push(`Muster: ${pats.slice(0, 4).map((x) => x.title).join(", ")}.`);
  return out.join("\n");
}

export type TrainingContext = TrainingSummary;

const moveRows = (buckets: MoveBucket[]) =>
  buckets
    .filter((b) => b.moves > 0)
    .map((b) => `${b.label}: ${b.per100 !== null ? de(b.per100) : "–"} je 100 Züge (${b.errors}/${b.moves})`)
    .join("; ");

const scoreRows = (buckets: ScoreBucket[]) =>
  buckets
    .filter((b) => b.games > 0)
    .map((b) => `${b.label}: ${pct(b.score_pct)} Punkte in ${b.games} Partien${b.avg_accuracy ? `, Genauigkeit ${pct(b.avg_accuracy)}` : ""}`)
    .join("; ");

function digestLine(g: GameDigest): string {
  const ratings = g.user_rating && g.opp_rating ? ` (${g.user_rating} vs. ${g.opp_rating})` : "";
  const quality =
    g.accuracy !== null ? `, Genauigkeit ${pct(g.accuracy)}, ${g.blunders ?? 0} Patzer, ${g.mistakes ?? 0} Fehler` : ", nicht analysiert";
  const worst = g.worst.length
    ? `; teuerste Züge: ${g.worst.map((w) => `${w.move} (${trClassification(w.classification)} im ${trPhase(w.phase)}, ${w.wp_before}→${w.wp_after} %${w.best ? `, besser ${w.best}` : ""})`).join(", ")}`
    : "";
  return `- ${g.date || "?"} ${trSpeed(g.speed)}, ${trColor(g.color)} gegen ${g.opponent || "?"}${ratings}: ${resultWord(g.score)}${g.termination ? ` (${trTermination(g.termination)})` : ""}, ${g.opening ? openingLabel(g.opening) : "Eröffnung unbekannt"}, ${Math.ceil(g.plies / 2)} Züge${quality}${worst}`;
}

/**
 * Everything the app knows about the player, as text sections in order of
 * importance. Sections are added until the budget of the detail level is
 * used up; the newest games fill the rest.
 */
export function profileContext(p: PlayerProfile, detail: CoachDetail = "normal", training?: TrainingContext | null): string {
  const level = DETAIL_LEVELS[detail];
  const o = p.overview;
  const rc = p.rating;
  const sections: string[][] = [];

  const overview = [
    "## Überblick",
    `Partien: ${p.total_games} (${p.analyzed_games} analysiert), Bilanz ${o.wins} Siege, ${o.draws} Remis, ${o.losses} Niederlagen, Punktequote ${pct(o.score_pct)}.`,
    `Durchschnittliche Genauigkeit: ${pct(o.avg_accuracy)}. Partien ohne schweren Fehler: ${pct(o.clean_games_pct)}.`,
  ];
  if (o.form_delta !== null && o.form_delta !== undefined) {
    overview.push(`Form: Genauigkeit der letzten 20 Partien ${o.form_delta >= 0 ? "+" : ""}${de(o.form_delta)} Punkte gegenüber den 20 davor.`);
  }
  if (o.ratings && Object.keys(o.ratings).length) {
    overview.push(`Aktuelle Wertungen: ${Object.entries(o.ratings as Record<string, number>).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
  }
  if (rc) {
    overview.push(
      `Wertung ${rc.rating} (${trSpeed(rc.speed)}), Performance ${rc.performance ?? "–"}, Ø Gegner ${rc.avg_opponent ?? "–"}, Punkte ${rc.score} statt erwartet ${rc.expected_score ?? "–"}. Typische Genauigkeit für diese Wertung (Schätzung): ${pct(rc.typical_accuracy)}.`,
    );
    const phases = Object.entries(rc.typical_phase_accuracy ?? {});
    const own = (o.phase_accuracy ?? {}) as Record<string, number>;
    if (phases.length) {
      overview.push(`Genauigkeit je Phase (eigene / typisch): ${phases.map(([k, v]) => `${trPhase(k)} ${pct(own[k])} / ${pct(v)}`).join(", ")}.`);
    }
  }
  sections.push(overview);

  if (p.skills.length) {
    sections.push([
      "## Fähigkeiten (0–100, in Klammern typisch für die Wertung)",
      ...p.skills
        .filter((s) => s.sample > 0)
        .map(
          (s) =>
            `- ${s.name}: ${Math.round(s.score)}${s.typical !== null && s.typical !== undefined ? ` (${Math.round(s.typical)})` : ""}${s.reliable ? "" : " – noch wenig Daten"}; ${s.detail}`,
        ),
    ]);
  }
  const sw: string[] = [];
  if (p.strengths.length) sw.push("## Stärken", ...p.strengths.map((s) => `- ${s.title}: ${s.text}`));
  if (p.weaknesses.length) sw.push("## Schwächen", ...p.weaknesses.map((s) => `- ${s.title}: ${s.text}`));
  if (sw.length) sections.push(sw);
  if (p.patterns.length) {
    sections.push(["## Wiederkehrende Muster", ...p.patterns.map((x) => `- ${x.title} (${x.severity}): ${x.text}`)]);
  }

  const d = p.deep;
  if (d) {
    const deep = ["## Einblicke"];
    if (d.facts.length) deep.push(...d.facts.map((f) => `- ${f}`));
    deep.push(`- Schwere Fehler nach Zugnummer: ${moveRows(d.by_move_number)}.`);
    deep.push(`- Nach Stellungslage: ${moveRows(d.by_situation)}.`);
    if (d.by_think_time.some((b) => b.moves)) deep.push(`- Nach Bedenkzeit pro Zug: ${moveRows(d.by_think_time)}.`);
    if (d.time_trouble.some((b) => b.moves)) deep.push(`- Zeitnot: ${moveRows(d.time_trouble)}.`);
    if (d.after_book.some((b) => b.moves)) deep.push(`- Nach der Theorie: ${moveRows(d.after_book)}.`);
    deep.push(`- Nach Figur: ${moveRows(d.by_piece)}.`);
    if (d.punish.chances) deep.push(`- Gegnerfehler bestraft: ${d.punish.punished} von ${d.punish.chances} (${pct(d.punish.rate)}).`);
    deep.push(`- Fehler pro Partie: ${d.errors_per_game.map((e) => `${trClassification(e.classification)} ${de(e.per_game, 2)}`).join(", ")}.`);
    if (d.hot_squares.length) deep.push(`- Häufigste Fehlerfelder: ${d.hot_squares.map((h) => `${h.square} (${h.count})`).join(", ")}.`);
    if (d.by_daytime.some((b) => b.games)) deep.push(`- Tageszeit: ${scoreRows(d.by_daytime)}.`);
    if (d.after_result.some((b) => b.games)) deep.push(`- Nach dem letzten Ergebnis: ${scoreRows(d.after_result)}.`);
    if (d.by_session_game.some((b) => b.games)) deep.push(`- Partie in der Serie: ${scoreRows(d.by_session_game)}.`);
    sections.push(deep);
  }

  const op = p.openings;
  const openings: string[] = [];
  const line = (l: OpeningStat) =>
    `${openingLabel(l.name)} (${l.games} Partien, ${pct(l.score_pct)} Punkte${l.opening_accuracy !== null ? `, Eröffnungsgenauigkeit ${pct(l.opening_accuracy)}` : ""}${l.wp_after_opening !== null ? `, Gewinnchance nach der Eröffnung ${pct(l.wp_after_opening)}` : ""}${l.book_exit_move !== null ? `, Theorie verlassen ~Zug ${Math.round(l.book_exit_move)}` : ""}${l.first_error_move !== null ? `, erster schwerer Fehler ~Zug ${Math.round(l.first_error_move)}` : ""})`;
  if (op) {
    if (op.white.length) openings.push(`Repertoire mit Weiß: ${op.white.slice(0, 6).map(line).join("; ")}.`);
    if (op.black.length) openings.push(`Repertoire mit Schwarz: ${op.black.slice(0, 6).map(line).join("; ")}.`);
    if (op.white_first.length) openings.push(`Erste Züge mit Weiß: ${op.white_first.map((c) => `1. ${c.san} (${c.games}×, ${pct(c.score_pct)})`).join(", ")}.`);
    for (const v of op.black_vs.slice(0, 3)) {
      openings.push(`Mit Schwarz gegen 1. ${v.san}: ${v.replies.map((r) => `1… ${r.san} (${r.games}×, ${pct(r.score_pct)})`).join(", ")}.`);
    }
    if (op.facts.length) openings.push(...op.facts.map((f) => `- ${f}`));
  }
  if (openings.length) sections.push(["## Eröffnungen", ...openings]);

  if (p.style) {
    sections.push([
      "## Spielstil",
      `${p.style.label}: ${p.style.description}`,
      ...p.style.axes.map((a) => `- ${a.name}: ${Math.round(a.value)}/100 (0 = ${a.low_label}, 100 = ${a.high_label})`),
    ]);
  }

  const monthly = (p.trends?.monthly ?? []) as { month: string; games: number; score_pct: number; avg_accuracy: number | null; blunders_per_game: number | null }[];
  if (monthly.length) {
    sections.push([
      "## Entwicklung pro Monat",
      ...monthly
        .slice(-6)
        .map((m) => `- ${m.month}: ${m.games} Partien, ${pct(m.score_pct)} Punkte, Genauigkeit ${pct(m.avg_accuracy)}${m.blunders_per_game !== null ? `, ${de(m.blunders_per_game)} Patzer pro Partie` : ""}`),
    ]);
  }

  const b = (p.breakdowns ?? {}) as Record<string, { label: string; games: number; score_pct: number; avg_accuracy: number; expected_pct: number | null }[]>;
  const rows = (k: string) =>
    (b[k] ?? []).map((r) => `${r.label}: ${r.games} Partien, ${pct(r.score_pct)} Punkte${r.expected_pct !== null ? ` (erwartet ${pct(r.expected_pct)})` : ""}, Genauigkeit ${pct(r.avg_accuracy)}`).join("; ");
  if (Object.keys(b).length) {
    sections.push(["## Aufschlüsselung", `- Nach Farbe: ${rows("color")}.`, `- Nach Bedenkzeit: ${rows("speed")}.`, `- Nach Gegnerstärke: ${rows("opponent")}.`]);
  }

  if (training) {
    const cats = training.categories.filter((c) => c.attempts > 0);
    sections.push([
      "## Training in der App",
      `Serie: ${training.streak} Tage am Stück. Letzte 7 Tage: ${training.week.done} Übungen, davon ${training.week.correct} gelöst.`,
      training.headline ? `Heutiger Plan: ${training.headline}.` : "",
      ...cats.map((c) => `- ${CATEGORIES[c.category].label}: ${c.solved}/${c.attempts} gelöst, ${c.mastered} von ${c.total} Übungen sicher`),
    ].filter(Boolean));
  }

  let text = "";
  for (const s of sections) {
    const block = s.join("\n");
    if (text && text.length + block.length > level.chars) break;
    text += (text ? "\n\n" : "") + block;
  }
  const games = (p.recent_games ?? []).slice(0, level.games);
  if (games.length) {
    let list = "\n\n## Letzte Partien (neueste zuerst)";
    for (const g of games) {
      const row = digestLine(g);
      if (text.length + list.length + row.length > level.chars) break;
      list += `\n${row}`;
    }
    if (list.includes("\n- ")) text += list;
  }
  return text;
}

export const PROFILE_QUESTIONS = [
  "Was kostet mich die meisten Punkte – und wie trainiere ich genau das?",
  "Erstelle mir einen Trainingsplan für die nächsten zwei Wochen.",
  "Was ist der eine Punkt, der mir am schnellsten mehr Wertung bringt?",
  "Welche meiner letzten Partien sollte ich mir noch einmal ansehen und warum?",
];

export const OPENING_QUESTIONS = [
  "Welche Eröffnung sollte ich als Erstes verbessern?",
  "Stell mir ein schlankes Repertoire für Weiß und Schwarz zusammen.",
  "Warum stehe ich nach der Eröffnung oft schlechter?",
  "Was soll ich gegen 1. d4 spielen?",
];

export const TRAINING_QUESTIONS = [
  "Passt mein heutiger Plan zu meinen Schwächen?",
  "Wie gut läuft mein Training bisher?",
  "Welche Übung bringt mir gerade am meisten?",
];

function systemWithData(p: PlayerProfile, detail: CoachDetail, training?: TrainingContext | null): string {
  return `${COACH_SYSTEM}\n\n${GLOSSARY}\n\nDas sind die Daten des Spielers:\n\n${profileContext(p, detail, training)}`;
}

export function profileCoachMessages(
  p: PlayerProfile,
  history: CoachMessage[],
  question: string,
  detail: CoachDetail = "normal",
  training?: TrainingContext | null,
): CoachMessage[] {
  return [
    { role: "system", content: systemWithData(p, detail, training) },
    ...history.filter((m) => m.role !== "system"),
    { role: "user", content: question },
  ];
}

/** One-shot full report about the player (Einblicke page). */
export function reportMessages(p: PlayerProfile, detail: CoachDetail = "normal", training?: TrainingContext | null): CoachMessage[] {
  return [
    { role: "system", content: systemWithData(p, detail, training) },
    {
      role: "user",
      content: [
        "Schreibe mir einen ehrlichen Trainerbericht über mein Schach mit genau diesen Abschnitten:",
        "### Dein Spiel in drei Sätzen",
        "### Was dich die meisten Punkte kostet (die drei wichtigsten Ursachen, jeweils mit Zahlen und einer Beispielpartie aus den Daten)",
        "### Was du schon gut machst (mit Zahlen)",
        "### Dein Plan für die nächsten zwei Wochen (konkret, pro Tag 15–30 Minuten, mit den Übungen der App)",
        "### Ein messbares Ziel für deine nächsten 20 Partien",
      ].join("\n"),
    },
  ];
}
