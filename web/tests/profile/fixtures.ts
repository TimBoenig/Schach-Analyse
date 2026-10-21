// Synthetic analyzed games for player-profile and game-review tests
// (port of tests/profile_fixtures.py). Games follow a fixed legal line; tests
// inject classifications and White-perspective win chances per ply.

import { Board, moveToUci } from "../../src/domain/tactics/board";
import {
  type Classification,
  emptyMetadata,
  emptyMove,
  type GameAnalysis,
  type MoveData,
} from "../../src/domain/types";
import type { RawGame } from "../../src/domain/metrics/models";

export const LINE = [
  "e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d4", "exd4", "cxd4", "Bb4+", "Nc3",
  "Nxe4", "O-O", "Bxc3", "d5", "Bf6", "Re1", "Ne7", "Rxe4", "d6", "Bg5", "Bxg5", "Nxg5", "h6",
];

export type Events = Record<number, [Classification, number]>;

/**
 * Move dicts for LINE. `events` maps ply index -> [classification, White-perspective
 * win chance AFTER that move]; the win chance otherwise stays put.
 */
export function buildMoves(events: Events = {}): MoveData[] {
  const board = new Board();
  let wp = 0.5;
  return LINE.map((san, idx) => {
    const move = board.parseSan(san);
    const legal = board.legalMoves();
    const alt = legal.find((m) => m.from !== move.from || m.to !== move.to) ?? move;
    const [cls, wpAfter] = events[idx] ?? (["Best", wp] as [Classification, number]);
    const md = emptyMove({
      move_number: Math.floor(idx / 2) + 1,
      ply: idx + 1,
      san,
      uci: moveToUci(move),
      fen_before: board.fen(),
      best_move: cls === "Best" ? moveToUci(move) : moveToUci(alt),
      win_chance_before: wp,
      win_chance_after: wpAfter,
      eval_before_cp: Math.trunc((wp - 0.5) * 1200),
      eval_after_cp: Math.trunc((wpAfter - 0.5) * 1200),
      classification: cls,
      time_spent: 5,
      time_left: 300 - idx * 5,
    });
    board.push(move);
    wp = wpAfter;
    return md;
  });
}

interface RowOpts {
  userWhite?: boolean;
  result?: string;
  accuracy?: number;
  utc?: string;
  opening?: string;
  user?: string;
}

export function gameRow(gameId: string, moves: MoveData[], opts: RowOpts = {}): RawGame {
  const {
    userWhite = true,
    result = "1-0",
    accuracy = 80,
    utc = "2026.06.01 18:00:00",
    opening = "Italian Game",
    user = "Tim",
  } = opts;
  const [date, time] = utc.split(" ");
  const [white, black] = userWhite ? [user, "Gegner"] : ["Gegner", user];
  const counts: Record<string, Record<string, number>> = {
    white: { accuracy },
    black: { accuracy },
  };
  moves.forEach((m, i) => {
    const side = counts[i % 2 === 0 ? "white" : "black"];
    side[m.classification] = (side[m.classification] ?? 0) + 1;
  });
  const pgn =
    `[White "${white}"]\n[Black "${black}"]\n[Result "${result}"]\n` +
    `[UTCDate "${date}"]\n[UTCTime "${time}"]\n\n${LINE.join(" ")} ${result}`;
  return {
    id: gameId,
    white,
    black,
    result,
    date,
    white_elo: "1500",
    black_elo: "1500",
    speed_category: "Rapid",
    opening,
    eco: "C54",
    source: "chesscom",
    chess960: 0,
    pgn,
    // Stored as JSON strings like the desktop DB, to cover that input path too.
    moves_json: JSON.stringify(moves),
    summary_json: JSON.stringify({ ...counts, analysis_status: "completed" }),
  };
}

export function gameAnalysis(moves: MoveData[], result = "0-1", userWhite = true): GameAnalysis {
  const [white, black] = userWhite ? ["Tim", "Gegner"] : ["Gegner", "Tim"];
  return {
    game_id: "review-game",
    metadata: emptyMetadata({ white, black, result, speed_category: "Rapid" }),
    moves: moves.map((m) => ({ ...m })),
    summary: {
      white: { accuracy: 70, acpl: 0, move_count: 0, accuracies: [], win_percents: [] },
      black: { accuracy: 85, acpl: 0, move_count: 0, accuracies: [], win_percents: [] },
    },
    pgn_content: "",
  };
}

// Opponent (Black) blunders at ply 15 -> White winning; user (White) throws it away at ply 16.
export const THROWN_WIN: Events = { 15: ["Blunder", 0.85], 16: ["Blunder", 0.25] };
// Opponent blunders at ply 15 and the user keeps the advantage.
export const PUNISHED: Events = { 15: ["Blunder", 0.85], 16: ["Best", 0.86] };

const pad = (n: number) => String(n).padStart(2, "0");

/** `nThrown` lost games (May) where Tim throws a won position away, then `nClean` won games (June). */
export function profileGames(nThrown: number, nClean: number): RawGame[] {
  const rows: RawGame[] = [];
  for (let i = 0; i < nThrown; i++) {
    rows.push(gameRow(`t${i}`, buildMoves(THROWN_WIN), { result: "0-1", utc: `2026.05.${pad(i + 1)} 18:00:00` }));
  }
  for (let i = 0; i < nClean; i++) {
    rows.push(gameRow(`c${i}`, buildMoves(PUNISHED), { result: "1-0", utc: `2026.06.${pad(i + 1)} 18:00:00` }));
  }
  return rows;
}
