// Typed game record for statistics (port of src/backend/analysis/metrics/models.py).

import { analyzeGameTactics } from "../tactics";
import type { GameSummary, MoveData, StoredGame } from "../types";
import { QUALITY_NAMES } from "./constants";
import { detectSpeedCategory } from "./speed";
import { classifyTermination } from "./termination";

/**
 * A stored game as consumed by metrics/profile code. Every field is optional so
 * partial rows (e.g. imported but never analyzed) are accepted; summary_json and
 * moves_json may be parsed objects or the JSON strings the desktop app stores.
 */
export type RawGame = Partial<Omit<StoredGame, "summary_json" | "moves_json" | "chess960">> & {
  summary_json?: GameSummary | string | null;
  moves_json?: MoveData[] | string | null;
  chess960?: number | boolean | null;
};

export type Outcome = "win" | "draw" | "loss";

/** Normalized outcome for the given player color; null for unfinished games ('*'). */
export function outcomeFor(result: string | null | undefined, userColor: string): Outcome | null {
  const res = (result || "").trim();
  if (["1/2-1/2", "Draw", "draw", "1/2"].includes(res)) return "draw";
  if (res === "1-0") return userColor === "white" ? "win" : "loss";
  if (res === "0-1") return userColor === "black" ? "win" : "loss";
  return null;
}

export function parseSummary(raw: RawGame["summary_json"]): GameSummary | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as GameSummary) : null;
    } catch {
      return null;
    }
  }
  return raw;
}

export function parseMoves(raw: RawGame["moves_json"]): MoveData[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MoveData[]) : [];
  } catch {
    return [];
  }
}

export interface GameMeta {
  game_id: string | null;
  opponent: string;
  opponent_elo: string;
  date: string;
  result: string;
  user_color: string;
  speed_category: string;
  opening: string;
}

const needsTacticsRecompute = (t: Record<string, any> | null): boolean =>
  !t || !("phase_move_counts" in t) || !("clock_metrics" in t) || !("hung_pieces_details" in t);

/** Parsed, strongly-typed representation of a single game for statistical analysis. */
export class GameRecord {
  constructor(
    public game_id: string | null,
    public raw_game: RawGame,
    public user_color: "white" | "black",
    public result: string,
    public outcome: Outcome | null,
    public term_type: string,
    public draw_type: string | null,
    public speed: string,
    public opp_name: string,
    public opp_rating_str: string,
    public opp_elo: number,
    public opening: string,
    public eco: string,
    public game_acc: number,
    public quality_counts: Record<string, number>,
    public blunders_count: number,
    public tactics_data: Record<string, any> | null,
    public game_meta: GameMeta,
  ) {}

  get is_win(): boolean {
    return this.outcome === "win";
  }
  get is_draw(): boolean {
    return this.outcome === "draw";
  }
  get is_loss(): boolean {
    return this.outcome === "loss";
  }

  static fromDict(game: RawGame, userColor: "white" | "black"): GameRecord {
    const res = (game.result || "*").trim();
    const outcome = outcomeFor(res, userColor);
    const [termType, drawType] = classifyTermination(game, outcome === "draw");

    let speed: string;
    if (game.chess960) {
      speed = "Chess960";
    } else {
      speed = (game.speed_category || "").trim();
      if (!speed) speed = detectSpeedCategory(game.time_control, game.event);
      if (!speed) speed = "Other";
    }

    const oppName = (userColor === "white" ? game.black : game.white) ?? "Unknown";
    const oppRatingStr = String((userColor === "white" ? game.black_elo : game.white_elo) || "");
    const oppElo = /^\s*[+-]?\d+\s*$/.test(oppRatingStr) ? parseInt(oppRatingStr, 10) : 0;

    let opName = game.opening || "";
    let ecoCode = game.eco || "";
    if (!opName || !ecoCode) {
      const pgn = game.pgn || "";
      if (!opName && pgn.includes('Opening "')) {
        const m = /\[Opening "([^"]+)"\]/.exec(pgn);
        if (m) opName = m[1];
      }
      if (!ecoCode && pgn.includes('ECO "')) {
        const m = /\[ECO "([^"]+)"\]/.exec(pgn);
        if (m) ecoCode = m[1];
      }
    }

    let gameAcc = 0;
    const qualityCounts: Record<string, number> = Object.fromEntries(
      QUALITY_NAMES.map((k) => [k, 0]),
    );
    let blundersCount = 0;
    let tactics: Record<string, any> | null = null;

    const summary = parseSummary(game.summary_json);
    if (summary) {
      const sData = (summary[userColor] ?? {}) as Record<string, any>;
      const acc = Number(sData.accuracy ?? 0);
      if (Number.isFinite(acc) && acc > 0) gameAcc = acc;
      for (const qk of QUALITY_NAMES) qualityCounts[qk] = Number(sData[qk] ?? 0) || 0;
      blundersCount = Number(sData.Blunder ?? 0) || 0;
      tactics = (sData.tactics as Record<string, any> | undefined) ?? null;
    }

    // Recompute tactics if missing or stored in an older format.
    const moves = parseMoves(game.moves_json);
    if (moves.length && needsTacticsRecompute(tactics)) {
      try {
        tactics = analyzeGameTactics(moves, userColor, res, speed);
      } catch {
        // A corrupt move list must not break the statistics of all other games.
      }
    }

    if (!game.summary_json && tactics) {
      blundersCount = ((tactics.blunders_details as unknown[]) ?? []).length;
      qualityCounts.Blunder = blundersCount;
    }

    const gameMeta: GameMeta = {
      game_id: game.id ?? null,
      opponent: oppName,
      opponent_elo: oppRatingStr,
      date: game.date ?? "",
      result: res,
      user_color: userColor,
      speed_category: speed,
      opening: opName || game.opening || "",
    };

    return new GameRecord(
      game.id ?? null,
      game,
      userColor,
      res,
      outcome,
      termType,
      drawType,
      speed,
      oppName,
      oppRatingStr,
      oppElo,
      opName,
      ecoCode,
      gameAcc,
      qualityCounts,
      blundersCount,
      tactics,
      gameMeta,
    );
  }
}
