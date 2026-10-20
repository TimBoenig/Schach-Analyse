import { Chess } from "chess.js";
import { useEffect, useMemo, useState } from "preact/hooks";

import { enqueue, cancelCurrent, subscribeQueue, type QueueState } from "../app/analysisService";
import { getWinProbability } from "../domain/math";
import { getUserColor } from "../domain/metrics";
import { buildGameReview } from "../domain/profile";
import type { GameAnalysis, MoveData, StoredGame } from "../domain/types";
import { getGame, getSetting, listGames, onDataChanged } from "../storage/db";
import { fromStoredGame } from "../storage/rows";
import { Board, type Arrow } from "./Board";
import { IconBack, IconFirst, IconFlip, IconLast, IconNext, IconPlay, IconPrev, IconStop } from "./icons";
import { CLASSIFICATION_ORDER, badgeFor, classLabel, formatEval, resultText } from "./labels";
import { navigate } from "./router";

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
  return (
    <svg
      class="eval-graph card"
      style={{ padding: 0 }}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onClick={(e) => {
        const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
        onPick(Math.round(((e.clientX - rect.left) / rect.width) * n));
      }}
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
          fill={m.classification === "Blunder" ? "#df4b45" : m.classification === "Miss" ? "#e05a8f" : "#e6913a"}
        />
      ))}
      <line x1={x(idx)} y1="0" x2={x(idx)} y2={H} stroke="#f0a93b" stroke-width="2" />
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
  const rows = [];
  const startBlack = moves[0] && moves[0].fen_before.split(" ")[1] === "b";
  const items: (MoveData | null)[] = startBlack ? [null, ...moves] : [...moves];
  for (let r = 0; r < items.length; r += 2) {
    const num = (moves[0]?.move_number ?? 1) + r / 2;
    rows.push(<span class="num" key={`n${r}`}>{num}.</span>);
    for (const k of [r, r + 1]) {
      const m = items[k];
      if (!m) {
        rows.push(<span key={`e${k}`} />);
        continue;
      }
      const moveIdx = moves.indexOf(m) + 1;
      const badge = badgeFor(m.classification);
      rows.push(
        <button key={`m${k}`} class={moveIdx === idx ? "active" : ""} onClick={() => onPick(moveIdx)} id={`mv-${moveIdx}`}>
          {badge && <img src={badge} alt={classLabel(m.classification)} />}
          {m.san}
        </button>,
      );
    }
  }
  useEffect(() => {
    document.getElementById(`mv-${idx}`)?.scrollIntoView({ block: "nearest" });
  }, [idx]);
  return <div class="movelist">{rows}</div>;
}

export function AnalysisView({ gameId, ply }: { gameId?: string; ply?: number }) {
  const [row, setRow] = useState<StoredGame | null | undefined>(undefined);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [idx, setIdx] = useState(ply ?? 0);
  const [flipped, setFlipped] = useState(false);
  const [usernames, setUsernames] = useState<string[]>([]);

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
    if (userColor === "black") setFlipped(true);
    else setFlipped(false);
  }, [row?.id, userColor]);
  useEffect(() => {
    if (ply !== undefined) setIdx(ply);
  }, [ply, gameId]);

  const n = game?.moves.length ?? 0;
  const clamp = (i: number) => Math.max(0, Math.min(n, i));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") setIdx((i) => clamp(i - 1));
      if (e.key === "ArrowRight") setIdx((i) => clamp(i + 1));
      if (e.key === "Home") setIdx(0);
      if (e.key === "End") setIdx(n);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [n]);

  const review = useMemo(() => {
    if (!stored || stored.summary.analysis_status !== "completed") return null;
    try {
      return buildGameReview(stored, userColor ?? "white");
    } catch {
      return null;
    }
  }, [stored, userColor]);

  if (row === undefined) return <div class="empty">Lade …</div>;
  if (!row || !game) {
    return (
      <div class="empty">
        <p>Noch keine Partie ausgewählt.</p>
        <button class="btn primary" onClick={() => navigate({ view: "games" })}>
          Partien öffnen
        </button>
      </div>
    );
  }

  const i = clamp(idx);
  const move = i > 0 ? game.moves[i - 1] : null;
  const fen = move ? fenAfter(move) : game.moves[0]?.fen_before ?? game.metadata.starting_fen ?? new Chess().fen();
  const arrows: Arrow[] = [];
  if (move && move.best_move && move.best_move !== move.uci && move.classification && move.classification !== "Book") {
    const b = sq(move.best_move);
    if (b) arrows.push({ ...b, kind: "best" });
  }
  const wc = winChanceAt(game.moves, i);
  const evalLabel = move
    ? move.classification
      ? formatEval(move.eval_after_cp, move.eval_after_mate)
      : ""
    : game.moves[0]
      ? formatEval(game.moves[0].eval_before_cp, game.moves[0].eval_before_mate)
      : "";
  const status = game.summary.analysis_status ?? (game.moves.some((m) => m.classification) ? "paused" : "not_started");
  const analyzing = Boolean(isLive);
  const progress = analyzing && queue ? Math.round((queue.done / Math.max(1, queue.total)) * 100) : 0;
  const top = flipped ? "white" : "black";
  const bottom = flipped ? "black" : "white";
  const name = (c: "white" | "black") => {
    const elo = c === "white" ? game.metadata.white_elo : game.metadata.black_elo;
    return `${c === "white" ? game.metadata.white : game.metadata.black}${elo ? ` (${elo})` : ""}`;
  };
  const acc = (c: "white" | "black") => game.summary[c]?.accuracy;

  return (
    <div>
      <div class="page-title">
        <button class="btn icon" onClick={() => navigate({ view: "games" })} aria-label="Zurück">
          <IconBack />
        </button>
        <span style={{ fontSize: "18px" }}>
          {game.metadata.white} – {game.metadata.black} <span class="muted">{resultText(game.metadata.result)}</span>
        </span>
      </div>
      <div class="analysis">
        <div class="board-area">
          <div class="player-line">
            <span>{name(top)}</span>
            {acc(top) !== undefined && <span class="pill">{acc(top)!.toFixed(1)} %</span>}
          </div>
          <EvalBar wc={wc} flipped={flipped} label={evalLabel} />
          <div style={{ gridRow: 2, gridColumn: 2 }}>
            <Board fen={fen} flipped={flipped} lastMove={move ? sq(move.uci) : null} arrows={arrows} badge={move?.classification} />
          </div>
          <div class="player-line" style={{ gridRow: 3 }}>
            <span>{name(bottom)}</span>
            {acc(bottom) !== undefined && <span class="pill">{acc(bottom)!.toFixed(1)} %</span>}
          </div>
          <div class="controls" style={{ gridRow: 4 }}>
            <button class="btn" onClick={() => setIdx(0)} aria-label="Anfang">
              <IconFirst />
            </button>
            <button class="btn" onClick={() => setIdx(clamp(i - 1))} aria-label="Zurück">
              <IconPrev />
            </button>
            <button class="btn" onClick={() => setIdx(clamp(i + 1))} aria-label="Weiter">
              <IconNext />
            </button>
            <button class="btn" onClick={() => setIdx(n)} aria-label="Ende">
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
                    <button class="btn" onClick={cancelCurrent}>
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
                  <div class="muted small">Genauigkeit {c === "white" ? "Weiß" : "Schwarz"}</div>
                  <div class="value">{acc(c) !== undefined ? `${acc(c)!.toFixed(1)}` : "–"}</div>
                  <div class="muted small">Ø-Verlust {Math.round(game.summary[c]?.acpl ?? 0)} cp</div>
                </div>
              ))}
            </div>
          )}

          <div class="card">
            {move ? (
              <div class="move-explain">
                {badgeFor(move.classification) && <img src={badgeFor(move.classification)!} alt="" />}
                <div>
                  <strong>
                    {move.move_number}
                    {move.fen_before.split(" ")[1] === "w" ? "." : "..."} {move.san}
                  </strong>{" "}
                  {move.classification && <span class="muted">· {classLabel(move.classification)}</span>}
                  <div class="small">
                    {move.classification === "Book" && move.opening_name ? move.opening_name : move.explanation || (analyzing ? "Wird analysiert …" : "Noch nicht bewertet.")}
                  </div>
                  {move.best_move && move.best_move !== move.uci && move.multi_pvs[0]?.pv_san && move.classification !== "Book" && (
                    <div class="small muted" style={{ marginTop: "4px" }}>
                      Besser war: {move.multi_pvs[0].pv_san.split(" ").slice(0, 6).join(" ")}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div class="small muted">
                {game.metadata.opening || game.metadata.event} · {game.metadata.date}
              </div>
            )}
          </div>

          <EvalGraph moves={game.moves} idx={i} onPick={(k) => setIdx(clamp(k))} />
          <MoveList moves={game.moves} idx={i} onPick={setIdx} />

          {review && (
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
              {review.key_moments.length > 0 && (
                <>
                  <h3 style={{ marginTop: "12px" }}>Schlüsselmomente</h3>
                  {review.key_moments.map((k) => (
                    <button
                      key={k.ply_index}
                      class="btn"
                      style={{ width: "100%", justifyContent: "flex-start", marginBottom: "6px", textAlign: "left", height: "auto", padding: "8px 12px" }}
                      onClick={() => setIdx(k.ply_index + 1)}
                    >
                      <span>
                        <strong>{k.title.includes(k.move_label) ? k.title : `${k.move_label} ${k.title}`}</strong>
                        <div class="small muted" style={{ fontWeight: 400 }}>
                          {k.text}
                        </div>
                      </span>
                    </button>
                  ))}
                </>
              )}
              {review.lessons.length > 0 && (
                <>
                  <h3 style={{ marginTop: "12px" }}>Was du mitnehmen kannst</h3>
                  <ul style={{ margin: 0, paddingLeft: "18px" }}>
                    {review.lessons.map((l) => (
                      <li key={l} class="small">
                        {l}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          {status === "completed" && <ClassTable game={game} />}
        </div>
      </div>
    </div>
  );
}
