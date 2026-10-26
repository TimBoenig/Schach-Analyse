// Friends ranking: compares the user and their friends across many factors
// (rating, results against the Elo expectation, accuracy, blunders, each
// skill, activity and the direct encounters inside the group) and combines
// the places into one overall score.
//
// Ranks instead of raw values go into the overall score so that factors on
// different scales (a rating of 1500, 3 blunders, 80 % accuracy) count alike,
// and a factor only counts where at least two players have data for it.

import { filterGames } from "../metrics/filters";
import { type RawGame } from "../metrics/models";
import { parsePlayedAt } from "../metrics/played";
import type { PlayerProfile } from "../profile/models";
import { SKILL_NAMES } from "../profile/skills";
import { headToHead } from "./h2h";

export interface RankInput {
  id: string;
  name: string;
  is_me: boolean;
  usernames: string[];
  profile: PlayerProfile;
}

export type FactorGroup = "Ergebnisse" | "Spielqualität" | "Fähigkeiten" | "Sonstiges";

export interface RankFactor {
  key: string;
  label: string;
  group: FactorGroup;
  higher_is_better: boolean;
  /** Share of the overall score relative to the other factors. */
  weight: number;
  /** One line on what the factor measures. */
  hint: string;
}

export interface RankCell {
  value: number | null;
  /** 1 = best; ties share the better place. */
  rank: number | null;
  /** 0..100 position inside the group (100 = best), null when not ranked. */
  points: number | null;
  /** Short evidence note, e.g. "12 Partien". */
  note: string;
}

export interface RankRow {
  id: string;
  name: string;
  is_me: boolean;
  /** Place in the overall ranking (null without enough data). */
  rank: number | null;
  /** Weighted average of the factor points, 0..100. */
  overall: number | null;
  cells: Record<string, RankCell>;
  games: number;
  analyzed: number;
  /** Platform the player's games mostly come from. */
  source: string;
}

export interface Ranking {
  factors: RankFactor[];
  /** Sorted by overall place; unranked players last. */
  rows: RankRow[];
  /** Time control the rating factor compares (German label), null without ratings. */
  rating_speed: string | null;
  notes: string[];
}

// Below these samples a value is too noisy to rank.
const MIN_RATED_GAMES = 5;
const MIN_ANALYZED = 3;
const ACTIVITY_DAYS = 30;

const SKILL_FACTORS = ["opening", "middlegame", "endgame", "tactics", "safety", "conversion", "defense", "time"] as const;

export const RANK_FACTORS: RankFactor[] = [
  { key: "rating", label: "Wertung", group: "Ergebnisse", higher_is_better: true, weight: 1, hint: "Letzte Wertung in der gemeinsamen Bedenkzeit" },
  { key: "expectation", label: "Über Erwartung", group: "Ergebnisse", higher_is_better: true, weight: 1, hint: "Punkte über oder unter der Elo-Erwartung, in Prozentpunkten" },
  { key: "score", label: "Punkte-Quote", group: "Ergebnisse", higher_is_better: true, weight: 1, hint: "Anteil der geholten Punkte" },
  { key: "h2h", label: "Direktvergleich", group: "Ergebnisse", higher_is_better: true, weight: 1.5, hint: "Punkte in Partien gegeneinander (innerhalb der Gruppe)" },
  { key: "accuracy", label: "Genauigkeit", group: "Spielqualität", higher_is_better: true, weight: 1.5, hint: "Ø Genauigkeit der analysierten Partien" },
  { key: "blunders", label: "Patzer pro Partie", group: "Spielqualität", higher_is_better: false, weight: 1, hint: "Weniger ist besser" },
  ...SKILL_FACTORS.map((k) => ({
    key: k,
    label: SKILL_NAMES[k],
    group: "Fähigkeiten" as const,
    higher_is_better: true,
    weight: 0.5,
    hint: `Fähigkeitswert ${SKILL_NAMES[k]} (0–100)`,
  })),
  { key: "activity", label: `Partien (${ACTIVITY_DAYS} Tage)`, group: "Sonstiges", higher_is_better: true, weight: 0.5, hint: `Gespielte Partien in den letzten ${ACTIVITY_DAYS} Tagen` },
];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** German speed label with the most players having a rating in it (ties: more ratings overall). */
function commonSpeed(inputs: RankInput[]): string | null {
  const count = new Map<string, number>();
  for (const i of inputs) {
    for (const sp of Object.keys((i.profile.overview.ratings ?? {}) as Record<string, number>)) count.set(sp, (count.get(sp) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [sp, n] of count) if (best === null || n > (count.get(best) as number)) best = sp;
  return best;
}

function mainSource(games: RawGame[], names: string[]): string {
  const by = new Map<string, number>();
  for (const [g] of filterGames(games, names)) by.set(String(g.source ?? "file"), (by.get(String(g.source ?? "file")) ?? 0) + 1);
  let best = "";
  for (const [s, n] of by) if (!best || n > (by.get(best) as number)) best = s;
  return best;
}

/** Ranks with ties sharing the better place; null values stay unranked. */
function assignRanks(values: (number | null)[], higher: boolean): { rank: number | null; points: number | null }[] {
  const present = values.filter((v): v is number => v !== null);
  const n = present.length;
  return values.map((v) => {
    if (v === null || n < 2) return { rank: null, points: null };
    const better = present.filter((x) => (higher ? x > v : x < v)).length;
    const equal = present.filter((x) => x === v).length;
    // Average position of the tied group, so a tie does not hand out full points twice.
    const avgPos = better + (equal - 1) / 2;
    return { rank: better + 1, points: ((n - 1 - avgPos) / (n - 1)) * 100 };
  });
}

export function buildRanking(
  inputs: RankInput[],
  games: RawGame[],
  { format = "All Formats", date = "All Time", now = Date.now() / 1000 }: { format?: string; date?: string; now?: number } = {},
): Ranking {
  const speed = commonSpeed(inputs);
  const notes: string[] = [];
  const raw: Record<string, { value: number | null; note: string }[]> = {};
  const put = (key: string, i: number, value: number | null, note = "") => {
    (raw[key] ??= [])[i] = { value, note };
  };

  inputs.forEach((inp, i) => {
    const p = inp.profile;
    const o = p.overview;
    const rc = p.rating;
    const ratings = (o.ratings ?? {}) as Record<string, number>;
    put("rating", i, speed && ratings[speed] ? ratings[speed] : null, speed && ratings[speed] ? speed : "");
    put(
      "expectation",
      i,
      rc && rc.expected_score !== null && rc.rated_games >= MIN_RATED_GAMES ? ((rc.score - rc.expected_score) / rc.rated_games) * 100 : null,
      rc ? plural(rc.rated_games, "Partie", "Partien") : "",
    );
    put("score", i, p.total_games ? o.score_pct : null, plural(p.total_games, "Partie", "Partien"));
    const enough = p.analyzed_games >= MIN_ANALYZED;
    put("accuracy", i, enough ? o.avg_accuracy : null, plural(p.analyzed_games, "Analyse", "Analysen"));
    const blunders = Number((o.quality_counts ?? {}).Blunder ?? 0);
    put("blunders", i, enough ? blunders / p.analyzed_games : null, plural(p.analyzed_games, "Analyse", "Analysen"));
    for (const k of SKILL_FACTORS) {
      const s = p.skills.find((x) => x.key === k);
      const usable = enough && s && s.sample > 0 && !(k === "time" && s.grade === "Keine Uhrdaten");
      put(k, i, usable ? s.score : null, usable && s.margin ? `±${s.margin}` : "");
    }
    const recent = filterGames(games, inp.usernames).filter(([g]) => {
      const at = parsePlayedAt(g);
      return at !== null && at >= now - ACTIVITY_DAYS * 86400;
    }).length;
    put("activity", i, recent, "");

    // Points against everyone else in the group.
    let pts = 0;
    let n = 0;
    inputs.forEach((other, j) => {
      if (j === i) return;
      const h = headToHead(games, inp.usernames, other.usernames, format, date);
      n += h.games;
      pts += h.wins + h.draws / 2;
    });
    put("h2h", i, n ? (pts / n) * 100 : null, n ? `${String(pts).replace(".", ",")}/${n}` : "");
  });

  const rows: RankRow[] = inputs.map((inp) => ({
    id: inp.id,
    name: inp.name,
    is_me: inp.is_me,
    rank: null,
    overall: null,
    cells: {},
    games: inp.profile.total_games,
    analyzed: inp.profile.analyzed_games,
    source: mainSource(games, inp.usernames),
  }));

  const weightSum = new Array(inputs.length).fill(0);
  const pointSum = new Array(inputs.length).fill(0);
  for (const f of RANK_FACTORS) {
    const cells = raw[f.key] ?? [];
    const ranks = assignRanks(inputs.map((_, i) => cells[i]?.value ?? null), f.higher_is_better);
    ranks.forEach((r, i) => {
      rows[i].cells[f.key] = { value: cells[i]?.value ?? null, rank: r.rank, points: r.points, note: cells[i]?.note ?? "" };
      if (r.points !== null) {
        weightSum[i] += f.weight;
        pointSum[i] += f.weight * r.points;
      }
    });
  }
  // Two full factors (e.g. results and accuracy) are the least to stand on.
  rows.forEach((r, i) => {
    r.overall = weightSum[i] >= 2 ? pointSum[i] / weightSum[i] : null;
  });
  const overall = assignRanks(
    rows.map((r) => r.overall),
    true,
  );
  rows.forEach((r, i) => (r.rank = overall[i].rank));
  rows.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || b.games - a.games || a.name.localeCompare(b.name));

  const sources = new Set(rows.map((r) => r.source).filter((s) => s === "lichess" || s === "chesscom"));
  if (sources.size > 1) notes.push("Wertungen von Lichess und Chess.com sind nicht direkt vergleichbar – „Über Erwartung“ und die Genauigkeit sind fairer.");
  if (rows.some((r) => r.analyzed < MIN_ANALYZED)) {
    notes.push(`Genauigkeit, Patzer und Fähigkeiten zählen erst ab ${MIN_ANALYZED} analysierten Partien eines Spielers.`);
  }
  return { factors: RANK_FACTORS, rows, rating_speed: speed, notes };
}
