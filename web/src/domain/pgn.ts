// Port of src/backend/storage/pgn_parser.py.
//
// The game id must equal the desktop app's md5(str(chess.pgn.read_game(...))),
// i.e. the hash of python-chess' *re-exported* PGN, not of the raw input.
// So this module mirrors python-chess' reader (chess.pgn.read_game with the
// default GameBuilder), its SAN parser and its StringExporter(columns=None)
// token for token; chess.js only supplies move generation.

import { type Chess, type Move, type Square } from "chess.js";

import { md5 } from "./md5";
import { STANDARD_START_FEN, applyNullMove, detectTermination, loadChess } from "./termination";
import { type GameAnalysis, type MoveData, emptyMetadata, emptyMove } from "./types";

export const CHESS960_UNSUPPORTED =
  "Chess960-Partien (Fischer Random) werden in der Web-App noch nicht unterstützt.";
export const VARIANT_UNSUPPORTED =
  "Schachvarianten (z. B. Crazyhouse, Atomic) können nicht analysiert werden.";

const TAG_ROSTER = ["Event", "Site", "Date", "Round", "White", "Black", "Result"] as const;
const TAG_REGEX = /^\[([A-Za-z0-9][A-Za-z0-9_+#=:-]*)\s+"([^\r]*)"\]\s*$/;
const MOVETEXT_REGEX =
  /([NBKRQ]?[a-h]?[1-8]?[-x]?[a-h][1-8](?:=?[nbrqkNBRQK])?|[PNBRQK]?@[a-h][1-8]|--|Z0|0000|@@@@|O-O(?:-O)?|0-0(?:-0)?)|(\{.*)|(;.*)|(\$[0-9]+)|(\()|(\))|(\*|1-0|0-1|1\/2-1\/2)|([?!]{1,2})/gs;
const SKIP_MOVETEXT_REGEX = /;|\{|\}/g;
const SAN_REGEX = /^([NBKRQ])?([a-h])?([1-8])?[-x]?([a-h][1-8])(=?[nbrqkNBRQK])?[+#]?$/;
const NULL_SANS = ["--", "Z0", "0000", "@@@@"];
const STANDARD_VARIANT_ALIASES = ["standard", "chess", "classical", "normal", "illegal", "from position"];
const CHESS960_VARIANTS = ["chess960", "chess 960", "fischerandom", "fischerrandom", "fischer random"];
const NAG_SYMBOLS: Record<string, number> = { "!": 1, "?": 2, "!!": 3, "??": 4, "!?": 5, "?!": 6 };

/** python str.isspace(): non-empty and whitespace only. */
const isSpace = (s: string): boolean => s.length > 0 && /^\s+$/.test(s);

// --------------------------------------------------------------------------
// Headers (python-chess Headers: Seven Tag Roster first, then insertion order)
// --------------------------------------------------------------------------

class Headers {
  private roster = new Map<string, string>([
    ["Event", "?"],
    ["Site", "?"],
    ["Date", "????.??.??"],
    ["Round", "?"],
    ["White", "?"],
    ["Black", "?"],
    ["Result", "*"],
  ]);
  private others = new Map<string, string>();

  set(key: string, value: string): void {
    if ((TAG_ROSTER as readonly string[]).includes(key)) this.roster.set(key, value);
    else this.others.set(key, value);
  }

  get(key: string): string | undefined {
    return this.roster.get(key) ?? this.others.get(key);
  }

  entries(): [string, string][] {
    const out: [string, string][] = [];
    for (const key of TAG_ROSTER) {
      const v = this.roster.get(key);
      if (v !== undefined) out.push([key, v]);
    }
    return [...out, ...this.others.entries()];
  }
}

// --------------------------------------------------------------------------
// Game tree
// --------------------------------------------------------------------------

interface PlayedMove {
  san: string;
  uci: string;
}

interface Node {
  parent: Node | null;
  /** null for the root (game) node. */
  move: PlayedMove | null;
  /** Position before `move` (python-chess board.fen() of the parent). */
  fenBefore: string;
  /** Position after `move` (or the starting position for the root). */
  fen: string;
  variations: Node[];
  comment: string;
  startingComment: string;
  nags: Set<number>;
}

interface RawGame {
  headers: Headers;
  root: Node;
  errors: string[];
  unsupported: string | null;
}

function newNode(parent: Node | null, move: PlayedMove | null, fenBefore: string, fen: string): Node {
  return { parent, move, fenBefore, fen, variations: [], comment: "", startingComment: "", nags: new Set() };
}

const joinComments = (a: string, b: string): string => [a, b].filter(Boolean).join(" ");

/** python-chess GameBuilder. */
class GameBuilder {
  private stack: Node[];
  private startingComment = "";
  private inVariation = false;

  constructor(private readonly game: RawGame) {
    this.stack = [game.root];
  }

  private get top(): Node {
    return this.stack[this.stack.length - 1];
  }

  visitNag(nag: number): void {
    this.top.nags.add(nag);
  }

  beginVariation(): void {
    const parent = this.top.parent;
    if (parent === null) throw new Error("begin_variation called, but root node on top of stack");
    this.stack.push(parent);
    this.inVariation = false;
  }

  endVariation(): void {
    this.stack.pop();
  }

  visitResult(result: string): void {
    if ((this.game.headers.get("Result") ?? "*") === "*") this.game.headers.set("Result", result);
  }

  visitComment(comment: string): void {
    const top = this.top;
    if (this.inVariation || (top.parent === null && top.variations.length === 0)) {
      top.comment = joinComments(top.comment, comment);
    } else {
      this.startingComment = joinComments(this.startingComment, comment);
    }
  }

  visitMove(fenBefore: string, move: PlayedMove, fenAfter: string): void {
    const node = newNode(this.top, move, fenBefore, fenAfter);
    this.top.variations.push(node);
    this.stack[this.stack.length - 1] = node;
    node.startingComment = this.startingComment;
    this.startingComment = "";
    this.inVariation = true;
  }
}

// --------------------------------------------------------------------------
// Boards (python-chess Board subset: a FEN history so variations can pop)
// --------------------------------------------------------------------------

class Board {
  constructor(public fens: string[]) {}

  get fen(): string {
    return this.fens[this.fens.length - 1];
  }

  get hasMoves(): boolean {
    return this.fens.length > 1;
  }

  copyPopped(): Board {
    return new Board(this.fens.slice(0, -1));
  }

  push(fen: string): void {
    this.fens.push(fen);
  }
}

const FILES = "abcdefgh";

/** Tries a move on a scratch copy; returns chess.js' Move or null if illegal. */
function tryMove(fen: string, from: string, to: string, promotion?: string): Move | null {
  try {
    return loadChess(fen).move({ from, to, promotion });
  } catch {
    return null;
  }
}

/**
 * python-chess Board.parse_san(): returns the legal move, or null for a null
 * move. Throws on invalid, illegal or ambiguous SAN.
 *
 * Candidates are probed with chess.js' move() instead of moves({verbose}),
 * which renders SAN for every legal move and is ~20x slower on bulk imports.
 */
function parseSan(chess: Chess, san: string): Move | null {
  const fen = chess.fen();
  const castling = (side: "k" | "q"): Move => {
    const m = chess.moves({ verbose: true, piece: "k" }).find((mv) => mv.flags.includes(side));
    if (!m) throw new Error(`illegal san: ${san}`);
    return m;
  };
  if (["O-O", "O-O+", "O-O#", "0-0", "0-0+", "0-0#"].includes(san)) return castling("k");
  if (["O-O-O", "O-O-O+", "O-O-O#", "0-0-0", "0-0-0+", "0-0-0#"].includes(san)) return castling("q");
  const match = SAN_REGEX.exec(san);
  if (!match) {
    if (NULL_SANS.includes(san)) return null;
    throw new Error(`invalid san: ${san}`);
  }
  const [, piece, fromFile, fromRank, to, promo] = match;
  const promotion = promo ? promo[promo.length - 1].toLowerCase() : undefined;
  const turn = chess.turn();
  const target = chess.get(to as Square);
  if (target && target.color === turn) throw new Error(`illegal san: ${san}`);
  const lastRank = turn === "w" ? "8" : "1";

  if (!piece && fromFile && fromRank) {
    // Fully specified moves (e.g. "e2e4"), python-chess find_move(): a pawn
    // reaching the last rank defaults to a queen, castling is allowed.
    const from = `${fromFile}${fromRank}`;
    const moving = chess.get(from as Square);
    const isPromotion = moving?.type === "p" && moving.color === turn && to[1] === lastRank;
    const move = tryMove(fen, from, to, promotion ?? (isPromotion ? "q" : undefined));
    if (!move) throw new Error(`illegal san: ${san}`);
    if ((move.promotion ?? undefined) !== promotion) throw new Error(`missing promotion piece type: ${san}`);
    return move;
  }

  const pieceType = piece ? piece.toLowerCase() : "p";
  let matched: Move | null = null;
  for (let f = 0; f < 8; f++) {
    for (let r = 1; r <= 8; r++) {
      const from = `${FILES[f]}${r}`;
      const p = chess.get(from as Square);
      if (!p || p.color !== turn || p.type !== pieceType) continue;
      if (fromFile && from[0] !== fromFile) continue;
      if (fromRank && from[1] !== fromRank) continue;
      // Pawn captures need an explicit file.
      if (!piece && !fromFile && from[0] !== to[0]) continue;
      // Castling is never written as a king move to g1/c1 (python-chess masks it out).
      if (pieceType === "k" && Math.abs(FILES.indexOf(from[0]) - FILES.indexOf(to[0])) > 1) continue;
      const isPromotion = pieceType === "p" && to[1] === lastRank;
      if (isPromotion !== (promotion !== undefined)) continue;
      const move = tryMove(fen, from, to, promotion);
      if (!move) continue;
      if (matched) throw new Error(`ambiguous san: ${san}`);
      matched = move;
    }
  }
  if (!matched) throw new Error(`illegal san: ${san}`);
  return matched;
}

function playToken(fen: string, token: string): { move: PlayedMove; fen: string } {
  const parsed = parseSan(loadChess(fen), token);
  if (parsed === null) return { move: { san: "--", uci: "0000" }, fen: applyNullMove(fen) };
  return {
    move: { san: parsed.san, uci: parsed.from + parsed.to + (parsed.promotion ?? "") },
    fen: parsed.after,
  };
}

// --------------------------------------------------------------------------
// Reader (python-chess read_game)
// --------------------------------------------------------------------------

class LineReader {
  private pos = 0;

  constructor(private readonly text: string) {}

  readline(): string {
    if (this.pos >= this.text.length) return "";
    const nl = this.text.indexOf("\n", this.pos);
    const end = nl === -1 ? this.text.length : nl + 1;
    const line = this.text.slice(this.pos, end);
    this.pos = end;
    return line;
  }
}

/** Castling rights that python-chess would only accept on a Chess960 board. */
function hasChess960CastlingRights(fen: string): boolean {
  const [placement, , castling = "-"] = fen.split(" ");
  if (castling === "-") return false;
  if ([...castling].some((c) => !"KQkq".includes(c))) return true;
  const rows = placement.split("/");
  const filesOf = (rank: number, piece: string): number[] => {
    const files: number[] = [];
    let f = 0;
    for (const ch of rows[8 - rank] ?? "") {
      if (/\d/.test(ch)) f += Number(ch);
      else {
        if (ch === piece) files.push(f);
        f += 1;
      }
    }
    return files;
  };
  // Mirrors python-chess: read K/Q as the outermost back-rank rook, drop
  // rights whose rook is missing or on the wrong side of the king, then call
  // anything left that is not a corner rook with an e-file king "Chess960".
  for (const [kingSide, queenSide, rank, king, rook] of [
    ["K", "Q", 1, "K", "R"],
    ["k", "q", 8, "k", "r"],
  ] as const) {
    const kingFiles = filesOf(rank, king);
    if (kingFiles.length !== 1) continue;
    const kingFile = kingFiles[0];
    const rooks = filesOf(rank, rook);
    const rights: number[] = [];
    if (castling.includes(kingSide) && rooks.length && Math.max(...rooks) > kingFile) {
      rights.push(Math.max(...rooks));
    }
    if (castling.includes(queenSide) && rooks.length && Math.min(...rooks) < kingFile) {
      rights.push(Math.min(...rooks));
    }
    if (rights.some((f) => f !== 0 && f !== 7)) return true;
    if (rights.length && kingFile !== 4) return true;
  }
  return false;
}

function unsupportedReason(headers: Headers): string | null {
  const variant = (headers.get("Variant") ?? "").toLowerCase();
  if (CHESS960_VARIANTS.includes(variant)) return CHESS960_UNSUPPORTED;
  if (variant && !STANDARD_VARIANT_ALIASES.includes(variant)) return VARIANT_UNSUPPORTED;
  const fen = headers.get("FEN");
  if (fen && hasChess960CastlingRights(fen)) return CHESS960_UNSUPPORTED;
  return null;
}

function readGame(reader: LineReader): RawGame | null {
  let line = reader.readline().replace(/^﻿/, "");
  while (isSpace(line) || line.startsWith("%") || line.startsWith(";")) line = reader.readline();

  let found = false;
  const headers = new Headers();
  let consecutiveEmpty = 0;
  while (line) {
    if (line.startsWith("%") || line.startsWith(";")) {
      line = reader.readline();
      continue;
    }
    if (consecutiveEmpty < 1 && isSpace(line)) {
      consecutiveEmpty += 1;
      line = reader.readline();
      continue;
    }
    found = true;
    if (!line.startsWith("[")) break;
    consecutiveEmpty = 0;
    const tag = TAG_REGEX.exec(line);
    if (tag) headers.set(tag[1], tag[2]);
    line = reader.readline();
  }
  if (!found) return null;

  const game: RawGame = {
    headers,
    root: newNode(null, null, "", ""),
    errors: [],
    unsupported: unsupportedReason(headers),
  };

  let skipping = game.unsupported !== null;
  let startFen = STANDARD_START_FEN;
  if (!skipping) {
    try {
      startFen = loadChess(headers.get("FEN") ?? STANDARD_START_FEN).fen();
      // chess.js is lenient about FEN syntax; python-chess rejects these.
      if (headers.get("FEN") !== undefined && !isPlausibleFen(headers.get("FEN") ?? "")) {
        throw new Error("invalid fen");
      }
    } catch (err) {
      game.errors.push(String(err));
      skipping = true;
    }
  }

  if (skipping) {
    // Fast path: consume the game's movetext without building moves.
    let inComment = false;
    while (line) {
      if (!inComment) {
        if (isSpace(line)) break;
        if (line.startsWith("%")) {
          line = reader.readline();
          continue;
        }
      }
      SKIP_MOVETEXT_REGEX.lastIndex = 0;
      for (const m of line.matchAll(SKIP_MOVETEXT_REGEX)) {
        const token = m[0];
        if (token === "{") inComment = true;
        else if (!inComment && token === ";") break;
        else if (token === "}") inComment = false;
      }
      line = reader.readline();
    }
    return game;
  }

  game.root.fen = startFen;
  const builder = new GameBuilder(game);
  const boardStack: Board[] = [new Board([startFen])];
  const topBoard = (): Board => boardStack[boardStack.length - 1];
  let skipDepth = 0;
  let freshLine = true;

  while (line) {
    if (freshLine) {
      if (line.startsWith("%") || line.startsWith(";")) {
        line = reader.readline();
        continue;
      }
      if (isSpace(line)) return game;
    }
    freshLine = true;
    for (const match of line.matchAll(MOVETEXT_REGEX)) {
      const token = match[0];
      if (token.startsWith("{")) {
        const startIndex = token.startsWith("{ ") ? 2 : 1;
        line = token.slice(startIndex);
        const commentLines: string[] = [];
        while (line && !line.includes("}")) {
          commentLines.push(line);
          line = reader.readline();
        }
        if (line) {
          const close = line.indexOf("}");
          const end = close > 0 && line[close - 1] === " " ? close - 1 : close;
          commentLines.push(line.slice(0, end));
          line = line.slice(close + 1);
        }
        if (!skipDepth) builder.visitComment(commentLines.join(""));
        freshLine = false;
        break;
      } else if (token === "(") {
        if (skipDepth) skipDepth += 1;
        else if (topBoard().hasMoves) {
          builder.beginVariation();
          boardStack.push(topBoard().copyPopped());
        }
      } else if (token === ")") {
        if (skipDepth === 1) {
          skipDepth = 0;
          builder.endVariation();
        } else if (skipDepth) skipDepth -= 1;
        else if (boardStack.length > 1) {
          builder.endVariation();
          boardStack.pop();
        }
      } else if (skipDepth) {
        continue;
      } else if (token.startsWith(";")) {
        break;
      } else if (token.startsWith("$")) {
        builder.visitNag(Number(token.slice(1)));
      } else if (token in NAG_SYMBOLS) {
        builder.visitNag(NAG_SYMBOLS[token]);
      } else if (["1-0", "0-1", "1/2-1/2", "*"].includes(token) && boardStack.length === 1) {
        builder.visitResult(token);
      } else {
        const board = topBoard();
        try {
          const played = playToken(board.fen, token);
          builder.visitMove(board.fen, played.move, played.fen);
          board.push(played.fen);
        } catch (err) {
          game.errors.push(String(err));
          skipDepth = 1;
        }
      }
    }
    if (freshLine) line = reader.readline();
  }
  return game;
}

/** Rough python-chess FEN acceptance check on top of chess.js parsing. */
function isPlausibleFen(fen: string): boolean {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 1 || parts.length > 6) return false;
  const rows = parts[0].split("/");
  if (rows.length !== 8) return false;
  return rows.every((row) => {
    let n = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) n += Number(ch);
      else if (/[pnbrqkPNBRQK]/.test(ch)) n += 1;
      else return false;
    }
    return n === 8;
  });
}

// --------------------------------------------------------------------------
// Exporter (python-chess StringExporter(columns=None), i.e. str(game))
// --------------------------------------------------------------------------

function exportGame(game: RawGame): string {
  const lines: string[] = [];
  let current = "";
  let forceMoveNumber = true;
  const writeToken = (t: string) => {
    current += t;
  };
  const writeLine = (l = "") => {
    if (current) lines.push(current.trimEnd());
    current = "";
    lines.push(l.trimEnd());
  };
  const visitComment = (c: string) => {
    writeToken("{ " + c.replaceAll("}", "").trim() + " } ");
    forceMoveNumber = true;
  };
  const visitNode = (node: Node) => {
    if (node.startingComment) visitComment(node.startingComment);
    const [, turn, , , , fullmove] = node.fenBefore.split(" ");
    if (turn === "w") writeToken(`${fullmove}. `);
    else if (forceMoveNumber) writeToken(`${fullmove}... `);
    writeToken((node.move?.san ?? "") + " ");
    forceMoveNumber = false;
    for (const nag of [...node.nags].sort((a, b) => a - b)) writeToken(`$${nag} `);
    if (node.comment) visitComment(node.comment);
  };
  const accept = (start: Node, sidelines: boolean) => {
    // Iterative to keep long mainlines off the call stack.
    let node: Node | null = start;
    let withSidelines = sidelines;
    while (node) {
      visitNode(node);
      if (withSidelines && node.parent) {
        for (const variation of node.parent.variations.slice(1)) {
          writeToken("( ");
          forceMoveNumber = true;
          accept(variation, false);
          writeToken(") ");
          forceMoveNumber = true;
        }
      }
      node = node.variations[0] ?? null;
      withSidelines = true;
    }
  };

  for (const [k, v] of game.headers.entries()) writeLine(`[${k} "${v}"]`);
  writeLine();
  if (game.root.comment) visitComment(game.root.comment);
  if (game.root.variations.length) accept(game.root.variations[0], true);
  writeToken((game.headers.get("Result") ?? "*") + " ");
  writeLine();
  return (current ? [...lines, current.trimEnd()] : lines).join("\n").trimEnd();
}

// --------------------------------------------------------------------------
// GameAnalysis conversion
// --------------------------------------------------------------------------

const CLK_RE = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/;

/** Pulls the first [%clk H:MM:SS(.s)] out of a comment: [raw, seconds] or [null, null]. */
export function parseClk(comment: string | null | undefined): [string | null, number | null] {
  if (!comment) return [null, null];
  const m = CLK_RE.exec(comment);
  if (!m) return [null, null];
  const h = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  // Reject out-of-range fields ("0:99:00") instead of producing bogus times.
  if (mm >= 60 || ss >= 60) return [null, null];
  const parts = m[0].split(/\s+/);
  const raw = parts[parts.length - 1].replace(/\]+$/, "");
  return [raw, h * 3600 + mm * 60 + ss];
}

/** python float() for the restricted inputs a TimeControl header carries. */
function pyFloat(text: string): number | null {
  const t = text.trim();
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t) ? Number(t) : null;
}

function initialClockSeconds(timeControl: string | undefined): number | null {
  const tc = timeControl ?? "";
  if (!tc || tc === "-") return null;
  const head = tc.split("+", 1)[0].trim();
  const slash = /^1\/(\d+)$/.exec(head);
  if (slash) return Number(slash[1]);
  return pyFloat(head);
}

/** Classify into UltraBullet, Bullet, Blitz, Rapid, Classical or Daily. */
export function detectSpeedCategory(timeControl: string | null | undefined, event: string | null | undefined): string {
  const tc = (timeControl ?? "").trim();
  const slash = /^(\d+)\/(\d+)$/.exec(tc);
  if (slash) {
    const movesCount = Number(slash[1]);
    const secCount = Number(slash[2]);
    if (secCount >= 86400 || (movesCount === 1 && secCount >= 3600)) return "Daily";
    if (secCount >= 1800) return "Classical";
    if (secCount >= 600) return "Rapid";
    return "Blitz";
  }
  const match = /^(\d+)(?:\+(\d+))?$/.exec(tc);
  if (match) {
    const total = Number(match[1]) + 40 * (match[2] ? Number(match[2]) : 0);
    if (total < 30) return "UltraBullet";
    if (total < 180) return "Bullet";
    if (total < 600) return "Blitz";
    if (total < 1800) return "Rapid";
    if (total >= 86400) return "Daily";
    return "Classical";
  }
  const evt = (event ?? "").toLowerCase();
  const tcl = tc.toLowerCase();
  const has = (k: string) => evt.includes(k) || tcl.includes(k);
  if (has("ultrabullet")) return "UltraBullet";
  if (has("bullet")) return "Bullet";
  if (has("blitz")) return "Blitz";
  if (has("rapid")) return "Rapid";
  if (has("daily") || has("correspondence")) return "Daily";
  if (has("classical")) return "Classical";
  return "Blitz";
}

function toGameAnalysis(game: RawGame): GameAnalysis {
  const headers: Record<string, string> = Object.fromEntries(game.headers.entries());
  const h = (k: string): string | null => headers[k] ?? null;
  const site = (headers.Site ?? "").toLowerCase();
  const metadata = emptyMetadata({
    white: headers.White ?? "?",
    black: headers.Black ?? "?",
    event: headers.Event ?? "?",
    date: headers.Date ?? "?",
    result: headers.Result ?? "*",
    headers,
    white_elo: h("WhiteElo"),
    black_elo: h("BlackElo"),
    time_control: h("TimeControl"),
    eco: h("ECO"),
    termination: h("Termination"),
    opening: h("Opening"),
    starting_fen: h("FEN"),
    source: site.includes("chess.com") ? "chesscom" : site.includes("lichess.org") ? "lichess" : "file",
  });

  // Per-side running clock, seeded from the TimeControl base so the first move
  // of each side also gets a time_spent value.
  const lastClk: Record<"w" | "b", number | null> = { w: null, b: null };
  const startClock = initialClockSeconds(headers.TimeControl);
  const moves: MoveData[] = [];
  for (let node = game.root.variations[0]; node; node = node.variations[0]) {
    const [, turn, , , , fullmove] = node.fenBefore.split(" ") as [string, "w" | "b", string, string, string, string];
    const moveNumber = Number(fullmove);
    const [rawClk, timeLeft] = parseClk(node.comment);
    let timeSpent: number | null = null;
    if (timeLeft !== null) {
      const previous = lastClk[turn] ?? startClock;
      if (previous !== null && previous - timeLeft >= 0) timeSpent = previous - timeLeft;
      lastClk[turn] = timeLeft;
    }
    moves.push(
      emptyMove({
        move_number: moveNumber,
        ply: 2 * (moveNumber - 1) + (turn === "b" ? 1 : 0),
        san: node.move?.san ?? "",
        uci: node.move?.uci ?? "",
        fen_before: node.fenBefore,
        time_left: timeLeft,
        time_spent: timeSpent,
        raw_clk: rawClk,
      }),
    );
  }

  metadata.speed_category = detectSpeedCategory(metadata.time_control, metadata.event);
  const [mode, desc] = detectTermination(headers, moves, metadata.starting_fen, false);
  metadata.termination_mode = mode;
  metadata.termination_description = desc;

  const pgnContent = exportGame(game);
  return { game_id: md5(pgnContent), metadata, moves, summary: {}, pgn_content: pgnContent };
}

export interface SkippedGame {
  /** 0-based index of the game within the PGN text. */
  index: number;
  white: string;
  black: string;
  reason: string;
}

export interface ParseResult {
  games: GameAnalysis[];
  skipped: SkippedGame[];
}

/** Parses every game; games without moves are dropped silently, unsupported variants are reported. */
export function parsePgnTextDetailed(text: string): ParseResult {
  // Universal newlines, like the desktop app reading a .pgn file with open().
  const reader = new LineReader((text ?? "").replace(/\r\n?/g, "\n"));
  const result: ParseResult = { games: [], skipped: [] };
  for (let index = 0; ; index++) {
    const game = readGame(reader);
    if (game === null) break;
    if (game.unsupported) {
      result.skipped.push({
        index,
        white: game.headers.get("White") ?? "?",
        black: game.headers.get("Black") ?? "?",
        reason: game.unsupported,
      });
      continue;
    }
    // Garbage input yields a game without moves; skip it like the desktop app.
    if (!game.root.variations.length) continue;
    result.games.push(toGameAnalysis(game));
  }
  return result;
}

/**
 * Parses a (multi-game) PGN. Throws a German error if the text only contained
 * games the web app cannot analyze (Chess960 or other variants).
 */
export function parsePgnText(text: string): GameAnalysis[] {
  const { games, skipped } = parsePgnTextDetailed(text);
  if (!games.length && skipped.length) throw new Error(skipped[0].reason);
  return games;
}
