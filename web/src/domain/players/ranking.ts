// Friends ranking: every player's playing strength on one absolute Elo scale
// (see strength.ts), estimated from their own games against their own
// opponents, so the order of two players never depends on who else is
// compared. Hiding a friend removes a row and nothing else.
//
// The place is the order of the estimates. Because every estimate has an
// uncertainty, each row also carries how sure its place is: the range of
// places in 90 % of plausible orders and the chance of first place.
//
// The other numbers (accuracy, blunders, skills, results over expectation,
// activity) stay as information in the table and feed the battle and the
// strengths section; they no longer add up to the place. Rating plays no part:
// the strength comes from results against the opponents' ratings and from
// move quality, never from the player's own (possibly unsettled) rating.

import { isBotGame, withoutBots } from "../metrics/bots";
import { extractGameTimestamp, filterGames } from "../metrics/filters";
import { outcomeFor, type RawGame } from "../metrics/models";
import { parsePlayedAt } from "../metrics/played";
import { detectSpeedCategory } from "../metrics/speed";
import { trSpeed } from "../i18n";
import { settlePeriod } from "../periods";
import type { PlayerProfile } from "../profile/models";
import { SKILL_NAMES } from "../profile/skills";
import {
  accuracyEstimate,
  blunderEstimate,
  type Estimate,
  expectationEstimate,
  MIN_COMPARE_ANALYZED,
  RATING_SE,
  shifted,
  skillEstimate,
  skillPrior,
} from "./compare";
import { DEPTH_GAP, FAIRNESS_NOTE, groupFairness, medianDepths } from "./fairness";
import { mainSource } from "./h2h";
import { hashText, MIN_RATED_GAMES, playerStrength, type RankOdds, rankOdds, type StrengthEstimate } from "./strength";
import { SKILL_FACTORS } from "./weights";
import { t } from "../../i18n";

export interface RankInput {
  id: string;
  name: string;
  is_me: boolean;
  usernames: string[];
  profile: PlayerProfile;
}

export type FactorGroup = "Ergebnisse" | "Spielqualität" | "Fähigkeiten" | "Sonstiges";

/** A number shown next to the strength (information only, it does not set the place). */
export interface RankFactor {
  key: string;
  label: string;
  group: FactorGroup;
  higher_is_better: boolean;
  /** One line on what the factor measures. */
  hint: string;
}

export interface RankCell {
  value: number | null;
  /** 1 = best; ties share the better place. */
  rank: number | null;
  /** Standard error of `value`. */
  se: number | null;
  /**
   * The value before the time-control correction (accuracy and blunders only,
   * when the correction moved it): the number the player's own profile shows.
   */
  raw?: number | null;
  /** Short evidence note, e.g. "12 Partien". */
  note: string;
}

export interface RankRow {
  id: string;
  name: string;
  is_me: boolean;
  /** Place by strength (null without enough rated games). */
  rank: number | null;
  /** Playing strength from the player's own games (null below MIN_RATED_GAMES). */
  strength: StrengthEstimate | null;
  /** How sure the place is (null when unranked or alone). */
  odds: RankOdds | null;
  cells: Record<string, RankCell>;
  games: number;
  analyzed: number;
  /** Rated games against humans in the period (the strength's basis). */
  rated_games: number;
  /** Games against computers in the period, left out everywhere in the league. */
  bot_games: number;
  /** Platform the player's games mostly come from. */
  source: string;
}

export interface Ranking {
  factors: RankFactor[];
  /** Date filter every number of this ranking covers (e.g. "Last 90 Days"). */
  period: string;
  /** Sorted by place; unranked players last. */
  rows: RankRow[];
  /** Time control the rating column compares (German label), null without ratings. */
  rating_speed: string | null;
  /**
   * How much harder each time control is for accuracy and blunders within this
   * group (see fairness.ts); empty when fewer than two time controls are shared.
   */
  speed_effects: Record<string, { accuracy: number; blunders: number; games: number }>;
  notes: string[];
}

const MIN_ANALYZED = MIN_COMPARE_ANALYZED;
const ACTIVITY_DAYS = 30;

export const RANK_FACTORS: RankFactor[] = [
  { key: "rating", label: t("Wertung"), group: "Ergebnisse", higher_is_better: true, hint: t("Letzte Wertung in der gemeinsamen Bedenkzeit. Nur zur Info: neue Konten haben noch keine aussagekräftige Wertung") }, // i18n: id
  { key: "expectation", label: t("Über Erwartung"), group: "Ergebnisse", higher_is_better: true, hint: t("Punkte über oder unter der Elo-Erwartung je Partie, in Prozentpunkten") }, // i18n: id
  { key: "accuracy", label: t("Genauigkeit"), group: "Spielqualität", higher_is_better: true, hint: t("Ø Genauigkeit der analysierten Partien") }, // i18n: id
  { key: "blunders", label: t("Patzer pro Partie"), group: "Spielqualität", higher_is_better: false, hint: t("Grobe Fehler je analysierter Partie, weniger ist besser") }, // i18n: id
  ...SKILL_FACTORS.map((k) => ({
    key: k,
    label: SKILL_NAMES[k],
    group: "Fähigkeiten" as const, // i18n: id
    higher_is_better: true,
    hint: t("Fähigkeitswert {0} (0–100), nur aus den eigenen Zügen", { 0: SKILL_NAMES[k] }),
  })),
  { key: "activity", label: t("Partien ({ACTIVITY_DAYS} Tage)", { ACTIVITY_DAYS }), group: "Sonstiges", higher_is_better: true, hint: t("Gespielte Partien in den letzten {ACTIVITY_DAYS} Tagen (in der gewählten Bedenkzeit, ohne Bots)", { ACTIVITY_DAYS }) }, // i18n: id
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
  return values.map((v) => (v === null || present.length < 1 ? null : present.filter((x) => (higher ? x > v : x < v)).length + 1));
}

/**
 * Platform with the most rated games of the player in one time control (German
 * label), ties going to the one played last: the same rule the profile uses
 * for its "current rating" (mainRatingSources).
 */
function speedSource(games: RawGame[], usernames: string[], speedLabel: string): string | null {
  const by = new Map<string, { n: number; last: number }>();
  for (const [g, color] of filterGames(games, usernames)) {
    if (trSpeed(speedOf(g)) !== speedLabel) continue;
    if (!(Number(color === "white" ? g.white_elo : g.black_elo) > 0)) continue;
    const src = String(g.source || "file").toLowerCase();
    const e = by.get(src) ?? { n: 0, last: 0 };
    e.n += 1;
    e.last = Math.max(e.last, parsePlayedAt(g) ?? 0);
    by.set(src, e);
  }
  let best: [string, { n: number; last: number }] | null = null;
  for (const entry of by) if (!best || entry[1].n > best[1].n || (entry[1].n === best[1].n && entry[1].last > best[1].last)) best = entry;
  return best?.[0] ?? null;
}

const speedOf = (g: RawGame) => (g.chess960 ? "Chess960" : (g.speed_category || "").trim() || detectSpeedCategory(g.time_control, g.event, g.source) || "Other");

const analyses = (n: number) => (n === 1 ? t("1 Analyse") : t("{n} Analysen", { n: n }));

export function buildRanking(
  inputs: RankInput[],
  games: RawGame[],
  { format = "All Formats", date = "All Time", now = Date.now() / 1000 }: { format?: string; date?: string; now?: number } = {},
): Ranking {
  const speed = commonSpeed(inputs);
  const notes: string[] = [];
  // The strength counts the bot games it leaves out; everything else never sees them.
  const all = games;
  games = withoutBots(games);
  const sources = inputs.map((inp) => mainSource(games, inp.usernames));
  const raw: Record<string, { est: Estimate | null; note: string; raw?: number | null }[]> = {};
  const put = (key: string, i: number, est: Estimate | null, note = "", unadjusted?: number | null) => {
    (raw[key] ??= [])[i] = { est, note, raw: unadjusted };
  };

  // The strength of each player, from that player's games alone.
  const reports = inputs.map((inp) => playerStrength(all, inp.usernames, { format, date }));

  // Ratings only compare within one platform: the one most rated players are on.
  const ratingOf = (i: number) => (speed ? Number(((inputs[i].profile.overview.ratings ?? {}) as Record<string, number>)[speed]) || null : null);
  const ratingSources = inputs.map((inp, i) => (speed ? speedSource(games, inp.usernames, speed) : null) ?? sources[i]);
  const bySource = new Map<string, number>();
  inputs.forEach((_, i) => ratingOf(i) !== null && bySource.set(ratingSources[i], (bySource.get(ratingSources[i]) ?? 0) + 1));
  const ratingSource = [...bySource.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // One rating-free prior per skill for the whole group (see skillEstimate).
  const eligible = inputs.filter((inp) => inp.profile.analyzed_games >= MIN_ANALYZED);
  const priors = Object.fromEntries(SKILL_FACTORS.map((k) => [k, skillPrior(eligible.map((inp) => inp.profile.skills.find((x) => x.key === k)))]));

  // Take each player's mix of time controls out of the shown accuracy and blunders.
  const fair = groupFairness(
    games,
    inputs.map((inp) => inp.usernames),
    format,
    date,
    MIN_ANALYZED,
  );

  inputs.forEach((inp, i) => {
    const p = inp.profile;
    const rating = ratingOf(i);
    const sameSite = rating !== null && ratingSources[i] === ratingSource;
    put("rating", i, sameSite ? { value: rating as number, se: RATING_SE } : null, sameSite ? (speed as string) : "");
    put("expectation", i, expectationEstimate(p), p.rating ? plural(p.rating.rated_games, t("Partie"), t("Partien")) : "");
    const acc = accuracyEstimate(p);
    const bl = blunderEstimate(p);
    put("accuracy", i, shifted(acc, fair.adjust[i].accuracy), analyses(p.analyzed_games), acc && fair.adjust[i].accuracy ? acc.value : undefined);
    put("blunders", i, shifted(bl, fair.adjust[i].blunders), analyses(p.analyzed_games), bl && fair.adjust[i].blunders ? bl.value : undefined);
    const enough = p.analyzed_games >= MIN_ANALYZED;
    for (const k of SKILL_FACTORS) {
      const s = p.skills.find((x) => x.key === k);
      const est = enough ? skillEstimate(s, priors[k]) : null;
      put(k, i, est, est && s?.margin ? `±${s.margin}` : "");
    }
    const recent = filterGames(games, inp.usernames, "All Colors", format).filter(([g, color]) => {
      const at = parsePlayedAt(g);
      return at !== null && at >= now - ACTIVITY_DAYS * 86400 && !isBotGame(g, color);
    }).length;
    put("activity", i, { value: recent, se: Math.sqrt(recent + 1) });
  });

  const rows: RankRow[] = inputs.map((inp, i) => ({
    id: inp.id,
    name: inp.name,
    is_me: inp.is_me,
    rank: null,
    strength: reports[i].estimate,
    odds: null,
    cells: {},
    games: inp.profile.total_games,
    analyzed: inp.profile.analyzed_games,
    rated_games: reports[i].rated_games,
    bot_games: reports[i].bot_games,
    source: sources[i],
  }));

  for (const f of RANK_FACTORS) {
    const cells = inputs.map((_, i) => raw[f.key]?.[i] ?? { est: null, note: "" });
    const ranks = assignRanks(
      cells.map((c) => c.est?.value ?? null),
      f.higher_is_better,
    );
    cells.forEach((c, i) => {
      rows[i].cells[f.key] = { value: c.est?.value ?? null, se: c.est?.se ?? null, rank: c.est && cells.filter((x) => x.est).length >= 2 ? ranks[i] : null, note: c.note, ...(c.raw !== undefined ? { raw: c.raw } : {}) };
    });
  }

  const places = assignRanks(
    rows.map((r) => r.strength?.value ?? null),
    true,
  );
  rows.forEach((r, i) => (r.rank = places[i]));
  const ranked = rows.filter((r) => r.strength !== null);
  if (ranked.length >= 2) {
    const odds = rankOdds(
      ranked.map((r) => r.strength as StrengthEstimate),
      hashText(ranked.map((r) => r.id).join("|") + date + format),
    );
    ranked.forEach((r, i) => (r.odds = odds[i]));
  }
  rows.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || b.games - a.games || a.name.localeCompare(b.name));

  const bots = rows.reduce((s, r) => s + r.bot_games, 0);
  if (bots) notes.push(t("{plural} nicht mit: Bots haben keine vergleichbare Wertung.", { plural: plural(bots, t("Partie gegen einen Computer zählt"), t("Partien gegen Computer zählen")) }));
  const thin = rows.filter((r) => r.strength === null);
  if (thin.length) {
    notes.push(t("Eine Spielstärke gibt es ab {MIN_RATED_GAMES} gewerteten Partien gegen Menschen im Zeitraum. Noch zu wenige: {1}.", { MIN_RATED_GAMES, 1: thin.map((r) => (r.is_me ? t("du") : r.name)).join(", ") }));
  }
  const pools = new Set(ranked.flatMap((r) => Object.entries((r.strength as StrengthEstimate).columns).filter(([, w]) => w > 0.2).map(([c]) => c.slice(0, 2))));
  if (pools.size > 1) {
    notes.push(t("Lichess- und Chess.com-Wertungen sind über die ChessGoals-Umfrage auf eine Skala gebracht. Diese Umrechnung ist selbst unsicher und steckt in den Spannen: zwischen Spielern verschiedener Plattformen sind Abstände unsicherer als zwischen Spielern derselben."));
  }
  if (fair.applied) notes.push(FAIRNESS_NOTE);
  const depthNote = depthGapNote(medianDepths(fair.quality), inputs);
  if (depthNote) notes.push(depthNote);
  return { factors: RANK_FACTORS, period: date, rows, rating_speed: speed, speed_effects: fair.speeds, notes };
}

/**
 * The period a comparison starts with: `preferred` (see periods.ts), widened
 * until at least two of the members have MIN_RATED_GAMES rated games against
 * humans in it, so their strengths can be estimated at all. Every member is
 * measured over the same span.
 */
export function comparisonPeriod(games: RawGame[], members: string[][], format: string, preferred: string, now = Date.now() / 1000): string {
  const times = members.map((names) =>
    filterGames(games, names, "All Colors", format)
      .filter(([g, color]) => outcomeFor(g.result, color) !== null && Number(color === "white" ? g.black_elo : g.white_elo) > 0 && !isBotGame(g, color))
      .map(([g]) => extractGameTimestamp(g)),
  );
  const need = Math.min(2, members.length);
  return settlePeriod(preferred, (start) => times.filter((ts) => (start === null ? ts.length : ts.filter((tk) => tk !== null && tk >= start).length) >= MIN_RATED_GAMES).length >= need, now);
}

/**
 * A warning when the players' games were analysed at clearly different engine
 * depths (own games and friends' games have separate depth settings): a
 * deeper search finds errors a shallow one misses and judges other moves
 * differently, so accuracy and blunders then compare two different rulers.
 */
function depthGapNote(depths: (number | null)[], inputs: RankInput[]): string | null {
  const known = depths.map((d, i) => ({ d, name: inputs[i].is_me ? "deine" : t("die von {name}", { name: inputs[i].name }) })).filter((x): x is { d: number; name: string } => x.d !== null);
  if (known.length < 2) return null;
  const deep = known.reduce((a, b) => (b.d > a.d ? b : a));
  const flat = known.reduce((a, b) => (b.d < a.d ? b : a));
  if (deep.d - flat.d < DEPTH_GAP) return null;
  const cap = (tk: string) => tk.charAt(0).toUpperCase() + tk.slice(1);
  return t("{cap} Partien sind flacher analysiert (Tiefe {1}) als {name} (Tiefe {3}). Genauigkeit und Patzer vergleichen nur bei gleicher Tiefe ganz fair: stelle in den Einstellungen dieselbe Analysetiefe für dich und deine Freunde ein und lass die Partien neu analysieren.", { cap: cap(flat.name), 1: Math.round(flat.d), name: deep.name, 3: Math.round(deep.d) });
}
