// What the game report shows beyond the review itself: the grade taken apart,
// the player's winning chance move by move, where this game stands among the
// player's own games of the same time control, and the best and the most
// expensive moment. Pure functions, so every figure on the report is tested.
import { getUserColor } from "../metrics/filters";
import { parseSummary, type RawGame } from "../metrics/models";
import type { MoveData } from "../types";
import { MIN_GROUP_GAMES } from "./evidence";
import { ERROR_CLASSES, userWp } from "./features";
import type { GameReview, KeyMoment } from "./models";

export interface Grade {
  /** 1.0 (best) … 6.0, null when the game has no accuracy. */
  value: number | null;
  /** "2,5" */
  text: string;
  /** "gut" */
  word: string;
}

/** "2,5 (gut)" from schoolGrade, taken apart for a big number and its word. */
export function parseGrade(grade: string): Grade {
  const m = /^(\d),(\d)\s*\(([^)]+)\)/.exec(grade.trim());
  if (!m) return { value: null, text: "–", word: "" };
  return { value: Number(`${m[1]}.${m[2]}`), text: `${m[1]},${m[2]}`, word: m[3] };
}

export interface WinPoint {
  /** 0 = the start position, n = after the n-th half move. */
  ply: number;
  /** The player's winning chance, 0..1. */
  wp: number;
}

/** The player's winning chance after every analysed move; unanalysed moves leave a gap the line bridges. */
export function winCurve(moves: MoveData[], isWhite: boolean): WinPoint[] {
  const out: WinPoint[] = [];
  if (moves[0]?.classification) out.push({ ply: 0, wp: userWp(moves[0].win_chance_before, isWhite) });
  moves.forEach((m, i) => {
    if (m.classification) out.push({ ply: i + 1, wp: userWp(m.win_chance_after, isWhite) });
  });
  return out;
}

export interface Standing {
  /** Other analysed games of the same time control. */
  games: number;
  /** Share of them played less accurately than this one, in percent. */
  better_than: number;
  /** The player's average accuracy over them. */
  average: number;
}

/**
 * Where this game's accuracy stands among the player's other games of the
 * same time control. A rank among nine games would mostly be chance, so it
 * takes as many games as a group comparison anywhere else in the app.
 */
export function ownStanding(accuracy: number, others: number[], min = MIN_GROUP_GAMES): Standing | null {
  if (!(accuracy > 0) || others.length < min) return null;
  const below = others.filter((a) => a < accuracy).length;
  const ties = others.filter((a) => a === accuracy).length;
  return {
    games: others.length,
    // A tie counts half, so a game exactly at the middle of the field stands at 50 %.
    better_than: ((2 * below + ties) * 50) / others.length,
    average: others.reduce((s, a) => s + a, 0) / others.length,
  };
}

/** The player's accuracy in every other analysed game of this time control. */
export function sameSpeedAccuracies(rows: RawGame[], usernames: string[], speed: string | null, exceptId: string): number[] {
  const out: number[] = [];
  for (const r of rows) {
    if (r.id === exceptId || r.deleted || (r.speed_category ?? null) !== speed) continue;
    const side = getUserColor(r, usernames);
    const summary = parseSummary(r.summary_json);
    if (!side || summary?.analysis_status !== "completed") continue;
    const acc = Number((summary[side] as { accuracy?: number } | undefined)?.accuracy ?? 0);
    if (acc > 0) out.push(acc);
  }
  return out;
}

const SHINE_RANK: Record<string, number> = { Brilliant: 2, Great: 1 };

/**
 * The player's best moment (a brilliant move before a great one, then the
 * largest gain) and the most expensive one (the error that cost the most
 * winning chance). Either is null when the game has none.
 */
export function reportMoments(review: GameReview): { best: KeyMoment | null; worst: KeyMoment | null } {
  const own = review.key_moments.filter((k) => k.by_user);
  const gain = (k: KeyMoment) => k.wp_after - k.wp_before;
  const rank = (k: KeyMoment) => SHINE_RANK[k.classification] ?? 0;
  const better = (k: KeyMoment, b: KeyMoment) => rank(k) > rank(b) || (rank(k) === rank(b) && gain(k) > gain(b));
  const best = own.filter((k) => rank(k) > 0 || gain(k) > 0).reduce<KeyMoment | null>((b, k) => (!b || better(k, b) ? k : b), null);
  const worst = own.filter((k) => ERROR_CLASSES.has(k.classification) && gain(k) < 0).reduce<KeyMoment | null>((w, k) => (!w || gain(k) < gain(w) ? k : w), null);
  return { best, worst };
}
