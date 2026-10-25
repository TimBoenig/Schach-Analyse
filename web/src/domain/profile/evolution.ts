// How the player does in different kinds of games, how their play develops over
// time, and a short personal feedback built from the clearest findings.
// Changes over time are only called "better" or "worse" when they exceed the
// noise of the samples (about two standard errors), so a lucky week is no trend.

import { trSpeed } from "../i18n";
import type { GameFeatures } from "./features";
import { avg, pstdev, pyRound } from "./num";
import type { PrecisionStats } from "./precision";
import { wilsonMargin } from "./precision";

export interface GameTypeStat {
  key: string;
  label: string;
  description: string;
  games: number;
  /** Share of all finished games, in percent. */
  share: number;
  score_pct: number | null;
  margin: number | null;
  accuracy: number | null;
}

export interface EvolutionBlock {
  label: string;
  from: string;
  to: string;
  games: number;
  accuracy: number | null;
  score_pct: number | null;
  blunders_per_game: number | null;
  /** Serious errors per 100 own moves, by phase. */
  opening_errors: number | null;
  middlegame_errors: number | null;
  endgame_errors: number | null;
}

export interface MetricChange {
  key: string;
  label: string;
  unit: string;
  earlier: number;
  recent: number;
  delta: number;
  /** True when the change is larger than the sampling noise. */
  significant: boolean;
  improved: boolean;
}

export interface Evolution {
  blocks: EvolutionBlock[];
  changes: MetricChange[];
  /** Games per half used for the before/after comparison. */
  half: number;
}

// Below this many analyzed games per block a block mean is mostly noise.
const MIN_BLOCK = 5;
const MAX_BLOCKS = 8;
const MIN_TYPE_GAMES = 3;

const TYPES: { key: string; label: string; description: string; test: (f: GameFeatures) => boolean }[] = [
  {
    key: "tactical",
    label: "Taktisch & wild",
    description: "Die Bewertung schwankt stark, Schläge und Drohungen prägen die Partie.",
    test: (f) => f.wp_volatility >= 0.07,
  },
  {
    key: "quiet",
    label: "Ruhig & positionell",
    description: "Kaum Ausschläge in der Bewertung, es geht um Pläne und kleine Vorteile.",
    test: (f) => f.wp_volatility > 0 && f.wp_volatility < 0.035,
  },
  {
    key: "attack",
    label: "Königsangriff",
    description: "Du stürmst mit Bauern auf den gegnerischen König.",
    test: (f) => f.pawn_storm_moves >= 2,
  },
  {
    key: "queenless",
    label: "Früher Damentausch",
    description: "Die Damen gehen bis Zug 20 vom Brett.",
    test: (f) => f.queens_off_by_move !== null && f.queens_off_by_move <= 20,
  },
  {
    key: "endgame",
    label: "Bis ins Endspiel",
    description: "Die Partie erreicht ein Endspiel.",
    test: (f) => f.reached_endgame,
  },
  {
    key: "short",
    label: "Kurz & entschieden",
    description: "Nach höchstens 25 Zügen ist die Partie vorbei.",
    test: (f) => f.plies > 0 && f.plies <= 50 && f.score !== 0.5,
  },
];

function scoreOf(fs: GameFeatures[]): { score_pct: number | null; margin: number | null } {
  const scores = fs.map((f) => f.score).filter((s): s is number => s !== null);
  if (!scores.length) return { score_pct: null, margin: null };
  const mean = avg(scores);
  return { score_pct: pyRound(mean * 100, 1), margin: wilsonMargin(mean, scores.length) };
}

function accuracyOf(fs: GameFeatures[]): number | null {
  const accs = fs.filter((f) => f.analyzed).map((f) => f.rec.game_acc);
  return accs.length ? pyRound(avg(accs), 1) : null;
}

/** Score and accuracy per game type; a game can belong to several types. */
export function gameTypes(feats: GameFeatures[]): GameTypeStat[] {
  const analyzed = feats.filter((f) => f.analyzed && f.score !== null);
  return TYPES.map((t) => {
    const group = analyzed.filter(t.test);
    return {
      key: t.key,
      label: t.label,
      description: t.description,
      games: group.length,
      share: analyzed.length ? pyRound((group.length / analyzed.length) * 100, 0) : 0,
      ...scoreOf(group),
      accuracy: accuracyOf(group),
    };
  }).filter((t) => t.games > 0);
}

/** Score and accuracy per time control. */
export function bySpeed(feats: GameFeatures[]): GameTypeStat[] {
  const finished = feats.filter((f) => f.score !== null);
  const speeds = [...new Set(finished.map((f) => f.rec.speed))];
  return speeds
    .map((sp) => {
      const group = finished.filter((f) => f.rec.speed === sp);
      return {
        key: sp,
        label: trSpeed(sp),
        description: "",
        games: group.length,
        share: pyRound((group.length / finished.length) * 100, 0),
        ...scoreOf(group),
        accuracy: accuracyOf(group),
      };
    })
    .sort((a, b) => b.games - a.games);
}

function per100(fs: GameFeatures[], phase: string): number | null {
  const moves = fs.flatMap((f) => f.moves.filter((m) => m.phase === phase && !m.is_book && m.classification));
  if (moves.length < 20) return null;
  return pyRound((moves.filter((m) => m.is_serious_error).length / moves.length) * 100, 1);
}

const shortDate = (d: string) => {
  const m = /^(\d{4})[.-](\d{2})[.-](\d{2})/.exec(d);
  return m ? `${m[3]}.${m[2]}.` : d;
};

/** Per-game values of one metric, for the before/after test. */
type Metric = { key: string; label: string; unit: string; higherIsBetter: boolean; value: (f: GameFeatures) => number | null };

const METRICS: Metric[] = [
  { key: "accuracy", label: "Genauigkeit", unit: "%", higherIsBetter: true, value: (f) => (f.analyzed ? f.rec.game_acc : null) },
  { key: "score", label: "Punkte-Quote", unit: "%", higherIsBetter: true, value: (f) => (f.score !== null ? f.score * 100 : null) },
  {
    key: "blunders",
    label: "Patzer pro Partie",
    unit: "",
    higherIsBetter: false,
    value: (f) => (f.analyzed ? f.moves.filter((m) => m.classification === "Blunder").length : null),
  },
  {
    key: "errors",
    label: "Schwere Fehler pro Partie",
    unit: "",
    higherIsBetter: false,
    value: (f) => (f.analyzed ? f.errors(true).length : null),
  },
  {
    key: "punish",
    label: "Gegnerfehler bestraft",
    unit: "%",
    higherIsBetter: true,
    value: (f) => (f.analyzed && f.punish_chances > 0 ? (f.punished / f.punish_chances) * 100 : null),
  },
  {
    key: "opening_wp",
    label: "Gewinnchance nach der Eröffnung",
    unit: "%",
    higherIsBetter: true,
    value: (f) => {
      const firstOut = f.moves.find((m) => !m.is_book && m.classification && m.move_number >= 10);
      return f.analyzed && firstOut ? firstOut.wp_before * 100 : null;
    },
  },
];

/** Chronological blocks of analyzed games and a before/after test per metric. */
export function buildEvolution(feats: GameFeatures[]): Evolution {
  const games = feats
    .filter((f) => f.analyzed)
    .sort((a, b) => (a.played_at ?? 0) - (b.played_at ?? 0) || a.date.localeCompare(b.date));
  const nBlocks = Math.min(MAX_BLOCKS, Math.floor(games.length / MIN_BLOCK));
  const blocks: EvolutionBlock[] = [];
  for (let b = 0; b < nBlocks; b++) {
    const part = games.slice(Math.floor((b * games.length) / nBlocks), Math.floor(((b + 1) * games.length) / nBlocks));
    const blunders = part.map((f) => f.moves.filter((m) => m.classification === "Blunder").length);
    const from = shortDate(part[0].date);
    const to = shortDate(part[part.length - 1].date);
    blocks.push({
      label: from === to ? from : `${from}–${to}`,
      from: part[0].date,
      to: part[part.length - 1].date,
      games: part.length,
      accuracy: accuracyOf(part),
      score_pct: scoreOf(part).score_pct,
      blunders_per_game: pyRound(avg(blunders), 2),
      opening_errors: per100(part, "opening"),
      middlegame_errors: per100(part, "middlegame"),
      endgame_errors: per100(part, "endgame"),
    });
  }

  const half = Math.floor(games.length / 2);
  const changes: MetricChange[] = [];
  if (half >= MIN_BLOCK) {
    const earlier = games.slice(0, half);
    const recent = games.slice(games.length - half);
    for (const m of METRICS) {
      const a = earlier.map(m.value).filter((v): v is number => v !== null);
      const b = recent.map(m.value).filter((v): v is number => v !== null);
      if (a.length < MIN_BLOCK || b.length < MIN_BLOCK) continue;
      const ma = avg(a);
      const mb = avg(b);
      // Welch standard error of the difference of two means.
      const se = Math.sqrt(pstdev(a) ** 2 / a.length + pstdev(b) ** 2 / b.length);
      const delta = mb - ma;
      changes.push({
        key: m.key,
        label: m.label,
        unit: m.unit,
        earlier: pyRound(ma, m.unit ? 1 : 2),
        recent: pyRound(mb, m.unit ? 1 : 2),
        delta: pyRound(delta, m.unit ? 1 : 2),
        significant: se > 0 ? Math.abs(delta) >= 2 * se : delta !== 0,
        improved: m.higherIsBetter ? delta > 0 : delta < 0,
      });
    }
  }
  return { blocks, changes, half };
}

const de = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",");

/**
 * A few personal sentences: what got better, what got worse, which games suit
 * the player and which do not, and one concrete next step.
 */
export interface FeedbackItem {
  title: string;
  text: string;
  tone: "good" | "bad" | "neutral";
}

export function personalFeedback(evo: Evolution, types: GameTypeStat[], speeds: GameTypeStat[], precision: PrecisionStats): FeedbackItem[] {
  const out: FeedbackItem[] = [];
  const fmt = (c: MetricChange, v: number) => (c.unit ? `${de(v)} ${c.unit}` : de(v, 2));
  const better = evo.changes.filter((c) => c.significant && c.improved);
  const worse = evo.changes.filter((c) => c.significant && !c.improved);
  if (better.length) {
    const c = better[0];
    out.push({
      title: "Fortschritt",
      text: `${c.label} hat sich verbessert, von ${fmt(c, c.earlier)} auf ${fmt(c, c.recent)} (deine letzten ${evo.half} gegenüber den ${evo.half} Partien davor).`,
      tone: "good",
    });
  }
  if (worse.length) {
    const c = worse[0];
    out.push({
      title: "Achtung",
      text: `${c.label} hat sich verschlechtert, von ${fmt(c, c.earlier)} auf ${fmt(c, c.recent)}. Das ist mehr als normale Schwankung.`,
      tone: "bad",
    });
  }
  if (!better.length && !worse.length && evo.changes.length) {
    // Name the metric that moved most in the right direction, even if still within noise.
    const lean = [...evo.changes].sort((a, b) => Math.abs(b.delta) / (Math.abs(b.earlier) || 1) - Math.abs(a.delta) / (Math.abs(a.earlier) || 1))[0];
    out.push({
      title: "Stabil",
      text: `Über deine letzten ${evo.half * 2} analysierten Partien hat sich keine Kennzahl mehr als zufällig verändert. Am deutlichsten bewegt hat sich ${lean.label} (${fmt(lean, lean.earlier)} → ${fmt(lean, lean.recent)}).`,
      tone: "neutral",
    });
  }

  const solid = types.filter((t) => t.games >= MIN_TYPE_GAMES && t.score_pct !== null);
  if (solid.length >= 2) {
    const best = solid.reduce((a, b) => ((b.score_pct as number) > (a.score_pct as number) ? b : a));
    const worst = solid.reduce((a, b) => ((b.score_pct as number) < (a.score_pct as number) ? b : a));
    if ((best.score_pct as number) - (worst.score_pct as number) >= 15) {
      const tip =
        worst.key === "quiet"
          ? "Übe Pläne in ruhigen Stellungen."
          : worst.key === "tactical"
            ? "Taktiktraining zahlt sich hier direkt aus."
            : worst.key === "endgame"
              ? "Endspieltraining bringt dir hier am meisten."
              : "Hier liegt dein größtes Potenzial.";
      out.push({
        title: "Partietyp",
        text: `In Partien vom Typ „${best.label}“ holst du ${de(best.score_pct as number, 0)} %, bei „${worst.label}“ nur ${de(worst.score_pct as number, 0)} %. ${tip}`,
        tone: "neutral",
      });
    }
  }

  const sp = speeds.filter((s) => s.games >= 5 && s.score_pct !== null);
  if (sp.length >= 2) {
    const best = sp.reduce((a, b) => ((b.score_pct as number) > (a.score_pct as number) ? b : a));
    const worst = sp.reduce((a, b) => ((b.score_pct as number) < (a.score_pct as number) ? b : a));
    const gap = (best.score_pct as number) - (worst.score_pct as number);
    if (gap >= 12 && best.accuracy !== null && worst.accuracy !== null) {
      out.push({
        title: "Bedenkzeit",
        text: `Im ${best.label} holst du ${de(gap, 0)} Prozentpunkte mehr als im ${worst.label} (Genauigkeit ${de(best.accuracy)} gegenüber ${de(worst.accuracy)} %).`,
        tone: "neutral",
      });
    }
  }

  const t = precision.turnarounds;
  if (t.winning >= 5 && t.lost_from_winning / t.winning >= 0.2) {
    out.push({
      title: "Nächster Schritt",
      text: `Sichere gewonnene Stellungen ab: ${t.lost_from_winning} von ${t.winning} hast du noch verloren. Frage dich vor jedem Zug, was dein Gegner droht, statt sofort weiter anzugreifen.`,
      tone: "neutral",
    });
  } else if (precision.spread.stdev !== null && precision.spread.stdev >= 12) {
    out.push({ title: "Nächster Schritt", text: "Mehr Konstanz. Spiele nur ausgeruht und mache nach zwei Niederlagen eine Pause.", tone: "neutral" });
  }
  return out;
}
