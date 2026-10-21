// Player profile assembly (port of src/backend/analysis/profile/builder.py):
// combines aggregated statistics, per-game features, skill scores, style,
// patterns and a training plan into one PlayerProfile.

import { trColor, trSpeed } from "../i18n";
import { StatsAccumulator } from "../metrics/accumulators";
import { filterGames } from "../metrics/filters";
import { GameRecord, type RawGame } from "../metrics/models";
import { buildExercisePool } from "../training/exercises";
import { extractFeatures, type GameFeatures, moveLabel, sanForUci } from "./features";
import type { GameDigest, Insight, OpeningLine, PlayerProfile, SkillScore } from "./models";
import { avg, fmt, pyRound } from "./num";
import { expectedScore, ratingContext, withTypical } from "./benchmarks";
import { buildDeepInsights } from "./insights";
import { buildOpeningInsights, openingMain } from "./openings";
import { detectPatterns } from "./patterns";
import { computeSkills } from "./skills";
import { buildStyle } from "./style";
import { buildTrainingPlan } from "./training";

type Dict = Record<string, any>;

export const MIN_OPENING_GAMES = 3;
// Games the AI coach sees one by one (newest first); older games only count in the aggregates.
export const MAX_DIGEST_GAMES = 40;

const STRENGTH_TEXT: Record<string, string> = {
  opening: "Du kommst gut aus der Eröffnung und legst damit die Basis für deine Partien.",
  middlegame: "Im Mittelspiel triffst du überwiegend gute Entscheidungen.",
  endgame: "Im Endspiel spielst du präzise – ein echter Vorteil in langen Partien.",
  tactics: "Du erkennst taktische Chancen und bestrafst Fehler deiner Gegner konsequent.",
  safety: "Du stellst selten Figuren ein und machst wenige grobe Patzer.",
  conversion: "Gewonnene Stellungen bringst du zuverlässig nach Hause.",
  defense: "Du kämpfst in schlechteren Stellungen und rettest oft noch Punkte.",
  time: "Du teilst deine Bedenkzeit gut ein.",
  consistency: "Deine Leistung ist von Partie zu Partie sehr stabil.",
};

const WEAKNESS_TEXT: Record<string, string> = {
  opening: "Schon in der Eröffnung verlierst du häufig an Boden.",
  middlegame: "Im Mittelspiel unterlaufen dir die meisten Ungenauigkeiten.",
  endgame: "Im Endspiel gibst du oft Vorteile ab oder verlierst ausgeglichene Stellungen.",
  tactics: "Du übersiehst häufig taktische Chancen – Gegnerfehler bleiben oft unbestraft.",
  safety: "Eingestellte Figuren und grobe Patzer kosten dich viele Punkte.",
  conversion: "Gewonnene Stellungen gibst du zu oft noch aus der Hand.",
  defense: "In schlechteren Stellungen bricht deine Verteidigung schnell zusammen.",
  time: "Die Zeiteinteilung kostet dich Punkte (Zeitnot oder Zeitverluste).",
  consistency: "Deine Leistung schwankt stark zwischen guten und schwachen Partien.",
};

function scoreOf(feats: GameFeatures[]): number {
  return avg(feats.map((f) => f.score).filter((s): s is number => s !== null)) * 100;
}

function groupBy<K, V>(items: V[], key: (v: V) => K): Map<K, V[]> {
  const out = new Map<K, V[]>();
  for (const it of items) {
    const k = key(it);
    const list = out.get(k);
    if (list) list.push(it);
    else out.set(k, [it]);
  }
  return out;
}


/** Build the complete player profile for the tracked usernames. */
export function buildPlayerProfile(
  games: RawGame[],
  usernames: Iterable<string>,
  formatFilter = "All Formats",
  dateFilter = "All Time",
  colorFilter = "All Colors",
): PlayerProfile {
  const names = [...new Set([...usernames].filter((u) => u))].sort();
  const matched = filterGames(games, names, colorFilter, formatFilter, "All Sources", dateFilter);
  const acc = new StatsAccumulator();
  const feats: GameFeatures[] = [];
  for (const [game, color] of matched) {
    try {
      const rec = GameRecord.fromDict(game, color);
      acc.add(rec);
      feats.push(extractFeatures(game, color, rec));
    } catch {
      // One corrupt game must not break the whole profile.
    }
  }

  const stats = acc.finalize(colorFilter, formatFilter, "All Sources", dateFilter);
  const analyzed = feats.filter((f) => f.analyzed);
  const profile: PlayerProfile = {
    usernames: names,
    total_games: feats.length,
    analyzed_games: analyzed.length,
    is_empty: analyzed.length === 0,
    overview: overview(stats, feats, analyzed),
    skills: [],
    strengths: [],
    weaknesses: [],
    style: null,
    patterns: [],
    openings_best: [],
    openings_worst: [],
    trends: trends(feats),
    breakdowns: breakdowns(feats),
    training_plan: [],
    exercises: [],
    recent_games: recentGames(feats),
    rating: ratingContext(feats),
    deep: null,
    openings: null,
  };
  profile.overview.phase_accuracy = stats.phase_stats?.accuracies ?? {};
  // Results per opening need no engine, so this page works right after an import.
  profile.openings = buildOpeningInsights(feats);
  // Repertoire drills and endgame basics need no engine either.
  profile.exercises = buildExercisePool(feats);
  if (!analyzed.length) return profile;

  profile.skills = withTypical(computeSkills(stats, feats), profile.rating?.rating ?? null);
  [profile.strengths, profile.weaknesses] = strengthsWeaknesses(profile.skills, profile.rating?.rating ?? null);
  const [best, worst] = openings(feats);
  profile.openings_best = best;
  profile.openings_worst = worst;
  contextInsights(profile, feats);
  profile.style = buildStyle(analyzed, profile.skills);
  profile.patterns = detectPatterns(feats);
  profile.deep = buildDeepInsights(feats);
  profile.training_plan = buildTrainingPlan(
    profile.skills,
    profile.patterns,
    stats,
    worst.length ? worst[0].name : "",
  );
  return profile;
}

function overview(stats: Dict, feats: GameFeatures[], analyzed: GameFeatures[]): Dict {
  const ratings = new Map<string, [number, number]>();
  for (const f of feats) {
    if (f.user_rating && f.played_at) {
      const prev = ratings.get(f.rec.speed);
      if (prev === undefined || f.played_at > prev[0]) {
        ratings.set(f.rec.speed, [f.played_at, f.user_rating]);
      }
    }
  }
  const recent = [...analyzed].sort((a, b) => (a.played_at || 0) - (b.played_at || 0));
  const last = recent.slice(-20);
  const before = recent.slice(Math.max(0, recent.length - 40), Math.max(0, recent.length - 20));
  const formDelta =
    before.length >= 5
      ? avg(last.map((f) => f.rec.game_acc)) - avg(before.map((f) => f.rec.game_acc))
      : null;
  const quality = (stats.detailed_quality_counts ?? {}) as Dict;
  return {
    games: stats.total ?? 0,
    wins: stats.wins ?? 0,
    draws: stats.draws ?? 0,
    losses: stats.losses ?? 0,
    win_rate: stats.win_rate ?? 0,
    score_pct: scoreOf(feats),
    avg_accuracy: stats.avg_accuracy ?? 0,
    analyzed: analyzed.length,
    clean_games_pct: stats.clean_games_pct ?? 0,
    ratings: Object.fromEntries(
      [...ratings.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [trSpeed(k), v[1]]),
    ),
    best_win: stats.best_win ?? "",
    brilliant_moves: quality.Brilliant ?? 0,
    great_moves: quality.Great ?? 0,
    form_delta: formDelta,
    quality_counts: quality,
  };
}

function strengthsWeaknesses(skills: SkillScore[], rating: number | null): [Insight[], Insight[]] {
  const reliable = skills.filter((s) => s.reliable);
  if (!reliable.length) return [[], []];
  const mean = avg(reliable.map((s) => s.score));
  const ranked = [...reliable].sort((a, b) => b.score - a.score);
  // With a rating, "strong" means clearly above what is typical at that rating;
  // without one, the player's own average is the yardstick.
  const ref = (s: SkillScore) => (s.typical !== null && s.typical !== undefined ? s.typical : mean);
  const delta = (s: SkillScore) => s.score - ref(s);
  const byDelta = [...reliable].sort((a, b) => delta(b) - delta(a));
  let strengths =
    rating !== null
      ? byDelta.filter((s) => delta(s) >= 8 || s.score >= 75).slice(0, 3)
      : ranked.filter((s) => s.score >= 65 || s.score >= mean + 8).slice(0, 3);
  let weaknesses =
    rating !== null
      ? [...byDelta].reverse().filter((s) => delta(s) <= -8 || s.score < 30).slice(0, 3)
      : [...ranked].reverse().filter((s) => s.score < 45 || s.score <= mean - 8).slice(0, 3);
  // Always name at least one of each, relative to the player's own level.
  if (!strengths.length && byDelta.length >= 3) strengths = byDelta.slice(0, 1);
  if (!weaknesses.length && byDelta.length >= 3) weaknesses = byDelta.slice(-1);
  weaknesses = weaknesses.filter((w) => !strengths.includes(w));
  const vs = (s: SkillScore) =>
    rating !== null && s.typical !== null && s.typical !== undefined
      ? ` · ${fmt(s.score, 0)} Punkte, typisch für ${rating}: ${fmt(s.typical, 0)}`
      : "";
  return [
    strengths.map((s) => ({
      key: s.key,
      title: s.name,
      text: `${STRENGTH_TEXT[s.key] ?? ""} (${s.detail}${vs(s)})`,
      category: "Fähigkeit",
      strength: delta(s),
    })),
    weaknesses.map((s) => ({
      key: s.key,
      title: s.name,
      text: `${WEAKNESS_TEXT[s.key] ?? ""} (${s.detail}${vs(s)})`,
      category: "Fähigkeit",
      strength: -delta(s),
    })),
  ];
}

function openingLines(feats: GameFeatures[]): OpeningLine[] {
  const groups = new Map<string, { name: string; color: string; fs: GameFeatures[] }>();
  for (const f of feats) {
    if (!f.rec.opening || f.score === null) continue;
    const main = openingMain(f.rec.opening);
    const k = `${main}\u0000${f.rec.user_color}`;
    const g = groups.get(k);
    if (g) g.fs.push(f);
    else groups.set(k, { name: main, color: f.rec.user_color, fs: [f] });
  }
  const lines: OpeningLine[] = [];
  for (const { name, color, fs } of groups.values()) {
    if (fs.length < MIN_OPENING_GAMES) continue;
    const firstErr: number[] = [];
    for (const f of fs) {
      const m = f.moves.find((x) => x.is_serious_error);
      if (m) firstErr.push(m.move_number);
    }
    lines.push({
      name,
      eco: fs.find((f) => f.rec.eco)?.rec.eco ?? "",
      color,
      games: fs.length,
      score_pct: scoreOf(fs),
      avg_accuracy: avg(fs.map((f) => f.rec.game_acc).filter((a) => a > 0)),
      first_error_move: firstErr.length ? avg(firstErr) : null,
    });
  }
  return lines;
}

function openings(feats: GameFeatures[]): [OpeningLine[], OpeningLine[]] {
  const byScore = openingLines(feats).sort(
    (a, b) => b.score_pct - a.score_pct || b.games - a.games,
  );
  const best = byScore.filter((o) => o.score_pct >= 50).slice(0, 5);
  const worst = [...byScore]
    .reverse()
    .filter((o) => o.score_pct < 50)
    .slice(0, 5);
  return [best, worst];
}

/** Add color, format and opening findings to strengths/weaknesses. */
function contextInsights(profile: PlayerProfile, feats: GameFeatures[]): void {
  const white = feats.filter((f) => f.rec.user_color === "white");
  const black = feats.filter((f) => f.rec.user_color === "black");
  if (white.length >= 8 && black.length >= 8) {
    const sw = scoreOf(white);
    const sb = scoreOf(black);
    if (Math.abs(sw - sb) >= 10) {
      const [better, worse] = sw > sb ? ["white", "black"] : ["black", "white"];
      profile.weaknesses.push({
        key: `color_${worse}`,
        title: `Ergebnisse mit ${trColor(worse)}`,
        text:
          `Mit ${trColor(worse)} holst du ${fmt(Math.min(sw, sb), 0)} % der Punkte, mit ` +
          `${trColor(better)} ${fmt(Math.max(sw, sb), 0)} %. Dein Repertoire mit ` +
          `${trColor(worse)} verdient Aufmerksamkeit.`,
        category: "Farbe",
        strength: Math.abs(sw - sb) / 2,
      });
    }
  }

  if (profile.openings_best.length) {
    const o = profile.openings_best[0];
    if (o.score_pct >= 60) {
      profile.strengths.push({
        key: "opening_best",
        title: `Erfolgseröffnung: ${o.name}`,
        text:
          `Mit ${trColor(o.color)} holst du hier ${fmt(o.score_pct, 0)} % der Punkte ` +
          `(${o.games} Partien, Ø ${fmt(o.avg_accuracy, 1)} % Genauigkeit).`,
        category: "Eröffnung",
        strength: (o.score_pct - 50) / 2,
      });
    }
  }
  if (profile.openings_worst.length) {
    const o = profile.openings_worst[0];
    if (o.score_pct <= 40) {
      profile.weaknesses.push({
        key: "opening_worst",
        title: `Problemeröffnung: ${o.name}`,
        text:
          `Mit ${trColor(o.color)} holst du hier nur ${fmt(o.score_pct, 0)} % der Punkte ` +
          `(${o.games} Partien).` +
          (o.first_error_move
            ? ` Der erste schwere Fehler kommt im Schnitt in Zug ${fmt(o.first_error_move, 0)}.`
            : ""),
        category: "Eröffnung",
        strength: (50 - o.score_pct) / 2,
      });
    }
  }

  const speeds = groupBy(feats, (f) => f.rec.speed);
  const rated = [...speeds.entries()].filter(([, v]) => v.length >= 8);
  if (rated.length >= 2) {
    const accBy = new Map<string, number>();
    for (const [k, v] of rated) {
      const a = avg(v.filter((f) => f.analyzed).map((f) => f.rec.game_acc));
      if (a > 0) accBy.set(k, a);
    }
    if (accBy.size >= 2) {
      let bestK = "";
      let worstK = "";
      for (const [k, a] of accBy) {
        if (!bestK || a > (accBy.get(bestK) as number)) bestK = k;
        if (!worstK || a < (accBy.get(worstK) as number)) worstK = k;
      }
      const ab = accBy.get(bestK) as number;
      const aw = accBy.get(worstK) as number;
      if (ab - aw >= 4) {
        profile.strengths.push({
          key: "speed_best",
          title: `Stärkste Bedenkzeit: ${trSpeed(bestK)}`,
          text:
            `In ${trSpeed(bestK)} spielst du mit Ø ${fmt(ab, 1)} % am ` +
            `genauesten, in ${trSpeed(worstK)} nur mit ${fmt(aw, 1)} %.`,
          category: "Bedenkzeit",
          strength: (ab - aw) / 2,
        });
      }
    }
  }
}

function monthKey(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function trends(feats: GameFeatures[]): Dict {
  const months = new Map<string, GameFeatures[]>();
  const ratingPoints = new Map<string, Array<[number, number]>>();
  for (const f of feats) {
    if (!f.played_at) continue;
    const mk = monthKey(f.played_at);
    const list = months.get(mk);
    if (list) list.push(f);
    else months.set(mk, [f]);
    if (f.user_rating) {
      const sk = trSpeed(f.rec.speed);
      const pts = ratingPoints.get(sk);
      if (pts) pts.push([f.played_at, f.user_rating]);
      else ratingPoints.set(sk, [[f.played_at, f.user_rating]]);
    }
  }
  const monthly = [...months.keys()].sort().map((key) => {
    const fs = months.get(key) as GameFeatures[];
    const accs = fs.filter((f) => f.analyzed).map((f) => f.rec.game_acc);
    return {
      month: key,
      games: fs.length,
      score_pct: scoreOf(fs),
      avg_accuracy: accs.length ? avg(accs) : null,
      blunders_per_game: accs.length
        ? avg(fs.filter((f) => f.analyzed).map((f) => Number(f.rec.quality_counts.Blunder ?? 0)))
        : null,
    };
  });
  const ratingsOut: Record<string, Array<[number, number]>> = {};
  for (const [k, v] of ratingPoints) {
    if (v.length >= 2) ratingsOut[k] = [...v].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  return { monthly, ratings: ratingsOut };
}

function breakdowns(feats: GameFeatures[]): Dict {
  const row = (label: string, fs: GameFeatures[]): Dict => {
    const finished = fs.filter((f) => f.score !== null);
    return {
      label,
      games: fs.length,
      wins: finished.filter((f) => f.rec.is_win).length,
      draws: finished.filter((f) => f.rec.is_draw).length,
      losses: finished.filter((f) => f.rec.is_loss).length,
      score_pct: scoreOf(fs),
      avg_accuracy: avg(fs.filter((f) => f.analyzed).map((f) => f.rec.game_acc)),
      expected_pct: expectedPct(finished),
    };
  };

  const byColor = (["white", "black"] as const).map((c) =>
    row(
      trColor(c),
      feats.filter((f) => f.rec.user_color === c),
    ),
  );
  const speeds = groupBy(feats, (f) => f.rec.speed);
  const bySpeed = [...speeds.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([k, v]) => row(trSpeed(k), v));

  const buckets = new Map<string, GameFeatures[]>([
    ["Stärkere Gegner (+100)", []],
    ["Ähnlich stark (±100)", []],
    ["Schwächere Gegner (−100)", []],
  ]);
  for (const f of feats) {
    if (!f.user_rating || !f.opp_rating) continue;
    const diff = f.opp_rating - f.user_rating;
    const key =
      diff >= 100
        ? "Stärkere Gegner (+100)"
        : diff <= -100
          ? "Schwächere Gegner (−100)"
          : "Ähnlich stark (±100)";
    (buckets.get(key) as GameFeatures[]).push(f);
  }
  const byOpponent = [...buckets.entries()].filter(([, v]) => v.length).map(([k, v]) => row(k, v));
  return { color: byColor, speed: bySpeed, opponent: byOpponent };
}

/** Elo-expected score in percent for games with both ratings, null if none. */
function expectedPct(fs: GameFeatures[]): number | null {
  const rated = fs.filter((f) => f.user_rating && f.opp_rating);
  if (!rated.length) return null;
  return pyRound((rated.reduce((s, f) => s + expectedScore(f.user_rating, f.opp_rating), 0) / rated.length) * 100, 1);
}

/** Compact per-game record for the AI coach: newest first, the player's worst moves included. */
function recentGames(feats: GameFeatures[]): GameDigest[] {
  return [...feats]
    .sort((a, b) => (b.played_at || 0) - (a.played_at || 0) || b.date.localeCompare(a.date))
    .slice(0, MAX_DIGEST_GAMES)
    .map((f) => {
      const q = f.rec.quality_counts as Record<string, number>;
      const worst = f.analyzed
        ? [...f.errors(true)]
            .sort((a, b) => b.wp_drop - a.wp_drop)
            .slice(0, 2)
            .map((m) => ({
              move: moveLabel(m.move_number, f.rec.user_color === "white", m.san),
              classification: m.classification,
              best: sanForUci(m.fen_before, m.best_move_uci, f.chess960),
              wp_before: pyRound(m.wp_before * 100, 0),
              wp_after: pyRound(m.wp_after * 100, 0),
              phase: m.phase,
            }))
        : [];
      return {
        game_id: f.game_id,
        date: f.date,
        color: f.rec.user_color,
        opponent: f.rec.opp_name,
        user_rating: f.user_rating || null,
        opp_rating: f.opp_rating || null,
        score: f.score,
        speed: f.rec.speed,
        opening: f.rec.opening,
        accuracy: f.analyzed ? pyRound(f.rec.game_acc, 1) : null,
        blunders: f.analyzed ? Number(q.Blunder ?? 0) : null,
        mistakes: f.analyzed ? Number(q.Mistake ?? 0) + Number(q.Miss ?? 0) : null,
        plies: f.plies,
        termination: f.rec.term_type,
        worst,
      };
    });
}
