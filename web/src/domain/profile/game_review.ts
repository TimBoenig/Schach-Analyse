// Per-game review: what went well, what went wrong, key moments and lessons,
// written in German from the tracked player's perspective
// (port of src/backend/analysis/profile/game_review.py).

import { trClassification, trPhase, trPhaseIn, trPiece } from "../i18n";
import { type Outcome, outcomeFor, parseMoves, parseSummary, type RawGame } from "../metrics/models";
import { analyzeGameTactics } from "../tactics";
import { Board } from "../tactics/board";
import { classifyGamePhase } from "../tactics/phase";
import type { GameAnalysis, GameSummary, MoveData } from "../types";
import {
  ERROR_CLASSES,
  GOOD_CLASSES,
  moveLabel,
  SERIOUS_ERROR_CLASSES,
  sanForUci,
  userWp,
} from "./features";
import type { GameReview, KeyMoment, PhaseReview } from "./models";
import { fmt, pyRound } from "./num";

type Dict = Record<string, any>;

export const MAX_KEY_MOMENTS = 6;
// Swings smaller than 12 points of winning chance are rarely decisive enough to discuss.
export const KEY_MOMENT_MIN_SWING = 0.12;

const GRADE_WORDS: Record<number, string> = {
  1: "sehr gut",
  2: "gut",
  3: "befriedigend",
  4: "ausreichend",
  5: "mangelhaft",
  6: "ungenügend",
};

/** Map game accuracy to a German school grade (1,0 = sehr gut … 6,0 = ungenügend). */
export function schoolGrade(accuracy: number): string {
  if (accuracy <= 0) return "–";
  let value = 1 + (95 - accuracy) / 8;
  value = Math.max(1, Math.min(6, pyRound(value * 2) / 2));
  const word = GRADE_WORDS[Math.trunc(pyRound(value - 0.01)) || 1];
  return `${value.toFixed(1).replace(".", ",")} (${word})`;
}

const pctText = (x: number) => `${fmt(x * 100, 0)} %`;

/** Minimal view of a game the review needs; built from GameAnalysis or a stored row. */
interface ReviewGame {
  game_id: string;
  white: string;
  black: string;
  result: string;
  speed_category: string | null;
  chess960: boolean;
  moves: MoveData[];
  summary: GameSummary;
}

function toReviewGame(game: GameAnalysis | RawGame): ReviewGame {
  if ("metadata" in game && game.metadata) {
    const g = game as GameAnalysis;
    return {
      game_id: g.game_id,
      white: g.metadata.white,
      black: g.metadata.black,
      result: g.metadata.result,
      speed_category: g.metadata.speed_category,
      chess960: Boolean(g.metadata.chess960),
      moves: g.moves,
      summary: g.summary ?? {},
    };
  }
  const r = game as RawGame;
  return {
    game_id: r.id ?? "",
    white: r.white ?? "?",
    black: r.black ?? "?",
    result: r.result ?? "*",
    speed_category: r.speed_category ?? null,
    chess960: Boolean(r.chess960),
    moves: parseMoves(r.moves_json),
    summary: parseSummary(r.summary_json) ?? {},
  };
}

function sideAccuracy(summary: GameSummary, color: string): number {
  const side = summary[color];
  if (side && typeof side === "object") {
    const v = Number((side as Dict).accuracy || 0);
    return Number.isFinite(v) ? v : 0;
  }
  return 0;
}

function phaseComment(name: string, acc: number | null, errors: number, moves: number): string {
  if (acc === null || acc === undefined || moves === 0) {
    return name !== "Eröffnung" ? `Kein ${name} in dieser Partie.` : "Nur Buchzüge.";
  }
  if (acc >= 90 && errors === 0) return "Sehr sauber gespielt.";
  if (acc >= 80 && errors <= 1) return "Solide, kaum Ungenauigkeiten.";
  if (errors >= 2) return `${errors} schwere Fehler – hier hast du die meisten Punkte abgegeben.`;
  return "Mehrere ungenaue Züge, hier steckt Verbesserungspotenzial.";
}

const moverIsWhite = (m: MoveData, idx: number): boolean =>
  m.fen_before ? ` ${m.fen_before} `.includes(" w ") : idx % 2 === 0;

/**
 * Create a review for an analyzed game; returns null if the game is not analyzed.
 * Accepts the in-memory GameAnalysis or a stored game row.
 */
export function buildGameReview(
  gameInput: GameAnalysis | RawGame,
  userColor: "white" | "black",
): GameReview | null {
  const game = toReviewGame(gameInput);
  if (!game.moves.length || !game.moves.some((m) => m.classification)) return null;

  const isWhite = userColor === "white";
  const oppColor = isWhite ? "black" : "white";
  const result = game.result || "*";
  const speed = game.speed_category || "Blitz";
  const tactics: Dict = analyzeGameTactics(game.moves, userColor, result, speed);

  const acc = sideAccuracy(game.summary, userColor);
  const oppAcc = sideAccuracy(game.summary, oppColor);
  const outcome = outcomeFor(result, userColor);
  const opponent = isWhite ? game.black : game.white;
  const resultText =
    outcome === "win"
      ? `Sieg gegen ${opponent}`
      : outcome === "draw"
        ? `Remis gegen ${opponent}`
        : outcome === "loss"
          ? `Niederlage gegen ${opponent}`
          : `Partie gegen ${opponent}`;

  const userMoves: Array<[number, MoveData]> = [];
  game.moves.forEach((m, idx) => {
    if (moverIsWhite(m, idx) === isWhite && m.classification) userMoves.push([idx, m]);
  });

  const counts: Record<string, number> = {};
  for (const [, m] of userMoves) counts[m.classification] = (counts[m.classification] ?? 0) + 1;

  const review: GameReview = {
    game_id: game.game_id,
    user_color: userColor,
    headline: "",
    result_text: resultText,
    accuracy: acc,
    opponent_accuracy: oppAcc,
    grade: schoolGrade(acc),
    phases: [],
    key_moments: [],
    positives: [],
    negatives: [],
    lessons: [],
    move_counts: counts,
    turning_point: null,
  };

  review.phases = phases(tactics, userMoves);
  review.key_moments = keyMoments(game, isWhite);
  review.turning_point = turningPoint(review.key_moments, outcome);
  [review.positives, review.negatives, review.lessons] = assess(
    tactics,
    review,
    outcome,
    acc,
    oppAcc,
  );
  review.headline = headline(outcome, acc, counts);
  return review;
}

function phases(tactics: Dict, userMoves: Array<[number, MoveData]>): PhaseReview[] {
  const perPhase: Record<string, string[]> = { opening: [], middlegame: [], endgame: [] };
  for (const [idx, m] of userMoves) {
    let board: Board;
    try {
      board = m.fen_before ? new Board(m.fen_before) : new Board();
    } catch {
      continue;
    }
    perPhase[classifyGamePhase(board, idx, Boolean(m.is_book_move))].push(m.classification);
  }

  const accs: Dict = tactics.phase_accuracies ?? {};
  return Object.entries(perPhase).map(([phase, classes]) => {
    const acc: number | null = accs[phase] ?? null;
    const errors = classes.filter((c) => SERIOUS_ERROR_CLASSES.has(c)).length;
    const nonBook = classes.filter((c) => c !== "Book").length;
    const name = trPhase(phase);
    return {
      phase,
      name,
      accuracy: acc,
      moves: nonBook,
      errors,
      grade: acc ? schoolGrade(acc) : "–",
      comment: phaseComment(name, acc, errors, nonBook),
    };
  });
}

function keyMoments(game: ReviewGame, isWhite: boolean): KeyMoment[] {
  const candidates: Array<[number, KeyMoment]> = [];
  game.moves.forEach((m, idx) => {
    if (!m.classification || m.classification === "Book") return;
    const mWhite = moverIsWhite(m, idx);
    const byUser = mWhite === isWhite;
    const wpB = userWp(m.win_chance_before, isWhite);
    const wpA = userWp(m.win_chance_after, isWhite);
    const swing = Math.abs(wpA - wpB);
    const brilliant = byUser && (m.classification === "Brilliant" || m.classification === "Great");
    if (swing < KEY_MOMENT_MIN_SWING && !brilliant) return;

    const label = moveLabel(m.move_number, mWhite, m.san);
    let bestSan = "";
    if (m.best_move && m.best_move !== m.uci) bestSan = sanForUci(m.fen_before, m.best_move, game.chess960);
    const clsDe = trClassification(m.classification);

    let title: string;
    let text: string;
    if (byUser && ERROR_CLASSES.has(m.classification)) {
      title = `${label} – ${clsDe}`;
      text = `Deine Gewinnchance fiel von ${pctText(wpB)} auf ${pctText(wpA)}.`;
      if (bestSan) text += ` Besser war ${bestSan}.`;
    } else if (byUser && brilliant) {
      title = `${label} – ${clsDe}!`;
      text = m.explanation || "Ein starker Zug, den die Engine besonders hervorhebt.";
      text += ` Gewinnchance jetzt ${pctText(wpA)}.`;
    } else if (byUser && wpA >= wpB) {
      title = `${label} – ${clsDe}`;
      text = `Du hast die Chance genutzt: Gewinnchance von ${pctText(wpB)} auf ${pctText(wpA)}.`;
    } else if (byUser) {
      // A large drop without an error label: the position was already slipping.
      return;
    } else if (wpA > wpB) {
      title = `${label} – Fehler des Gegners`;
      text = `Dein Gegner hat gepatzt: deine Gewinnchance stieg auf ${pctText(wpA)}.`;
      if (bestSan) text += ` (Er hätte ${bestSan} spielen sollen.)`;
    } else {
      title = `${label} – starker Gegnerzug`;
      text = `Dein Gegner fand einen starken Zug, deine Gewinnchance sank auf ${pctText(wpA)}.`;
    }
    candidates.push([
      swing + (brilliant ? 0.3 : 0),
      {
        ply_index: idx,
        move_label: label,
        by_user: byUser,
        classification: m.classification,
        title,
        text,
        wp_before: pyRound(wpB, 3),
        wp_after: pyRound(wpA, 3),
        best_move_san: bestSan,
      },
    ]);
  });

  return candidates
    .sort((a, b) => b[0] - a[0])
    .slice(0, MAX_KEY_MOMENTS)
    .map(([, m]) => m)
    .sort((a, b) => a.ply_index - b.ply_index);
}

function turningPoint(moments: KeyMoment[], outcome: Outcome | null): KeyMoment | null {
  if (!moments.length || outcome === null || outcome === "draw") return null;
  const pick = (list: KeyMoment[], gain: (m: KeyMoment) => number) =>
    list.reduce<KeyMoment | null>((best, m) => (best === null || gain(m) > gain(best) ? m : best), null);
  if (outcome === "loss") {
    return pick(
      moments.filter((m) => m.wp_after < m.wp_before),
      (m) => m.wp_before - m.wp_after,
    );
  }
  return pick(
    moments.filter((m) => m.wp_after > m.wp_before),
    (m) => m.wp_after - m.wp_before,
  );
}

const unique = (items: string[]) => [...new Set(items)];

function assess(
  tactics: Dict,
  review: GameReview,
  outcome: Outcome | null,
  acc: number,
  oppAcc: number,
): [string[], string[], string[]] {
  const pos: string[] = [];
  const neg: string[] = [];
  const lessons: string[] = [];
  const counts = review.move_counts;
  const blunders = counts.Blunder ?? 0;
  const mistakes = counts.Mistake ?? 0;
  const misses = counts.Miss ?? 0;
  const good = [...GOOD_CLASSES].reduce((s, c) => s + (counts[c] ?? 0), 0);
  const total = Object.entries(counts)
    .filter(([k]) => k !== "Book")
    .reduce((s, [, v]) => s + v, 0);

  if (acc >= 85) {
    pos.push(`Hohe Genauigkeit von ${fmt(acc, 1)} % – du hast die meisten Züge sehr gut gewählt.`);
  } else if (acc && oppAcc && acc > oppAcc + 5) {
    pos.push(
      `Du hast genauer gespielt als dein Gegner (${fmt(acc, 1)} % gegenüber ${fmt(oppAcc, 1)} %).`,
    );
  }
  if (total && good / total >= 0.6) pos.push(`${good} von ${total} Zügen waren beste oder exzellente Züge.`);
  if (counts.Brilliant || counts.Great) {
    pos.push(
      `Starke Funde: ${counts.Brilliant ?? 0}× brillant, ${counts.Great ?? 0}× großartig.`,
    );
  }
  if (blunders === 0 && total >= 10) pos.push("Kein einziger Patzer in der ganzen Partie.");

  for (const p of review.phases) {
    if (p.accuracy && p.accuracy >= 88 && p.moves >= 5 && p.errors === 0) {
      pos.push(`${p.name} sehr sauber gespielt (${fmt(p.accuracy, 0)} %).`);
    }
  }

  const adv: Dict = tactics.advantage_metrics ?? {};
  if (adv.converted_advantage) pos.push("Deinen klaren Vorteil hast du sicher in einen Sieg umgewandelt.");
  if (adv.comeback_wins) {
    pos.push("Starke Moral: Aus einer verlorenen Stellung hast du die Partie noch gewonnen.");
  } else if (adv.comeback_draws) {
    pos.push("Aus einer verlorenen Stellung hast du noch ein Remis gerettet.");
  }

  const hang: Dict = tactics.hanging_metrics ?? {};
  if (hang.opponent_hanging_captured) {
    pos.push(`${hang.opponent_hanging_captured}× hängendes Material des Gegners eingesammelt.`);
  }

  // --- Negatives & lessons ---
  if (blunders) {
    neg.push(
      blunders === 1
        ? "1 Patzer hat die Stellung deutlich verschlechtert."
        : `${blunders} Patzer – jeder davon hat die Stellung deutlich verschlechtert.`,
    );
  }
  if (mistakes) {
    neg.push(
      mistakes === 1
        ? "1 Fehler hat dich Vorteil gekostet."
        : `${mistakes} Fehler haben dich Vorteil gekostet.`,
    );
  }
  if (misses) {
    neg.push(`${misses}× eine klare Chance verpasst, den Gegner zu bestrafen.`);
    lessons.push("Nach jedem gegnerischen Zug prüfen: Hängt jetzt etwas? Gibt es Schachs oder Schläge?");
  }

  const hung: number = hang.total_hung ?? 0;
  if (hung) {
    const byPiece = Object.entries((hang.by_piece ?? {}) as Record<string, number>).filter(
      ([, v]) => v,
    );
    const pieces = byPiece.map(([k, v]) => `${v}× ${trPiece(k)}`).join(", ");
    neg.push(`Figuren ungedeckt gelassen bzw. eingestellt: ${pieces || hung}.`);
    lessons.push("Vor jedem Zug den Blunder-Check: Welche meiner Figuren sind danach ungedeckt?");
  }

  if (adv.thrown_losses) {
    neg.push("Eine klar gewonnene Stellung (+3) ging noch verloren.");
    lessons.push("Mit großem Vorteil: Figuren tauschen, Gegenspiel verhindern und keine Hektik.");
  } else if (adv.squandered_draws) {
    neg.push("Eine gewonnene Stellung endete nur remis.");
    lessons.push("Mit Vorteil die Technik üben: Spiele solche Stellungen gegen die Engine zu Ende.");
  }

  // max() keeps the first phase on ties, like Python.
  const worstPhase = review.phases.reduce<PhaseReview | null>(
    (w, p) => (w === null || p.errors > w.errors ? p : w),
    null,
  );
  if (worstPhase && worstPhase.errors >= 2) {
    neg.push(`Die meisten schweren Fehler passierten ${trPhaseIn(worstPhase.phase)}.`);
    const phaseLesson: Record<string, string> = {
      opening: "Lerne die Pläne deiner Eröffnung, nicht nur die ersten Züge.",
      middlegame: "Im Mittelspiel vor jedem Zug Drohungen und Kandidatenzüge sammeln.",
      endgame: "Grundendspiele wiederholen und den König im Endspiel aktivieren.",
    };
    lessons.push(phaseLesson[worstPhase.phase]);
  }

  const cm: Dict = tactics.clock_metrics ?? {};
  if (cm.trouble_blunders) {
    neg.push(`${cm.trouble_blunders} Patzer in Zeitnot.`);
    lessons.push("Teile deine Zeit besser ein, damit kritische Momente nicht in Zeitnot fallen.");
  }
  const qualityPace: Dict = cm.quality_timed_moves ?? {};
  if (
    qualityPace.blunder &&
    ((cm.quality_time_spent ?? {}).blunder ?? 0) / Math.max(1, qualityPace.blunder) < 4
  ) {
    lessons.push("Deine Patzer kamen schnell – in angespannten Stellungen bewusst langsamer ziehen.");
  }

  if (review.turning_point && outcome === "loss") {
    const tp = review.turning_point;
    lessons.unshift(
      `Wendepunkt war ${tp.move_label}: Hier lohnt es sich, die Stellung nachzuspielen` +
        (tp.best_move_san && tp.by_user ? ` und ${tp.best_move_san} zu verstehen.` : "."),
    );
  }

  if (!neg.length) neg.push("Keine größeren Schwächen – eine sehr saubere Partie.");
  if (!lessons.length) lessons.push("Weiter so! Schau dir die Schlüsselmomente an, um noch präziser zu werden.");
  if (!pos.length) pos.push("Du hast die Partie zu Ende gekämpft – analysiere die Schlüsselmomente unten.");
  return [unique(pos), unique(neg), unique(lessons).slice(0, 5)];
}

function headline(outcome: Outcome | null, acc: number, counts: Record<string, number>): string {
  const blunders = counts.Blunder ?? 0;
  if (outcome === "win") {
    if (acc >= 90) return "Eine Glanzleistung – präzise von Anfang bis Ende.";
    if (blunders) return "Gewonnen, aber nicht fehlerfrei – hier steckt noch Potenzial.";
    return "Verdienter Sieg mit solidem Spiel.";
  }
  if (outcome === "loss") {
    if (acc >= 80) return "Knappe Niederlage trotz guter Leistung.";
    if (blunders) {
      return blunders === 1
        ? "Ein Patzer hat die Partie entschieden."
        : `${blunders} Patzer haben die Partie entschieden.`;
    }
    return "Der Gegner war heute genauer.";
  }
  if (outcome === "draw") return "Remis – schau dir an, wo mehr drin war.";
  return "Partie-Review";
}
