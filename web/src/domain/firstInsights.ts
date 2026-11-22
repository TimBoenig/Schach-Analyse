// What Lucena can honestly say while a fresh import is still arriving and the
// engine is still running: short facts counted from the game records, and,
// once the first games are analysed, the first real finding. Every sentence
// here is a count or a quote from the user's own games, never a verdict that
// would need more evidence (no "better than", no "weakness").
import { Chess } from "chess.js";
import { locale, t } from "../i18n";

import { getUserColor, isBulletGame } from "./metrics";
import type { GameAnalysis, MoveData } from "./types";

/** Fewer games than this and a "most played" fact is noise, so it stays unsaid. */
const MIN_REPEAT = 3;
/** Per colour, so a points share is not read off two games. */
const MIN_PER_COLOR = 5;

// One whole sentence per speed, so each language can phrase it its own way.
const SPEED_SENTENCE: Record<string, (n: string, total: string) => string> = {
  bullet: (n, total) => t("Die meisten Partien spielst du im Bullet: {n} von {total}.", { n, total }),
  blitz: (n, total) => t("Die meisten Partien spielst du im Blitz: {n} von {total}.", { n, total }),
  rapid: (n, total) => t("Die meisten Partien spielst du im Schnellschach: {n} von {total}.", { n, total }),
  classical: (n, total) => t("Die meisten Partien spielst du mit langer Bedenkzeit: {n} von {total}.", { n, total }),
  daily: (n, total) => t("Die meisten Partien spielst du im Fernschach: {n} von {total}.", { n, total }),
};

const n = (v: number) => v.toLocaleString(locale());

function dateKey(g: GameAnalysis): string {
  return `${g.metadata.date || ""} ${g.metadata.headers?.UTCTime || g.metadata.headers?.EndTime || ""}`;
}

function top<T extends string>(counts: Map<T, number>): [T, number] | null {
  let best: [T, number] | null = null;
  for (const e of counts) if (!best || e[1] > best[1]) best = e;
  return best;
}

/** "Italian Game: Two Knights Defense" counts as "Italian Game", so one opening is not split by its variations. */
export function openingFamily(name: string | null | undefined): string {
  return (name || "").split(/[:,]/)[0].trim();
}

/**
 * Short facts for the "Lucena denkt …" moments of the first start, in a fixed
 * order. Each needs enough games to be more than an accident.
 */
export function firstThoughts(games: GameAnalysis[], name: string): string[] {
  const mine = games.map((g) => ({ g, color: getUserColor(g.metadata, [name]) })).filter((x): x is { g: GameAnalysis; color: "white" | "black" } => x.color !== null);
  if (!mine.length) return [];
  const out: string[] = [];

  const openings = new Map<string, number>();
  for (const { g } of mine) {
    const o = openingFamily(g.metadata.opening);
    if (o && o !== "?") openings.set(o, (openings.get(o) ?? 0) + 1);
  }
  const op = top(openings);
  if (op && op[1] >= MIN_REPEAT) out.push(t("Am häufigsten auf dem Brett: {n}, in {n2} Partien.", { n: op[0], n2: n(op[1]) }));

  const points = { white: { pts: 0, games: 0 }, black: { pts: 0, games: 0 } };
  for (const { g, color } of mine) {
    const r = g.metadata.result;
    if (r !== "1-0" && r !== "0-1" && r !== "1/2-1/2") continue;
    points[color].games++;
    points[color].pts += r === "1/2-1/2" ? 0.5 : (r === "1-0") === (color === "white") ? 1 : 0;
  }
  if (points.white.games >= MIN_PER_COLOR && points.black.games >= MIN_PER_COLOR) {
    const share = (c: "white" | "black") => Math.round((points[c].pts / points[c].games) * 100);
    out.push(t("Mit Weiß holst du {share} % der Punkte, mit Schwarz {share2} %.", { share: share("white"), share2: share("black") }));
  }

  const speeds = new Map<string, number>();
  for (const { g } of mine) {
    const s = (g.metadata.speed_category || "").toLowerCase() || (isBulletGame(g.metadata) ? "bullet" : "");
    if (SPEED_SENTENCE[s]) speeds.set(s, (speeds.get(s) ?? 0) + 1);
  }
  const sp = top(speeds);
  if (sp && sp[1] >= MIN_REPEAT && speeds.size > 1) out.push(SPEED_SENTENCE[sp[0]](n(sp[1]), n(mine.length)));

  let run = 0;
  let best = 0;
  for (const { g, color } of [...mine].sort((a, b) => dateKey(a.g).localeCompare(dateKey(b.g)))) {
    const r = g.metadata.result;
    const won = (r === "1-0" && color === "white") || (r === "0-1" && color === "black");
    run = won ? run + 1 : 0;
    best = Math.max(best, run);
  }
  if (best >= MIN_REPEAT) out.push(t("Deine längste Siegesserie hier: {n} Partien am Stück.", { n: n(best) }));

  const rivals = new Map<string, number>();
  for (const { g, color } of mine) {
    const opp = color === "white" ? g.metadata.black : g.metadata.white;
    if (opp) rivals.set(opp, (rivals.get(opp) ?? 0) + 1);
  }
  const rv = top(rivals);
  if (rv && rv[1] >= MIN_REPEAT) out.push(t("Gegen {n} hast du {n2}-mal gespielt. Dein häufigster Gegner.", { n: rv[0], n2: n(rv[1]) }));

  return out;
}

export interface CostlyMove {
  gameId: string;
  opponent: string;
  /** Ply index into the game's move list, for the analysis link. */
  ply: number;
  moveNumber: number;
  /** Whether the user had White, for "19." against "19...". */
  white: boolean;
  san: string;
  /** The engine's move instead, in SAN; null when it cannot be read. */
  better: string | null;
  /** The user's winning chances before and after, in percent. */
  before: number;
  after: number;
}

export interface FirstFinding {
  /** Games with a finished engine pass. */
  analysed: number;
  blunders: number;
  mistakes: number;
  /** The single move that cost the most winning chances. */
  costliest: CostlyMove | null;
  /** The game with the highest accuracy, when at least one has one. */
  bestGame: { gameId: string; opponent: string; accuracy: number } | null;
}

const COSTLY = new Set(["Blunder", "Mistake", "Miss"]);

function sanOf(m: MoveData): string | null {
  if (!m.best_move || !m.fen_before) return null;
  try {
    const g = new Chess(m.fen_before);
    return g.move({ from: m.best_move.slice(0, 2), to: m.best_move.slice(2, 4), promotion: m.best_move[4] }).san;
  } catch {
    return null;
  }
}

/**
 * The first finding after the engine's first pass: how many mistakes it
 * found and the one move that turned the most. Null until a game is done.
 */
export function firstFinding(games: GameAnalysis[], name: string): FirstFinding | null {
  const out: FirstFinding = { analysed: 0, blunders: 0, mistakes: 0, costliest: null, bestGame: null };
  let worst = 0;
  for (const g of games) {
    if (g.summary?.analysis_status !== "completed" || !g.moves?.length) continue;
    const color = getUserColor(g.metadata, [name]);
    if (!color) continue;
    out.analysed++;
    const opponent = color === "white" ? g.metadata.black : g.metadata.white;
    const side = g.summary[color];
    if (side) {
      out.blunders += Number(side.Blunder) || 0;
      out.mistakes += Number(side.Mistake) || 0;
      const acc = Number(side.accuracy);
      if (Number.isFinite(acc) && acc > 0 && (!out.bestGame || acc > out.bestGame.accuracy)) out.bestGame = { gameId: g.game_id, opponent, accuracy: Math.round(acc) };
    }
    g.moves.forEach((m, i) => {
      // The side to move comes from the position, so games from a set-up position count right too.
      const mover = (m.fen_before || "").split(" ")[1] === "b" ? "black" : "white";
      if (mover !== color || !COSTLY.has(m.classification)) return;
      const mine = (wp: number) => (color === "white" ? wp : 1 - wp);
      const drop = mine(m.win_chance_before) - mine(m.win_chance_after);
      if (drop <= worst) return;
      worst = drop;
      out.costliest = {
        gameId: g.game_id,
        opponent,
        ply: i + 1,
        moveNumber: m.move_number,
        white: color === "white",
        san: m.san,
        better: sanOf(m),
        before: Math.round(mine(m.win_chance_before) * 100),
        after: Math.round(mine(m.win_chance_after) * 100),
      };
    });
  }
  return out.analysed ? out : null;
}
