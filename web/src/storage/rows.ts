// Port of GamesRepo._prepare_game_analysis_row / row_to_game_analysis:
// converts between the in-memory GameAnalysis and the persisted StoredGame row.
// Tactics and termination are computed here, before storage, like the desktop app.
import { parsePgnText } from "../domain/pgn";
import { detectSpeedCategory } from "../domain/pgn";
import { analyzeGameTactics } from "../domain/tactics";
import { detectTermination } from "../domain/termination";
import { emptyMetadata, type GameAnalysis, type GameSummary, type MoveData, type StoredGame } from "../domain/types";

function analysisStatus(game: GameAnalysis): "completed" | "paused" | "not_started" {
  const s = game.summary?.analysis_status;
  if (s === "completed" || s === "paused" || s === "not_started") return s;
  const total = game.moves.length;
  const analyzed = game.moves.filter((m) => m.classification).length;
  if (!total || !analyzed) return "not_started";
  return analyzed >= total ? "completed" : "paused";
}

export function toStoredGame(game: GameAnalysis, timestamp?: number): StoredGame {
  const meta = game.metadata;
  const speed = meta.speed_category || "Blitz";
  const moves = game.moves.map((m) => ({ ...m }));
  const summary: GameSummary = { ...(game.summary ?? {}) };
  summary.white = { ...(summary.white ?? ({} as any)) };
  summary.black = { ...(summary.black ?? ({} as any)) };
  summary.analysis_status = analysisStatus(game);
  summary.analyzed_moves = moves.filter((m) => m.classification).length;
  summary.total_moves = moves.length;

  // Tactics need engine evaluations; skipping them for unanalysed games keeps
  // bulk imports of hundreds of games responsive (the profile recomputes on demand).
  const analysed = summary.analyzed_moves > 0;
  const tw: Record<string, any> = analysed ? analyzeGameTactics(moves, "white", meta.result, speed) : {};
  const tb: Record<string, any> = analysed ? analyzeGameTactics(moves, "black", meta.result, speed) : {};
  if (analysed) {
    summary.white!.tactics = tw;
    summary.black!.tactics = tb;
  }

  if (!meta.termination_mode || !meta.termination_description) {
    const [mode, desc] = detectTermination(meta.headers, moves, meta.starting_fen, meta.chess960);
    meta.termination_mode = mode;
    meta.termination_description = desc;
  }
  if (!meta.termination || ["", "normal", "unknown"].includes(meta.termination.trim().toLowerCase())) {
    meta.termination = meta.termination_description;
  }

  const count = (t: Record<string, any>, c: string) =>
    ((t.brilliancies ?? []) as { classification?: string }[]).filter((b) => b.classification === c).length;

  return {
    id: game.game_id,
    white: meta.white,
    black: meta.black,
    result: meta.result,
    date: meta.date,
    event: meta.event,
    white_elo: meta.white_elo,
    black_elo: meta.black_elo,
    time_control: meta.time_control,
    speed_category: speed,
    eco: meta.eco,
    opening: meta.opening,
    termination: meta.termination,
    termination_mode: meta.termination_mode,
    source: meta.source,
    starting_fen: meta.starting_fen,
    chess960: meta.chess960 ? 1 : 0,
    book_exit_ply: tw.book_exit_ply ?? null,
    white_opening_acc: tw.phase_accuracies?.opening ?? null,
    black_opening_acc: tb.phase_accuracies?.opening ?? null,
    white_middlegame_acc: tw.phase_accuracies?.middlegame ?? null,
    black_middlegame_acc: tb.phase_accuracies?.middlegame ?? null,
    white_endgame_acc: tw.phase_accuracies?.endgame ?? null,
    black_endgame_acc: tb.phase_accuracies?.endgame ?? null,
    white_pieces_hung: tw.hanging_metrics?.total_hung ?? 0,
    black_pieces_hung: tb.hanging_metrics?.total_hung ?? 0,
    white_brilliant_count: count(tw, "Brilliant"),
    black_brilliant_count: count(tb, "Brilliant"),
    white_great_count: count(tw, "Great"),
    black_great_count: count(tb, "Great"),
    pgn: game.pgn_content,
    summary_json: summary,
    moves_json: moves,
    timestamp: timestamp ?? Date.now() / 1000,
    updated_at: Date.now(),
  };
}

export function fromStoredGame(row: StoredGame): GameAnalysis {
  const metadata = emptyMetadata({
    white: row.white ?? "",
    black: row.black ?? "",
    result: row.result ?? "*",
    date: row.date ?? "",
    event: row.event ?? "",
    white_elo: row.white_elo,
    black_elo: row.black_elo,
    time_control: row.time_control,
    eco: row.eco,
    opening: row.opening,
    termination: row.termination,
    termination_mode: row.termination_mode,
    termination_description: row.termination,
    starting_fen: row.starting_fen,
    speed_category: row.speed_category,
    source: row.source ?? "file",
    chess960: Boolean(row.chess960),
  });
  if (!metadata.speed_category) metadata.speed_category = detectSpeedCategory(metadata.time_control, metadata.event);

  let moves: MoveData[] = Array.isArray(row.moves_json) ? row.moves_json.map((m) => ({ ...m })) : [];
  if (!moves.length && row.pgn) {
    try {
      const parsed = parsePgnText(row.pgn);
      if (parsed.length) {
        moves = parsed[0].moves;
        metadata.headers = parsed[0].metadata.headers;
      }
    } catch {
      moves = [];
    }
  }
  // Headers are not persisted; rebuild the ones later steps rely on.
  metadata.headers = {
    ...metadata.headers,
    Result: metadata.result,
    White: metadata.white,
    Black: metadata.black,
    Termination: metadata.termination ?? "",
  };
  return {
    game_id: row.id,
    metadata,
    moves,
    summary: (row.summary_json ?? {}) as GameSummary,
    pgn_content: row.pgn ?? "",
  };
}
