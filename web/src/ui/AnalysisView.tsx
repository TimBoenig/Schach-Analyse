import { Chess, type Square } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { enqueue, cancelCurrent, subscribeQueue, type QueueState } from "../app/analysisService";
import { lineScoreWhite, pvToSan } from "../domain/analyzer";
import { explainMove } from "../domain/explain";
import { getWinProbability } from "../domain/math";
import { getUserColor } from "../domain/metrics";
import { buildGameReview, gameCoachMessages } from "../domain/profile";
import { SERIOUS_ERROR_CLASSES } from "../domain/profile/features";
import type { GameAnalysis, MoveData, PvLine, StoredGame } from "../domain/types";
import { deleteGame, getGame, getSetting, listGames, onDataChanged } from "../storage/db";
import { fromStoredGame } from "../storage/rows";
import { Board, type Arrow, type Promotion } from "./Board";
import { AiAnswer, coachDetail } from "./AiCoach";
import { loadFullProfile } from "./training/useTraining";
import { BarList, StackBar } from "./charts";
import { IconArrow, IconBack, IconFreeBoard, IconFirst, IconFlip, IconLast, IconNext, IconPlay, IconPrev, IconStop, IconTrash } from "./icons";
import {
  CLASSIFICATION_ORDER,
  accClass,
  badgeFor,
  classLabel,
  formatDate,
  formatEval,
  moveVerdict,
  qualitySegments,
  resultText,
  shortOpening,
} from "./labels";
import { isTyping } from "./keys";
import { LineMoves, MoveFacts, VerdictCard } from "./LiveLine";
import { usePositionLines, useVerdicts } from "./useLive";
import { navigate } from "./router";
import { Coach, COACH_NAME, moodFor } from "./Coach";

type Side = "white" | "black";

function fenAfter(move: MoveData): string {
  try {
    const b = new Chess(move.fen_before);
    b.move({ from: move.uci.slice(0, 2), to: move.uci.slice(2, 4), promotion: move.uci[4] });
    return b.fen();
  } catch {
    return move.fen_before;
  }
}

/** Plays `uci` at the end of a side line; returns the line unchanged if the move is illegal. */
function extendLine(line: Explore, uci: string, pending: string[]): Explore {
  try {
    const b = new Chess(line.fens[line.fens.length - 1]);
    const m = b.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return { ...line, fens: [...line.fens, b.fen()], sans: [...line.sans, m.san], ucis: [...line.ucis, uci], lastUci: uci, pending };
  } catch {
    return line;
  }
}

function sq(uci: string | null | undefined) {
  return uci && uci.length >= 4 ? { from: uci.slice(0, 2), to: uci.slice(2, 4) } : null;
}

/** White win chance (0..1) after `idx` moves have been played. */
function winChanceAt(moves: MoveData[], idx: number): number | null {
  if (idx === 0) {
    const m = moves[0];
    return m && (m.eval_before_cp !== null || m.eval_before_mate !== null) ? getWinProbability(m.eval_before_cp, m.eval_before_mate) : null;
  }
  const m = moves[idx - 1];
  if (!m.classification) return null;
  return m.win_chance_after;
}

export function EvalBar({ wc, flipped, label }: { wc: number | null; flipped: boolean; label: string }) {
  const pct = Math.round((wc ?? 0.5) * 100);
  const whiteAhead = pct >= 50;
  return (
    <div class={`evalbar${flipped ? " flipped" : ""}`} style={{ gridRow: "2" }} aria-label={`Bewertung ${label}`}>
      <div class="white" style={{ height: `${pct}%` }} />
      <div class="mid" />
      <span class={whiteAhead ? "on-white" : "on-black"} style={{ [whiteAhead !== flipped ? "bottom" : "top"]: "5px" }}>
        {label}
      </span>
    </div>
  );
}

/** Clock of `side` after `idx` moves: the time left after that side's last move. */
function clockAt(moves: MoveData[], idx: number, side: Side): number | null {
  for (let k = idx - 1; k >= 0; k--) {
    const m = moves[k];
    if ((m.fen_before.split(" ")[1] === "w") === (side === "white")) return m.time_left;
  }
  return null;
}

function formatClock(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return "";
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

const ERROR_CLASSES = new Set(["Blunder", "Mistake", "Miss", "Inaccuracy"]);
// Moves at least as good as the engine's choice: no "better was" hint, no best-move arrow.
const TOP_CLASSES = new Set(["Best", "Great", "Brilliant"]);

const CLASS_TONE: Partial<Record<string, string>> = {
  Brilliant: "var(--brilliant)",
  Great: "var(--great)",
  Best: "var(--best)",
  Excellent: "var(--best)",
  Good: "var(--good)",
  Book: "var(--book)",
  Inaccuracy: "var(--inacc)",
  Mistake: "var(--mistake)",
  Miss: "var(--blunder)",
  Blunder: "var(--blunder)",
};


function EvalGraph({ moves, idx, onPick, userColor }: { moves: MoveData[]; idx: number; onPick: (i: number) => void; userColor: Side | null }) {
  const dragging = useRef(false);
  const [hover, setHover] = useState<number | null>(null);
  const n = moves.length;
  if (!n) return null;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const wc = winChanceAt(moves, i);
    if (wc !== null) pts.push([i, wc]);
  }
  if (pts.length < 2) return null;
  const W = 400;
  const H = 120;
  const x = (i: number) => (i / n) * W;
  const y = (wc: number) => (1 - wc) * H;
  const line = pts.map(([i, wc], k) => `${k ? "L" : "M"}${x(i).toFixed(2)},${y(wc).toFixed(2)}`).join(" ");
  const area = `M0,${H} ` + pts.map(([i, wc]) => `L${x(i).toFixed(2)},${y(wc).toFixed(2)}`).join(" ") + ` L${x(pts[pts.length - 1][0])},${H} Z`;
  const errors = moves
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.classification === "Blunder" || m.classification === "Mistake" || m.classification === "Miss");
  const bookEnd = moves.findIndex((m) => m.classification && m.classification !== "Book");
  const indexAt = (e: PointerEvent) => {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * n);
  };
  const shown = hover ?? null;
  const hm = shown !== null && shown > 0 ? moves[shown - 1] : null;
  const hwc = shown !== null ? winChanceAt(moves, shown) : null;
  const userSide = userColor === "black" ? "b" : "w";
  return (
    <div class="eval-graph-wrap">
      <svg
        class="eval-graph"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Bewertungsverlauf, antippen oder ziehen zum Springen"
        // Drag to scrub through the game, like a video timeline.
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
          onPick(indexAt(e));
        }}
        onPointerMove={(e) => {
          const i = indexAt(e);
          if (e.pointerType === "mouse") setHover(i);
          if (dragging.current) onPick(i);
        }}
        onPointerLeave={() => setHover(null)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <rect class="eg-bg" x="0" y="0" width={W} height={H} />
        <path class="eg-area" d={area} />
        <path class="eg-line" d={line} />
        <line class="eg-mid" x1="0" y1={H / 2} x2={W} y2={H / 2} />
        {bookEnd > 0 && <line class="eg-book" x1={x(bookEnd)} y1="0" x2={x(bookEnd)} y2={H} />}
        {errors.map(({ m, i }) => (
          <circle
            key={i}
            cx={x(i + 1)}
            cy={y(m.win_chance_after)}
            r={m.fen_before.split(" ")[1] === userSide ? 4 : 3}
            class={`eg-dot ${m.classification.toLowerCase()}${m.fen_before.split(" ")[1] === userSide ? " own" : ""}`}
          />
        ))}
        {shown !== null && <line class="eg-hover" x1={x(shown)} y1="0" x2={x(shown)} y2={H} />}
        <line class="eg-cursor" x1={x(idx)} y1="0" x2={x(idx)} y2={H} />
      </svg>
      {shown !== null && (
        <div class="eg-tip" style={{ left: `${Math.max(12, Math.min(88, (shown / n) * 100))}%` }}>
          <strong>{hm ? `${hm.move_number}${hm.fen_before.split(" ")[1] === "w" ? "." : "..."} ${hm.san}` : "Start"}</strong>
          {hm?.classification && hm.classification !== "Book" ? ` · ${classLabel(hm.classification)}` : ""}
          {hwc !== null && <span class="faint"> · Weiß {Math.round(hwc * 100)} %</span>}
        </div>
      )}
      <div class="eg-legend faint">
        <span>Gewinnchance Weiß</span>
        {bookEnd > 0 && <span>┆ Ende der Theorie</span>}
        <span>
          <i class="eg-key blunder" /> Patzer <i class="eg-key mistake" /> Fehler
        </span>
      </div>
    </div>
  );
}

function ClassTable({ game }: { game: GameAnalysis }) {
  const w = game.summary.white;
  const b = game.summary.black;
  if (!w || !b) return null;
  return (
    <div class="class-wrap">
      <div class="class-table">
        <span class="muted small">Zugbewertung</span>
        <span class="w muted small">Weiß</span>
        <span />
        <span class="b muted small">Schwarz</span>
        {CLASSIFICATION_ORDER.map((c) => (
          <>
            <span>{classLabel(c)}</span>
            <span class="w" style={{ color: CLASS_TONE[c] }}>{w[c] ?? 0}</span>
            <img src={badgeFor(c) ?? ""} alt="" />
            <span class="b" style={{ color: CLASS_TONE[c] }}>{b[c] ?? 0}</span>
          </>
        ))}
      </div>
    </div>
  );
}

function MoveList({ moves, idx, onPick }: { moves: MoveData[]; idx: number; onPick: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const rows = [];
  const startBlack = moves[0] && moves[0].fen_before.split(" ")[1] === "b";
  const items: (MoveData | null)[] = startBlack ? [null, ...moves] : [...moves];
  for (let r = 0; r < items.length; r += 2) {
    const num = (moves[0]?.move_number ?? 1) + r / 2;
    rows.push(
      <span class="num" key={`n${r}`}>
        {num}.
      </span>,
    );
    for (const k of [r, r + 1]) {
      const m = items[k];
      if (!m) {
        rows.push(<span key={`e${k}`} />);
        continue;
      }
      const moveIdx = startBlack ? k : k + 1;
      const badge = badgeFor(m.classification);
      rows.push(
        <button
          key={`m${k}`}
          class={`${moveIdx === idx ? "active" : ""}${ERROR_CLASSES.has(m.classification) ? ` err ${m.classification.toLowerCase()}` : ""}`}
          onClick={() => onPick(moveIdx)}
          data-ply={moveIdx}
        >
          {badge && <img src={badge} alt={classLabel(m.classification)} />}
          {m.san}
        </button>,
      );
    }
  }
  useEffect(() => {
    // Scroll inside the list only; scrollIntoView would also scroll the page on phones.
    const list = ref.current;
    const el = list?.querySelector<HTMLElement>(`[data-ply="${idx}"]`);
    if (!list || !el) return;
    const top = el.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight / 2;
    }
  }, [idx]);
  return (
    <div class="movelist" ref={ref}>
      {rows}
    </div>
  );
}

export function EngineLines({
  fen,
  lines,
  label,
  onPlay,
  max = 2,
}: {
  fen: string;
  lines: PvLine[];
  label?: string;
  onPlay?: (pv: string[]) => void;
  max?: number;
}) {
  if (!lines.length) return null;
  return (
    <div class="engine-lines">
      {label && (
        <div class="faint small engine-head">
          <span>{label}</span>
          {onPlay && <span>Antippen zum Nachspielen</span>}
        </div>
      )}
      {lines.slice(0, max).map((l, k) => {
        const s = lineScoreWhite(fen, l);
        const whiteBetter = s.mate !== null ? s.mate > 0 : (s.cp ?? 0) >= 0;
        const body = (
          <>
            <span class={`ev ${whiteBetter ? "w" : "b"}`}>{formatEval(s.cp, s.mate)}</span>
            <span class="pv">{l.pv_san ?? pvToSan(fen, l.pv)}</span>
            {l.depth ? <span class="depth faint">T{l.depth}</span> : null}
          </>
        );
        return onPlay && l.pv.length ? (
          <button class="engine-line" key={k} onClick={() => onPlay(l.pv)} title="Variante auf dem Brett nachspielen">
            {body}
          </button>
        ) : (
          <div class="engine-line" key={k}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** Horizontal strip of moves under the board on tablets and phones (the full list sits further down). */
function MoveStrip({ moves, idx, onPick }: { moves: MoveData[]; idx: number; onPick: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = ref.current;
    const el = list?.querySelector<HTMLElement>(`[data-ply="${idx}"]`);
    if (!list) return;
    if (!el) {
      list.scrollLeft = 0;
      return;
    }
    list.scrollLeft = el.offsetLeft - list.clientWidth / 2 + el.offsetWidth / 2;
  }, [idx]);
  return (
    <div class="move-strip" ref={ref}>
      {moves.map((m, k) => {
        const white = m.fen_before.split(" ")[1] === "w";
        return (
          <button
            key={k}
            data-ply={k + 1}
            class={`${k + 1 === idx ? "active" : ""}${ERROR_CLASSES.has(m.classification) ? ` err ${m.classification.toLowerCase()}` : ""}`}
            onClick={() => onPick(k + 1)}
          >
            {white || k === 0 ? <span class="faint">{m.move_number}{white ? "." : "..."}</span> : null}
            {m.san}
          </button>
        );
      })}
    </div>
  );
}

interface Explore {
  /** Moves of the game played before the side line starts. */
  base: number;
  fens: string[];
  sans: string[];
  /** UCI of each tried move; ucis[k] leads from fens[k] to fens[k + 1]. */
  ucis: string[];
  lastUci: string | null;
  /** Engine moves (UCI) still to be played when stepping forward through a picked line. */
  pending: string[];
}

function useSwipe(onLeft: () => void, onRight: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0];
      // A touch on a piece picks it up for dragging; only empty squares swipe.
      const onPiece = (e.target as Element | null)?.closest?.(".piece");
      start.current = t && !onPiece ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current;
      const t = e.changedTouches[0];
      start.current = null;
      if (!s || !t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? onLeft : onRight)();
    },
  };
}

export function AnalysisView({ gameId, ply }: { gameId?: string; ply?: number }) {
  const [row, setRow] = useState<StoredGame | null | undefined>(undefined);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [idx, setIdx] = useState(ply ?? 0);
  const [flipped, setFlipped] = useState(false);
  const [usernames, setUsernames] = useState<string[]>([]);
  const [tab, setTab] = useState<"moves" | "report">("moves");
  const [explore, setExplore] = useState<Explore | null>(null);
  const [showArrows, setShowArrows] = useState(true);

  useEffect(() => subscribeQueue(setQueue), []);
  useEffect(() => {
    void getSetting<string[]>("usernames", []).then(setUsernames);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      let r: StoredGame | undefined;
      if (gameId) r = await getGame(gameId);
      else r = (await listGames())[0];
      if (alive) setRow(r ?? null);
    };
    void load();
    const off = onDataChanged(() => void load());
    return () => {
      alive = false;
      off();
    };
  }, [gameId]);

  const stored = useMemo(() => (row ? fromStoredGame(row) : null), [row]);
  const isLive = queue?.current === row?.id && queue?.live;
  const game = isLive ? queue!.live! : stored;
  const queued = row ? queue?.queued.includes(row.id) : false;

  const userColor = row ? getUserColor(row, usernames) : null;
  useEffect(() => {
    setFlipped(userColor === "black");
  }, [row?.id, userColor]);
  useEffect(() => {
    if (ply !== undefined) setIdx(ply);
    setExplore(null);
  }, [ply, gameId]);

  const n = game?.moves.length ?? 0;
  const clamp = (i: number) => Math.max(0, Math.min(n, i));
  const goTo = (i: number) => {
    setExplore(null);
    setIdx(clamp(i));
  };
  const step = (d: 1 | -1) => {
    if (explore) {
      // Inside a side line: back steps undo tried moves, then return to the game;
      // forward steps play the rest of a picked engine line.
      if (d === -1) {
        if (explore.sans.length <= 1) setExplore(null);
        else
          setExplore({
            ...explore,
            fens: explore.fens.slice(0, -1),
            sans: explore.sans.slice(0, -1),
            ucis: explore.ucis.slice(0, -1),
            lastUci: explore.ucis[explore.ucis.length - 2] ?? null,
            pending: [explore.ucis[explore.ucis.length - 1], ...explore.pending],
          });
      } else if (explore.pending.length) {
        setExplore(extendLine(explore, explore.pending[0], explore.pending.slice(1)));
      }
      return;
    }
    setIdx((i) => clamp(i + d));
  };

  // Ply indices of the player's own serious errors, for "jump to next mistake".
  const errorPlies = useMemo(() => {
    if (!game) return [];
    const side = userColor === "black" ? "b" : "w";
    return game.moves
      .map((m, i) => (SERIOUS_ERROR_CLASSES.has(m.classification) && m.fen_before.split(" ")[1] === side ? i : -1))
      .filter((i) => i >= 0);
  }, [game, userColor]);
  const jumpError = (d: 1 | -1) => {
    const target = d === 1 ? errorPlies.find((p) => p + 1 > idx) : [...errorPlies].reverse().find((p) => p + 1 < idx);
    if (target !== undefined) goTo(target + 1);
  };
  const errorPos = errorPlies.indexOf(idx - 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "Home") goTo(0);
      else if (e.key === "End") goTo(n);
      else if (e.key === "Escape") setExplore(null);
      else if (e.key === "f") setFlipped((f) => !f);
      else if (e.key === "n") jumpError(1);
      else if (e.key === "N" || e.key === "p") jumpError(-1);
      else if (e.key === "a") setShowArrows((v) => !v);
      else if (e.key === "b" && review) setTab((t) => (t === "report" ? "moves" : "report"));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const review = useMemo(() => {
    if (!stored || stored.summary.analysis_status !== "completed") return null;
    try {
      return buildGameReview(stored, userColor ?? "white");
    } catch {
      return null;
    }
  }, [stored, userColor]);
  useEffect(() => {
    if (!review) setTab("moves");
  }, [review]);

  const exploreFen = explore ? explore.fens[explore.fens.length - 1] : null;
  const live = usePositionLines(exploreFen);
  const verdicts = useVerdicts(
    explore ? explore.ucis.map((uci, k) => ({ fenBefore: explore.fens[k], uci, fenAfter: explore.fens[k + 1] })) : [],
  );
  const lastVerdict = verdicts.length ? verdicts[verdicts.length - 1] : null;
  const swipe = useSwipe(
    () => step(1),
    () => step(-1),
  );

  if (row === undefined) return <div class="skeleton" style={{ height: "60vh" }} />;
  if (!row || !game) {
    return (
      <div class="empty">
        <h3>Noch keine Partie ausgewählt</h3>
        <p>Wähle eine Partie aus deiner Liste, um sie Zug für Zug durchzugehen.</p>
        <button class="btn primary" onClick={() => navigate({ view: "games" })}>
          Partien öffnen
        </button>
      </div>
    );
  }

  const i = clamp(idx);
  const move = i > 0 ? game.moves[i - 1] : null;
  const gameFen = move ? fenAfter(move) : (game.moves[0]?.fen_before ?? game.metadata.starting_fen ?? new Chess().fen());
  const fen = exploreFen ?? gameFen;

  const arrows: Arrow[] = [];
  if (showArrows && !explore && move && move.best_move && move.best_move !== move.uci && move.classification && move.classification !== "Book" && !TOP_CLASSES.has(move.classification)) {
    const b = sq(move.best_move);
    if (b) arrows.push({ ...b, kind: "best" });
  }
  if (showArrows && explore && !explore.pending.length && live.lines[0]?.pv[0]) {
    const b = sq(live.lines[0].pv[0]);
    if (b) arrows.push({ ...b, kind: "hint" });
  }

  // Lines for the shown position: stored with the next game move, or live in a side line.
  const nextMove = game.moves[i];
  const storedLines = !explore && nextMove?.multi_pvs?.length ? nextMove.multi_pvs : [];

  let wc = winChanceAt(game.moves, i);
  let evalLabel = move
    ? move.classification
      ? formatEval(move.eval_after_cp, move.eval_after_mate)
      : ""
    : game.moves[0]
      ? formatEval(game.moves[0].eval_before_cp, game.moves[0].eval_before_mate)
      : "";
  if (explore && exploreFen) {
    const best = live.lines[0];
    if (best) {
      const s = lineScoreWhite(exploreFen, best);
      wc = getWinProbability(s.cp, s.mate);
      evalLabel = formatEval(s.cp, s.mate);
    } else {
      evalLabel = "…";
    }
  }

  const status = game.summary.analysis_status ?? (game.moves.some((m) => m.classification) ? "paused" : "not_started");
  const analyzing = Boolean(isLive);
  const progress = analyzing && queue ? Math.round((queue.done / Math.max(1, queue.total)) * 100) : 0;
  const top: Side = flipped ? "white" : "black";
  const bottom: Side = flipped ? "black" : "white";
  const nameOf = (c: Side) => (c === "white" ? game.metadata.white : game.metadata.black);
  const eloOf = (c: Side) => (c === "white" ? game.metadata.white_elo : game.metadata.black_elo);
  const acc = (c: Side) => game.summary[c]?.accuracy;

  // Tap-to-move works everywhere: a move that differs from the game starts a side line.
  const board = (() => {
    try {
      return new Chess(fen);
    } catch {
      return null;
    }
  })();
  const legalTargets = (from: string) => (board ? board.moves({ square: from as Square, verbose: true }).map((m) => m.to) : []);
  const tryMove = (from: string, to: string, chosen?: Promotion) => {
    if (!board) return false;
    const promo = board.get(from as Square)?.type === "p" && (to[1] === "8" || to[1] === "1") ? (chosen ?? "q") : undefined;
    let san: string;
    try {
      san = board.move({ from, to, promotion: promo }).san;
    } catch {
      return false;
    }
    const uci = from + to + (promo ?? "");
    if (!explore && nextMove && nextMove.uci.slice(0, 4) === uci.slice(0, 4)) {
      setIdx(i + 1);
      return true;
    }
    const base = explore ?? { base: i, fens: [gameFen], sans: [], ucis: [], lastUci: null, pending: [] };
    setExplore({ ...base, fens: [...base.fens, board.fen()], sans: [...base.sans, san], ucis: [...base.ucis, uci], lastUci: uci, pending: [] });
    return true;
  };
  // Plays the first move of an engine line; forward steps play the rest.
  const playLine = (pv: string[]) => {
    const base: Explore = explore ?? { base: i, fens: [gameFen], sans: [], ucis: [], lastUci: null, pending: [] };
    const next = extendLine(base, pv[0], pv.slice(1, 12));
    if (next !== base) setExplore(next);
  };

  const lastMove = explore ? sq(explore.lastUci) : move ? sq(move.uci) : null;
  // Concrete reasons for an error: the opponent's refutation and the better move.
  const reasons =
    move && !explore && ERROR_CLASSES.has(move.classification)
      ? explainMove({
          fenBefore: move.fen_before,
          uci: move.uci,
          bestPv: move.multi_pvs[0]?.pv ?? move.pv,
          replyPv: nextMove?.multi_pvs[0]?.pv ?? [],
          mateBefore: move.eval_before_mate,
          mateAfter: move.eval_after_mate,
        })
      : [];

  const playerLine = (c: Side, r: number) => (
    <div class="player-line" style={{ gridRow: r }}>
      <span class="who">
        <span class={`side-dot ${c}`} />
        <span>
          {nameOf(c)}
          {eloOf(c) ? <span class="faint"> {eloOf(c)}</span> : null}
        </span>
      </span>
      <span class="player-meta">
        {acc(c) !== undefined && <span class={`pill ${accClass(acc(c))}`}>{acc(c)!.toFixed(1)} %</span>}
        {clockAt(game.moves, explore ? explore.base : i, c) !== null && (
          <span class={`clock${(explore ? explore.base : i) % 2 === (c === "white" ? 0 : 1) && !explore ? " running" : ""}`}>
            {formatClock(clockAt(game.moves, explore ? explore.base : i, c))}
          </span>
        )}
      </span>
    </div>
  );


  return (
    <div>
      <div class="page-title">
        <button class="btn icon" onClick={() => navigate({ view: "games" })} aria-label="Zurück zur Liste">
          <IconBack />
        </button>
        <span class="game-title">
          {game.metadata.white} – {game.metadata.black} <span class="muted">{resultText(game.metadata.result)}</span>
        </span>
        <span class="spacer" />
        <button class="btn small" onClick={() => navigate({ view: "board", fen })} title="Diese Stellung frei weiteranalysieren">
          <IconFreeBoard /> <span class="wide-label">Im Analysebrett</span>
        </button>
        <button
          class="btn icon ghost danger"
          aria-label="Partie löschen"
          onClick={() => {
            if (confirm(`Partie ${game.metadata.white} – ${game.metadata.black} löschen?`)) {
              void deleteGame(row.id).then(() => navigate({ view: "games" }, true));
            }
          }}
        >
          <IconTrash />
        </button>
      </div>
      <div class="analysis">
        <div class="board-area">
          {playerLine(top, 1)}
          <EvalBar wc={wc} flipped={flipped} label={evalLabel} />
          <div style={{ gridRow: 2, gridColumn: 2 }} {...swipe}>
            <Board
              fen={fen}
              flipped={flipped}
              lastMove={lastMove}
              arrows={arrows}
              badge={explore ? (lastVerdict?.classification || undefined) : move?.classification}
              onMove={tryMove}
              legalTargets={legalTargets}
              annotate
            />
          </div>
          {playerLine(bottom, 3)}
          <div class="controls" style={{ gridRow: 4 }}>
            <button class="btn" onClick={() => goTo(0)} aria-label="Zum Anfang">
              <IconFirst />
            </button>
            <button class="btn" onClick={() => step(-1)} aria-label="Zug zurück">
              <IconPrev />
            </button>
            <button class="btn" onClick={() => step(1)} aria-label="Zug vor" disabled={Boolean(explore && !explore.pending.length)}>
              <IconNext />
            </button>
            <button class="btn" onClick={() => goTo(n)} aria-label="Zum Ende">
              <IconLast />
            </button>
            <button class="btn" onClick={() => setFlipped((f) => !f)} aria-label="Brett drehen" title="Brett drehen (F)">
              <IconFlip />
            </button>
            <button
              class={`btn${showArrows ? " on" : ""}`}
              onClick={() => setShowArrows((v) => !v)}
              aria-pressed={showArrows}
              aria-label="Pfeil für den besten Zug ein- oder ausblenden"
              title="Bester-Zug-Pfeil (A)"
            >
              <IconArrow />
            </button>
            {errorPlies.length > 0 && !explore && (
              <div class="error-nav" role="group" aria-label="Eigene Fehler">
                <button class="btn" onClick={() => jumpError(-1)} disabled={!errorPlies.some((p) => p + 1 < idx)} aria-label="Voriger eigener Fehler" title="Voriger eigener Fehler (P)">
                  <IconPrev />
                </button>
                <span class="error-count tnum">
                  {errorPos >= 0 ? `Fehler ${errorPos + 1}/${errorPlies.length}` : `${errorPlies.length} Fehler`}
                </span>
                <button class="btn" onClick={() => jumpError(1)} disabled={!errorPlies.some((p) => p + 1 > idx)} aria-label="Nächster eigener Fehler" title="Nächster eigener Fehler (N)">
                  <IconNext />
                </button>
              </div>
            )}
          </div>
          <div class="strip-row" style={{ gridRow: 5 }}>
            <MoveStrip moves={game.moves} idx={explore ? explore.base : i} onPick={goTo} />
          </div>
        </div>

        <div class="side-panel">
          {status !== "completed" || analyzing ? (
            <div class="card">
              {analyzing ? (
                <>
                  <div class="row" style={{ justifyContent: "space-between", marginBottom: "8px" }}>
                    <strong>Analyse läuft … {progress} %</strong>
                    <button class="btn small" onClick={cancelCurrent}>
                      <IconStop /> Pause
                    </button>
                  </div>
                  <div class="progress">
                    <div style={{ width: `${progress}%` }} />
                  </div>
                  <p class="muted small" style={{ marginBottom: 0 }}>
                    Stockfish rechnet direkt auf diesem Gerät. Du kannst währenddessen durch die Partie blättern.
                  </p>
                </>
              ) : (
                <>
                  <p style={{ marginTop: 0 }}>
                    {status === "paused" ? "Die Analyse wurde unterbrochen." : "Diese Partie ist noch nicht analysiert."}
                  </p>
                  <button class="btn primary" disabled={queued} onClick={() => enqueue([row.id], { front: true })}>
                    <IconPlay /> {queued ? "In der Warteschlange" : status === "paused" ? "Analyse fortsetzen" : "Partie analysieren"}
                  </button>
                </>
              )}
            </div>
          ) : null}

          <div class="card">
            {explore ? (
              <>
                <div class="explore-bar">
                  <span class="pill accent">Eigene Variante</span>
                  <span class="spacer" />
                  <button class="btn small" onClick={() => setExplore(null)}>
                    Zurück zur Partie
                  </button>
                </div>
                <LineMoves startFen={explore.fens[0]} sans={explore.sans} verdicts={verdicts} />
                {explore.sans.length > 0 && <VerdictCard san={explore.sans[explore.sans.length - 1]} verdict={lastVerdict} />}
                {live.busy && !live.lines.length ? (
                  <p class="muted small" style={{ marginBottom: 0 }}>
                    Stockfish rechnet …
                  </p>
                ) : (
                  <EngineLines fen={exploreFen!} lines={live.lines} label="Beste Fortsetzungen" onPlay={explore.pending.length ? undefined : playLine} />
                )}
              </>
            ) : move ? (
              <div class="move-explain">
                <Coach
                  mood={moodFor(move.classification)}
                  tone={CLASS_TONE[move.classification]}
                  title={
                    <>
                      {badgeFor(move.classification) && <img src={badgeFor(move.classification)!} alt="" />}
                      <span style={{ color: CLASS_TONE[move.classification] }}>{moveVerdict(move)}</span>
                    </>
                  }
                >
                  {!reasons.length && (
                    <div>
                      {move.classification === "Book" && move.opening_name
                        ? move.opening_name
                        : move.explanation || (analyzing ? "Ich schaue mir den Zug gerade an …" : "Diesen Zug habe ich noch nicht bewertet.")}
                    </div>
                  )}
                  {reasons.length > 0 && (
                    <ul class="reasons">
                      {reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                  {move.classification && move.classification !== "Book" && <MoveFacts move={move} />}
                  {move.best_move && move.best_move !== move.uci && move.multi_pvs[0]?.pv_san && move.classification !== "Book" && !TOP_CLASSES.has(move.classification) && !reasons.some((r) => r.startsWith("Besser war") || r.startsWith("Du hattest Matt")) && (
                    <div class="small" style={{ marginTop: "4px" }}>
                      Besser war: <strong>{move.multi_pvs[0].pv_san.split(" ").slice(0, 6).join(" ")}</strong>
                    </div>
                  )}
                </Coach>
                <EngineLines fen={gameFen} lines={storedLines} label="Engine in dieser Stellung" onPlay={playLine} />
              </div>
            ) : (
              <div>
                <Coach
                  mood="happy"
                  title={review && tab === "moves" ? review.headline : "Lass uns die Partie zusammen durchgehen!"}
                >
                  <p class="small">
                    {shortOpening(game.metadata.opening) || game.metadata.event} · {formatDate(game.metadata.date)}
                  </p>
                  <p class="small">
                    Blättere mit den Pfeilen oder wische über das Brett. Ich sage dir zu jedem Zug, wie gut er war und was
                    besser gewesen wäre. Ziehe selbst eine Figur, um eine eigene Variante auszuprobieren.
                  </p>
                </Coach>
                <EngineLines fen={gameFen} lines={storedLines} label="Engine in dieser Stellung" onPlay={playLine} />
              </div>
            )}
          </div>

          {review && (
            <div class="segmented full">
              <button class={tab === "moves" ? "active" : ""} onClick={() => setTab("moves")}>
                Züge
              </button>
              <button class={tab === "report" ? "active" : ""} onClick={() => setTab("report")}>
                Bericht · Note {review.grade.split(" ")[0]}
              </button>
            </div>
          )}

          {tab === "moves" || !review ? (
            <>
              <EvalGraph moves={game.moves} idx={explore ? explore.base : i} onPick={goTo} userColor={userColor} />
              <MoveList moves={game.moves} idx={explore ? explore.base : i} onPick={goTo} />
            </>
          ) : (
            <>
              <div class="card review-card">
                <Coach mood={review.grade.startsWith("1") || review.grade.startsWith("2") ? "wow" : review.grade.startsWith("5") || review.grade.startsWith("6") ? "sad" : "happy"} title={review.headline}>
                  <p class="small">
                    {COACH_NAME} gibt dir für diese Partie die Note <strong>{review.grade}</strong>.
                  </p>
                </Coach>
                <div class="review-duel">
                  {(["white", "black"] as const).map((c) => (
                    <div class={`duel-side${userColor === c ? " me" : ""}`} key={c}>
                      <span class="small muted">{nameOf(c)}</span>
                      <span class={`duel-acc ${c}`}>{acc(c) !== undefined ? acc(c)!.toFixed(1) : "–"}</span>
                      <span class="faint small">Genauigkeit</span>
                    </div>
                  ))}
                </div>
                <ClassTable game={game} />
                {review.phases.length > 0 && (
                  <>
                    <h4>Genauigkeit nach Phase</h4>
                    <BarList
                      rows={review.phases.map((p) => ({
                        label: p.name,
                        value: p.accuracy,
                        valueText: p.accuracy !== null ? `${p.accuracy.toFixed(0)} % · ${p.grade}` : "–",
                        note: `${p.moves} Züge${p.errors ? ` · ${p.errors} Fehler` : ""}`,
                      }))}
                    />
                  </>
                )}
                {userColor && game.summary[userColor] && (
                  <>
                    <h4>Deine Zugqualität</h4>
                    <StackBar segments={qualitySegments(game.summary[userColor] as Record<string, number>)} />
                  </>
                )}
                <h4>Fazit</h4>
                {review.positives.map((t) => (
                  <div class="insight pos small" key={t}>
                    {t}
                  </div>
                ))}
                {review.negatives.map((t) => (
                  <div class="insight neg small" key={t}>
                    {t}
                  </div>
                ))}
              </div>
              <div class="card">
                <AiAnswer
                  cacheKey={`game:${game.game_id}`}
                  title="Partie erklärt"
                  saveTitle={`Partie erklärt: ${game.metadata.white} – ${game.metadata.black}, ${formatDate(game.metadata.date)}`}
                  start="Partie vom KI-Coach erklären lassen"
                  messages={async () => {
                    const me = userColor ?? "white";
                    // The profile lets the coach say whether an error is typical for the player.
                    const profile = await loadFullProfile().catch(() => null);
                    const opp = me === "white" ? "black" : "white";
                    const elo = (c: Side) => Number(game.metadata[c === "white" ? "white_elo" : "black_elo"]) || null;
                    return gameCoachMessages(review, {
                      white: game.metadata.white,
                      black: game.metadata.black,
                      result: game.metadata.result,
                      opening: game.metadata.opening ?? "",
                      userColor: me,
                      userAccuracy: acc(me) ?? null,
                      opponentAccuracy: acc(opp) ?? null,
                      userRating: elo(me),
                      opponentRating: elo(opp),
                    }, { moves: game.moves, profile: coachDetail() === "compact" ? null : profile });
                  }}
                />
              </div>
              {review.key_moments.length > 0 && (
                <div class="card">
                  <h3>Schlüsselmomente</h3>
                  {review.key_moments.map((k) => {
                    const m = game.moves[k.ply_index];
                    const badge = m ? badgeFor(m.classification) : null;
                    return (
                      <button key={k.ply_index} class="moment" onClick={() => goTo(k.ply_index + 1)}>
                        {badge ? <img src={badge} alt="" /> : null}
                        <span>
                          <strong>{k.title.includes(k.move_label) ? k.title : `${k.move_label} ${k.title}`}</strong>
                          <div class="small muted">{k.text}</div>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {review.lessons.length > 0 && (
                <div class="card">
                  <h3>Was du mitnehmen kannst</h3>
                  <ul style={{ margin: 0, paddingLeft: "18px" }}>
                    {review.lessons.map((l) => (
                      <li key={l} class="small" style={{ marginBottom: "4px" }}>
                        {l}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
