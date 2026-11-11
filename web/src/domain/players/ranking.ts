// Friends ranking: compares the user and their friends across many factors
// (results against the Elo expectation, accuracy, blunders, each
// skill, activity and the direct encounters inside the group) and combines
// the places into one overall score.
//
// Each factor hands out points by the chance of being truly better than each
// other player (see compare.ts), not by bare places: 84,9 % against 85,0 %
// accuracy is a coin flip worth about 50 points each, while a clear gap from
// many games is worth nearly 100. So factors on different scales (a rating of
// 1500, 3 blunders, 80 % accuracy) count alike, a lucky streak over five games
// cannot buy a top spot, and a factor only counts where at least two players
// have data for it. The weights live in weights.ts (percent of the total).
// The rating is listed for orientation only (weight 0): a fresh account's
// rating is not settled yet, and "Über Erwartung" already judges results
// fairly against the opponents' strength.

import { filterGames } from "../metrics/filters";
import { type RawGame } from "../metrics/models";
import { parsePlayedAt } from "../metrics/played";
import type { PlayerProfile } from "../profile/models";
import { SKILL_NAMES } from "../profile/skills";
import {
  accuracyEstimate,
  blunderEstimate,
  type Estimate,
  expectationEstimate,
  MIN_COMPARE_ANALYZED,
  probBetter,
  RATING_SE,
  scoreEstimate,
  scoreSe,
  shifted,
  skillEstimate,
  skillPrior,
} from "./compare";
import { FAIRNESS_NOTE, qualityGames, speedFairness } from "./fairness";
import { headToHead, mainSource } from "./h2h";
import { FACTOR_WEIGHTS, SKILL_FACTORS } from "./weights";

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
  /** 0..100: average chance of being better than each other player (null when not ranked). */
  points: number | null;
  /** Standard error of `value` (0 for exact counts). */
  se: number | null;
  /** Short evidence note, e.g. "12 Partien". */
  note: string;
}

/** How one factor fed a player's overall score. */
export interface RankContribution {
  key: string;
  /** Points the player got in this factor (0..100). */
  points: number;
  /** Weight in percent of this player's own total (missing factors handed on). */
  share: number;
  /** Overall points this factor brought: points * share / 100. */
  value: number;
  /** Most overall points still to win here: (100 - points) * share / 100. */
  room: number;
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
  /** Factor by factor, how the overall score is made up (biggest first). */
  breakdown: RankContribution[];
  /** Weighted factors without data for this player (their weight goes to the others). */
  missing: string[];
}

export interface Ranking {
  factors: RankFactor[];
  /** Sorted by overall place; unranked players last. */
  rows: RankRow[];
  /** Time control the rating factor compares (German label), null without ratings. */
  rating_speed: string | null;
  notes: string[];
}

const MIN_ANALYZED = MIN_COMPARE_ANALYZED;
const ACTIVITY_DAYS = 30;
// Share of the total weight (in percent) a player needs data for to be ranked.
const MIN_WEIGHT = 30;

export const RANK_FACTORS: RankFactor[] = [
  // Weight 0: the rating is shown for orientation but never moves the overall score.
  { key: "rating", label: "Wertung", group: "Ergebnisse", higher_is_better: true, weight: 0, hint: "Letzte Wertung in der gemeinsamen Bedenkzeit. Nur zur Info: neue Konten haben noch keine aussagekräftige Wertung" },
  { key: "expectation", label: "Über Erwartung", group: "Ergebnisse", higher_is_better: true, weight: FACTOR_WEIGHTS.expectation, hint: "Punkte über oder unter der Elo-Erwartung je Partie, in Prozentpunkten. Fair bei unterschiedlich starken Gegnern; Partien mit noch springender Wertung (neue Konten) zählen nicht" },
  // Raw points depend on who someone plays; "Über Erwartung" measures the same thing fairly.
  { key: "score", label: "Punkte-Quote", group: "Ergebnisse", higher_is_better: true, weight: 0, hint: "Anteil der geholten Punkte. Nur zur Info: hängt stark davon ab, gegen wen jemand spielt" },
  { key: "h2h", label: "Direktvergleich", group: "Ergebnisse", higher_is_better: true, weight: FACTOR_WEIGHTS.h2h, hint: "Punkte in Partien gegeneinander (innerhalb der Gruppe)" },
  { key: "accuracy", label: "Genauigkeit", group: "Spielqualität", higher_is_better: true, weight: FACTOR_WEIGHTS.accuracy, hint: "Ø Genauigkeit der analysierten Partien" },
  { key: "blunders", label: "Patzer pro Partie", group: "Spielqualität", higher_is_better: false, weight: FACTOR_WEIGHTS.blunders, hint: "Grobe Fehler je analysierter Partie, weniger ist besser" },
  ...SKILL_FACTORS.map((k) => ({
    key: k,
    label: SKILL_NAMES[k],
    group: "Fähigkeiten" as const,
    higher_is_better: true,
    weight: FACTOR_WEIGHTS[k],
    hint: `Fähigkeitswert ${SKILL_NAMES[k]} (0–100), nur aus den eigenen Zügen`,
  })),
  { key: "activity", label: `Partien (${ACTIVITY_DAYS} Tage)`, group: "Sonstiges", higher_is_better: true, weight: FACTOR_WEIGHTS.activity, hint: `Gespielte Partien in den letzten ${ACTIVITY_DAYS} Tagen` },
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

/** Ranks with ties sharing the better place; null values stay unranked. */
function assignRanks(values: (number | null)[], higher: boolean): (number | null)[] {
  const present = values.filter((v): v is number => v !== null);
  return values.map((v) => (v === null || present.length < 2 ? null : present.filter((x) => (higher ? x > v : x < v)).length + 1));
}

/** Points 0..100: average chance of being better than each other player with data. */
function chancePoints(est: (Estimate | null)[], higher: boolean): (number | null)[] {
  const n = est.filter(Boolean).length;
  return est.map((a, i) => {
    if (!a || n < 2) return null;
    let sum = 0;
    est.forEach((b, j) => {
      if (b && j !== i) sum += probBetter(a, b, higher);
    });
    return (sum / (n - 1)) * 100;
  });
}

const analyses = (n: number) => plural(n, "Analyse", "Analysen");

export function buildRanking(
  inputs: RankInput[],
  games: RawGame[],
  { format = "All Formats", date = "All Time", now = Date.now() / 1000 }: { format?: string; date?: string; now?: number } = {},
): Ranking {
  const speed = commonSpeed(inputs);
  const notes: string[] = [];
  const sources = inputs.map((inp) => mainSource(games, inp.usernames));
  const raw: Record<string, { est: Estimate | null; note: string }[]> = {};
  const put = (key: string, i: number, est: Estimate | null, note = "") => {
    (raw[key] ??= [])[i] = { est, note };
  };

  // Ratings only compare within one platform: the one most rated players are on.
  const ratingOf = (i: number) => (speed ? Number(((inputs[i].profile.overview.ratings ?? {}) as Record<string, number>)[speed]) || null : null);
  const bySource = new Map<string, number>();
  inputs.forEach((_, i) => ratingOf(i) !== null && bySource.set(sources[i], (bySource.get(sources[i]) ?? 0) + 1));
  const ratingSource = [...bySource.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  let ratingDropped = false;

  // One rating-free prior per skill for the whole group (see skillEstimate).
  const eligible = inputs.filter((inp) => inp.profile.analyzed_games >= MIN_ANALYZED);
  const priors = Object.fromEntries(SKILL_FACTORS.map((k) => [k, skillPrior(eligible.map((inp) => inp.profile.skills.find((x) => x.key === k)))]));

  // Take each player's mix of time controls out of accuracy and blunders.
  const fair = speedFairness(inputs.map((inp) => (inp.profile.analyzed_games >= MIN_ANALYZED ? qualityGames(games, inp.usernames, format, date) : [])));

  inputs.forEach((inp, i) => {
    const p = inp.profile;
    const rating = ratingOf(i);
    const sameSite = rating !== null && sources[i] === ratingSource;
    if (rating !== null && !sameSite) ratingDropped = true;
    put("rating", i, sameSite ? { value: rating as number, se: RATING_SE } : null, sameSite ? (speed as string) : "");
    put("expectation", i, expectationEstimate(p), p.rating ? plural(p.rating.rated_games, "Partie", "Partien") : "");
    put("score", i, scoreEstimate(p), plural(p.total_games, "Partie", "Partien"));
    put("accuracy", i, shifted(accuracyEstimate(p), fair.adjust[i].accuracy), analyses(p.analyzed_games));
    put("blunders", i, shifted(blunderEstimate(p), fair.adjust[i].blunders), analyses(p.analyzed_games));
    const enough = p.analyzed_games >= MIN_ANALYZED;
    for (const k of SKILL_FACTORS) {
      const s = p.skills.find((x) => x.key === k);
      const est = enough ? skillEstimate(s, priors[k]) : null;
      put(k, i, est, est && s?.margin ? `±${s.margin}` : "");
    }
    const recent = filterGames(games, inp.usernames).filter(([g]) => {
      const at = parsePlayedAt(g);
      return at !== null && at >= now - ACTIVITY_DAYS * 86400;
    }).length;
    put("activity", i, { value: recent, se: 0 });

    // Points against everyone else in the group.
    let pts = 0;
    let n = 0;
    inputs.forEach((other, j) => {
      if (j === i) return;
      const h = headToHead(games, inp.usernames, other.usernames, format, date);
      n += h.games;
      pts += h.wins + h.draws / 2;
    });
    const pct = n ? (pts / n) * 100 : 0;
    put("h2h", i, n ? { value: pct, se: scoreSe(pct, n) } : null, n ? `${String(pts).replace(".", ",")}/${n}` : "");
  });

  const rows: RankRow[] = inputs.map((inp, i) => ({
    id: inp.id,
    name: inp.name,
    is_me: inp.is_me,
    rank: null,
    overall: null,
    cells: {},
    games: inp.profile.total_games,
    analyzed: inp.profile.analyzed_games,
    source: sources[i],
    breakdown: [],
    missing: [],
  }));

  const weightSum = new Array(inputs.length).fill(0);
  const pointSum = new Array(inputs.length).fill(0);
  for (const f of RANK_FACTORS) {
    const cells = inputs.map((_, i) => raw[f.key]?.[i] ?? { est: null, note: "" });
    const est = cells.map((c) => c.est);
    const ranks = assignRanks(
      est.map((e) => e?.value ?? null),
      f.higher_is_better,
    );
    const points = chancePoints(est, f.higher_is_better);
    cells.forEach((c, i) => {
      rows[i].cells[f.key] = { value: c.est?.value ?? null, se: c.est?.se ?? null, rank: ranks[i], points: points[i], note: c.note };
      if (f.weight <= 0) return;
      if (points[i] === null) {
        rows[i].missing.push(f.key);
        return;
      }
      weightSum[i] += f.weight;
      pointSum[i] += f.weight * (points[i] as number);
    });
  }
  // A third of the weight (e.g. results and accuracy) is the least to stand on.
  rows.forEach((r, i) => {
    r.overall = weightSum[i] >= MIN_WEIGHT ? pointSum[i] / weightSum[i] : null;
    if (r.overall === null) return;
    r.breakdown = RANK_FACTORS.filter((f) => f.weight > 0 && r.cells[f.key]?.points !== null && r.cells[f.key]?.points !== undefined)
      .map((f) => {
        const pts = r.cells[f.key].points as number;
        const share = (f.weight / weightSum[i]) * 100;
        return { key: f.key, points: pts, share, value: (pts * share) / 100, room: ((100 - pts) * share) / 100 };
      })
      .sort((a, b) => b.value - a.value);
  });
  const overall = assignRanks(
    rows.map((r) => r.overall),
    true,
  );
  rows.forEach((r, i) => (r.rank = overall[i]));
  rows.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || b.games - a.games || a.name.localeCompare(b.name));

  if (ratingDropped) {
    notes.push("Wertungen von Lichess und Chess.com sind nicht vergleichbar: die Wertung zählt nur für Spieler derselben Plattform. „Über Erwartung“ und die Genauigkeit vergleichen fair.");
  }
  if (fair.applied) notes.push(FAIRNESS_NOTE);
  if (rows.some((r) => r.analyzed < MIN_ANALYZED)) {
    notes.push(`Genauigkeit, Patzer und Fähigkeiten zählen erst ab ${MIN_ANALYZED} analysierten Partien eines Spielers.`);
  }
  return { factors: RANK_FACTORS, rows, rating_speed: speed, notes };
}
