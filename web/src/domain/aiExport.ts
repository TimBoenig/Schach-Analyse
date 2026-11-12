// Export for an AI chat (ChatGPT, Claude, Gemini, …): one Markdown file the
// player uploads, after which the model can write a thorough coaching report.
//
// Language models read text well but cannot see a board or run an engine, so
// the file hands them everything pre-digested: the task and the wanted report
// structure first, then a legend of every number, then the aggregated profile
// (most important first, so retrieval-chunked uploads still see it), and at the
// end the per-game evidence with FEN, engine line and a concrete reason for
// each costly move. Every game carries a short number (P001 = newest) that all
// sections use, so the model can cite examples precisely.

import { BRAND, BRAND_DOMAIN } from "../brand";
import { pvToSan } from "./analyzer";
import { explainMove } from "./explain";
import { gamesInPeriod, type ExportSetting } from "./export";
import { trClassification, trColor, trFilter, trMotif, trPhase, trPhaseIn, trPiece, trSpeed, trTermination } from "./i18n";
import { classifyTermination, dateWindow, getUserColor, outcomeFor, parseMoves, parsePlayedAt, parseSummary } from "./metrics";
import { buildGameReview, buildPlayerProfile, type GameReview, type PlayerProfile } from "./profile";
import { SERIOUS_ERROR_CLASSES, userWp } from "./profile/features";
import type { MoveBucket, ScoreBucket } from "./profile/insights";
import type { OpeningStat } from "./profile/openings";
import { Board } from "./tactics/board";
import { classifyGamePhase } from "./tactics/phase";
import { CATEGORIES } from "./training/exercises";
import { summarizeTraining, type ProgressMap, type TrainingLog } from "./training";
import type { MoveData, StoredGame } from "./types";

export type AiExportDetail = "full" | "compact";

/**
 * How many games go into each per-game section. "full" stays around 30–40k
 * tokens, which every current chat model reads in one piece; "compact" fits
 * the smaller context of free tiers and local models.
 */
export const AI_EXPORT_LIMITS: Record<AiExportDetail, { label: string; table: number; moments: number; annotated: number; errorsPerGame: number }> = {
  full: { label: "Ausführlich", table: 300, moments: 60, annotated: 12, errorsPerGame: 3 },
  compact: { label: "Kompakt", table: 60, moments: 15, annotated: 3, errorsPerGame: 2 },
};

export interface AiExportInput {
  games: StoredGame[];
  usernames: string[];
  dateFilter: string;
  settings: ExportSetting[];
  today: string; // local YYYY-MM-DD
  now: number; // ms
  detail?: AiExportDetail;
}

export interface AiExportResult {
  text: string;
  /** The player's games in the period. */
  games: number;
  analyzed: number;
}

/** The short message to paste next to the uploaded file. */
export const AI_EXPORT_PROMPT =
  `Im Anhang ist der Export meiner Schachpartien aus ${BRAND}. Lies die ganze Datei und erstelle die ausführliche Analyse, ` +
  "die in Abschnitt 1 („Auftrag an die KI“) beschrieben ist. Halte dich an die Legende in Abschnitt 2.";

// ---- formatting ----

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const de = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",");
const pct = (v: unknown) => {
  const n = num(v);
  return n === null ? "–" : `${Math.round(n)} %`;
};
const pct1 = (v: unknown) => {
  const n = num(v);
  return n === null ? "–" : `${de(n)} %`;
};
const signed = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${de(Math.abs(v), digits)}`;
const cell = (v: unknown) => (v === null || v === undefined || v === "" ? "–" : String(v).replace(/\|/g, "/").replace(/\s+/g, " ").trim());

function table(head: string[], rows: unknown[][]): string {
  if (!rows.length) return "_Keine Daten._";
  return [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n");
}

const bullets = (items: string[]) => items.filter(Boolean).map((s) => `- ${s}`).join("\n");

/** Engine score from White's view in pawns ("+1.3", "#-2"); "Matt" once the game is over. */
function evalText(cp: number | null | undefined, mate: number | null | undefined, san = ""): string {
  if (san.endsWith("#")) return "Matt";
  if (mate !== null && mate !== undefined && mate !== 0) return mate > 0 ? `#${mate}` : `#-${-mate}`;
  if (cp === null || cp === undefined) return "?";
  const v = cp / 100;
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

const clock = (s: number | null | undefined) =>
  s === null || s === undefined ? "" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function moverIsWhite(m: MoveData, idx: number): boolean {
  const side = m.fen_before?.split(" ")[1];
  return side ? side === "w" : idx % 2 === 0;
}

const moveLabel = (m: MoveData, idx: number) => {
  const n = m.move_number || Math.floor(idx / 2) + 1;
  return moverIsWhite(m, idx) ? `${n}. ${m.san}` : `${n}... ${m.san}`;
};

function phaseOf(m: MoveData, idx: number): string {
  try {
    return classifyGamePhase(m.fen_before ? new Board(m.fen_before) : new Board(), idx, Boolean(m.is_book_move));
  } catch {
    return "";
  }
}

const NAG: Record<string, string> = { Brilliant: "!!", Great: "!", Inaccuracy: "?!", Mistake: "?", Miss: "?", Blunder: "??" };
const NOTED = new Set(Object.keys(NAG));

// ---- the player's games ----

interface GameItem {
  nr: string;
  game: StoredGame;
  color: "white" | "black";
  moves: MoveData[];
  analyzed: boolean;
  playedAt: number;
}

function ownGames(games: StoredGame[], usernames: string[]): GameItem[] {
  const items = games
    .map((game) => ({ game, color: getUserColor(game, usernames), playedAt: parsePlayedAt(game) ?? 0 }))
    .filter((x): x is { game: StoredGame; color: "white" | "black"; playedAt: number } => x.color !== null)
    .sort((a, b) => b.playedAt - a.playedAt || (b.game.date ?? "").localeCompare(a.game.date ?? ""));
  const width = Math.max(3, String(items.length).length);
  return items.map((x, i) => {
    const moves = parseMoves(x.game.moves_json);
    return {
      ...x,
      nr: `P${String(i + 1).padStart(width, "0")}`,
      moves,
      analyzed: parseSummary(x.game.summary_json)?.analysis_status === "completed" && moves.some((m) => m.classification),
    };
  });
}

const mine = <T,>(it: GameItem, white: T, black: T): T => (it.color === "white" ? white : black);

function resultWord(it: GameItem): string {
  const o = outcomeFor(it.game.result, it.color);
  return o === "win" ? "Sieg" : o === "draw" ? "Remis" : o === "loss" ? "Niederlage" : "offen";
}

function sideAccuracy(it: GameItem, side: "white" | "black"): number | null {
  const s = parseSummary(it.game.summary_json);
  return it.analyzed ? num(s?.[side]?.accuracy) : null;
}

function countsOf(it: GameItem): Record<string, number> {
  const out: Record<string, number> = {};
  it.moves.forEach((m, i) => {
    if (m.classification && moverIsWhite(m, i) === (it.color === "white")) out[m.classification] = (out[m.classification] ?? 0) + 1;
  });
  return out;
}

const opponentOf = (it: GameItem) => mine(it, it.game.black, it.game.white);
const dateOf = (it: GameItem) => (it.game.date && !it.game.date.includes("?") ? it.game.date : "?");
const openingOf = (g: StoredGame) => [g.eco, g.opening].filter(Boolean).join(" ") || "unbekannt";

/** How the game ended, as a German word ("Aufgabe", "Zeitüberschreitung", …). */
function terminationOf(it: GameItem): string {
  try {
    const [type] = classifyTermination(it.game, outcomeFor(it.game.result, it.color) === "draw");
    return type && type !== "Unknown" ? trTermination(type) : "";
  } catch {
    return "";
  }
}
const ratingOf = (v: string | null) => (v && /^\d+$/.test(v.trim()) ? v.trim() : "");

function gameTitle(it: GameItem): string {
  const g = it.game;
  const opp = opponentOf(it);
  const oppElo = ratingOf(mine(it, g.black_elo, g.white_elo));
  const ownElo = ratingOf(mine(it, g.white_elo, g.black_elo));
  const t = terminationOf(it);
  const term = t ? ` (${t})` : "";
  return `${it.nr} · ${dateOf(it)} · ${trSpeed(g.speed_category) || "?"}${g.time_control ? ` ${g.time_control}` : ""} · ${trColor(it.color)}${ownElo ? ` (${ownElo})` : ""} gegen ${opp || "?"}${oppElo ? ` (${oppElo})` : ""} · ${resultWord(it)}${term}`;
}

// ---- sections ----

function header(input: AiExportInput, items: GameItem[], profile: PlayerProfile | null, limits: (typeof AI_EXPORT_LIMITS)[AiExportDetail]): string {
  const nowSec = input.now / 1000;
  const w = dateWindow(input.dateFilter, nowSec);
  const iso = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
  const range = w ? ` (${w.start != null ? iso(w.start) : "Anfang"} bis ${iso(w.end ?? nowSec)})` : "";
  const analyzed = items.filter((i) => i.analyzed).length;
  return [
    `# ${BRAND}: Datenpaket für eine KI-Auswertung`,
    "",
    `> Erstellt am ${input.today} mit ${BRAND} (${BRAND_DOMAIN}) aus Stockfish-Analysen der eigenen Partien.`,
    `> Spieler: **${input.usernames.join(", ") || "?"}** · Zeitraum: ${trFilter(input.dateFilter || "All Time")}${range}`,
    `> ${items.length} eigene Partien, davon ${analyzed} mit der Engine analysiert${profile?.rating ? ` · aktuelle Wertung ${profile.rating.rating} (${trSpeed(profile.rating.speed)})` : ""}.`,
    ">",
    "> **So benutzt du die Datei:** Lade sie in ChatGPT, Claude, Gemini oder eine andere KI hoch und schreibe dazu:",
    `> „${AI_EXPORT_PROMPT}“`,
    "",
    "Inhalt: 1 Auftrag · 2 Legende · 3 Überblick · 4 Wertung · 5 Aufschlüsselung · 6 Phasen · 7 Zugqualität · " +
      "8 Fähigkeiten · 9 Stärken, Schwächen, Muster · 10 Spielstil · 11 Fehleranalyse · 12 Vorteile, Material, Taktik · " +
      "13 Eröffnungen · 14 Entwicklung · 15 Training · 16 Partienliste · 17 Kritische Momente · 18 Partien mit Engine-Kommentaren",
    "",
    `Umfang der Partie-Abschnitte: Partienliste bis ${limits.table} Partien, kritische Momente für die neuesten ${limits.moments} analysierten Partien, ` +
      `vollständige kommentierte Notation für die neuesten ${limits.annotated}. Alle Statistiken (Abschnitte 3–15) beruhen auf allen Partien des Zeitraums.`,
  ].join("\n");
}

const TASK = `## 1. Auftrag an die KI

Du bist ein erfahrener Schachtrainer und analysierst die Partien deines Schülers. Die Daten in dieser Datei stammen aus einer Stockfish-Analyse seiner eigenen Online-Partien und wurden von der App bereits ausgewertet.

**Regeln**
- Antworte auf Deutsch und sprich den Spieler mit „du“ an.
- Stütze dich nur auf diese Daten. Erfinde keine Partien, Züge, Varianten oder Zahlen. Wenn du eine Stellung beurteilst, nutze FEN, Engine-Linie und die Begründung, die zu jedem kritischen Moment angegeben sind, statt selbst Varianten zu rechnen.
- Belege jede Aussage mit einer Zahl aus den Daten und, wo möglich, mit einer Beispielpartie im Format „P007, Zug 23… Lxf7“.
- Achte auf die Stichprobe: Werte mit wenigen Partien (n < 10) oder dem Vermerk „wenig Daten“ sind nur Hinweise, keine Befunde. Sag das dazu.
- Gewichte nach Wirkung: Was kostet die meisten Punkte? Häufige mittlere Probleme sind oft wichtiger als ein einzelner spektakulärer Patzer.
- Suche nach Ursachen hinter den Fehlern (z. B. übersehene Gabeln, Zeitnot, Fehler direkt nach der Eröffnungstheorie, Probleme in Gewinnstellungen), nicht nur nach Symptomen.

**Gewünschte Analyse (mit genau diesen Überschriften)**
1. **Dein Schach in Kürze**: Spielstärke, Spielstil und Gesamteindruck in 4–6 Sätzen, verglichen mit dem, was für die Wertung typisch ist.
2. **Die drei größten Punktefresser**: jeweils Ursache, Zahlen, zwei konkrete Beispielpartien (Zug, besserer Zug, Idee dahinter) und das Muster, das sich wiederholt.
3. **Deine Stärken**: was gut funktioniert und wie du es öfter nutzt.
4. **Eröffnungen**: was du behalten, was du ändern solltest; konkrete Züge oder Systeme als Empfehlung, passend zu den Ergebnissen und zum Stil.
5. **Mittelspiel, Endspiel und Zeiteinteilung**: Befunde je Phase und zur Bedenkzeit.
6. **Psychologie und Rahmen**: Tageszeit, Serien, Spiele nach Niederlagen, Gegnerstärke. Nur mit belastbaren Daten.
7. **Trainingsplan für 4 Wochen**: Woche für Woche, 20–40 Minuten pro Tag, mit konkreten Übungen (Taktikmotive, Endspieltypen, Eröffnungslinien, eigene Partien nacharbeiten).
8. **Messbare Ziele für die nächsten 30 Partien**: 3 Ziele mit Zahl (z. B. „Patzer pro Partie von 1,4 auf unter 1,0“).

Biete am Ende an, einzelne Partien (per Nummer) oder eine Eröffnung vertieft zu besprechen.`;

const LEGEND = `## 2. Legende: So liest du die Daten

- **Perspektive**: „GC“ = Gewinnchance in Prozent, immer **aus Sicht des Spielers** (50 % = ausgeglichen, 100 % = sicher gewonnen). Engine-Bewertungen in Bauerneinheiten sind dagegen **aus Sicht von Weiß** (+1.5 = Weiß steht anderthalb Bauern besser, #3 = Weiß setzt in 3 Zügen matt, #-3 = Schwarz setzt matt).
- **Genauigkeit** (0–100 %): Lichess-Formel aus dem Verlust an Gewinnchance je Zug. Ab etwa 80 % solide, ab 90 % sehr stark. Typisch für die Wertung steht in Abschnitt 4.
- **Punktequote**: (Siege + ½ · Remis) / Partien. **Erwartet**: Punktequote, die die Elo-Formel gegen dieselben Gegner vorhersagt. Darüber = besser als die Wertung.
- **Zugklassen** (nach Verlust an Gewinnchance des Ziehenden, chess.com-Skala):

| Klasse | Zeichen | Bedeutung |
| --- | --- | --- |
| Brillant | !! | bester Zug mit Figurenopfer |
| Großartig | ! | einziger guter Zug oder starke Wende |
| Bester Zug | | erste Wahl der Engine oder gleichwertig |
| Exzellent / Gut | | weniger als 2 bzw. 5 Prozentpunkte GC verloren |
| Buchzug | | Eröffnungstheorie |
| Ungenauigkeit | ?! | 5–10 Prozentpunkte GC verloren |
| Fehler | ? | 10–20 Prozentpunkte GC verloren |
| Patzer | ?? | mehr als 20 Prozentpunkte GC verloren |
| Verpasst | ? | klare Chance ausgelassen (z. B. Gegnerfehler nicht bestraft, Matt übersehen) |

- **Schwere Fehler** = Fehler + Patzer + Verpasst. „je 100 Züge“ zählt nur die eigenen Züge.
- **Phasen**: Eröffnung bis zum Ende der Theorie bzw. der Entwicklung, Endspiel bei wenig Figurenmaterial, dazwischen Mittelspiel.
- **Fähigkeiten** (0–100): aus vielen Zügen geschätzte Teilstärken; „typisch“ = Richtwert für Spieler mit derselben Wertung, „±“ = Unsicherheit, „wenig Daten“ = noch nicht belastbar.
- **Stichprobe**: Die App nennt Stärken, Schwächen und Befunde nur mit genug Partien und einem statistischen Test. Die Rohdaten-Tabellen enthalten aber auch kleine Gruppen; achte auf die Spalte n bzw. Partien.
- **Partie-Nummern**: P001 ist die neueste Partie. Dieselbe Nummer gilt in allen Abschnitten.
- **Notation**: Züge in englischer Kurznotation (N = Springer, B = Läufer, R = Turm, Q = Dame, K = König). Stellungen als FEN.`;

function overviewSection(p: PlayerProfile): string {
  const o = p.overview;
  const q = (o.quality_counts ?? {}) as Record<string, number>;
  const rows: unknown[][] = [
    ["Partien (analysiert)", `${p.total_games} (${p.analyzed_games})`],
    ["Bilanz", `${o.wins} Siege, ${o.draws} Remis, ${o.losses} Niederlagen`],
    ["Punktequote", pct1(o.score_pct)],
    ["Ø Genauigkeit", `${pct1(o.avg_accuracy)}${num(o.accuracy_sd) !== null ? ` (Streuung ± ${de(o.accuracy_sd)})` : ""}`],
    ["Partien ohne schweren Fehler", pct1(o.clean_games_pct)],
    ["Form (letzte 20 vs. 20 davor)", num(o.form_delta) !== null ? `${signed(o.form_delta)} Prozentpunkte Genauigkeit` : "–"],
    ["Aktuelle Wertungen", Object.entries((o.ratings ?? {}) as Record<string, number>).map(([k, v]) => `${k} ${v}`).join(", ")],
    ["Höchster besiegter Gegner", o.best_win && o.best_win !== "N/A" ? o.best_win : "–"],
    ["Brillante / großartige Züge", `${q.Brilliant ?? 0} / ${q.Great ?? 0}`],
  ];
  return `## 3. Überblick\n\n${table(["Kennzahl", "Wert"], rows)}`;
}

function ratingSection(p: PlayerProfile): string {
  const rc = p.rating;
  if (!rc) return "## 4. Wertung und Erwartung\n\n_Keine Wertungen in den Partien._";
  const own = (p.overview.phase_accuracy ?? {}) as Record<string, number>;
  const rows: unknown[][] = [
    ["Wertung (meistgespielte Bedenkzeit)", `${rc.rating} (${trSpeed(rc.speed)})`],
    ["Partien mit beiden Wertungen", rc.rated_games],
    ["Ø Gegnerwertung", rc.avg_opponent ?? "–"],
    ["Performance", rc.performance ?? "–"],
    ["Punkte geholt / erwartet", `${de(rc.score, 1)} / ${rc.expected_score !== null ? de(rc.expected_score, 1) : "–"}`],
    ["Genauigkeit eigen / typisch für die Wertung", `${pct1(p.overview.avg_accuracy)} / ${pct1(rc.typical_accuracy)}`],
    ...Object.entries(rc.typical_phase_accuracy ?? {}).map(([k, v]) => [`Genauigkeit ${trPhase(k)} eigen / typisch`, `${pct1(own[k])} / ${pct1(v)}`]),
  ];
  const ratings = (p.trends?.ratings ?? {}) as Record<string, Array<[number, number]>>;
  const course = Object.entries(ratings).map(([speed, pts]) => {
    const vals = pts.map((x) => x[1]);
    const day = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
    return [speed, pts.length, `${vals[0]} (${day(pts[0][0])})`, `${vals[vals.length - 1]} (${day(pts[pts.length - 1][0])})`, Math.min(...vals), Math.max(...vals)];
  });
  return [
    "## 4. Wertung und Erwartung",
    "",
    table(["Kennzahl", "Wert"], rows),
    course.length ? `\n**Wertungsverlauf**\n\n${table(["Bedenkzeit", "Partien", "Erste", "Letzte", "Tief", "Hoch"], course)}` : "",
  ].join("\n");
}

type BreakdownRow = { label: string; games: number; wins: number; draws: number; losses: number; score_pct: number; avg_accuracy: number; expected_pct: number | null };

function breakdownSection(p: PlayerProfile): string {
  const b = (p.breakdowns ?? {}) as Record<string, BreakdownRow[]>;
  const rows = (k: string) =>
    (b[k] ?? []).map((r) => [r.label, r.games, `${r.wins}/${r.draws}/${r.losses}`, pct(r.score_pct), r.expected_pct !== null ? pct(r.expected_pct) : "–", r.avg_accuracy ? pct1(r.avg_accuracy) : "–"]);
  const head = ["Gruppe", "Partien", "S/R/N", "Punkte", "Erwartet", "Genauigkeit"];
  const parts = ["## 5. Aufschlüsselung", "", "**Nach Farbe**", "", table(head, rows("color")), "", "**Nach Bedenkzeit**", "", table(head, rows("speed")), "", "**Nach Gegnerstärke**", "", table(head, rows("opponent"))];
  const d = p.deep;
  if (d?.game_types?.length) {
    parts.push("", "**Nach Partieverlauf**", "", table(["Partietyp", "Beschreibung", "Partien", "Anteil", "Punkte", "Genauigkeit"], d.game_types.map((t) => [t.label, t.description, t.games, pct(t.share), pct(t.score_pct), pct1(t.accuracy)])));
  }
  return parts.join("\n");
}

function phaseSection(p: PlayerProfile): string {
  const stats = p.statistics ?? {};
  const acc = (stats.phase_stats?.accuracies ?? {}) as Record<string, number>;
  const blunders = (stats.phase_stats?.blunders ?? {}) as Record<string, number>;
  const typical = p.rating?.typical_phase_accuracy ?? {};
  const time = (stats.time_stats?.has_clock_data ? (stats.time_stats.phase_pace ?? {}) : {}) as Record<string, { avg_time?: number; moves_count?: number }>;
  const rows = ["opening", "middlegame", "endgame"].map((ph) => [
    trPhase(ph),
    acc[ph] ? pct1(acc[ph]) : "–",
    typical[ph] !== undefined ? pct1(typical[ph]) : "–",
    blunders[ph] ?? 0,
    num(time[ph]?.avg_time) ? `${de(time[ph].avg_time as number)} s` : "–",
  ]);
  const tally = p.moves?.phases ?? [];
  const tallyRows = tally.map((t) => {
    const serious = (t.counts.Mistake ?? 0) + (t.counts.Miss ?? 0) + (t.counts.Blunder ?? 0);
    return [t.label, t.games, t.moves, t.moves ? de((serious / t.moves) * 100) : "–", t.counts.Inaccuracy ?? 0, t.counts.Mistake ?? 0, t.counts.Miss ?? 0, t.counts.Blunder ?? 0];
  });
  return [
    "## 6. Phasen",
    "",
    table(["Phase", "Genauigkeit", "Typisch für Wertung", "Patzer gesamt", "Ø Zeit pro Zug"], rows),
    tallyRows.length ? `\n${table(["Phase", "Partien", "Eigene Züge", "Schwere Fehler je 100", "Ungenau", "Fehler", "Verpasst", "Patzer"], tallyRows)}` : "",
  ].join("\n");
}

function moveQualitySection(p: PlayerProfile): string {
  const t = p.moves;
  if (!t) return "## 7. Zugqualität\n\n_Noch keine analysierten Partien._";
  const opp = t.opponents;
  const rows = t.classes.map((c) => [
    trClassification(c.key),
    c.count,
    de(c.per_game, 2),
    de(c.per_100),
    c.games_with,
    opp && opp.moves ? de(((opp.counts[c.key] ?? 0) / opp.moves) * 100) : "–",
  ]);
  const r = t.records;
  return [
    "## 7. Zugqualität",
    "",
    `${t.games} analysierte Partien, ${t.moves} eigene Züge${opp ? `, ${opp.moves} Züge der Gegner` : ""}.`,
    "",
    table(["Klasse", "Anzahl", "Je Partie", "Je 100 Züge", "Partien mit", "Gegner je 100 Züge"], rows),
    "",
    bullets([
      `Partien ohne Patzer: ${r.blunder_free_games}; längste Serie ohne Patzer: ${r.longest_blunder_free}; aktuelle Serie: ${r.current_blunder_free}.`,
      ...t.findings.map((f) => `${f.title}: ${f.text}`),
    ]),
  ].join("\n");
}

function skillsSection(p: PlayerProfile): string {
  const rows = p.skills
    .filter((s) => s.sample > 0)
    .map((s) => [
      s.name,
      Math.round(s.score),
      s.typical !== null && s.typical !== undefined ? Math.round(s.typical) : "–",
      s.margin ? `± ${Math.round(s.margin)}` : "–",
      s.games ?? s.sample,
      s.reliable ? "ja" : "wenig Daten",
      s.detail,
    ]);
  return `## 8. Fähigkeiten\n\n${table(["Fähigkeit", "Wert", "Typisch", "Unsicherheit", "Partien", "Belastbar", "Grundlage"], rows)}`;
}

function insightsSection(p: PlayerProfile, nrOf: (id: string) => string): string {
  const refs = (examples: { game_id: string; label: string }[]) => {
    const list = examples.slice(0, 4).map((e) => `${nrOf(e.game_id)}${e.label ? ` ${e.label}` : ""}`).filter((s) => !s.startsWith("?"));
    return list.length ? ` Beispiele: ${list.join("; ")}.` : "";
  };
  return [
    "## 9. Stärken, Schwächen und Muster",
    "",
    "**Stärken** (von der App statistisch geprüft)",
    p.strengths.length ? bullets(p.strengths.map((s) => `${s.title}: ${s.text}`)) : "_Noch keine belastbare Stärke._",
    "",
    "**Schwächen** (von der App statistisch geprüft)",
    p.weaknesses.length ? bullets(p.weaknesses.map((s) => `${s.title}: ${s.text}`)) : "_Noch keine belastbare Schwäche._",
    "",
    "**Wiederkehrende Muster**",
    p.patterns.length ? bullets(p.patterns.map((x) => `${x.title} (Schwere: ${x.severity}): ${x.text}${refs(x.examples)}`)) : "_Keine._",
    p.training_plan.length
      ? `\n**Trainingsvorschläge der App**\n${bullets(p.training_plan.map((t) => `${t.title}: ${t.reason}${t.steps.length ? ` Schritte: ${t.steps.join(" ")}` : ""}${refs(t.examples)}`))}`
      : "",
  ].join("\n");
}

function styleSection(p: PlayerProfile): string {
  if (!p.style) return "## 10. Spielstil\n\n_Noch zu wenige analysierte Partien._";
  const s = p.style;
  return [
    "## 10. Spielstil",
    "",
    `**${s.label}**: ${s.description}`,
    "",
    table(["Achse", "Wert (0–100)", "0 bedeutet", "100 bedeutet"], s.axes.map((a) => [a.name, `${Math.round(a.value)}${a.margin ? ` ± ${Math.round(a.margin)}` : ""}`, a.low_label, a.high_label])),
    s.facts.length ? `\n${bullets(s.facts)}` : "",
  ].join("\n");
}

const moveTable = (title: string, buckets: MoveBucket[]) =>
  buckets.some((b) => b.moves)
    ? `**${title}**\n\n${table(["Gruppe", "Eigene Züge", "Schwere Fehler", "Je 100 Züge"], buckets.filter((b) => b.moves).map((b) => [b.label, b.moves, b.errors, b.per100 !== null ? de(b.per100) : "–"]))}`
    : "";

const scoreTable = (title: string, buckets: ScoreBucket[]) =>
  buckets.some((b) => b.games)
    ? `**${title}**\n\n${table(["Gruppe", "Partien", "Punkte", "± (95 %)", "Genauigkeit"], buckets.filter((b) => b.games).map((b) => [b.label, b.games, pct(b.score_pct), b.margin !== null ? Math.round(b.margin) : "–", pct1(b.avg_accuracy)]))}`
    : "";

function deepSection(p: PlayerProfile): string {
  const d = p.deep;
  if (!d) return "## 11. Fehleranalyse\n\n_Noch keine analysierten Partien._";
  const parts = [
    "## 11. Fehleranalyse",
    "",
    d.facts.length ? `**Befunde der App** (statistisch geprüft)\n${bullets(d.facts)}` : "",
    d.feedback.length ? `**Entwicklung und Rückmeldung**\n${bullets(d.feedback.map((f) => `${f.title}: ${f.text}`))}` : "",
    `Fehler pro Partie: ${d.errors_per_game.map((e) => `${trClassification(e.classification)} ${de(e.per_game, 2)}`).join(", ")}.`,
    d.punish.chances ? `Gegnerfehler bestraft: ${d.punish.punished} von ${d.punish.chances} (${pct(d.punish.rate)}).` : "",
    d.hot_squares.length ? `Felder, auf denen die meisten schweren Fehler landen: ${d.hot_squares.map((h) => `${h.square} (${h.count})`).join(", ")}.` : "",
    moveTable("Nach Zugnummer", d.by_move_number),
    moveTable("Nach Stellungslage vor dem Zug (eigene GC)", d.by_situation),
    moveTable("Nach gezogener Figur", d.by_piece),
    moveTable("Nach Bedenkzeit pro Zug", d.by_think_time),
    moveTable("Zeitnot", d.time_trouble),
    moveTable("Nach Verlassen der Theorie", d.after_book),
    scoreTable("Nach Tageszeit", d.by_daytime),
    scoreTable("Nach Wochentag", d.by_weekday),
    scoreTable("Nach dem Ergebnis der vorigen Partie (gleiche Sitzung)", d.after_result),
    scoreTable("Nach Position in der Sitzung", d.by_session_game),
  ];
  return parts.filter(Boolean).join("\n\n");
}

function materialSection(p: PlayerProfile): string {
  const s = p.statistics ?? {};
  const adv = (s.advantage_stats ?? {}) as Record<string, number>;
  const hang = (s.hanging_stats ?? {}) as { total_hung?: number; by_piece?: Record<string, number>; opponent_hanging_captured?: number; opponent_hanging_missed?: number };
  const themes = Object.entries((s.tactical_themes ?? {}) as Record<string, number>).filter(([, v]) => v > 0);
  const terms = (label: string, counts: Record<string, number> | undefined) => {
    const list = Object.entries(counts ?? {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    return list.length ? `${label}: ${list.map(([k, v]) => `${trTermination(k)} ${v}`).join(", ")}.` : "";
  };
  const pieces = Object.entries(hang.by_piece ?? {}).filter(([, v]) => v > 0);
  return [
    "## 12. Vorteile, Material und Taktik",
    "",
    bullets([
      adv.had_winning_advantage ? `Gewinnstellung (GC ≥ ~75 %) erreicht in ${adv.had_winning_advantage} Partien, davon gewonnen ${adv.converted_advantage ?? 0} (${pct(adv.conversion_rate)}), verloren ${adv.thrown_losses ?? 0} (${pct(adv.throw_rate)}).` : "",
      adv.had_losing_position ? `Verloren stehende Partien: ${adv.had_losing_position}, davon noch Remis oder Sieg: ${adv.comeback_drawn_or_won ?? 0} (${pct(adv.comeback_rate)}).` : "",
      hang.total_hung !== undefined ? `Eingestellte Figuren: ${hang.total_hung}${pieces.length ? ` (${pieces.map(([k, v]) => `${trPiece(k, v > 1)} ${v}`).join(", ")})` : ""}. Eingestellte Gegnerfiguren geschlagen: ${hang.opponent_hanging_captured ?? 0}, übersehen: ${hang.opponent_hanging_missed ?? 0}.` : "",
      themes.length ? `Taktische Motive in den eigenen Partien: ${themes.map(([k, v]) => `${trMotif(k)} ${v}`).join(", ")}.` : "",
      num(s.time_loss_pct) ? `Anteil der Niederlagen durch Zeitüberschreitung: ${pct(s.time_loss_pct)}.` : "",
      terms("Siege durch", s.win_term_counts),
      terms("Niederlagen durch", s.loss_term_counts),
      terms("Remis durch", s.draw_term_counts),
    ]),
  ].join("\n");
}

function openingSection(p: PlayerProfile, nrOf: (id: string) => string): string {
  const op = p.openings;
  if (!op) return "## 13. Eröffnungen\n\n_Keine Daten._";
  const rows = (list: OpeningStat[]) =>
    list.slice(0, 15).map((l) => [
      `${l.eco ? `${l.eco} ` : ""}${l.name}`,
      l.games,
      `${l.wins}/${l.draws}/${l.losses}`,
      pct(l.score_pct),
      pct1(l.opening_accuracy),
      pct(l.wp_after_opening),
      l.book_exit_move !== null ? Math.round(l.book_exit_move) : "–",
      l.first_error_move !== null ? Math.round(l.first_error_move) : "–",
      l.line.slice(0, 10).join(" "),
    ]);
  const head = ["Eröffnung", "Partien", "S/R/N", "Punkte", "Eröffnungs-Genauigkeit", "GC nach Eröffnung", "Theorie bis Zug", "1. schwerer Fehler ~Zug", "Typische Züge"];
  const leaks = op.tree.leaks.slice(0, 10).map((l) => [
    trColor(l.color),
    l.path.join(" "),
    l.san,
    l.better ?? "–",
    `${l.errors} von ${l.judged}`,
    l.games,
    pct(l.score_pct),
    l.recent.slice(0, 3).map((g) => nrOf(g.id)).filter((n) => n !== "?").join(", "),
  ]);
  return [
    "## 13. Eröffnungen",
    "",
    op.wp_after_opening !== null ? `Ø eigene Gewinnchance nach der Eröffnung: ${pct(op.wp_after_opening)}.` : "",
    "",
    "**Repertoire mit Weiß**",
    "",
    table(head, rows(op.white)),
    "",
    "**Repertoire mit Schwarz**",
    "",
    table(head, rows(op.black)),
    "",
    op.white_first.length ? `Erste Züge mit Weiß: ${op.white_first.map((c) => `1. ${c.san} (${c.games}×, ${pct(c.score_pct)})`).join(", ")}.` : "",
    ...op.black_vs.slice(0, 5).map((v) => `Mit Schwarz gegen 1. ${v.san} (${v.games}×, ${pct(v.score_pct)} Punkte): ${v.replies.map((r) => `1… ${r.san} (${r.games}×, ${pct(r.score_pct)})`).join(", ")}.`),
    leaks.length
      ? `\n**Eröffnungszüge, die immer wieder schiefgehen**\n\n${table(["Farbe", "Zugfolge bis dahin", "Gespielter Zug", "Besser", "Davon Fehler", "Partien", "Punkte", "Beispiele"], leaks)}`
      : "",
    op.facts.length ? `\n**Befunde der App**\n${bullets(op.facts)}` : "",
  ].join("\n");
}

type MonthRow = { month: string; games: number; score_pct: number; avg_accuracy: number | null; blunders_per_game: number | null };

function trendSection(p: PlayerProfile): string {
  const monthly = (p.trends?.monthly ?? []) as MonthRow[];
  const rows = monthly.slice(-18).map((m) => [m.month, m.games, pct(m.score_pct), pct1(m.avg_accuracy), m.blunders_per_game !== null ? de(m.blunders_per_game, 2) : "–"]);
  const evo = p.deep?.evolution;
  const changes = evo?.changes ?? [];
  return [
    "## 14. Entwicklung",
    "",
    table(["Monat", "Partien", "Punkte", "Genauigkeit", "Patzer je Partie"], rows),
    changes.length
      ? `\n**Vorher/Nachher-Vergleich der App**\n${bullets(
          changes.map((c) => {
            const unit = c.unit ? ` ${c.unit}` : "";
            const v = (x: number) => de(x, c.unit ? 1 : 2);
            return `${c.label}: ${v(c.earlier)}${unit} → ${v(c.recent)}${unit}${c.significant ? (c.improved ? " (deutlich besser)" : " (deutlich schlechter)") : " (kein klarer Unterschied)"}`;
          }),
        )}`
      : "",
  ].join("\n");
}

function trainingSection(input: AiExportInput, p: PlayerProfile): string {
  const get = <T,>(key: string, fallback: T): T => (input.settings.find((s) => s.key === key)?.value as T | undefined) ?? fallback;
  const progress = get<ProgressMap>("training.progress", {});
  const log = get<TrainingLog>("training.log", {});
  if (!Object.keys(progress).length && !Object.keys(log).length) return "## 15. Training in der App\n\n_Noch keine Übungen gemacht._";
  const t = summarizeTraining(p.exercises, progress, log, input.today);
  const cats = t.categories.filter((c) => c.total > 0 || c.attempts > 0);
  return [
    "## 15. Training in der App",
    "",
    `Serie: ${t.streak} Tage am Stück. Letzte 7 Tage: ${t.week.done} Übungen, davon ${t.week.correct} gelöst.`,
    "",
    table(["Übungsart", "Verfügbar", "Versuche", "Gelöst", "Quote", "Sicher beherrscht"], cats.map((c) => [CATEGORIES[c.category].label, c.total, c.attempts, c.solved, c.rate !== null ? pct(c.rate) : "–", c.mastered])),
  ].join("\n");
}

function gameListSection(items: GameItem[], limit: number): string {
  const rows = items.slice(0, limit).map((it) => {
    const g = it.game;
    const c = it.analyzed ? countsOf(it) : null;
    return [
      it.nr,
      dateOf(it),
      `${trSpeed(g.speed_category)}${g.time_control ? ` ${g.time_control}` : ""}`,
      trColor(it.color),
      ratingOf(mine(it, g.white_elo, g.black_elo)),
      `${opponentOf(it)}${ratingOf(mine(it, g.black_elo, g.white_elo)) ? ` (${ratingOf(mine(it, g.black_elo, g.white_elo))})` : ""}`,
      resultWord(it),
      terminationOf(it),
      openingOf(g),
      Math.ceil(it.moves.length / 2),
      pct1(sideAccuracy(it, it.color)),
      pct1(sideAccuracy(it, it.color === "white" ? "black" : "white")),
      c ? `${c.Blunder ?? 0}/${c.Mistake ?? 0}/${c.Miss ?? 0}/${c.Inaccuracy ?? 0}` : "nicht analysiert",
    ];
  });
  const more = items.length > limit ? `\n\n_${items.length - limit} ältere Partien sind nicht einzeln aufgeführt, aber in allen Statistiken enthalten._` : "";
  return `## 16. Partienliste (neueste zuerst)\n\n${table(
    ["Nr", "Datum", "Tempo", "Farbe", "Eigene Elo", "Gegner", "Ergebnis", "Beendigung", "Eröffnung", "Züge", "Genauigkeit", "Gegner-Gen.", "Patzer/Fehler/Verpasst/Ungenau"],
    rows,
  )}${more}`;
}

/** One costly move with everything a reader needs to understand it without a board. */
function momentLines(it: GameItem, idx: number): string {
  const m = it.moves[idx];
  const next = it.moves[idx + 1];
  const isWhite = it.color === "white";
  const wpB = Math.round(userWp(m.win_chance_before, isWhite) * 100);
  const wpA = Math.round(userWp(m.win_chance_after, isWhite) * 100);
  const bestPv = m.multi_pvs?.[0]?.pv?.length ? m.multi_pvs[0].pv : m.pv?.length ? m.pv : m.best_move ? [m.best_move] : [];
  const bestLine = m.best_move && m.best_move !== m.uci && bestPv.length ? m.multi_pvs?.[0]?.pv_san || pvToSan(m.fen_before, bestPv.slice(0, 8)) : "";
  const replyPv = next?.multi_pvs?.[0]?.pv ?? [];
  const refutation = replyPv.length && next ? pvToSan(next.fen_before, replyPv.slice(0, 6)) : "";
  let reasons: string[] = [];
  try {
    reasons = explainMove({ fenBefore: m.fen_before, uci: m.uci, bestPv, replyPv, mateBefore: m.eval_before_mate, mateAfter: m.eval_after_mate });
  } catch {
    reasons = [];
  }
  // A bare "Besser war …" only repeats the line above; one with a reason after the colon stays.
  if (bestLine) reasons = reasons.filter((r) => !/^Besser war [^:]*\.$/.test(r));
  const phase = phaseOf(m, idx);
  const time = m.time_spent !== null && m.time_spent !== undefined ? `, ${de(m.time_spent, 0)} s überlegt${m.time_left !== null ? `, Restzeit ${clock(m.time_left)}` : ""}` : "";
  return [
    `- **${moveLabel(m, idx)}${NAG[m.classification] ?? ""}** ${trClassification(m.classification)}${phase ? ` ${trPhaseIn(phase)}` : ""}: GC ${wpB} % → ${wpA} % (Bewertung ${evalText(m.eval_before_cp, m.eval_before_mate)} → ${evalText(m.eval_after_cp, m.eval_after_mate, m.san)})${time}.`,
    bestLine ? `  - Besser: ${bestLine}` : "",
    refutation ? `  - Beste Antwort des Gegners danach: ${refutation}` : "",
    reasons.length ? `  - Warum: ${reasons.join(" ")}` : m.explanation ? `  - Hinweis der App: ${m.explanation}` : "",
    `  - Stellung vor dem Zug: \`${m.fen_before}\``,
  ]
    .filter(Boolean)
    .join("\n");
}

function momentsSection(items: GameItem[], limits: (typeof AI_EXPORT_LIMITS)[AiExportDetail]): string {
  const games = items.filter((i) => i.analyzed).slice(0, limits.moments);
  const blocks = games.map((it) => {
    const isWhite = it.color === "white";
    let review: GameReview | null = null;
    try {
      review = buildGameReview(it.game, it.color);
    } catch {
      review = null;
    }
    const own = it.moves
      .map((m, idx) => ({ m, idx }))
      .filter(({ m, idx }) => moverIsWhite(m, idx) === isWhite && SERIOUS_ERROR_CLASSES.has(m.classification))
      .sort((a, b) => userWp(b.m.win_chance_before, isWhite) - userWp(b.m.win_chance_after, isWhite) - (userWp(a.m.win_chance_before, isWhite) - userWp(a.m.win_chance_after, isWhite)))
      .slice(0, limits.errorsPerGame)
      .sort((a, b) => a.idx - b.idx);
    const highlights = it.moves
      .map((m, idx) => ({ m, idx }))
      .filter(({ m, idx }) => moverIsWhite(m, idx) === isWhite && (m.classification === "Brilliant" || m.classification === "Great"))
      .slice(0, 3);
    const g = it.game;
    const acc = sideAccuracy(it, it.color);
    const oppAcc = sideAccuracy(it, isWhite ? "black" : "white");
    const lines = [
      `### ${gameTitle(it)}`,
      `Eröffnung: ${openingOf(g)} · ${Math.ceil(it.moves.length / 2)} Züge · Genauigkeit ${pct1(acc)} (Gegner ${pct1(oppAcc)})`,
    ];
    if (review) {
      lines.push(
        `Phasen: ${review.phases
          .filter((ph) => ph.moves > 0)
          .map((ph) => `${ph.name} ${ph.accuracy ? pct(ph.accuracy) : "–"} (${ph.errors} ${ph.errors === 1 ? "schwerer Fehler" : "schwere Fehler"} in ${ph.moves} Zügen)`)
          .join(" · ")}`,
      );
      lines.push(`Fazit der App: ${review.headline}`);
      if (review.turning_point) lines.push(`Wendepunkt: ${review.turning_point.move_label} (${review.turning_point.by_user ? "eigener Zug" : "Zug des Gegners"}, GC ${Math.round(review.turning_point.wp_before * 100)} % → ${Math.round(review.turning_point.wp_after * 100)} %)`);
    }
    if (own.length) lines.push("", ...own.map(({ idx }) => momentLines(it, idx)));
    else lines.push("", "- Kein schwerer eigener Fehler in dieser Partie.");
    if (highlights.length) lines.push(`- Starke Züge: ${highlights.map(({ m, idx }) => `${moveLabel(m, idx)}${NAG[m.classification]} (${trClassification(m.classification)})`).join(", ")}`);
    if (review?.lessons.length) lines.push(`- Lehre der App: ${review.lessons.join(" ")}`);
    return lines.join("\n");
  });
  return `## 17. Kritische Momente der neuesten analysierten Partien\n\nJe Partie die ${limits.errorsPerGame} teuersten eigenen Züge mit besserem Zug, Engine-Linie, konkreter Begründung und Stellung (FEN).\n\n${blocks.join("\n\n") || "_Noch keine analysierten Partien._"}`;
}

/** Whole game as PGN move text with the engine score after every move and verdicts on notable moves. */
export function annotatedMovetext(moves: MoveData[], userColor: "white" | "black"): string {
  const isUserWhite = userColor === "white";
  const out: string[] = [];
  let needNumber = true;
  moves.forEach((m, i) => {
    const white = moverIsWhite(m, i);
    const n = m.move_number || Math.floor(i / 2) + 1;
    const num = white ? `${n}. ` : needNumber ? `${n}... ` : "";
    const cls = m.classification;
    const ev = evalText(m.eval_after_cp, m.eval_after_mate, m.san);
    let comment = ev;
    if (NOTED.has(cls)) {
      const who = white === isUserWhite ? "eigener Zug" : "Gegner";
      const wpB = Math.round(userWp(m.win_chance_before, isUserWhite) * 100);
      const wpA = Math.round(userWp(m.win_chance_after, isUserWhite) * 100);
      const best = m.best_move && m.best_move !== m.uci && cls !== "Brilliant" && cls !== "Great" ? pvToSan(m.fen_before, [m.best_move]).replace(/^\d+\.+\s*/, "") : "";
      comment = `${ev}; ${trClassification(cls)} (${who}), GC ${wpB} → ${wpA} %${best ? `, besser ${best}` : ""}`;
    }
    out.push(`${num}${m.san}${NAG[cls] ?? ""} {${comment}}`);
    // After a comment the next Black move repeats its number, as in PGN.
    needNumber = true;
  });
  return out.join(" ");
}

function annotatedSection(items: GameItem[], limit: number): string {
  const games = items.filter((i) => i.analyzed).slice(0, limit);
  const blocks = games.map((it) => `### ${gameTitle(it)}\n\n${annotatedMovetext(it.moves, it.color)}`);
  return `## 18. Partien mit Engine-Kommentaren\n\nDie neuesten analysierten Partien Zug für Zug. Hinter jedem Zug steht in {} die Bewertung danach (aus Sicht von Weiß); auffällige Züge tragen die Zugklasse und die Gewinnchance aus Sicht des Spielers.\n\n${blocks.join("\n\n") || "_Noch keine analysierten Partien._"}`;
}

/** Builds the Markdown file for an AI chat from the player's games in the period. */
export function buildAiExport(input: AiExportInput): AiExportResult {
  const limits = AI_EXPORT_LIMITS[input.detail ?? "full"];
  const games = gamesInPeriod(input.games, input.dateFilter, input.now / 1000);
  const items = ownGames(games, input.usernames);
  const analyzed = items.filter((i) => i.analyzed).length;
  const profile = input.usernames.length && items.length ? buildPlayerProfile(games, input.usernames, "All Formats", "All Time", "All Colors") : null;
  const nrById = new Map(items.map((i) => [i.game.id, i.nr]));
  const nrOf = (id: string) => nrById.get(id) ?? "?";

  const sections = [header(input, items, profile, limits), TASK, LEGEND];
  if (!profile) {
    sections.push("## 3. Daten\n\n_Keine eigenen Partien im gewählten Zeitraum. Trage in der App unter Einstellungen deine Benutzernamen ein._");
  } else {
    sections.push(
      overviewSection(profile),
      ratingSection(profile),
      breakdownSection(profile),
      phaseSection(profile),
      moveQualitySection(profile),
      skillsSection(profile),
      insightsSection(profile, nrOf),
      styleSection(profile),
      deepSection(profile),
      materialSection(profile),
      openingSection(profile, nrOf),
      trendSection(profile),
      trainingSection(input, profile),
      gameListSection(items, limits.table),
      momentsSection(items, limits),
      annotatedSection(items, limits.annotated),
    );
  }
  const text = `${sections.join("\n\n")}\n\n---\nEnde des Datenpakets.\n`;
  return { text, games: items.length, analyzed };
}
