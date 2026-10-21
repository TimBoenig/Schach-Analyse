// Deep insights: where on the board, when in the game, with which piece, at
// which time of day and in which mood (after a win or loss) the player errs.
// Every block carries its sample size so the UI can hide thin evidence.

import type { GameFeatures, MoveEvent } from "./features";
import { avg, pyRound } from "./num";

export interface ScoreBucket {
  key: string;
  label: string;
  games: number;
  score_pct: number | null;
  avg_accuracy: number | null;
}

export interface MoveBucket {
  label: string;
  moves: number;
  errors: number;
  /** Serious errors (mistake, miss, blunder) per 100 of the player's moves. */
  per100: number | null;
}

export interface PieceBucket extends MoveBucket {
  piece: string;
}

export interface DeepInsights {
  /** Serious errors by destination square, index 0 = a1 … 63 = h8. */
  error_squares: number[];
  error_total: number;
  hot_squares: { square: string; count: number }[];
  by_move_number: MoveBucket[];
  by_piece: PieceBucket[];
  by_daytime: ScoreBucket[];
  by_weekday: ScoreBucket[];
  /** Score depending on the result of the previous game in the same session. */
  after_result: ScoreBucket[];
  /** Score by position of the game within a session (1st, 2nd, …). */
  by_session_game: ScoreBucket[];
  /** Error rate by how the game stood before the move (player's winning chance). */
  by_situation: MoveBucket[];
  /** Error rate by thinking time per move (only moves with clock data). */
  by_think_time: MoveBucket[];
  /** Error rate right after leaving theory vs. later. */
  after_book: MoveBucket[];
  /** Error rate with enough time vs. in time trouble. */
  time_trouble: MoveBucket[];
  /** How often the player punished an opponent error (kept the gain). */
  punish: { chances: number; punished: number; rate: number | null };
  /** Average count per analyzed game of each error class. */
  errors_per_game: { classification: string; per_game: number }[];
  /** Headline findings in German, strongest first. */
  facts: string[];
}

// Two games belong to one session when the second starts within this gap.
export const SESSION_GAP_SECONDS = 2 * 60 * 60;
// Buckets with fewer games/moves than this are not used for headline findings.
const MIN_GAMES = 4;
const MIN_MOVES = 30;

const FILES = "abcdefgh";

const PIECES: [string, string][] = [
  ["P", "Bauer"],
  ["N", "Springer"],
  ["B", "Läufer"],
  ["R", "Turm"],
  ["Q", "Dame"],
  ["K", "König"],
];

const PIECE_DATIVE: Record<string, string> = {
  P: "dem Bauern",
  N: "dem Springer",
  B: "dem Läufer",
  R: "dem Turm",
  Q: "der Dame",
  K: "dem König",
};

const MOVE_RANGES: [number, number, string][] = [
  [1, 10, "1–10"],
  [11, 20, "11–20"],
  [21, 30, "21–30"],
  [31, 40, "31–40"],
  [41, 9999, "41+"],
];

const DAYTIMES: [string, string, (h: number) => boolean][] = [
  ["morning", "Morgens (5–11 Uhr)", (h) => h >= 5 && h < 11],
  ["midday", "Mittags (11–17 Uhr)", (h) => h >= 11 && h < 17],
  ["evening", "Abends (17–22 Uhr)", (h) => h >= 17 && h < 22],
  ["night", "Nachts (22–5 Uhr)", (h) => h >= 22 || h < 5],
];

const SITUATIONS: [string, (wp: number) => boolean][] = [
  ["Klar besser (ab 70 %)", (wp) => wp >= 0.7],
  ["Ausgeglichen", (wp) => wp > 0.3 && wp < 0.7],
  ["Klar schlechter (bis 30 %)", (wp) => wp <= 0.3],
];

const THINK_TIMES: [string, (s: number) => boolean][] = [
  ["unter 3 s", (s) => s < 3],
  ["3–10 s", (s) => s >= 3 && s < 10],
  ["10–30 s", (s) => s >= 10 && s < 30],
  ["über 30 s", (s) => s >= 30],
];

// The first moves after theory are where players without a plan go wrong.
const AFTER_BOOK_MOVES = 5;

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** German decimal formatting (comma) for sentences. */
const de = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",");

export function pieceOf(m: MoveEvent): string {
  const san = m.san || "";
  if (san.startsWith("O-O")) return "K";
  return "NBRQK".includes(san[0]) ? san[0] : "P";
}

function scoreBucket(key: string, label: string, fs: GameFeatures[]): ScoreBucket {
  const scores = fs.map((f) => f.score).filter((s): s is number => s !== null);
  const accs = fs.filter((f) => f.analyzed).map((f) => f.rec.game_acc);
  return {
    key,
    label,
    games: fs.length,
    score_pct: scores.length ? pyRound(avg(scores) * 100, 1) : null,
    avg_accuracy: accs.length ? pyRound(avg(accs), 1) : null,
  };
}

function moveBucket(label: string, moves: MoveEvent[]): MoveBucket {
  const errors = moves.filter((m) => m.is_serious_error).length;
  return { label, moves: moves.length, errors, per100: moves.length ? pyRound((errors / moves.length) * 100, 1) : null };
}

/** Group consecutive games (by start time) into sessions. */
export function sessions(feats: GameFeatures[]): GameFeatures[][] {
  const timed = feats.filter((f) => f.time_known && f.played_at).sort((a, b) => (a.played_at as number) - (b.played_at as number));
  const out: GameFeatures[][] = [];
  for (const f of timed) {
    const cur = out[out.length - 1];
    const prev = cur?.[cur.length - 1];
    if (prev && (f.played_at as number) - (prev.played_at as number) <= SESSION_GAP_SECONDS) cur.push(f);
    else out.push([f]);
  }
  return out;
}

export function buildDeepInsights(
  feats: GameFeatures[],
  localHour: (ts: number) => number = (ts) => new Date(ts * 1000).getHours(),
  localWeekday: (ts: number) => number = (ts) => new Date(ts * 1000).getDay(),
): DeepInsights {
  const analyzed = feats.filter((f) => f.analyzed);
  // Only moves after the book: theory moves are never errors and would dilute the rates.
  const moves = analyzed.flatMap((f) => f.moves.filter((m) => !m.is_book && m.classification));

  const squares = new Array<number>(64).fill(0);
  for (const m of moves) {
    if (!m.is_serious_error || m.uci.length < 4) continue;
    const file = FILES.indexOf(m.uci[2]);
    const rank = Number(m.uci[3]) - 1;
    if (file >= 0 && rank >= 0 && rank < 8) squares[rank * 8 + file] += 1;
  }
  const errorTotal = squares.reduce((s, v) => s + v, 0);
  const hot = squares
    .map((count, i) => ({ square: `${FILES[i % 8]}${Math.floor(i / 8) + 1}`, count }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  const byMove = MOVE_RANGES.map(([lo, hi, label]) =>
    moveBucket(label, moves.filter((m) => m.move_number >= lo && m.move_number <= hi)),
  );
  const byPiece: PieceBucket[] = PIECES.map(([p, name]) => ({
    piece: p,
    ...moveBucket(name, moves.filter((m) => pieceOf(m) === p)),
  }));

  const timed = feats.filter((f) => f.time_known && f.played_at);
  const byDaytime = DAYTIMES.map(([key, label, test]) =>
    scoreBucket(key, label, timed.filter((f) => test(localHour(f.played_at as number)))),
  );
  const byWeekday = WEEK_ORDER.map((d) =>
    scoreBucket(String(d), WEEKDAYS[d], timed.filter((f) => localWeekday(f.played_at as number) === d)),
  );

  const after: Record<string, GameFeatures[]> = { win: [], draw: [], loss: [], loss2: [] };
  const bySession: GameFeatures[][] = [[], [], [], []];
  for (const s of sessions(feats)) {
    s.forEach((f, i) => {
      bySession[Math.min(i, 3)].push(f);
      if (i === 0) return;
      const prev = s[i - 1].score;
      if (prev === 1) after.win.push(f);
      else if (prev === 0.5) after.draw.push(f);
      else if (prev === 0) {
        after.loss.push(f);
        if (i >= 2 && s[i - 2].score === 0) after.loss2.push(f);
      }
    });
  }
  const afterResult = [
    scoreBucket("win", "Nach einem Sieg", after.win),
    scoreBucket("draw", "Nach einem Remis", after.draw),
    scoreBucket("loss", "Nach einer Niederlage", after.loss),
    scoreBucket("loss2", "Nach zwei Niederlagen", after.loss2),
  ];
  const bySessionGame = ["1. Partie", "2. Partie", "3. Partie", "4. und später"].map((label, i) =>
    scoreBucket(String(i + 1), label, bySession[i]),
  );

  const bySituation = SITUATIONS.map(([label, test]) => moveBucket(label, moves.filter((m) => test(m.wp_before))));
  const clocked = moves.filter((m) => m.time_spent !== null);
  const byThink = THINK_TIMES.map(([label, test]) => moveBucket(label, clocked.filter((m) => test(m.time_spent as number))));
  const outOfBook = moves.filter((m) => m.moves_since_book >= 0);
  const afterBook = [
    moveBucket(`Erste ${AFTER_BOOK_MOVES} Züge nach der Theorie`, outOfBook.filter((m) => m.moves_since_book < AFTER_BOOK_MOVES)),
    moveBucket("Danach", outOfBook.filter((m) => m.moves_since_book >= AFTER_BOOK_MOVES)),
  ];
  const withClock = moves.filter((m) => m.time_left !== null);
  const timeTrouble = [
    moveBucket("Genug Zeit", withClock.filter((m) => !m.in_time_trouble)),
    moveBucket("Zeitnot", withClock.filter((m) => m.in_time_trouble)),
  ];
  const chances = analyzed.reduce((s, f) => s + f.punish_chances, 0);
  const punished = analyzed.reduce((s, f) => s + f.punished, 0);
  const errorsPerGame = ["Inaccuracy", "Mistake", "Miss", "Blunder"].map((c) => ({
    classification: c,
    per_game: analyzed.length ? pyRound(moves.filter((m) => m.classification === c).length / analyzed.length, 2) : 0,
  }));

  const insights: DeepInsights = {
    error_squares: squares,
    error_total: errorTotal,
    hot_squares: hot,
    by_move_number: byMove,
    by_piece: byPiece,
    by_daytime: byDaytime,
    by_weekday: byWeekday,
    after_result: afterResult,
    by_session_game: bySessionGame,
    by_situation: bySituation,
    by_think_time: byThink,
    after_book: afterBook,
    time_trouble: timeTrouble,
    punish: { chances, punished, rate: chances ? pyRound((punished / chances) * 100, 1) : null },
    errors_per_game: errorsPerGame,
    facts: [],
  };
  insights.facts = headlineFacts(insights, feats);
  return insights;
}

function headlineFacts(d: DeepInsights, feats: GameFeatures[]): string[] {
  const facts: [number, string][] = [];
  const overallScores = feats.map((f) => f.score).filter((s): s is number => s !== null);
  const overall = overallScores.length ? avg(overallScores) * 100 : null;

  // Tilt: clearly worse right after a loss.
  const afterWin = d.after_result[0];
  const afterLoss = d.after_result[2];
  if (afterLoss.games >= MIN_GAMES && afterLoss.score_pct !== null && overall !== null) {
    const gap = overall - afterLoss.score_pct;
    if (gap >= 10) {
      facts.push([
        gap,
        `Nach einer Niederlage holst du nur ${afterLoss.score_pct.toFixed(0)} % der Punkte (sonst ${overall.toFixed(0)} %). Eine kurze Pause vor der nächsten Partie lohnt sich.`,
      ]);
    } else if (afterWin.games >= MIN_GAMES && afterWin.score_pct !== null && gap <= -5) {
      facts.push([5, `Niederlagen werfen dich nicht aus der Bahn: Direkt danach holst du sogar ${afterLoss.score_pct.toFixed(0)} %.`]);
    }
  }

  // Sessions: does the player fade in long sessions?
  const first = d.by_session_game[0];
  const late = d.by_session_game[3];
  if (first.games >= MIN_GAMES && late.games >= MIN_GAMES && first.score_pct !== null && late.score_pct !== null) {
    const drop = first.score_pct - late.score_pct;
    if (drop >= 12) {
      facts.push([
        drop,
        `Ab der 4. Partie am Stück sinkt deine Punktequote von ${first.score_pct.toFixed(0)} % auf ${late.score_pct.toFixed(0)} %. Lange Serien kosten dich Punkte.`,
      ]);
    }
  }

  // Time of day: best and worst slot with enough games.
  const slots = d.by_daytime.filter((b) => b.games >= MIN_GAMES && b.score_pct !== null);
  if (slots.length >= 2) {
    const best = slots.reduce((a, b) => ((b.score_pct as number) > (a.score_pct as number) ? b : a));
    const worst = slots.reduce((a, b) => ((b.score_pct as number) < (a.score_pct as number) ? b : a));
    const gap = (best.score_pct as number) - (worst.score_pct as number);
    if (gap >= 12) {
      facts.push([
        gap * 0.8,
        `${best.label.split(" ")[0]} spielst du am besten (${(best.score_pct as number).toFixed(0)} %), ${worst.label.split(" ")[0].toLowerCase()} am schwächsten (${(worst.score_pct as number).toFixed(0)} %).`,
      ]);
    }
  }

  // Move number: where errors pile up.
  const ranges = d.by_move_number.filter((b) => b.moves >= MIN_MOVES && b.per100 !== null);
  if (ranges.length >= 2) {
    const peak = ranges.reduce((a, b) => ((b.per100 as number) > (a.per100 as number) ? b : a));
    const mean = avg(ranges.map((b) => b.per100 as number));
    if ((peak.per100 as number) >= mean * 1.35 && (peak.per100 as number) >= 3) {
      facts.push([
        ((peak.per100 as number) / Math.max(mean, 0.1)) * 8,
        `Deine Fehler häufen sich zwischen Zug ${peak.label.replace("–", " und ")}: ${de(peak.per100 as number)} schwere Fehler pro 100 Züge (Schnitt ${de(mean)}).`,
      ]);
    }
  }

  // Piece: which piece the player misplays most often.
  const pieces = d.by_piece.filter((b) => b.moves >= MIN_MOVES && b.per100 !== null);
  if (pieces.length >= 3) {
    const worst = pieces.reduce((a, b) => ((b.per100 as number) > (a.per100 as number) ? b : a));
    const others = pieces.filter((b) => b !== worst);
    const rest = others.reduce((s, b) => s + b.errors, 0) / Math.max(1, others.reduce((s, b) => s + b.moves, 0)) * 100;
    if ((worst.per100 as number) >= rest * 1.5 && worst.errors >= 3) {
      const factor = (worst.per100 as number) / Math.max(rest, 0.1);
      facts.push([
        factor * 7,
        `Mit ${PIECE_DATIVE[worst.piece]} patzt du ${factor >= 2 ? `${de(factor)}-mal so oft wie` : "deutlich öfter als"} mit anderen Figuren.`,
      ]);
    }
  }

  // Hot square: one square that keeps coming back.
  const top = d.hot_squares[0];
  if (top && d.error_total >= 10 && top.count / d.error_total >= 0.08 && top.count >= 3) {
    facts.push([top.count, `Auf ${top.square} landen auffällig viele deiner Fehler (${top.count} von ${d.error_total}).`]);
  }

  // Thinking time: quick moves clearly more error-prone than considered ones.
  const fast = d.by_think_time[0];
  const slow = d.by_think_time.slice(1).filter((b) => b.moves >= MIN_MOVES && b.per100 !== null);
  if (fast.moves >= MIN_MOVES && fast.per100 !== null && slow.length) {
    const rest = slow.reduce((s, b) => s + b.errors, 0) / Math.max(1, slow.reduce((s, b) => s + b.moves, 0)) * 100;
    if (fast.per100 >= rest * 1.5 && fast.errors >= 3) {
      facts.push([
        (fast.per100 / Math.max(rest, 0.1)) * 6,
        `Schnelle Züge (unter 3 Sekunden) gehen bei dir ${de(fast.per100 / Math.max(rest, 0.1))}-mal so oft schief wie überlegte: ${de(fast.per100)} gegenüber ${de(rest)} schweren Fehlern pro 100 Züge.`,
      ]);
    }
  }

  // Time trouble.
  const [calm, trouble] = d.time_trouble;
  if (trouble.moves >= MIN_MOVES && calm.moves >= MIN_MOVES && trouble.per100 !== null && calm.per100 !== null && trouble.per100 >= calm.per100 * 1.8) {
    facts.push([
      (trouble.per100 / Math.max(calm.per100, 0.1)) * 5,
      `In Zeitnot machst du ${de(trouble.per100)} schwere Fehler pro 100 Züge, mit genug Zeit nur ${de(calm.per100)}.`,
    ]);
  }

  // Right after theory.
  const [early, later] = d.after_book;
  if (early.moves >= MIN_MOVES && later.moves >= MIN_MOVES && early.per100 !== null && later.per100 !== null && early.per100 >= later.per100 * 1.4) {
    facts.push([
      (early.per100 / Math.max(later.per100, 0.1)) * 5,
      `Direkt nach der Theorie wird es gefährlich: In den ersten ${AFTER_BOOK_MOVES} Zügen danach patzt du ${de(early.per100)}-mal pro 100 Züge, später ${de(later.per100)}-mal.`,
    ]);
  }

  // Position type: in which situation errors pile up.
  const sit = d.by_situation.filter((b) => b.moves >= MIN_MOVES && b.per100 !== null);
  if (sit.length >= 2) {
    const worst = sit.reduce((a, b) => ((b.per100 as number) > (a.per100 as number) ? b : a));
    const mean = avg(sit.map((b) => b.per100 as number));
    if ((worst.per100 as number) >= mean * 1.4 && worst.errors >= 3) {
      const where =
        worst === d.by_situation[0] ? "wenn du klar besser stehst" : worst === d.by_situation[1] ? "in ausgeglichenen Stellungen" : "wenn du schlechter stehst";
      facts.push([
        ((worst.per100 as number) / Math.max(mean, 0.1)) * 5,
        `Die meisten Fehler pro Zug machst du ${where} (${de(worst.per100 as number)} je 100 Züge).`,
      ]);
    }
  }

  // Punishing opponent errors.
  if (d.punish.chances >= 8 && d.punish.rate !== null && d.punish.rate < 50) {
    facts.push([
      (50 - d.punish.rate) / 3,
      `Nur ${Math.round(d.punish.rate)} % der Fehler deiner Gegner bestrafst du (${d.punish.punished} von ${d.punish.chances}). Hier liegen leichte Punkte.`,
    ]);
  }

  return facts.sort((a, b) => b[0] - a[0]).map(([, t]) => t);
}
