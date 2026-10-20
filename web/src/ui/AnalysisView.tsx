import { Chess, type Square } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { enqueue, cancelCurrent, getEngine, subscribeQueue, type QueueState } from "../app/analysisService";
import { lineScoreWhite, pvToSan } from "../domain/analyzer";
import { getWinProbability } from "../domain/math";
import { getUserColor } from "../domain/metrics";
import { buildGameReview } from "../domain/profile";
import type { GameAnalysis, MoveData, PvLine, StoredGame } from "../domain/types";
import { deleteGame, getGame, getSetting, listGames, onDataChanged } from "../storage/db";
import { fromStoredGame } from "../storage/rows";
import { Board, type Arrow } from "./Board";
import { IconBack, IconFirst, IconFlip, IconLast, IconNext, IconPlay, IconPrev, IconStop, IconTrash } from "./icons";
import { CLASSIFICATION_ORDER, accClass, badgeFor, classLabel, formatDate, formatEval, resultText, shortOpening } from "./labels";
import { navigate } from "./router";

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
  if (!m.classification) return null;
  return m.win_chance_after;
}

function EvalBar({ wc, flipped, label }: { wc: number | null; flipped: boolean; label: string }) {
  const pct = Math.round((wc ?? 0.5) * 100);
  return (
    <div class={`evalbar${flipped ? " flipped" : ""}`} style={{ gridRow: "2" }}>
      <div class="white" style={{ height: `${pct}%` }} />
      <span style={{ [pct >= 50 !== flipped ? "bottom" : "top"]: "4px", color: pct >= 50 ? "#222" : "#eee" }}>{label}</span>
    </div>
  );
}

function EvalGraph({ moves, idx, onPick }: { moves: MoveData[]; idx: number; onPick: (i: number) => void }) {
  const dragging = useRef(false);
  const n = moves.length;
  if (!n) return null;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const wc = winChanceAt(moves, i);
    if (wc !== null) pts.push([i, wc]);
  }
  if (pts.length < 2) return null;
  const W = 400;
  const H = 110;
  const x = (i: number) => (i / n) * W;
  const y = (wc: number) => (1 - wc) * H;
  const area = `M0,${H} ` + pts.map(([i, wc]) => `L${x(i)},${y(wc)}`).join(" ") + ` L${x(pts[pts.length - 1][0])},${H} Z`;
  const errors = moves
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.classification === "Blunder" || m.classification === "Mistake" || m.classification === "Miss");
  const pick = (e: PointerEvent) => {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    onPick(Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * n));
  };
  return (
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
        pick(e);
      }}
      onPointerMove={(e) => dragging.current && pick(e)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <rect x="0" y="0" width={W} height={H} fill="#3a3d44" />
      <path d={area} fill="#f2f2f2" />
      <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#888" stroke-width="0.5" />
      {errors.map(({ m, i }) => (
        <circle
          key={i}
          cx={x(i + 1)}
          cy={y(m.win_chance_after)}
          r="3.5"
          fill={m.classification === "Blunder" ? "#e5524b" : m.classification === "Miss" ? "#e05a8f" : "#ea933b"}
        />
      ))}
      <line x1={x(idx)} y1="0" x2={x(idx)} y2={H} stroke="#f2aa3c" stroke-width="2" />
    </svg>
  );
}

function ClassTable({ game }: { game: GameAnalysis }) {
  const w = game.summary.white;
  const b = game.summary.black;
  if (!w || !b) return null;
  return (
    <div class="card">
      <div class="class-table">
        <span class="muted small">Zugbewertung</span>
        <span class="w muted small">Weiß</span>
        <span />
        <span class="b muted small">Schwarz</span>
        {CLASSIFICATION_ORDER.map((c) => (
          <>
            <span>{classLabel(c)}</span>
            <span class="w">{w[c] ?? 0}</span>
            <img src={badgeFor(c) ?? ""} alt="" />
            <span class="b">{b[c] ?? 0}</span>
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
        <button key={`m${k}`} class={moveIdx === idx ? "active" : ""} onClick={() => onPick(moveIdx)} data-ply={moveIdx}>
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

function EngineLines({ fen, lines, label }: { fen: string; lines: PvLine[]; label?: string }) {
  if (!lines.length) return null;
  return (
    <div class="engine-lines">
      {label && <div class="faint small">{label}</div>}
      {lines.slice(0, 2).map((l, k) => {
        const s = lineScoreWhite(fen, l);
        const whiteBetter = s.mate !== null ? s.mate > 0 : (s.cp ?? 0) >= 0;
        return (
          <div class="engine-line" key={k}>
            <span class={`ev ${whiteBetter ? "w" : "b"}`}>{formatEval(s.cp, s.mate)}</span>
            <span class="pv">{l.pv_san ?? pvToSan(fen, l.pv)}</span>
          </div>
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
  lastUci: string | null;
}

/** Evaluates a position the user reached by trying their own moves. */
function useLiveEval(fen: string | null): { lines: PvLine[]; busy: boolean } {
  const [lines, setLines] = useState<PvLine[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!fen) {
      setLines([]);
      return;
    }
    let alive = true;
    setBusy(true);
    setLines([]);
    // Short delay so stepping through a line quickly doesn't queue a search per move.
    const t = window.setTimeout(() => {
      getEngine()
        .analyse(fen, { depth: 16, movetimeMs: 1200, multiPv: 2 })
        .then((res) => alive && setLines(res.map((l) => ({ ...l, pv_san: pvToSan(fen, l.pv) }))))
        .catch(() => undefined)
        .finally(() => alive && setBusy(false));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [fen]);
  return { lines, busy };
}

function useSwipe(onLeft: () => void, onRight: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0];
      start.current = t ? { x: t.clientX, y: t.clientY } : null;
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
      // Inside a side line: back steps undo tried moves, then return to the game.
      if (d === -1) {
        if (explore.sans.length <= 1) setExplore(null);
        else
          setExplore({
            ...explore,
            fens: explore.fens.slice(0, -1),
            sans: explore.sans.slice(0, -1),
            lastUci: null,
          });
      }
      return;
    }
    setIdx((i) => clamp(i + d));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
      if (e.key === "Home") goTo(0);
      if (e.key === "End") goTo(n);
      if (e.key === "Escape") setExplore(null);
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
  const live = useLiveEval(exploreFen);
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
  if (!explore && move && move.best_move && move.best_move !== move.uci && move.classification && move.classification !== "Book") {
    const b = sq(move.best_move);
    if (b) arrows.push({ ...b, kind: "best" });
  }
  if (explore && live.lines[0]?.pv[0]) {
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
  const tryMove = (from: string, to: string) => {
    if (!board) return false;
    const promo = board.get(from as Square)?.type === "p" && (to[1] === "8" || to[1] === "1") ? "q" : undefined;
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
    const base = explore ?? { base: i, fens: [gameFen], sans: [], lastUci: null };
    setExplore({ base: base.base, fens: [...base.fens, board.fen()], sans: [...base.sans, san], lastUci: uci });
    return true;
  };

  const lastMove = explore ? sq(explore.lastUci) : move ? sq(move.uci) : null;

  const playerLine = (c: Side, r: number) => (
    <div class="player-line" style={{ gridRow: r }}>
      <span class="who">
        <span class={`side-dot ${c}`} />
        <span>
          {nameOf(c)}
          {eloOf(c) ? <span class="faint"> {eloOf(c)}</span> : null}
        </span>
      </span>
      {acc(c) !== undefined && <span class={`pill ${accClass(acc(c))}`}>{acc(c)!.toFixed(1)} %</span>}
    </div>
  );

  const exploreLine = explore
    ? (() => {
        const startFen = explore.fens[0];
        const parts = startFen.split(" ");
        let num = Number(parts[5]) || 1;
        let white = parts[1] === "w";
        return explore.sans
          .map((s, k) => {
            const label = white ? `${num}. ${s}` : k === 0 ? `${num}... ${s}` : s;
            if (!white) num++;
            white = !white;
            return label;
          })
          .join(" ");
      })()
    : "";

  return (
    <div>
      <div class="page-title">
        <button class="btn icon" onClick={() => navigate({ view: "games" })} aria-label="Zurück zur Liste">
          <IconBack />
        </button>
        <span style={{ fontSize: "18px", minWidth: 0 }}>
          {game.metadata.white} – {game.metadata.black} <span class="muted">{resultText(game.metadata.result)}</span>
        </span>
        <span class="spacer" />
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
              badge={explore ? undefined : move?.classification}
              onMove={tryMove}
              legalTargets={legalTargets}
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
            <button class="btn" onClick={() => step(1)} aria-label="Zug vor" disabled={Boolean(explore)}>
              <IconNext />
            </button>
            <button class="btn" onClick={() => goTo(n)} aria-label="Zum Ende">
              <IconLast />
            </button>
            <button class="btn" onClick={() => setFlipped((f) => !f)} aria-label="Brett drehen">
              <IconFlip />
            </button>
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

          {(acc("white") !== undefined || acc("black") !== undefined) && (
            <div class="acc-row">
              {(["white", "black"] as const).map((c) => (
                <div class="acc-box" key={c}>
                  <div class="muted small who">
                    <span class={`side-dot ${c}`} /> Genauigkeit
                  </div>
                  <div class={`value ${accClass(acc(c))}`}>{acc(c) !== undefined ? `${acc(c)!.toFixed(1)}` : "–"}</div>
                  <div class="faint small">Ø-Verlust {Math.round(game.summary[c]?.acpl ?? 0)} cp</div>
                </div>
              ))}
            </div>
          )}

          <div class="card">
            {explore ? (
              <>
                <div class="explore-bar">
                  <span class="pill accent">Eigene Variante</span>
                  <span class="line-san">{exploreLine}</span>
                  <button class="btn small" onClick={() => setExplore(null)}>
                    Zurück zur Partie
                  </button>
                </div>
                {live.busy && !live.lines.length ? (
                  <p class="muted small" style={{ marginBottom: 0 }}>
                    Stockfish rechnet …
                  </p>
                ) : (
                  <EngineLines fen={exploreFen!} lines={live.lines} label="Beste Fortsetzungen" />
                )}
              </>
            ) : move ? (
              <div class="move-explain">
                {badgeFor(move.classification) && <img src={badgeFor(move.classification)!} alt="" />}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <strong>
                    {move.move_number}
                    {move.fen_before.split(" ")[1] === "w" ? "." : "..."} {move.san}
                  </strong>{" "}
                  {move.classification && <span class="muted">· {classLabel(move.classification)}</span>}
                  <div class="small">
                    {move.classification === "Book" && move.opening_name
                      ? move.opening_name
                      : move.explanation || (analyzing ? "Wird analysiert …" : "Noch nicht bewertet.")}
                  </div>
                  {move.best_move && move.best_move !== move.uci && move.multi_pvs[0]?.pv_san && move.classification !== "Book" && (
                    <div class="small muted" style={{ marginTop: "4px" }}>
                      Besser war: {move.multi_pvs[0].pv_san.split(" ").slice(0, 6).join(" ")}
                    </div>
                  )}
                  <EngineLines fen={gameFen} lines={storedLines} label="Engine in dieser Stellung" />
                </div>
              </div>
            ) : (
              <div>
                <div class="small muted">
                  {shortOpening(game.metadata.opening) || game.metadata.event} · {formatDate(game.metadata.date)}
                </div>
                <EngineLines fen={gameFen} lines={storedLines} label="Engine in dieser Stellung" />
                <p class="faint small" style={{ marginBottom: 0 }}>
                  Tipp: Wische über das Brett zum Blättern, oder ziehe selbst eine Figur, um eine eigene Variante zu prüfen.
                </p>
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
              <EvalGraph moves={game.moves} idx={i} onPick={goTo} />
              <MoveList moves={game.moves} idx={explore ? explore.base : i} onPick={goTo} />
            </>
          ) : (
            <>
              <div class="card">
                <h3>
                  Partie-Bericht <span class="pill accent">Note {review.grade}</span>
                </h3>
                <p style={{ marginTop: 0 }}>
                  <strong>{review.headline}</strong>
                </p>
                {review.phases.length > 0 && (
                  <table class="table" style={{ marginBottom: "10px" }}>
                    <tbody>
                      {review.phases.map((p) => (
                        <tr key={p.phase}>
                          <td>{p.name}</td>
                          <td class="num">{p.accuracy !== null ? `${p.accuracy.toFixed(0)} %` : "–"}</td>
                          <td class="num">{p.grade}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
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
              <ClassTable game={game} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
