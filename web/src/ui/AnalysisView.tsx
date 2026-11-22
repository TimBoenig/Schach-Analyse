import { Chess, type Square } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { enqueue, cancelCurrent, subscribeQueue, type QueueState } from "../app/analysisService";
import { LiveDepth } from "./LiveDepth";
import { DEPTH_PRESETS, deeperPreset, settingsLabel, type DepthPreset } from "../domain/analysisDepth";
import { lineScoreWhite, pvToSan } from "../domain/analyzer";
import { type Explanation, explainMoveDetailed } from "../domain/explain";
import { getWinProbability } from "../domain/math";
import { getUserColor } from "../domain/metrics";
import { glanzzuege, nextStop, stopsOf, type JumpSide } from "../domain/moveJump";
import { buildGameReview, openingParts, ownStanding, sameSpeedAccuracies, type Standing } from "../domain/profile";
import { bookKey } from "../domain/book";
import { SERIOUS_ERROR_CLASSES } from "../domain/profile/features";
import type { Classification, GameAnalysis, MoveData, PvLine, StoredGame } from "../domain/types";
import { deleteGame, getGame, getSetting, listGames, onDataChanged } from "../storage/db";
import { fromStoredGame } from "../storage/rows";
import { BrilliantFx } from "./BrilliantFx";
import { Board, type Arrow, type Promotion } from "./Board";
import { IconArrow, IconBack, IconBolt, IconSpark, IconChevron, IconFreeBoard, IconFirst, IconFlip, IconInfo, IconLast, IconNext, IconPlay, IconPrev, IconSearch, IconStop, IconTrash } from "./icons";
import { useHoldRepeat } from "./hold";
import { MoreMenu } from "./MoreMenu";
import { useNarrow } from "./useNarrow";
import { PhoneReport, type SheetPart } from "./report/PhoneReport";
import {
  CLASSIFICATION_ORDER,
  accClass,
  badgeFor,
  CLASS_COLOR,
  classLabel,
  formatDate,
  formatEval,
  moveVerdict,
  resultText,
  shortOpening,
  SPEED_DE,
} from "./labels";
import { isTyping } from "./keys";
import { LineMoves, MoveFacts, VerdictCard } from "./LiveLine";
import { usePositionLines, useVerdicts } from "./useLive";
import { navigate } from "./router";
import { OpeningLine } from "./OpeningLine";
import { GradeBadge, ReportPanel } from "./report/ReportPanel";
import { GuideButton, usePageGuide } from "./stage/PageGuide";
import { REPORT_INTRO } from "./stage/ReportStory";
import { currentShow, markSeen, openStage, takeAuto, wasSeen } from "./stage/store";
import { useBook } from "./useBook";
import { activeIn, extendLine, lineMoveNumber, mergeLine, resumeLine, startLine, threatFen, type Explore } from "./sideLines";
import { ENGINE_NAME } from "../engine/info";
import { EngineWait } from "./EngineWait";
import { t, tj, tStored } from "../i18n";

const ENGINE_PREF_KEY = "schach.analysis.engine";

function readEnginePref(): { live: boolean; threat: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(ENGINE_PREF_KEY) ?? "{}");
    return { live: Boolean(v.live), threat: Boolean(v.threat) };
  } catch {
    return { live: false, threat: false };
  }
}

function writeEnginePref(v: { live: boolean; threat: boolean }): void {
  try {
    localStorage.setItem(ENGINE_PREF_KEY, JSON.stringify(v));
  } catch {
    // Private mode: the toggle still works for this visit.
  }
}

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
  if (!m?.classification) return null;
  return m.win_chance_after;
}

/** "+12.4" -> "12": the phone bar is 16 px wide, the colour already says who is ahead. */
export function shortEval(label: string): string {
  const s = label.replace(/^\+/, "");
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) >= 10 ? String(Math.round(n)) : s;
}

export function EvalBar({ wc, flipped, label }: { wc: number | null; flipped: boolean; label: string }) {
  const pct = Math.round((wc ?? 0.5) * 100);
  const whiteAhead = pct >= 50;
  return (
    <div class={`evalbar${flipped ? " flipped" : ""}`} style={{ gridRow: "2" }} aria-label={t("Bewertung {label}", { label })}>
      <div class="white" style={{ height: `${pct}%` }} />
      <div class="mid" />
      <span class={whiteAhead ? "on-white" : "on-black"} style={{ [whiteAhead !== flipped ? "bottom" : "top"]: "5px" }}>
        <span class="eval-long">{label}</span>
        <span class="eval-short">{shortEval(label)}</span>
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
  const tk = Math.max(0, Math.round(s));
  const h = Math.floor(tk / 3600);
  const m = Math.floor((tk % 3600) / 60);
  const sec = String(tk % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

const ERROR_CLASSES = new Set(["Blunder", "Mistake", "Miss", "Inaccuracy"]);
// Moves at least as good as the engine's choice: no "better was" hint, no best-move arrow.
const TOP_CLASSES = new Set(["Best", "Great", "Brilliant"]);

// Explanations read the position statically (a few ms each); keep them while
// the player steps back and forth through a game.
const explanations = new Map<string, Explanation>();

/** Concrete reasons for a stored game move: what it does, stops or allows. */
function explainStored(move: MoveData, next: MoveData | undefined, previous: MoveData | undefined): Explanation {
  const input = {
    fenBefore: move.fen_before,
    uci: move.uci,
    bestPv: move.multi_pvs[0]?.pv ?? move.pv,
    replyPv: next?.multi_pvs[0]?.pv ?? [],
    mateBefore: move.eval_before_mate,
    mateAfter: move.eval_after_mate,
    classification: move.classification,
    previousMove: previous ? { uci: previous.uci, san: previous.san } : undefined,
  };
  const key = `${previous?.uci ?? ""}|${input.fenBefore}|${input.uci}|${input.classification}|${input.bestPv.slice(0, 6).join(" ")}|${input.replyPv.slice(0, 8).join(" ")}`;
  let hit = explanations.get(key);
  if (!hit) {
    hit = explainMoveDetailed(input);
    if (explanations.size > 500) explanations.delete(explanations.keys().next().value as string);
    explanations.set(key, hit);
  }
  return hit;
}



function EvalGraph({ moves, idx, onPick, userColor, readonly = false }: { moves: MoveData[]; idx: number; onPick: (i: number) => void; userColor: Side | null; readonly?: boolean }) {
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
    const f = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
    return Math.round(Math.max(0, Math.min(1, f)) * n);
  };
  // The hover index outlives a switch to a shorter game (palette, links), so clamp it.
  const shown = hover !== null && hover <= n ? hover : null;
  const hm = shown !== null && shown > 0 ? moves[shown - 1] : null;
  const hwc = shown !== null ? winChanceAt(moves, shown) : null;
  const userSide = userColor === "black" ? "b" : "w";
  return (
    <div class={`eval-graph-wrap${readonly ? " ro" : ""}`}>
      <svg
        class="eval-graph"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={readonly ? t("Bewertungsverlauf") : t("Bewertungsverlauf, antippen oder ziehen zum Springen")}
        // Drag to scrub through the game, like a video timeline. On a phone the
        // finger belongs to scrolling, so the line is only a picture there.
        onPointerDown={readonly ? undefined : (e) => {
          dragging.current = true;
          (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
          onPick(indexAt(e));
        }}
        onPointerMove={readonly ? undefined : (e) => {
          const i = indexAt(e);
          if (e.pointerType === "mouse") setHover(i);
          if (dragging.current) onPick(i);
        }}
        onPointerLeave={readonly ? undefined : () => setHover(null)}
        onPointerUp={readonly ? undefined : () => (dragging.current = false)}
        onPointerCancel={readonly ? undefined : () => (dragging.current = false)}
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
          <strong>{hm ? `${hm.move_number}${hm.fen_before.split(" ")[1] === "w" ? "." : "..."} ${hm.san}` : t("Start")}</strong>
          {hm?.classification && hm.classification !== "Book" ? ` · ${classLabel(hm.classification)}` : ""}
          {hwc !== null && <span class="faint">  {t("· Weiß {n} %", { n: Math.round(hwc * 100) })}</span>}
        </div>
      )}
      <div class="eg-legend faint">
        <span>{t("Gewinnchance Weiß")}</span>
        {bookEnd > 0 && <span>{t("┆ Ende der Theorie")}</span>}
        <span>
          <i class="eg-key blunder" />  {t("Patzer")} <i class="eg-key mistake" />  {t("Fehler")}
        </span>
      </div>
    </div>
  );
}

/**
 * Counts per classification for both sides. Each number is a button: it jumps
 * to that move on the board, and further clicks walk through the others.
 */
function ClassTable({ game, idx, onJump }: { game: GameAnalysis; idx: number; onJump: (stop: number) => void }) {
  const w = game.summary.white;
  const b = game.summary.black;
  if (!w || !b) return null;
  const cell = (c: Classification, side: JumpSide, count: number) => {
    const stops = stopsOf(game.moves, [c], side);
    const cls = side === "white" ? "w" : "b";
    if (!stops.length) return <span class={cls} style={{ color: CLASS_COLOR[c] }}>{count}</span>;
    const at = stops.indexOf(idx);
    const who = side === "white" ? t("Weiß") : t("Schwarz");
    return (
      <button
        class={`${cls} cls-jump${at >= 0 ? " on" : ""}`}
        style={{ color: CLASS_COLOR[c] }}
        onClick={() => onJump(nextStop(stops, idx)!)}
        title={t("Zum Zug springen")}
        aria-label={t("{classLabel}, {who}: {count}. Zum {3}Zug springen", { classLabel: classLabel(c), who, count, 3: at >= 0 && stops.length > 1 ? t("nächsten ") : "" })}
      >
        {at >= 0 && stops.length > 1 ? `${at + 1}/${stops.length}` : count}
      </button>
    );
  };
  return (
    <div class="class-wrap">
      <div class="class-table">
        <span class="muted small">{t("Zugbewertung")}</span>
        <span class="w muted small">{t("Weiß")}</span>
        <span />
        <span class="b muted small">{t("Schwarz")}</span>
        {CLASSIFICATION_ORDER.map((c) => (
          <>
            <span>{classLabel(c)}</span>
            {cell(c, "white", Number(w[c] ?? 0))}
            <img src={badgeFor(c) ?? ""} alt="" />
            {cell(c, "black", Number(b[c] ?? 0))}
          </>
        ))}
      </div>
      <p class="faint small class-hint">{t("Tippe auf eine Zahl, um zu diesen Zügen zu springen.")}</p>
    </div>
  );
}

interface VariationProps {
  lines: Explore[];
  active: { line: Explore; ply: number } | null;
  onPick: (line: Explore, ply: number) => void;
  onDrop: (line: Explore) => void;
}

/** One kept side line, shown under the game move it replaces (lichess move tree style). */
function VariationRow({ line, active, onPick, onDrop }: { line: Explore } & Omit<VariationProps, "lines">) {
  const isActive = active?.line === line;
  return (
    <div class={`variation${isActive ? " current" : ""}`}>
      <span class="var-moves">
        {line.sans.map((san, k) => {
          const num = lineMoveNumber(line, k);
          return (
            <button key={k} class={isActive && active!.ply === k ? "active" : ""} onClick={() => onPick(line, k)} data-var-ply={isActive ? k : undefined}>
              {num && <span class="faint">{num}</span>}
              {san}
            </button>
          );
        })}
      </span>
      <button class="var-drop" onClick={() => onDrop(line)} aria-label={t("Variante entfernen")} title={t("Variante entfernen")}>
        ×
      </button>
    </div>
  );
}

function MoveList({ moves, idx, onPick, variations }: { moves: MoveData[]; idx: number; onPick: (i: number) => void; variations: VariationProps }) {
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
    // Side lines branch off before a game move: list them under that move's row.
    for (const k of [r, r + 1]) {
      const base = startBlack ? k - 1 : k;
      for (const line of variations.lines.filter((l) => l.base === base && items[k])) {
        rows.push(<VariationRow key={`v${base}-${line.ucis.join("")}`} line={line} active={variations.active} onPick={variations.onPick} onDrop={variations.onDrop} />);
      }
    }
  }
  useEffect(() => {
    // Scroll inside the list only; scrollIntoView would also scroll the page on phones.
    const list = ref.current;
    const el = list?.querySelector<HTMLElement>(".variation.current button.active") ?? list?.querySelector<HTMLElement>(`[data-ply="${idx}"]`);
    if (!list || !el) return;
    const top = el.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight / 2;
    }
  }, [idx, variations.active?.ply, variations.active?.line]);
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
  head,
}: {
  fen: string;
  lines: PvLine[];
  label?: string;
  onPlay?: (pv: string[]) => void;
  max?: number;
  /** Replaces the default heading (used for the live engine switches). */
  head?: preact.ComponentChildren;
}) {
  if (!lines.length && !head) return null;
  return (
    <div class="engine-lines">
      {head}
      {!head && label && (
        <div class="faint small engine-head">
          <span>{label}</span>
          {onPlay && <span>{t("Antippen zum Nachspielen")}</span>}
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
          <button class="engine-line" key={k} onClick={() => onPlay(l.pv)} title={t("Variante auf dem Brett nachspielen")}>
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

export function AnalysisView({ gameId, ply }: { gameId?: string; ply?: number }) {
  const narrow = useNarrow();
  const [row, setRow] = useState<StoredGame | null | undefined>(undefined);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [idx, setIdx] = useState(ply ?? 0);
  const [flipped, setFlipped] = useState(false);
  const [usernames, setUsernames] = useState<string[]>([]);
  const [tab, setTab] = useState<"moves" | "report">("moves");
  const [sheetPart, setSheetPart] = useState<SheetPart>("move");
  const openSheet = (part: SheetPart) => {
    setSheetPart(part);
    setTab("report");
  };
  const [explore, setExplore] = useState<Explore | null>(null);
  const [showArrows, setShowArrows] = useState(true);
  // Side lines the player tried in this game, kept in the move list like lichess variations.
  const [sideLines, setSideLines] = useState<Explore[]>([]);
  const [engine, setEngineState] = useState(readEnginePref);
  const setEngine = (next: { live: boolean; threat: boolean }) => {
    setEngineState(next);
    writeEnginePref(next);
  };

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
  useEffect(() => setSideLines([]), [gameId, row?.id]);

  /** Leaves the side line; it stays in the move list to come back to. */
  const leaveLine = () => {
    if (explore) setSideLines((lines) => mergeLine(lines, explore));
    setExplore(null);
  };
  const pickSideLine = (line: Explore, k: number) => {
    if (explore) setSideLines((lines) => mergeLine(lines, explore));
    setIdx(line.base);
    setExplore(resumeLine(line, k));
  };
  const dropSideLine = (line: Explore) => {
    setSideLines((lines) => lines.filter((l) => l !== line));
    if (explore && activeIn([line], explore)) setExplore(null);
  };

  const n = game?.moves.length ?? 0;
  const clamp = (i: number) => Math.max(0, Math.min(n, i));
  const goTo = (i: number) => {
    leaveLine();
    setIdx(clamp(i));
  };
  const step = (d: 1 | -1) => {
    if (explore) {
      // Inside a side line: back steps undo tried moves, then return to the game;
      // forward steps play the rest of a picked engine line.
      if (d === -1) {
        if (explore.sans.length <= 1) leaveLine();
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
  // Jumps from the report: the board sits above the report on phones, so bring it back into view.
  const boardRef = useRef<HTMLDivElement>(null);
  const jumpTo = (stop: number) => {
    goTo(stop);
    const el = boardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) {
      el.scrollIntoView({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  };
  const jumpError = (d: 1 | -1) => {
    const target = d === 1 ? errorPlies.find((p) => p + 1 > idx) : [...errorPlies].reverse().find((p) => p + 1 < idx);
    if (target !== undefined) goTo(target + 1);
  };
  const errorPos = errorPlies.indexOf(idx - 1);
  // Holding a step button runs through the moves and stops at the end of the game (or the line).
  const canStep = (d: 1 | -1) => (explore ? (d === -1 ? true : explore.pending.length > 0) : d === -1 ? clamp(idx) > 0 : clamp(idx) < n);
  const holdBack = useHoldRepeat(() => {
    if (!canStep(-1)) return false;
    step(-1);
  });
  const holdNext = useHoldRepeat(() => {
    if (!canStep(1)) return false;
    step(1);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "Home") goTo(0);
      else if (e.key === "End") goTo(n);
      else if (e.key === "Escape") leaveLine();
      else if (e.key === "ArrowUp") goTo(0);
      else if (e.key === "ArrowDown") goTo(n);
      else if (e.key === "l") setEngine({ ...engine, live: !engine.live });
      else if (e.key === "x") setEngine({ ...engine, threat: !engine.threat });
      else if (e.key === " " && bestPv.current.length) playBest.current();
      else if (e.key === "f") setFlipped((f) => !f);
      else if (e.key === "n") jumpError(1);
      else if (e.key === "N" || e.key === "p") jumpError(-1);
      else if (e.key === "a") setShowArrows((v) => !v);
      else if (e.key === "b" && review) setTab((tk) => (tk === "report" ? "moves" : "report"));
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
    // On a phone the sheet also holds the move and the move list, so it works without a report.
    if (!review && !narrow) setTab("moves");
  }, [review, narrow]);

  const highlights = useMemo(() => (game ? glanzzuege(game.moves) : []), [game]);

  // The first report ever opened is told by Lucena in full screen; later ones
  // from the button. It counts as the page's explanation (store.ts SAME_STORY)
  // and as the one show of this visit.
  useEffect(() => {
    if (tab === "report" && review && row && !wasSeen(REPORT_INTRO) && !currentShow() && takeAuto()) {
      markSeen(REPORT_INTRO);
      openStage({ kind: "report", subject: row.id });
    }
  }, [tab, review, row?.id]);

  // Where this game stands among the player's other games of its time control, for the report.
  const [standing, setStanding] = useState<Standing | null>(null);
  useEffect(() => {
    setStanding(null);
    if (!review || !row) return;
    let alive = true;
    void listGames().then((rows) => {
      if (alive) setStanding(ownStanding(review.accuracy, sameSpeedAccuracies(rows, usernames, row.speed_category, row.id)));
    });
    return () => {
      alive = false;
    };
  }, [review, row?.id, usernames]);

  const exploreFen = explore ? explore.fens[explore.fens.length - 1] : null;
  const live = usePositionLines(exploreFen, engine.live ? 3 : 2);
  // The game position, known before the page renders so the engine hooks can run.
  const shownMove = game && clamp(idx) > 0 ? game.moves[clamp(idx) - 1] : null;
  const gameFenNow = game ? (shownMove ? fenAfter(shownMove) : (game.moves[0]?.fen_before ?? game.metadata.starting_fen ?? new Chess().fen())) : null;
  const liveGame = usePositionLines(engine.live && !explore ? gameFenNow : null, 3);
  const threat = usePositionLines(engine.threat ? threatFen(exploreFen ?? gameFenNow ?? "") : null, 1);
  // First move of the best known line, for the space key (lichess: play best move).
  const bestPv = useRef<string[]>([]);
  const playBest = useRef<() => void>(() => undefined);
  const verdicts = useVerdicts(
    explore ? explore.ucis.map((uci, k) => ({ fenBefore: explore.fens[k], uci, fenAfter: explore.fens[k + 1] })) : [],
  );
  const lastVerdict = verdicts.length ? verdicts[verdicts.length - 1] : null;
  const book = useBook();
  // Every position of the game in order, for the opening name.
  const gameFens = useMemo(
    () => (game ? [game.moves[0]?.fen_before ?? game.metadata.starting_fen ?? new Chess().fen(), ...game.moves.map((m, k) => game.moves[k + 1]?.fen_before ?? fenAfter(m))] : []),
    [game?.game_id, game?.moves.length],
  );

  usePageGuide("analysis", Boolean(row && game));

  if (row === undefined) return <div class="skeleton" style={{ height: "60vh" }} />;
  if (!row || !game) {
    return (
      <div class="empty">
        <h3>{t("Noch keine Partie ausgewählt")}</h3>
        <p>{t("Wähle eine Partie aus deiner Liste, um sie Zug für Zug durchzugehen.")}</p>
        <button class="btn primary" onClick={() => navigate({ view: "games" })}>
          
          {t("Partien öffnen")}
        </button>
      </div>
    );
  }

  const i = clamp(idx);
  const move = i > 0 ? game.moves[i - 1] : null;
  const gameFen = gameFenNow!;
  const fen = exploreFen ?? gameFen;

  const arrows: Arrow[] = [];
  // Live engine: arrows for its two best moves in the shown position, the second fainter.
  const liveLines = explore ? live.lines : liveGame.lines;
  const engineArrows = engine.live && showArrows && !(explore && explore.pending.length);
  if (engineArrows) {
    liveLines.slice(0, 2).forEach((l, k) => {
      const a = sq(l.pv[0]);
      if (a) arrows.push({ ...a, kind: k === 0 ? "hint" : "engine2" });
    });
  }
  if (engine.threat && threat.lines[0]?.pv[0]) {
    const a = sq(threat.lines[0].pv[0]);
    if (a) arrows.push({ ...a, kind: "threat" });
  }
  if (!engineArrows && showArrows && !explore && move && move.best_move && move.best_move !== move.uci && move.classification && move.classification !== "Book" && !TOP_CLASSES.has(move.classification)) {
    const b = sq(move.best_move);
    if (b) arrows.push({ ...b, kind: "best" });
  }
  if (!engineArrows && showArrows && explore && !explore.pending.length && live.lines[0]?.pv[0]) {
    const b = sq(live.lines[0].pv[0]);
    if (b) arrows.push({ ...b, kind: "hint" });
  }

  // Lines for the shown position: stored with the next game move, or live in a side line.
  const nextMove = game.moves[i];
  const storedLines = !explore && nextMove?.multi_pvs?.length ? nextMove.multi_pvs : [];
  const gameLines = engine.live && liveGame.lines.length ? liveGame.lines : storedLines;
  bestPv.current = (explore ? live.lines[0]?.pv : gameLines[0]?.pv) ?? [];
  const depthOf = (lines: PvLine[]) => Math.max(0, ...lines.map((l) => Number(l.depth) || 0));
  const threatLine = threat.lines[0];
  const engineHead = (lines: PvLine[], busy: boolean) =>
    narrow ? (
      // The switches live in the three-dot menu on a phone; only the depth stays.
      engine.live || lines.length ? (
        <div class="engine-switches slim">
          <span class="faint small engine-depth">
            {engine.live ? `${ENGINE_NAME} live · ` : ""}
            {engine.live && busy ? t("rechnet …") : lines.length && depthOf(lines) ? t("Tiefe {depthOf}", { depthOf: depthOf(lines) }) : ""}
          </span>
        </div>
      ) : null
    ) : (
    <div class="engine-switches">
      <label class="switch-pill" title={t("{ENGINE_NAME} rechnet live mit, drei beste Züge als Pfeile (L)", { ENGINE_NAME })}>
        <input type="checkbox" checked={engine.live} onChange={() => setEngine({ ...engine, live: !engine.live })} />
        <span>{t("{ENGINE_NAME} live", { ENGINE_NAME })}</span>
      </label>
      <label class="switch-pill" title={t("Zeigt, was der Gegner droht, wenn du jetzt nichts tust (X)")}>
        <input type="checkbox" checked={engine.threat} onChange={() => setEngine({ ...engine, threat: !engine.threat })} />
        <span>{t("Drohung")}</span>
      </label>
      <span class="faint small engine-depth">
        {engine.live && busy ? t("rechnet …") : lines.length && depthOf(lines) ? t("Tiefe {depthOf}", { depthOf: depthOf(lines) }) : ""}
      </span>
    </div>
    );
  const threatInfo =
    engine.threat && (exploreFen ?? gameFen) ? (
      <div class="threat-line small">
        {threatFen(exploreFen ?? gameFen) === null ? (
          <span class="faint">{t("Drohung: im Schach nicht verfügbar")}</span>
        ) : threatLine ? (
          <>
            <span class="threat-tag">{t("Drohung")}</span>
            <strong>{threatLine.pv_san?.split(" ").slice(0, 4).join(" ")}</strong>
            <span class="faint"> {formatEval(lineScoreWhite(threatFen(exploreFen ?? gameFen)!, threatLine).cp, lineScoreWhite(threatFen(exploreFen ?? gameFen)!, threatLine).mate)}</span>
          </>
        ) : (
          <span class="faint">{t("Drohung wird berechnet …")}</span>
        )}
      </div>
    ) : null;

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
    const base = explore ?? startLine(i, gameFen);
    setExplore({ ...base, fens: [...base.fens, board.fen()], sans: [...base.sans, san], ucis: [...base.ucis, uci], lastUci: uci, pending: [] });
    return true;
  };
  // Plays the first move of an engine line; forward steps play the rest.
  const playLine = (pv: string[]) => {
    const base: Explore = explore ?? startLine(i, gameFen);
    const next = extendLine(base, pv[0], pv.slice(1, 12));
    if (next !== base) setExplore(next);
  };

  // Space plays the engine's move; when that is the game move, the game simply goes on.
  playBest.current = () => {
    const uci = bestPv.current[0];
    if (!uci) return;
    if (!explore && nextMove && nextMove.uci.slice(0, 4) === uci.slice(0, 4)) setIdx(i + 1);
    else playLine([uci]);
  };
  const lastMove = explore ? sq(explore.lastUci) : move ? sq(move.uci) : null;
  // The current side line shows in the move list while it is being played.
  const shownSideLines = explore ? mergeLine(sideLines, explore) : sideLines;
  // Concrete reasons: the opponent's refutation and the better move for an error,
  // the fork, saved piece or stopped threat for a good move.
  const detail = move && !explore && move.classification && move.classification !== "Book" ? explainStored(move, nextMove, game.moves[i - 2]) : null;
  const reasons = detail?.lines ?? [];
  // The positions up to the shown one, side line included, for the opening name.
  const shownFens = explore ? [...gameFens.slice(0, explore.base + 1), ...explore.fens.slice(1)] : gameFens.slice(0, i + 1);
  // The idea behind the explanation on the board: the threat the move stopped,
  // the fork it sets up, the opponent's refutation.
  const circles: { at: string; kind: Arrow["kind"] }[] = [];
  if (detail && showArrows && !engineArrows) {
    for (const a of detail.arrows) {
      if (!arrows.some((x) => x.from === a.from && x.to === a.to)) arrows.push({ from: a.from, to: a.to, kind: a.by === "opp" ? "threat" : "hint" });
    }
    for (const at of detail.squares) circles.push({ at, kind: "user" });
  }

  const reportDetails = (
                <>
                  <ClassTable game={game} idx={explore ? -1 : i} onJump={jumpTo} />
                  {highlights.length > 0 && (
                    <>
                      <h4>{t("Glanzzüge dieser Partie")}</h4>
                      <div class="glanz-moves">
                        {highlights.map((h) => (
                          <button
                            key={h.stop}
                            class={`glanz-move${!explore && h.stop === i ? " on" : ""}`}
                            style={{ "--tone": CLASS_COLOR[h.classification] }}
                            onClick={() => jumpTo(h.stop)}
                            title={t("{classLabel}: zum Zug springen", { classLabel: classLabel(h.classification) })}
                          >
                            <img src={badgeFor(h.classification) ?? ""} alt={classLabel(h.classification)} />
                            <span class={`side-dot ${h.side}`} />
                            {h.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  <DepthNote game={game} queued={Boolean(queued)} onDeeper={(p) => enqueue([row.id], { front: true, restart: true, settings: DEPTH_PRESETS[p].settings })} />
                </>
  );

  const phoneBanner = explore ? (

                <div class="an-banner">
                  <span class="pill accent">{t("Eigene Variante")}</span>
                  <span class="an-banner-text">{explore.sans.slice(-3).join(" ")}</span>
                  <button class="btn small" onClick={leaveLine}>
                    {t("Zurück")}
                  </button>
                </div>
              ) : move && move.classification ? (
                <button class="an-banner" style={{ "--tone": CLASS_COLOR[move.classification] ?? "var(--text-3)" }} onClick={() => openSheet("move")}>
                  {badgeFor(move.classification) && <img src={badgeFor(move.classification)!} alt="" width={22} height={22} />}
                  <span class="an-banner-text">{moveVerdict(move)}</span>
                  <IconChevron />
                </button>
              ) : review ? (
                <button class="an-banner" onClick={() => openSheet("sum")}>
                  <GradeBadge grade={review.grade} size="tiny" />
                  <span class="an-banner-text">{review.headline}</span>
                  <IconChevron />
                </button>
  ) : null;

  const statusCard = (
    <>
          {status !== "completed" || analyzing ? (
            <div class="card">
              {analyzing ? (
                <>
                  <div class="row" style={{ justifyContent: "space-between", marginBottom: "8px" }}>
                    <strong>{t("Analyse läuft … {progress} %", { progress })}</strong>
                    <button class="btn small" onClick={cancelCurrent}>
                      <IconStop />  {t("Abbrechen")}
                    </button>
                  </div>
                  <div class="progress">
                    <div style={{ width: `${progress}%` }} />
                  </div>
                  {queue && <LiveDepth queue={queue} />}
                  <p class="muted small" style={{ marginBottom: 0 }}>
                    <EngineWait>{t("{ENGINE_NAME} rechnet direkt auf diesem Gerät. Du kannst währenddessen durch die Partie blättern.", { ENGINE_NAME })}</EngineWait>
                  </p>
                </>
              ) : (
                <>
                  <p style={{ marginTop: 0 }}>
                    {status === "paused" ? t("Die Analyse wurde unterbrochen.") : t("Diese Partie ist noch nicht analysiert.")}
                  </p>
                  <button class="btn primary" disabled={queued} onClick={() => enqueue([row.id], { front: true })}>
                    <IconPlay /> {queued ? t("In der Warteschlange") : status === "paused" ? t("Analyse fortsetzen") : t("Partie analysieren")}
                  </button>
                </>
              )}
            </div>
          ) : null}
    </>
  );

  const moveCard = (
          <div class={`card${narrow ? " an-card" : ""}`}>
            {explore ? (
              <>
                <div class="explore-bar">
                  <span class="pill accent">{t("Eigene Variante")}</span>
                  <span class="spacer" />
                  <button class="btn small" onClick={leaveLine}>
                    
                    {t("Zurück zur Partie")}
                  </button>
                </div>
                <LineMoves startFen={explore.fens[0]} sans={explore.sans} verdicts={verdicts} />
                {explore.sans.length > 0 && <VerdictCard san={explore.sans[explore.sans.length - 1]} verdict={lastVerdict} />}
                {live.busy && !live.lines.length ? (
                  <p class="muted small" style={{ marginBottom: 0 }}>
                    <EngineWait>{t("{ENGINE_NAME} rechnet …", { ENGINE_NAME })}</EngineWait>
                  </p>
                ) : (
                  <EngineLines
                    fen={exploreFen!}
                    lines={live.lines}
                    max={engine.live ? 3 : 2}
                    head={<>{engineHead(live.lines, live.busy)}{threatInfo}</>}
                    onPlay={explore.pending.length ? undefined : playLine}
                  />
                )}
              </>
            ) : move ? (
              <div class="move-explain">
                <div class="an-verdict" style={{ "--tone": CLASS_COLOR[move.classification] ?? "var(--text-3)" }}>
                  <div class="an-verdict-head">
                    {badgeFor(move.classification) && <img src={badgeFor(move.classification)!} alt="" width={26} height={26} />}
                    <strong>{moveVerdict(move)}</strong>
                  </div>
                  <div class="an-verdict-body">
                    {move.classification === "Book" ? (
                      <BookNote move={move} next={book?.[bookKey(gameFen)]} />
                    ) : (
                      // The classifier's own line still says why a top move is special ("Einziger guter Zug!").
                      (!reasons.length || move.classification === "Great" || move.classification === "Brilliant") && (
                        <div>{tStored(move.explanation) || (analyzing ? t("Ich schaue mir den Zug gerade an …") : t("Diesen Zug habe ich noch nicht bewertet."))}</div>
                      )
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
                        
                        {tj("Besser war: {x}", { x: <strong>{move.multi_pvs[0].pv_san.split(" ").slice(0, 6).join(" ").replace(/\s+\d+\.$/, "")}</strong> })}
                      </div>
                    )}
                  </div>
                </div>
                <EngineLines fen={gameFen} lines={gameLines} max={engine.live ? 3 : 2} head={<>{engineHead(gameLines, liveGame.busy)}{threatInfo}</>} onPlay={playLine} />
              </div>
            ) : (
              <div>
                <div class="an-intro">
                  {/* With the report open below, its grade, headline and story button stand there; here only the hint. */}
                  {review && tab === "report" ? null : review && narrow ? (
                    <button class="an-intro-lite" onClick={() => setTab("report")}>
                      <GradeBadge grade={review.grade} size="tiny" />
                      <span class="an-intro-text">
                        <strong>{review.headline}</strong>
                        <span class="faint">{t("Bericht ansehen")}</span>
                      </span>
                      <IconChevron />
                    </button>
                  ) : review ? (
                    <>
                      <div class="an-intro-top">
                        <GradeBadge grade={review.grade} size="small" />
                        <div class="an-intro-text">
                          <span class="eyebrow">{t("Lucena · deine Partie")}</span>
                          <strong>{review.headline}</strong>
                        </div>
                      </div>
                      <div class="an-intro-actions">
                        <button class="btn primary small" onClick={() => openStage({ kind: "report", subject: row.id })}>
                          <IconPlay />  {t("Lucena erklärt die Partie")}
                        </button>
                        <button class="btn small" onClick={() => setTab("report")}>
                          
                          {t("Bericht lesen")}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div class="an-intro-text">
                      <span class="eyebrow">{t("Lucena · deine Partie")}</span>
                      <strong>{status === "completed" ? t("Geh die Partie Zug für Zug durch.") : t("Sobald die Partie analysiert ist, sage ich dir zu jedem Zug, wie gut er war.")}</strong>
                    </div>
                  )}
                  <p class="an-intro-hint">{t("Pfeiltasten oder Wischen übers Brett blättern. Zieh selbst eine Figur, um eine eigene Variante auszuprobieren.")}</p>
                </div>
                <EngineLines fen={gameFen} lines={gameLines} max={engine.live ? 3 : 2} head={<>{engineHead(gameLines, liveGame.busy)}{threatInfo}</>} onPlay={playLine} />
              </div>
            )}
          </div>
  );

  const playerLine = (c: Side, r: number) => (
    <div class={`player-line ${r === 1 ? "pl-top" : "pl-bot"}`} style={{ gridRow: r }}>
      <span class="who">
        <span class={`side-dot ${c}`} />
        <span>
          {nameOf(c)}
          {eloOf(c) ? <span class="faint"> {eloOf(c)}</span> : null}
        </span>
      </span>
      <span class="player-meta">
        {acc(c) !== undefined && <span class={`pill ${accClass(acc(c))}`}>{acc(c)!.toFixed(1).replace(".", ",")} %</span>}
        {clockAt(game.moves, explore ? explore.base : i, c) !== null && (
          <span class={`clock${(explore ? explore.base : i) % 2 === (c === "white" ? 0 : 1) && !explore ? " running" : ""}`}>
            {formatClock(clockAt(game.moves, explore ? explore.base : i, c))}
          </span>
        )}
      </span>
    </div>
  );


  return (
    <div class={`an-page${narrow ? " phone" : ""}${narrow && tab === "report" ? " sheet" : ""}`}>
      {narrow ? (
        <header class="an-bar">
          <button class="btn icon ghost" onClick={() => navigate({ view: "games" })} aria-label={t("Zurück zur Liste")}>
            <IconBack />
          </button>
          <div class="an-bar-title">
            <strong class="an-result tnum">{resultText(game.metadata.result)}</strong>
            <span class="an-bar-sub">
              {[row.speed_category ? (SPEED_DE[row.speed_category] ?? row.speed_category) : null, formatDate(game.metadata.date), shortOpening(game.metadata.opening)].filter(Boolean).join(" · ")}
            </span>
          </div>
          <MoreMenu
            label={t("Mehr zur Partie")}
            items={[
              { label: t("Brett drehen"), icon: <IconFlip />, onSelect: () => setFlipped((f) => !f) },
              { label: t("Pfeile zeigen"), icon: <IconArrow />, checked: showArrows, onSelect: () => setShowArrows((v) => !v) },
              { label: t("{ENGINE_NAME} live", { ENGINE_NAME }), icon: <IconBolt />, checked: engine.live, onSelect: () => setEngine({ ...engine, live: !engine.live }) },
              { label: t("Drohung zeigen"), icon: <IconInfo />, checked: engine.threat, onSelect: () => setEngine({ ...engine, threat: !engine.threat }) },
              errorPlies.length > 0 && !explore && { label: t("Voriger Fehler"), icon: <IconPrev />, divider: true, disabled: !errorPlies.some((p) => p + 1 < idx), onSelect: () => jumpError(-1) },
              errorPlies.length > 0 && !explore && { label: t("Nächster Fehler"), icon: <IconNext />, disabled: !errorPlies.some((p) => p + 1 > idx), onSelect: () => jumpError(1) },
              { label: t("Zum Anfang"), icon: <IconFirst />, divider: true, onSelect: () => goTo(0) },
              { label: t("Zum Ende"), icon: <IconLast />, onSelect: () => goTo(n) },
              { label: t("Im Analysebrett"), icon: <IconFreeBoard />, divider: true, onSelect: () => navigate({ view: "board", fen }) },
              { label: t("Seite erklären"), icon: <IconSpark />, onSelect: () => openStage({ kind: "page", subject: "analysis" }) },
              {
                label: t("Partie löschen"),
                icon: <IconTrash />,
                danger: true,
                divider: true,
                onSelect: () => {
                  if (confirm(t("Partie {white} – {black} löschen?", { white: game.metadata.white, black: game.metadata.black }))) void deleteGame(row.id).then(() => navigate({ view: "games" }, true));
                },
              },
            ]}
          />
        </header>
      ) : (
      <header class="an-head">
        <button class="btn icon ghost" onClick={() => navigate({ view: "games" })} aria-label={t("Zurück zur Liste")}>
          <IconBack />
        </button>
        <div class="an-head-title">
          <h1>
            <span class="an-player">
              <span class="side-dot white" />
              {game.metadata.white}
              {game.metadata.white_elo ? <span class="faint tnum">{game.metadata.white_elo}</span> : null}
            </span>
            <span class="an-result tnum">{resultText(game.metadata.result)}</span>
            <span class="an-player">
              <span class="side-dot black" />
              {game.metadata.black}
              {game.metadata.black_elo ? <span class="faint tnum">{game.metadata.black_elo}</span> : null}
            </span>
          </h1>
          <p class="an-head-sub">
            {[row.speed_category ? (SPEED_DE[row.speed_category] ?? row.speed_category) : null, formatDate(game.metadata.date), shortOpening(game.metadata.opening)].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span class="spacer" />
        <div class="an-head-actions">
          <button class="btn small" onClick={() => navigate({ view: "board", fen })} title={t("Diese Stellung frei weiteranalysieren")}>
            <IconFreeBoard /> <span class="wide-label">{t("Im Analysebrett")}</span>
          </button>
          <GuideButton id="analysis" />
          <button
            class="btn icon ghost danger"
            aria-label={t("Partie löschen")}
            title={t("Partie löschen")}
            onClick={() => {
              if (confirm(t("Partie {white} – {black} löschen?", { white: game.metadata.white, black: game.metadata.black }))) {
                void deleteGame(row.id).then(() => navigate({ view: "games" }, true));
              }
            }}
          >
            <IconTrash />
          </button>
        </div>
      </header>
      )}
      <div class="analysis">
        <div class="board-area" ref={boardRef}>
          {playerLine(top, 1)}
          <EvalBar wc={wc} flipped={flipped} label={evalLabel} />
          <div class="board-fx-wrap" style={{ gridRow: 2, gridColumn: 2 }}>
            <Board
              fen={fen}
              flipped={flipped}
              lastMove={lastMove}
              arrows={arrows}
              circles={circles}
              badge={explore ? (lastVerdict?.classification || undefined) : move?.classification}
              onMove={tryMove}
              legalTargets={legalTargets}
              annotate
              onSwipe={(dir) => step(dir === "left" ? 1 : -1)}
            />
            {/* Stepping onto a brilliant move replays its celebration, in a finished analysis as in exploration. */}
            {lastMove && (explore ? lastVerdict?.classification : move?.classification) === "Brilliant" && (
              <BrilliantFx key={`${i}:${explore?.lastUci ?? ""}`} square={lastMove.to} flipped={flipped} san={explore ? explore.sans[explore.sans.length - 1] : move?.san} />
            )}
          </div>
          {playerLine(bottom, 3)}
          {narrow && tab !== "report" && phoneBanner ? <div class="pc-banner">{phoneBanner}</div> : null}
          {narrow ? (
            <div class="pc-controls" style={{ gridRow: 4 }}>
              <button class="btn pc-step" aria-label={t("Zug zurück")} disabled={!canStep(-1)} {...holdBack}>
                <IconPrev />
              </button>
              <button
                class={`btn pc-lupe${tab === "report" ? " on" : ""}`}
                aria-label={t("Bericht und Zug erklärt")}
                aria-pressed={tab === "report"}
                onClick={() => (tab === "report" ? setTab("moves") : openSheet(review ? "sum" : "move"))}
              >
                <IconSearch />
                <span>{t("Analyse")}</span>
              </button>
              <button class="btn pc-step" aria-label={t("Zug vor")} disabled={!canStep(1)} {...holdNext}>
                <IconNext />
              </button>
            </div>
          ) : (
          <div class="controls" style={{ gridRow: 4 }}>
            <button class="btn" onClick={() => goTo(0)} aria-label={t("Zum Anfang")}>
              <IconFirst />
            </button>
            <button class="btn" aria-label={t("Zug zurück")} {...holdBack}>
              <IconPrev />
            </button>
            <button class="btn" aria-label={t("Zug vor")} disabled={!canStep(1)} {...holdNext}>
              <IconNext />
            </button>
            <button class="btn" onClick={() => goTo(n)} aria-label={t("Zum Ende")}>
              <IconLast />
            </button>
            <button class="btn" onClick={() => setFlipped((f) => !f)} aria-label={t("Brett drehen")} title={t("Brett drehen (F)")}>
              <IconFlip />
            </button>
            <button
              class={`btn${showArrows ? " on" : ""}`}
              onClick={() => setShowArrows((v) => !v)}
              aria-pressed={showArrows}
              aria-label={t("Pfeil für den besten Zug ein- oder ausblenden")}
              title={t("Bester-Zug-Pfeil (A)")}
            >
              <IconArrow />
            </button>
            {errorPlies.length > 0 && !explore && (
              <div class="error-nav" role="group" aria-label={t("Eigene Fehler")}>
                <button class="btn" onClick={() => jumpError(-1)} disabled={!errorPlies.some((p) => p + 1 < idx)} aria-label={t("Voriger eigener Fehler")} title={t("Voriger eigener Fehler (P)")}>
                  <IconPrev />
                </button>
                <span class="error-count tnum">
                  {errorPos >= 0 ? t("Fehler {0}/{length}", { 0: errorPos + 1, length: errorPlies.length }) : t("{length} Fehler", { length: errorPlies.length })}
                </span>
                <button class="btn" onClick={() => jumpError(1)} disabled={!errorPlies.some((p) => p + 1 > idx)} aria-label={t("Nächster eigener Fehler")} title={t("Nächster eigener Fehler (N)")}>
                  <IconNext />
                </button>
              </div>
            )}
          </div>
          )}
          <div class="strip-row" style={{ gridRow: 5 }}>
            <MoveStrip moves={game.moves} idx={explore ? explore.base : i} onPick={goTo} />
          </div>
        </div>

        <div class="side-panel">
          {narrow ? (
            <>
              {statusCard}
              {tab === "report" ? (
                <PhoneReport
                  gameId={row.id}
                  review={review}
                  moves={game.moves}
                  isWhite={userColor !== "black"}
                  names={{ me: nameOf(userColor ?? "white"), opp: nameOf(userColor === "black" ? "white" : "black") }}
                  speed={row.speed_category}
                  standing={standing}
                  idx={explore ? explore.base : i}
                  onJump={jumpTo}
                  onPeek={goTo}
                  details={reportDetails}
                  part={sheetPart}
                  onPart={setSheetPart}
                  onClose={() => setTab("moves")}
                  moveView={
                    <>
                      <OpeningLine fens={shownFens} book={book} />
                      {moveCard}
                    </>
                  }
                  listView={
                    <>
                      <EvalGraph moves={game.moves} idx={explore ? explore.base : i} onPick={goTo} userColor={userColor} readonly />
                      <MoveList
                        moves={game.moves}
                        idx={explore ? -1 : i}
                        onPick={goTo}
                        variations={{ lines: shownSideLines, active: activeIn(shownSideLines, explore), onPick: pickSideLine, onDrop: dropSideLine }}
                      />
                    </>
                  }
                />
              ) : null}
            </>
          ) : (
            <>
              <OpeningLine fens={shownFens} book={book} />
              {statusCard}
              {moveCard}
          {review && (
            <div class="segmented full">
              <button class={tab === "moves" ? "active" : ""} onClick={() => setTab("moves")}>
                
                {t("Züge")}
              </button>
              <button class={tab === "report" ? "active" : ""} onClick={() => setTab("report")}>
                
                {t("Bericht · Note {n}", { n: review.grade.split(" ")[0] })}
              </button>
            </div>
          )}

          {tab === "moves" || !review ? (
            <>
              <EvalGraph moves={game.moves} idx={explore ? explore.base : i} onPick={goTo} userColor={userColor} />
              <MoveList
                moves={game.moves}
                idx={explore ? -1 : i}
                onPick={goTo}
                variations={{ lines: shownSideLines, active: activeIn(shownSideLines, explore), onPick: pickSideLine, onDrop: dropSideLine }}
              />
            </>
          ) : (
            <ReportPanel
              gameId={row.id}
              review={review}
              moves={game.moves}
              isWhite={userColor !== "black"}
              names={{ me: nameOf(userColor ?? "white"), opp: nameOf(userColor === "black" ? "white" : "black") }}
              speed={row.speed_category}
              standing={standing}
              idx={explore ? explore.base : i}
              onJump={jumpTo}
              details={reportDetails}
            />
          )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** A theory move: the opening it belongs to and the known continuations. */
function BookNote({ move, next }: { move: MoveData; next: [string, string, string[]] | undefined }) {
  // The live book wins over the stored name, which older analyses got wrong.
  const name = next?.[1] || move.opening_name;
  const parts = name ? openingParts(name) : null;
  const continuations = next?.[2] ?? move.candidate_continuations ?? [];
  return (
    <div>
      {parts ? (
        <>
          
          {tj("Theorie: {main}", { main: <strong>{parts.main}</strong> })}
          {parts.variation && <span class="muted"> · {parts.variation}</span>}
        </>
      ) : (
        t("Ein bekannter Eröffnungszug.")
      )}
      {continuations.length > 0 && (
        <div class="small muted" style={{ marginTop: "4px" }}>
          
          {t("Bekannte Fortsetzungen: {n}{n2}", { n: continuations.slice(0, 6).join(", "), n2: continuations.length > 6 ? " …" : "" })}
        </div>
      )}
    </div>
  );
}

/** Which depth the game was analysed with, and a deeper re-run for close calls. */
function DepthNote({ game, queued, onDeeper }: { game: GameAnalysis; queued: boolean; onDeeper: (p: DepthPreset) => void }) {
  const depth = Number(game.summary.analysis_depth) || null;
  const movetimeMs = Number(game.summary.analysis_movetime_ms) || null;
  // Games analysed before the depth was stored count as "Normal".
  const next = deeperPreset({ depth: depth ?? DEPTH_PRESETS.normal.settings.depth });
  if (!depth && !next) return null;
  return (
    <div class="analysis-depth-note small">
      <span class="faint">{depth && movetimeMs ? t("Analysiert mit {settingsLabel}", { settingsLabel: settingsLabel({ depth, movetimeMs }) }) : t("Analysetiefe nicht gespeichert")}</span>
      {next && (
        <button class="btn small" disabled={queued} onClick={() => onDeeper(next)}>
          {queued ? t("In der Warteschlange") : t("Genauer: {name} (Tiefe {depth})", { name: DEPTH_PRESETS[next].name, depth: DEPTH_PRESETS[next].settings.depth })}
        </button>
      )}
    </div>
  );
}
