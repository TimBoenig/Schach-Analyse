// Compact cloud form of a game's analysis.
//
// A fully analysed game weighs ~100 KB locally: every move carries its FEN,
// several engine lines with long PVs and candidate continuations. Online we
// only keep what the profile, statistics and move review need and rebuild the
// rest from the PGN on the receiving device:
//   - positions, SAN and clock times come from replaying the PGN,
//   - engine lines shrink to their first move + score (enough for judgedLoss
//     and "equally good" alternatives), the best line to 8 plies,
//   - tactics in the summary are recomputed from the moves.
// The packed tuples are gzip-compressed where the browser supports it, which
// brings a game to roughly 2–4 KB.
import { parsePgnText } from "../domain/pgn";
import { analyzeGameTactics } from "../domain/tactics";
import type { Classification, GameSummary, MoveData, PvLine, StoredGame } from "../domain/types";

export const COMPACT_VERSION = 1;
/** Plies of the engine's best line kept online (the profile reads up to 8). */
const BEST_PV_PLIES = 8;

const CLASSES: Classification[] = [
  "",
  "Brilliant",
  "Great",
  "Best",
  "Excellent",
  "Good",
  "Book",
  "Inaccuracy",
  "Mistake",
  "Miss",
  "Blunder",
];

// One tuple per move. Order matters; append new fields at the end only.
type PackedMove = [
  uci: string,
  cls: number,
  evalBeforeCp: number | null,
  evalBeforeMate: number | null,
  evalAfterCp: number | null,
  evalAfterMate: number | null,
  wcBefore: number,
  wcAfter: number,
  bestMove: string | null,
  bestEvalCp: number | null,
  bestEvalMate: number | null,
  pv: string,
  /** Engine lines as "uci,cp,mate,depth" joined by ";" (empty fields = null). */
  lines: string,
  /** bit 0 book move, bit 1 book exit. */
  flags: number,
  bookCount: number,
  eco: string,
  openingName: string,
  explanation: string,
];

export interface PackedMoves {
  v: number;
  /** "gz" = base64 gzip of the JSON tuples, "json" = plain tuples. */
  enc: "gz" | "json";
  n: number;
  data: string | PackedMove[];
}

const round4 = (x: number) => Math.round((Number(x) || 0) * 10000) / 10000;
const nul = (s: string) => (s === "" ? null : Number(s));

function packLines(lines: PvLine[] | undefined): string {
  return (lines ?? [])
    .filter((l) => l.pv?.length)
    .map((l) => [l.pv[0], l.cp ?? "", l.mate ?? "", l.depth ?? ""].join(","))
    .join(";");
}

function unpackLines(s: string): PvLine[] {
  if (!s) return [];
  return s.split(";").map((part) => {
    const [uci, cp, mate, depth] = part.split(",");
    return { pv: [uci], cp: nul(cp), mate: nul(mate), depth: depth === "" ? 0 : Number(depth) || depth };
  });
}

function packMove(m: MoveData): PackedMove {
  return [
    m.uci,
    Math.max(0, CLASSES.indexOf(m.classification)),
    m.eval_before_cp,
    m.eval_before_mate,
    m.eval_after_cp,
    m.eval_after_mate,
    round4(m.win_chance_before),
    round4(m.win_chance_after),
    m.best_move,
    m.best_eval_cp ?? null,
    m.best_eval_mate ?? null,
    (m.pv ?? []).slice(0, BEST_PV_PLIES).join(" "),
    packLines(m.multi_pvs),
    (m.is_book_move ? 1 : 0) | (m.book_exit_move ? 2 : 0),
    m.book_move_count || 0,
    m.eco || "",
    m.opening_name || "",
    m.explanation || "",
  ];
}

/** Copies the analysis of `p` onto `base` (a move rebuilt from the PGN). */
function applyPacked(base: MoveData, p: PackedMove): MoveData {
  return {
    ...base,
    classification: CLASSES[p[1]] ?? "",
    eval_before_cp: p[2],
    eval_before_mate: p[3],
    eval_after_cp: p[4],
    eval_after_mate: p[5],
    win_chance_before: p[6],
    win_chance_after: p[7],
    best_move: p[8],
    best_eval_cp: p[9],
    best_eval_mate: p[10],
    pv: p[11] ? p[11].split(" ") : [],
    multi_pvs: unpackLines(p[12]),
    is_book_move: Boolean(p[13] & 1),
    book_exit_move: Boolean(p[13] & 2),
    book_move_count: p[14],
    eco: p[15],
    opening_name: p[16],
    explanation: p[17],
  };
}

// ---- gzip + base64 (CompressionStream: Safari 16.4+, Chrome, Firefox, Node 18+) ----

const canGzip = () => typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

async function streamBytes(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream as TransformStream<Uint8Array, Uint8Array>));
  return new Uint8Array(await out.arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** True when a game carries engine analysis worth uploading. */
export function hasAnalysis(moves: MoveData[] | undefined): boolean {
  return Array.isArray(moves) && moves.some((m) => m.classification);
}

export async function packMoves(moves: MoveData[]): Promise<PackedMoves> {
  const tuples = moves.map(packMove);
  if (!canGzip()) return { v: COMPACT_VERSION, enc: "json", n: tuples.length, data: tuples };
  const bytes = await streamBytes(new TextEncoder().encode(JSON.stringify(tuples)), new CompressionStream("gzip"));
  return { v: COMPACT_VERSION, enc: "gz", n: tuples.length, data: toBase64(bytes) };
}

async function readTuples(p: PackedMoves): Promise<PackedMove[]> {
  if (p.enc === "json") return p.data as PackedMove[];
  if (!canGzip()) throw new Error("Dieser Browser kann komprimierte Analysen nicht lesen.");
  const bytes = await streamBytes(fromBase64(p.data as string), new DecompressionStream("gzip"));
  return JSON.parse(new TextDecoder().decode(bytes)) as PackedMove[];
}

/**
 * Rebuilds full moves from the PGN plus packed analysis. Returns null when the
 * PGN does not replay to the same moves (then the game is kept unanalysed).
 */
export async function unpackMoves(p: PackedMoves, pgn: string): Promise<MoveData[] | null> {
  let base: MoveData[];
  try {
    base = parsePgnText(pgn)[0]?.moves ?? [];
  } catch {
    return null;
  }
  const tuples = await readTuples(p);
  if (tuples.length !== base.length) return null;
  for (let i = 0; i < base.length; i++) if (base[i].uci !== tuples[i][0]) return null;
  return base.map((m, i) => applyPacked(m, tuples[i]));
}

/** Summary without the bulky tactics block (recomputed from the moves on arrival). */
function slimSummary(s: GameSummary | undefined): GameSummary {
  const out: GameSummary = { ...(s ?? {}) };
  for (const side of ["white", "black"] as const) {
    if (out[side]) {
      const { tactics: _t, ...rest } = out[side] as Record<string, unknown>;
      out[side] = rest as GameSummary["white"];
    }
  }
  return out;
}

export type CloudGame = Omit<StoredGame, "moves_json" | "updated_at" | "deleted"> & {
  moves_json?: MoveData[];
  moves_c?: PackedMoves;
};

/** What goes online for one game: metadata, PGN, summary and the packed analysis. */
export async function toCloudGame(g: StoredGame): Promise<CloudGame> {
  const { updated_at: _u, deleted, moves_json, ...rest } = g;
  if (deleted) return { ...rest, summary_json: {} as GameSummary, pgn: "" };
  const out: CloudGame = { ...rest, summary_json: slimSummary(g.summary_json) };
  if (hasAnalysis(moves_json)) out.moves_c = await packMoves(moves_json);
  return out;
}

/**
 * Turns an online record back into a local game. Older clients uploaded the
 * full `moves_json`; those records are used as they are.
 */
export async function fromCloudGame(
  data: CloudGame,
  meta: { id: string; updated_at: number; deleted: boolean },
): Promise<StoredGame> {
  const { moves_c, moves_json, ...rest } = data;
  const game: StoredGame = { ...(rest as StoredGame), id: meta.id, updated_at: meta.updated_at, deleted: meta.deleted, moves_json: [] };
  if (meta.deleted) return game;
  if (Array.isArray(moves_json)) {
    game.moves_json = moves_json;
    return game;
  }
  if (moves_c) {
    const moves = await unpackMoves(moves_c, game.pgn).catch(() => null);
    if (moves) {
      game.moves_json = moves;
      const summary: GameSummary = { ...(game.summary_json ?? {}) };
      const speed = game.speed_category || "Blitz";
      for (const side of ["white", "black"] as const) {
        summary[side] = { ...(summary[side] ?? ({} as NonNullable<GameSummary["white"]>)) };
        (summary[side] as Record<string, unknown>).tactics = analyzeGameTactics(moves, side, game.result, speed);
      }
      game.summary_json = summary;
    } else {
      // Analysis could not be matched to the PGN: keep the game, analyse it again here.
      game.summary_json = { ...(game.summary_json ?? {}), analysis_status: "not_started", analyzed_moves: 0 };
    }
  }
  return game;
}

/**
 * When a newer online copy arrives for a game this device analysed itself,
 * keep the local moves if they describe the same analysis: they still carry
 * the full engine lines the compact copy dropped. If the online copy has no
 * analysis at all, ours wins and must be uploaded again (`repush`).
 */
export function keepRicherMoves(local: StoredGame | undefined, incoming: StoredGame): { game: StoredGame; repush: boolean } {
  const plain = { game: incoming, repush: false };
  if (!local || local.deleted || incoming.deleted || !hasAnalysis(local.moves_json) || incoming.pgn !== local.pgn) return plain;
  const a = local.moves_json;
  const b = incoming.moves_json;
  if (!hasAnalysis(b)) {
    return { game: { ...incoming, moves_json: a, summary_json: local.summary_json, updated_at: Date.now() }, repush: true };
  }
  if (a.length !== b.length) return plain;
  for (let i = 0; i < a.length; i++) {
    if (a[i].uci !== b[i].uci || a[i].classification !== b[i].classification) return plain;
  }
  return { game: { ...incoming, moves_json: a }, repush: false };
}
