// Playing strength of one player on an absolute scale, from that player's own
// games only.
//
// Why absolute: the league used to hand out points for "chance of being better
// than each other member", averaged over the group. That makes every score
// depend on who else is in the group, so hiding a third friend could swap the
// order of two others. Here each player gets one strength estimate in Elo,
// computed from their own games against their own opponents, exactly as a
// rating system would. Who else is compared never changes it, so the order of
// any two players is fixed by their own games alone.
//
// Two measurements, both against the opponents met in the same games:
//
// 1. Results (performance rating). Each opponent's rating is converted to one
//    common scale (Lichess blitz, see fide.ts) so Chess.com and Lichess, Blitz
//    and Rapid games add up. The strength is the maximum-likelihood rating
//    under the Elo curve, with a weak prior at the average opponent (worth
//    about one game). Games against friends are ordinary games here: a direct
//    game says exactly as much about strength as a game against a stranger of
//    the same rating, so it counts once, like every other game.
//
// 2. Move quality. Per analysed game, the share of winning chance each side
//    gave away per move, compared with the opponent's in the same game. The
//    log of that error ratio converts to Elo (849 Lichess points per unit,
//    the Lichess-database fit Elo = 5189 − 849 · ln(ACPL); see
//    profile/strength.ts for the derivation). Both sides are measured by the
//    same engine at the same depth in the same time control, so engine depth
//    and time control cancel out: no group-dependent correction is needed.
//
// The two are combined by their uncertainty (best linear unbiased estimate).
// Two honest caveats are built in: the per-game noise of the two is correlated
// (whoever errs more usually loses), and move quality misses part of practical
// strength (time use, nerves, choosing positions), so it carries a fixed
// person-level uncertainty that more games cannot remove. With many rated
// games the results dominate; with few, move quality helps.
//
// Every estimate keeps its standard error. Rank ranges, chances and forecasts
// come from those errors; nothing is shown as a gap that chance explains.

import { isBotGame } from "../metrics/bots";
import { filterGames } from "../metrics/filters";
import { outcomeFor, parseMoves, parseSummary, type RawGame } from "../metrics/models";
import { parsePlayedAt } from "../metrics/played";
import { detectSpeedCategory } from "../metrics/speed";
import { MIN_GROUP_GAMES } from "../profile/evidence";
import { lichessBlitzToElo, ratingColumn, toLichessBlitz } from "../profile/fide";
import { type Tally, tallyRatio } from "../profile/strength";
import { OPPONENT_ERROR_THRESHOLD, PUNISH_KEEP_THRESHOLD } from "../profile/features";
import { classifyFenPhase } from "../tactics/phase";
import { normalCdf } from "./compare";

/** Rated games (no bots) in the period before a player gets a strength at all. */
export const MIN_RATED_GAMES = MIN_GROUP_GAMES;
/** Analysed rated games before move quality enters the estimate. */
export const MIN_QUALITY_GAMES = 5;

const C = Math.LN10 / 400;
// Prior around the average opponent: about one game's worth of information.
const PRIOR_SD = 350;
// An opponent's rating is itself uncertain by about this much (Glicko RD of active players).
const OPP_RATING_SD = 60;
// Error of the survey conversion per column against Lichess blitz (systematic:
// shared by every game in that column, so it cancels between two players of
// the same pool and counts in full between a Lichess and a Chess.com player).
export const CONVERSION_SD = 40;
// Lichess points per unit of ln(error ratio), with a relative uncertainty.
export const QUALITY_K = 849;
const QUALITY_K_REL_SD = 0.2;
// One game's quality says about ±400 Elo (Patzer's Review): a floor for the noise.
const QUALITY_GAME_SD = 400;
// How far move quality may sit from the true strength for one person (practical
// play the engine does not see). Does not shrink with games.
export const QUALITY_PERSON_SD = 150;
// Correlation of the per-game noise of results and move quality.
export const RESULT_QUALITY_RHO = 0.5;
// Pseudo-moves at the pooled error rate for the ratio (as the profile's overall).
const QUALITY_PRIOR = 30;
/** Lowest row of the rating survey on the common scale; below it conversions are straight-line guesses. */
const SURVEY_LOW_VALUE = 1090;
const Z95 = 1.96;
// Cap on |ln(error ratio)|: a factor of about 3.3 either way.
const MAX_LN_RATIO = 1.2;
// Cap on how far one part of the game is read from the player's own level before shrinking.
const MAX_AREA_RAW = 600;

export interface StrengthPart {
  /** Estimate on the Lichess blitz scale. */
  value: number;
  /** Standard error (statistical part). */
  se: number;
  games: number;
}

export interface ResultsPart extends StrengthPart {
  /** Points scored, out of `games`. */
  points: number;
  /** Average opponent on the Lichess blitz scale. */
  avg_opp: number;
  /** The games as used (opponent on the common scale, score), for projections. */
  sample: { opp: number; score: number }[];
}

export interface QualityPart extends StrengthPart {
  /** Uncertainty from the Elo-per-error factor (kept apart from `se`, the noise of the games). */
  k_sd: number;
  /** The measured game-to-game noise alone (without the floor): the part correlated with the results' luck. */
  noise_se: number;
  /** Own error rate divided by the opponents' (below 1 = fewer errors). */
  error_ratio: number;
  /** Weight of move quality in the combined estimate (0..1). */
  weight: number;
}

export interface AreaStrength {
  key: Area;
  /** The part of the game on the common scale: the player's strength plus how far this area sits from their own average. */
  value: number;
  /** Standard error of `value` (the strength's own included). */
  se: number;
  /** Shrunk distance from the player's own strength, in Elo (positive = better than their average). */
  offset: number;
  offset_se: number;
  /** Clearly above (1) or below (-1) the player's own level at 95 % (one-sided), else 0. */
  stands_out: -1 | 0 | 1;
  games: number;
}

export interface StrengthEstimate {
  /** Combined estimate on the Lichess blitz scale (orders players). */
  value: number;
  /** Its standard error without the conversion between platforms. */
  se: number;
  /** Share of the estimate resting on each rating pool (survey column), for the conversion error. */
  columns: Record<string, number>;
  /** The estimate as the shown Elo number (see fide.ts) with its 95 % range. */
  elo: number;
  elo_low: number;
  elo_high: number;
  /** Below the survey's range: the conversion is a straight-line guess. */
  extrapolated: boolean;
  results: ResultsPart;
  quality: QualityPart | null;
  /** Parts of the game measured against the player's own move quality (empty without enough analysed games). */
  areas: AreaStrength[];
}

export interface StrengthReport {
  estimate: StrengthEstimate | null;
  /** Rated games against humans in the period. */
  rated_games: number;
  /** Games against computers, left out. */
  bot_games: number;
  /** Finished games without opponent rating, left out of the results part. */
  unrated_games: number;
}

const speedOf = (g: RawGame) => (g.chess960 ? "Chess960" : (g.speed_category || "").trim() || detectSpeedCategory(g.time_control, g.event, g.source) || "Other");
const expected = (own: number, opp: number) => 1 / (1 + 10 ** ((opp - own) / 400));
const eloOf = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The parts of the game the strengths section places on the scale (as the profile's strength map). */
export const AREAS = ["opening", "middlegame", "endgame", "tactics", "safety"] as const;
export type Area = (typeof AREAS)[number];
type Pair = { u: Tally; o: Tally };
type GameTallies = { all: Pair } & Record<Area, Pair>;
// Pseudo-units per area for the error ratio (the same as profile/strength.ts).
const AREA_PRIOR: Record<Area, number> = { opening: 15, middlegame: 15, endgame: 15, tactics: 4, safety: 60 };

const emptyPair = (): Pair => ({ u: { errors: 0, units: 0 }, o: { errors: 0, units: 0 } });

/**
 * One analysed game seen from both sides: winning chance given away per
 * classified, non-book move (overall and per phase), blunders per move, and
 * opponent errors left unpunished. Chances in the data are White's.
 */
function gameTallies(g: RawGame, color: "white" | "black"): GameTallies | null {
  if (parseSummary(g.summary_json)?.analysis_status !== "completed") return null;
  const tk: GameTallies = { all: emptyPair(), opening: emptyPair(), middlegame: emptyPair(), endgame: emptyPair(), tactics: emptyPair(), safety: emptyPair() };
  let lastDrop = 0;
  parseMoves(g.moves_json).forEach((m, idx) => {
    // Side to move from the position; the ply (0 = White's first move) when it is missing.
    const turn = (m.fen_before ?? "").split(" ")[1];
    const whiteMoved = turn ? turn === "w" : (Number(m.ply) || idx) % 2 === 0;
    const before = Number(m.win_chance_before);
    const after = Number(m.win_chance_after);
    if (!Number.isFinite(before) || !Number.isFinite(after)) return;
    const drop = Math.max(0, whiteMoved ? before - after : after - before);
    const side = (whiteMoved ? "white" : "black") === color ? "u" : "o";
    // A chance to punish: the other side just gave away OPPONENT_ERROR_THRESHOLD or more.
    if (lastDrop >= OPPONENT_ERROR_THRESHOLD && m.classification) {
      tk.tactics[side].units += 1;
      if (drop >= PUNISH_KEEP_THRESHOLD) tk.tactics[side].errors += 1;
    }
    lastDrop = drop;
    if (m.is_book_move || !m.classification) return;
    tk.all[side].errors += drop * 100;
    tk.all[side].units += 1;
    tk.safety[side].units += 1;
    if (m.classification === "Blunder") tk.safety[side].errors += 1;
    if (!m.fen_before) return;
    const area = tk[classifyFenPhase(m.fen_before, idx) as Area];
    if (!area) return;
    area[side].errors += drop * 100;
    area[side].units += 1;
  });
  return tk.all.u.units || tk.all.o.units ? tk : null;
}

/** Maximum-likelihood rating under the Elo curve with a normal prior; returns value and information. */
export function performanceMle(sample: { opp: number; score: number }[], prior: number, priorSd = PRIOR_SD): { value: number; info: number } {
  let theta = prior;
  let info = 1 / priorSd ** 2;
  for (let it = 0; it < 50; it++) {
    let grad = -(theta - prior) / priorSd ** 2;
    info = 1 / priorSd ** 2;
    for (const g of sample) {
      const e = expected(theta, g.opp);
      grad += C * (g.score - e);
      info += C * C * e * (1 - e);
    }
    const step = grad / info;
    theta += Math.max(-200, Math.min(200, step));
    if (Math.abs(step) < 0.01) break;
  }
  return { value: theta, info };
}

function resultsPart(sample: { opp: number; score: number }[]): ResultsPart {
  const avg = sample.reduce((s, g) => s + g.opp, 0) / sample.length;
  const { value, info } = performanceMle(sample, avg);
  // Uncertain opponent ratings carry into the estimate with each game's weight.
  let wsum = 0;
  let w2 = 0;
  for (const g of sample) {
    const e = expected(value, g.opp);
    wsum += e * (1 - e);
    w2 += (e * (1 - e)) ** 2;
  }
  const oppVar = wsum > 0 ? (OPP_RATING_SD ** 2 * w2) / wsum ** 2 : 0;
  return {
    value,
    se: Math.sqrt(1 / info + oppVar),
    games: sample.length,
    points: sample.reduce((s, g) => s + g.score, 0),
    avg_opp: avg,
    sample,
  };
}

/** Combines results and move quality (both on the common scale) by their uncertainty. */
export function combineParts(r: StrengthPart, q: { value: number; se: number; k_sd: number; noise_se: number } | null): { value: number; se: number; wq: number } {
  if (!q) return { value: r.value, se: r.se, wq: 0 };
  const a = r.se ** 2;
  const b = q.se ** 2 + q.k_sd ** 2 + QUALITY_PERSON_SD ** 2;
  const cov = RESULT_QUALITY_RHO * r.se * Math.min(q.noise_se, q.se);
  let wr = (b - cov) / (a + b - 2 * cov);
  wr = Math.min(1, Math.max(0, wr));
  const wq = 1 - wr;
  const variance = wr * wr * a + wq * wq * b + 2 * wr * wq * cov;
  return { value: wr * r.value + wq * q.value, se: Math.sqrt(Math.max(variance, 1)), wq };
}

/** Conversion error (variance) of one estimate against the Lichess blitz pool. */
function conversionVar(columns: Record<string, number>): number {
  let v = 0;
  for (const [col, share] of Object.entries(columns)) if (col !== "li_blitz") v += (CONVERSION_SD * share) ** 2;
  return v;
}

/** The player's strength from their own games in the filters (bots and unrated games left out). */
export function playerStrength(games: RawGame[], usernames: string[], { format = "All Formats", date = "All Time" }: { format?: string; date?: string } = {}): StrengthReport {
  const sample: { opp: number; score: number; col: string; at: number }[] = [];
  const quality: { t: GameTallies; opp: number; col: string }[] = [];
  let bots = 0;
  let unrated = 0;
  for (const [g, color] of filterGames(games, usernames, "All Colors", format, "All Sources", date)) {
    const outcome = outcomeFor(g.result, color);
    if (!outcome) continue;
    if (isBotGame(g, color)) {
      bots++;
      continue;
    }
    const raw = eloOf(color === "white" ? g.black_elo : g.white_elo);
    if (raw === null) {
      unrated++;
      continue;
    }
    const source = String(g.source || "file").toLowerCase();
    const speed = speedOf(g);
    const opp = toLichessBlitz(raw, source, speed);
    const col = ratingColumn(source, speed);
    sample.push({ opp, score: outcome === "win" ? 1 : outcome === "draw" ? 0.5 : 0, col, at: parsePlayedAt(g) ?? 0 });
    const tk = gameTallies(g, color);
    if (tk) quality.push({ t: tk, opp, col });
  }
  const report: StrengthReport = { estimate: null, rated_games: sample.length, bot_games: bots, unrated_games: unrated };
  if (sample.length < MIN_RATED_GAMES) return report;

  const results = resultsPart(sample.map(({ opp, score }) => ({ opp, score })));
  let q: { value: number; se: number; k_sd: number; noise_se: number; ratio: number; games: number } | null = null;
  if (quality.length >= MIN_QUALITY_GAMES) {
    const ratio = tallyRatio(
      quality.map((x) => x.t.all),
      QUALITY_PRIOR,
    );
    if (ratio) {
      const anchor = quality.reduce((s, x) => s + x.opp, 0) / quality.length;
      const se = Math.hypot(Math.max(QUALITY_K * ratio.se, QUALITY_GAME_SD / Math.sqrt(ratio.games)), OPP_RATING_SD / Math.sqrt(ratio.games));
      // Real players make between a third and three times their opponents' errors;
      // beyond that the log ratio is a quirk of a few games, not a strength.
      const ln = Math.max(-MAX_LN_RATIO, Math.min(MAX_LN_RATIO, ratio.ln));
      q = { value: anchor - QUALITY_K * ln, se, k_sd: QUALITY_K_REL_SD * QUALITY_K * Math.abs(ln), noise_se: QUALITY_K * ratio.se, ratio: Math.exp(ratio.ln), games: ratio.games };
    }
  }
  const combined = combineParts(results, q);

  // Which rating pools the estimate rests on: results by each game's information, quality by games.
  const columns: Record<string, number> = {};
  const add = (col: string, w: number) => (columns[col] = (columns[col] ?? 0) + w);
  let infoSum = 0;
  const infos = sample.map((g) => {
    const e = expected(results.value, g.opp);
    infoSum += e * (1 - e);
    return e * (1 - e);
  });
  sample.forEach((g, i) => add(g.col, ((1 - combined.wq) * infos[i]) / (infoSum || 1)));
  if (q) for (const x of quality) add(x.col, combined.wq / quality.length);

  const margin = Z95 * Math.sqrt(combined.se ** 2 + conversionVar(columns));
  report.estimate = {
    value: combined.value,
    se: combined.se,
    columns,
    elo: lichessBlitzToElo(combined.value),
    elo_low: lichessBlitzToElo(combined.value - margin),
    elo_high: lichessBlitzToElo(combined.value + margin),
    extrapolated: combined.value < SURVEY_LOW_VALUE,
    results,
    quality: q ? { value: q.value, se: q.se, k_sd: q.k_sd, noise_se: q.noise_se, games: q.games, error_ratio: q.ratio, weight: combined.wq } : null,
    areas: q ? areaStrengths(quality.map((x) => x.t), combined) : [],
  };
  return report;
}

// How far one part of the game sits from the player's own average, before the
// data speak (prior SD): parts of one player's game rarely differ by more than
// one or two hundred points.
export const AREA_SPREAD = 150;
// One-sided 95 %: an area only "stands out" beyond this many standard errors.
const STAND_OUT_Z = 1.645;

/**
 * Each part of the game relative to the player's own overall move quality:
 * the error ratio in that part against the ratio over all moves, in Elo. Only
 * the player's own games enter, so a strength says "better than the rest of
 * this player's game", the same whoever else is compared. Shrunk toward 0
 * with AREA_SPREAD, so a handful of endgames cannot make an endgame expert.
 */
function areaStrengths(games: GameTallies[], overall: { value: number; se: number }): AreaStrength[] {
  const all = tallyRatio(
    games.map((tk) => tk.all),
    QUALITY_PRIOR,
  );
  if (!all) return [];
  const out: AreaStrength[] = [];
  for (const key of AREAS) {
    const r = tallyRatio(
      games.map((tk) => tk[key]),
      AREA_PRIOR[key],
    );
    if (!r) continue;
    const raw = Math.max(-MAX_AREA_RAW, Math.min(MAX_AREA_RAW, -QUALITY_K * (r.ln - all.ln)));
    // The area's moves are part of all moves: their noise mostly survives the
    // difference. Never surer than one game's ±400 per game allows.
    const seRaw = Math.max(QUALITY_K * Math.sqrt(Math.max(r.se ** 2 - all.se ** 2, 0.5 * r.se ** 2)), QUALITY_GAME_SD / Math.sqrt(r.games));
    const w = 1 / seRaw ** 2;
    const w0 = 1 / AREA_SPREAD ** 2;
    const offset = (raw * w) / (w + w0);
    const offsetSe = Math.sqrt(1 / (w + w0));
    out.push({
      key,
      value: overall.value + offset,
      se: Math.hypot(overall.se, offsetSe),
      offset,
      offset_se: offsetSe,
      stands_out: offset / offsetSe >= STAND_OUT_Z ? 1 : offset / offsetSe <= -STAND_OUT_Z ? -1 : 0,
      games: r.games,
    });
  }
  return out;
}

/** Mean and SD of A − B, the conversion error counted only where their rating pools differ. */
export function strengthGap(a: StrengthEstimate, b: StrengthEstimate): { mean: number; sd: number } {
  let sys = 0;
  for (const col of new Set([...Object.keys(a.columns), ...Object.keys(b.columns)])) {
    if (col === "li_blitz") continue;
    sys += (CONVERSION_SD * ((a.columns[col] ?? 0) - (b.columns[col] ?? 0))) ** 2;
  }
  return { mean: a.value - b.value, sd: Math.sqrt(a.se ** 2 + b.se ** 2 + sys) };
}

/** Chance that A is truly the stronger player. */
export function probStronger(a: StrengthEstimate, b: StrengthEstimate): number {
  const { mean, sd } = strengthGap(a, b);
  return sd > 0 ? normalCdf(mean / sd) : mean > 0 ? 1 : mean < 0 ? 0 : 0.5;
}

/** Small seeded generator, so the same group always gets the same numbers. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let tk = Math.imul(a ^ (a >>> 15), 1 | a);
    tk = (tk + Math.imul(tk ^ (tk >>> 7), 61 | tk)) ^ tk;
    return ((tk ^ (tk >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Standard normal draws from a uniform generator (Box–Muller). */
export function gaussian(rand: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    const u = Math.max(rand(), 1e-12);
    const v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

/**
 * One plausible set of true strengths: every player drawn from their estimate,
 * plus one shared conversion error per rating pool (so two players of the same
 * pool move together). Used for rank chances and the tournament.
 */
export function strengthSampler(estimates: StrengthEstimate[], rand: () => number): () => number[] {
  const z = gaussian(rand);
  const cols = [...new Set(estimates.flatMap((e) => Object.keys(e.columns)))].filter((c) => c !== "li_blitz");
  return () => {
    const shift = new Map(cols.map((c) => [c, CONVERSION_SD * z()]));
    return estimates.map((e) => {
      let v = e.value + e.se * z();
      for (const [col, share] of Object.entries(e.columns)) v += share * (shift.get(col) ?? 0);
      return v;
    });
  };
}

export interface RankOdds {
  /** Chance of each place (index 0 = first). */
  places: number[];
  /** Places the player ends up in 90 % of the plausible orders. */
  low: number;
  high: number;
  /** Chance of first place. */
  first: number;
}

export const RANK_RUNS = 4000;

/** How sure each place is: the order redrawn many times from the estimates' uncertainty. */
export function rankOdds(estimates: StrengthEstimate[], seed: number, runs = RANK_RUNS): RankOdds[] {
  const n = estimates.length;
  const counts = estimates.map(() => new Array<number>(n).fill(0));
  const draw = strengthSampler(estimates, mulberry32(seed));
  for (let r = 0; r < runs; r++) {
    const v = draw();
    for (let i = 0; i < n; i++) {
      let place = 0;
      for (let j = 0; j < n; j++) if (v[j] > v[i]) place++;
      counts[i][place]++;
    }
  }
  return counts.map((c) => {
    const places = c.map((x) => x / runs);
    // The middle 90 % of the places.
    let acc = 0;
    let low: number | null = null;
    let high = n;
    for (let k = 0; k < n; k++) {
      acc += places[k];
      if (low === null && acc >= 0.05) low = k + 1;
      if (acc >= 0.95) {
        high = k + 1;
        break;
      }
    }
    return { places, low: low ?? 1, high, first: places[0] };
  });
}

/**
 * Strength if the player scored `points` more from `games` further games at
 * their usual opponents' level (results part only; move quality unchanged).
 */
export function projectedStrength(e: StrengthEstimate, games: number, points: number, errorCut = 0): number {
  const extra = Array.from({ length: games }, (_, i) => ({ opp: e.results.avg_opp, score: i < Math.floor(points) ? 1 : i === Math.floor(points) && points % 1 ? 0.5 : 0 }));
  const r = games ? resultsPart([...e.results.sample, ...extra]) : e.results;
  // Fewer errors per move lower the error ratio by the same share.
  const q = e.quality ? { value: e.quality.value - QUALITY_K * Math.log(1 - errorCut), se: e.quality.se, k_sd: e.quality.k_sd, noise_se: e.quality.noise_se } : null;
  return combineParts(r, q).value;
}

/** A value of the common scale as the shown Elo number. */
export function eloText(value: number): string {
  return String(lichessBlitzToElo(value));
}
