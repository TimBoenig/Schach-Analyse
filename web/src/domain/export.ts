// Full data export and restore. One JSON file holds everything the app knows:
// the games with every analysed move, the player profile computed from them
// (statistics, skills, openings, insights, training plan), a review per game,
// the training progress and the saved AI coach answers. A CSV of the games and
// a PGN file cover spreadsheets and other chess programs.

import { trFilter } from "./i18n";
import { dateWindow, getUserColor, inDateFilter, outcomeFor, parseMoves, parseSummary } from "./metrics";
import { buildGameReview, buildPlayerProfile, type GameReview, type PlayerProfile } from "./profile";
import { summarizeTraining, type DailyPlan, type ProgressMap, type TrainingLog, type TrainingSummary } from "./training";
import type { MoveData, StoredGame } from "./types";

export const BACKUP_FORMAT = "schach-analyse-backup";
export const BACKUP_VERSION = 2;

/** A coach answer kept across sessions (Trainerbericht, Partie-Erklärung). */
export interface SavedCoachAnswer {
  key: string;
  title: string;
  text: string;
  created_at: number; // ms
}

export interface ExportSetting {
  key: string;
  value: unknown;
  updated_at: number;
}

export interface ExportInput {
  games: StoredGame[];
  usernames: string[];
  /** Period to export ("All Time", a preset or a range filter). */
  dateFilter: string;
  settings: ExportSetting[];
  coachAnswers: SavedCoachAnswer[];
  today: string; // local YYYY-MM-DD
  now: number; // ms
}

export interface FullExport {
  format: typeof BACKUP_FORMAT;
  version: number;
  exported_at: string;
  hinweis: string;
  scope: {
    usernames: string[];
    period: string;
    period_label: string;
    from: string | null;
    to: string | null;
    games_total: number;
    games_exported: number;
    games_analyzed: number;
  };
  /** Complete stored games: PGN, metadata, every move with evaluation and classification. */
  games: StoredGame[];
  /** Post-game review per analysed game of the player, keyed by game id. */
  reviews: Record<string, GameReview>;
  /** Player profile for the period, null without usernames. */
  profile: PlayerProfile | null;
  training: {
    progress: ProgressMap;
    log: TrainingLog;
    plan: DailyPlan | null;
    prefs: unknown;
    summary: TrainingSummary | null;
  };
  coach: { answers: SavedCoachAnswer[] };
  settings: ExportSetting[];
}

export const COACH_ANSWERS_KEY = "coach.answers";

// Settings that only describe this device's sync state, or that the export
// carries in its own section.
const SKIP_SETTING = (key: string) => key.startsWith("sync.") || key.startsWith("training.") || key === COACH_ANSWERS_KEY;

const HINWEIS =
  "Vollständiger Export der Schach-Analyse. games: alle Partien mit PGN und jedem analysierten Zug " +
  "(Bewertung aus Sicht von Weiß, Klassifizierung, beste Fortsetzung). reviews: Partie-Auswertung je Partie. " +
  "profile: Statistiken, Fähigkeiten, Stärken, Schwächen, Spielstil, Muster, Eröffnungen, Einblicke, " +
  "Verläufe und Trainingsplan für den gewählten Zeitraum. training: Übungsfortschritt und Tagespläne. " +
  "coach: gespeicherte Antworten des KI-Coachs. Diese Datei lässt sich unter Einstellungen wieder einspielen.";

const isoDay = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

function setting<T>(settings: ExportSetting[], key: string, fallback: T): T {
  const r = settings.find((s) => s.key === key);
  return r ? (r.value as T) : fallback;
}

/** Games inside the period, any player (the profile then picks the player's own). */
export function gamesInPeriod(games: StoredGame[], dateFilter: string, now = Date.now() / 1000): StoredGame[] {
  if (!dateFilter || dateFilter === "All Time") return games;
  return games.filter((g) => inDateFilter(g, dateFilter, now));
}

export function buildFullExport(input: ExportInput): FullExport {
  const nowSec = input.now / 1000;
  const games = gamesInPeriod(input.games, input.dateFilter, nowSec);
  const profile = input.usernames.length
    ? buildPlayerProfile(games, input.usernames, "All Formats", "All Time", "All Colors")
    : null;

  const reviews: Record<string, GameReview> = {};
  let analyzed = 0;
  for (const g of games) {
    if (parseSummary(g.summary_json)?.analysis_status !== "completed") continue;
    analyzed++;
    const color = getUserColor(g, input.usernames);
    if (!color) continue;
    try {
      const r = buildGameReview(g, color);
      if (r) reviews[g.id] = r;
    } catch {
      // A malformed game keeps its raw data in the export, just without a review.
    }
  }

  const progress = setting<ProgressMap>(input.settings, "training.progress", {});
  const log = setting<TrainingLog>(input.settings, "training.log", {});
  const plan = setting<DailyPlan | null>(input.settings, "training.plan", null);
  const w = dateWindow(input.dateFilter, nowSec);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: new Date(input.now).toISOString(),
    hinweis: HINWEIS,
    scope: {
      usernames: input.usernames,
      period: input.dateFilter || "All Time",
      period_label: trFilter(input.dateFilter || "All Time"),
      from: w?.start != null ? isoDay(w.start) : null,
      to: w ? isoDay(w.end ?? nowSec) : null,
      games_total: input.games.length,
      games_exported: games.length,
      games_analyzed: analyzed,
    },
    games,
    reviews,
    profile,
    training: {
      progress,
      log,
      plan,
      prefs: setting(input.settings, "training.prefs", null),
      summary: profile ? summarizeTraining(profile.exercises, progress, log, input.today) : null,
    },
    coach: { answers: [...input.coachAnswers].sort((a, b) => b.created_at - a.created_at) },
    settings: input.settings.filter((s) => !SKIP_SETTING(s.key)),
  };
}

export interface ParsedBackup {
  games: StoredGame[];
  settings: ExportSetting[];
  coachAnswers: SavedCoachAnswer[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * Read a backup file (version 1 = games only, version 2 = full export).
 * Throws on anything that is not a backup, so a wrong file never half-imports.
 */
export function parseBackup(text: string): ParsedBackup {
  const data: unknown = JSON.parse(text);
  if (!isRecord(data) || !Array.isArray(data.games)) throw new Error("Keine Sicherung der Schach-Analyse.");
  const games = data.games.filter(
    (g): g is StoredGame => isRecord(g) && typeof g.id === "string" && typeof g.pgn === "string" && !g.deleted,
  );
  const settings: ExportSetting[] = [];
  const keep = (key: string, value: unknown, updated_at: unknown) =>
    settings.push({ key, value, updated_at: typeof updated_at === "number" ? updated_at : 0 });
  if (Array.isArray(data.settings)) {
    for (const s of data.settings) {
      if (isRecord(s) && typeof s.key === "string" && !SKIP_SETTING(s.key)) keep(s.key, s.value, s.updated_at);
    }
  }
  if (isRecord(data.training)) {
    for (const k of ["progress", "log", "plan", "prefs"] as const) {
      const v = data.training[k];
      // Empty defaults ("no progress yet") carry nothing worth restoring.
      if (v !== undefined && v !== null && !(isRecord(v) && !Object.keys(v).length)) keep(`training.${k}`, v, 0);
    }
  }
  const answers = isRecord(data.coach) && Array.isArray(data.coach.answers) ? data.coach.answers : [];
  const coachAnswers = answers.filter(
    (a): a is SavedCoachAnswer =>
      isRecord(a) && typeof a.key === "string" && typeof a.text === "string" && typeof a.created_at === "number",
  );
  return { games, settings, coachAnswers };
}

/** Merge coach answers by key, the newer answer wins; newest first, at most `limit`. */
export function mergeCoachAnswers(a: SavedCoachAnswer[], b: SavedCoachAnswer[], limit = COACH_ANSWER_LIMIT): SavedCoachAnswer[] {
  const byKey = new Map<string, SavedCoachAnswer>();
  for (const x of [...a, ...b]) {
    const prev = byKey.get(x.key);
    if (!prev || x.created_at > prev.created_at) byKey.set(x.key, x);
  }
  return [...byKey.values()].sort((x, y) => y.created_at - x.created_at).slice(0, limit);
}

// Answers sync as one settings record; this keeps it well below a megabyte.
export const COACH_ANSWER_LIMIT = 40;

// ---- CSV / PGN ----

const CSV_HEADER = [
  "Datum",
  "Weiß",
  "Schwarz",
  "Ergebnis",
  "Deine Farbe",
  "Dein Ergebnis",
  "Gegner",
  "Deine Wertung",
  "Gegner-Wertung",
  "Bedenkzeit",
  "Zeitkontrolle",
  "Quelle",
  "ECO",
  "Eröffnung",
  "Halbzüge",
  "Analysiert",
  "Genauigkeit Weiß",
  "Genauigkeit Schwarz",
  "Deine Genauigkeit",
  "Deine Genauigkeit Eröffnung",
  "Deine Genauigkeit Mittelspiel",
  "Deine Genauigkeit Endspiel",
  "Brillant",
  "Großartig",
  "Beste Züge",
  "Ungenauigkeiten",
  "Fehler",
  "Verpasst",
  "Patzer",
  "Beendigung",
  "Partie-ID",
];

const OUTCOME_DE: Record<string, string> = { win: "Sieg", draw: "Remis", loss: "Niederlage" };

function moverIsWhite(m: MoveData, idx: number): boolean {
  const side = m.fen_before?.split(" ")[1];
  return side ? side === "w" : idx % 2 === 0;
}

// Excel in German locales splits on ";" and reads "," as the decimal mark.
function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(1).replace(".", ",")) : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function dateDe(date: string): string {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(date ?? "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : date || "";
}

/** One row per game, separated by ";" with a BOM so Excel opens umlauts correctly. */
export function gamesCsv(games: StoredGame[], usernames: string[]): string {
  const rows = [CSV_HEADER.join(";")];
  for (const g of games) {
    const color = getUserColor(g, usernames);
    const summary = parseSummary(g.summary_json);
    const done = summary?.analysis_status === "completed";
    const counts: Record<string, number> = {};
    const moves = parseMoves(g.moves_json);
    if (color && done) {
      moves.forEach((m, i) => {
        if (moverIsWhite(m, i) === (color === "white") && m.classification) {
          counts[m.classification] = (counts[m.classification] ?? 0) + 1;
        }
      });
    }
    const side = (c: "white" | "black") => (done ? (summary?.[c]?.accuracy ?? null) : null);
    const mine = <T,>(white: T, black: T): T | null => (color === "white" ? white : color === "black" ? black : null);
    const outcome = color ? outcomeFor(g.result, color) : null;
    const count = (k: string) => (color && done ? (counts[k] ?? 0) : null);
    rows.push(
      [
        dateDe(g.date),
        g.white,
        g.black,
        g.result,
        color === "white" ? "Weiß" : color === "black" ? "Schwarz" : "",
        outcome ? OUTCOME_DE[outcome] : "",
        mine(g.black, g.white),
        mine(g.white_elo, g.black_elo),
        mine(g.black_elo, g.white_elo),
        g.speed_category,
        g.time_control,
        g.source,
        g.eco,
        g.opening,
        moves.length,
        done ? "ja" : "nein",
        side("white"),
        side("black"),
        color ? side(color) : null,
        done ? mine(g.white_opening_acc, g.black_opening_acc) : null,
        done ? mine(g.white_middlegame_acc, g.black_middlegame_acc) : null,
        done ? mine(g.white_endgame_acc, g.black_endgame_acc) : null,
        count("Brilliant"),
        count("Great"),
        count("Best"),
        count("Inaccuracy"),
        count("Mistake"),
        count("Miss"),
        count("Blunder"),
        g.termination,
        g.id,
      ]
        .map(cell)
        .join(";"),
    );
  }
  return `﻿${rows.join("\r\n")}\r\n`;
}

/** All games as one PGN file, readable by every chess program. */
export function gamesPgn(games: StoredGame[]): string {
  return games
    .map((g) => g.pgn.trim())
    .filter(Boolean)
    .join("\n\n")
    .concat("\n");
}
