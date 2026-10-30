import { Chess, type Square } from "chess.js";
import { useEffect, useMemo, useState } from "preact/hooks";

import { lineScoreWhite } from "../domain/analyzer";
import { getWinProbability } from "../domain/math";
import { Board, type Arrow, type Promotion } from "./Board";
import { EngineLines, EvalBar } from "./AnalysisView";
import { IconArrow, IconFirst, IconFlip, IconLast, IconNext, IconPrev, IconReset } from "./icons";
import { isTyping } from "./keys";
import { formatEval } from "./labels";
import { LineMoves, VerdictCard } from "./LiveLine";
import { navigate } from "./router";
import { CoachTip } from "./Coach";
import { usePositionLines, useVerdicts } from "./useLive";

const START = new Chess().fen();
// Per-viewer convenience: the last line on the free board survives a reload.
const STORE_KEY = "schach.brett";

interface Line {
  start: string;
  ucis: string[];
}

function loadLine(fen?: string): Line {
  if (fen) return { start: fen, ucis: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as Line | null;
    if (saved && typeof saved.start === "string" && Array.isArray(saved.ucis)) return saved;
  } catch {
    // Private mode or broken data: start fresh.
  }
  return { start: START, ucis: [] };
}

/** Replays a line; drops moves that are no longer legal (e.g. after editing the start). */
function replay(line: Line): { fens: string[]; sans: string[]; ucis: string[] } {
  const b = new Chess(line.start);
  const fens = [b.fen()];
  const sans: string[] = [];
  const ucis: string[] = [];
  for (const u of line.ucis) {
    try {
      sans.push(b.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
    } catch {
      break;
    }
    ucis.push(u);
    fens.push(b.fen());
  }
  return { fens, sans, ucis };
}

function validFen(fen: string): boolean {
  try {
    new Chess(fen.trim());
    return true;
  } catch {
    return false;
  }
}

/** Free analysis board: move pieces freely, every move is judged live by Stockfish. */
export function FreeBoardView({ fen: initialFen }: { fen?: string }) {
  const [line, setLine] = useState<Line>(() => loadLine(initialFen && validFen(initialFen) ? initialFen : undefined));
  const { fens, sans, ucis } = useMemo(() => replay(line), [line]);
  const [cursor, setCursor] = useState(ucis.length);
  const [flipped, setFlipped] = useState(() => line.start.split(" ")[1] === "b");
  const [showArrows, setShowArrows] = useState(true);
  const [fenInput, setFenInput] = useState("");
  const [fenError, setFenError] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(line));
    } catch {
      // Not persisted; the board still works.
    }
  }, [line]);

  const n = Math.min(cursor, ucis.length);
  const fen = fens[n];
  const live = usePositionLines(fen, 3);
  const verdicts = useVerdicts(ucis.map((uci, k) => ({ fenBefore: fens[k], uci, fenAfter: fens[k + 1] })));
  const board = useMemo(() => new Chess(fen), [fen]);

  const play = (uci: string) => {
    // Re-playing the move that already follows keeps the rest of the line.
    if (ucis[n] && ucis[n].slice(0, 4) === uci.slice(0, 4) && (ucis[n][4] ?? "") === (uci[4] ?? "")) {
      setCursor(n + 1);
      return;
    }
    setLine({ start: line.start, ucis: [...ucis.slice(0, n), uci] });
    setCursor(n + 1);
  };
  const tryMove = (from: string, to: string, chosen?: Promotion) => {
    const promo = board.get(from as Square)?.type === "p" && (to[1] === "8" || to[1] === "1") ? (chosen ?? "q") : undefined;
    try {
      new Chess(fen).move({ from, to, promotion: promo });
    } catch {
      return false;
    }
    play(from + to + (promo ?? ""));
    return true;
  };
  const playLine = (pv: string[]) => pv[0] && play(pv[0]);
  const go = (k: number) => setCursor(Math.max(0, Math.min(ucis.length, k)));
  const reset = (start = START) => {
    setLine({ start, ucis: [] });
    setCursor(0);
    setFlipped(start.split(" ")[1] === "b");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") go(n - 1);
      else if (e.key === "ArrowRight") go(n + 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(ucis.length);
      else if (e.key === "f") setFlipped((f) => !f);
      else if (e.key === "a") setShowArrows((v) => !v);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const best = live.lines[0];
  const score = best ? lineScoreWhite(fen, best) : null;
  const terminal = board.isCheckmate() ? (board.turn() === "w" ? 0 : 1) : board.isGameOver() ? 0.5 : null;
  const wc = terminal ?? (score ? getWinProbability(score.cp, score.mate) : null);
  const evalLabel = board.isCheckmate() ? "#" : board.isGameOver() ? "½" : score ? formatEval(score.cp, score.mate) : "…";
  const arrows: Arrow[] = showArrows && best?.pv[0] ? [{ from: best.pv[0].slice(0, 2), to: best.pv[0].slice(2, 4), kind: "hint" }] : [];
  const last = n > 0 ? { from: ucis[n - 1].slice(0, 2), to: ucis[n - 1].slice(2, 4) } : null;
  const verdict = n > 0 ? verdicts[n - 1] : null;
  const status = board.isCheckmate()
    ? `Schachmatt – ${board.turn() === "w" ? "Schwarz" : "Weiß"} gewinnt.`
    : board.isStalemate()
      ? "Patt – Remis."
      : board.isGameOver()
        ? "Remis."
        : `${board.turn() === "w" ? "Weiß" : "Schwarz"} am Zug${board.inCheck() ? " (Schach)" : ""}`;

  return (
    <div>
      <div class="page-title">
        Analysebrett
        <span class="spacer" />
        <button class="btn small" onClick={() => reset()}>
          <IconReset /> Startstellung
        </button>
      </div>
      <CoachTip id="board" title="Probier einfach aus!">
        Zieh die Figuren für beide Seiten. Ich sage dir nach jedem Zug, wie gut er war, und zeige dir die besten
        Fortsetzungen der Engine.
      </CoachTip>
      <div class="analysis">
        <div class="board-area">
          <div class="player-line" style={{ gridRow: 1 }}>
            <span class="who">
              <span class={`side-dot ${board.turn() === "w" ? "white" : "black"}`} />
              <span>{status}</span>
            </span>
          </div>
          <EvalBar wc={wc} flipped={flipped} label={evalLabel} />
          <div style={{ gridRow: 2, gridColumn: 2 }}>
            <Board
              fen={fen}
              flipped={flipped}
              lastMove={last}
              arrows={arrows}
              badge={verdict?.classification || undefined}
              onMove={tryMove}
              legalTargets={(from) => board.moves({ square: from as Square, verbose: true }).map((m) => m.to)}
              annotate
            />
          </div>
          <div class="controls" style={{ gridRow: 4 }}>
            <button class="btn" onClick={() => go(0)} aria-label="Zum Anfang">
              <IconFirst />
            </button>
            <button class="btn" onClick={() => go(n - 1)} aria-label="Zug zurück" disabled={n === 0}>
              <IconPrev />
            </button>
            <button class="btn" onClick={() => go(n + 1)} aria-label="Zug vor" disabled={n >= ucis.length}>
              <IconNext />
            </button>
            <button class="btn" onClick={() => go(ucis.length)} aria-label="Zum Ende">
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
          </div>
        </div>

        <div class="side-panel">
          <div class="card">
            <h3>Bewertung</h3>
            {n > 0 ? (
              <VerdictCard san={sans[n - 1]} verdict={verdict} />
            ) : (
              <p class="muted small" style={{ margin: 0 }}>
                Ziehe eine Figur (antippen oder ziehen). Jeder Zug wird sofort von Stockfish bewertet, mit konkreter Begründung.
              </p>
            )}
            {live.busy && !live.lines.length ? (
              <p class="muted small" style={{ marginBottom: 0 }}>
                <span class="dot-wait" /> Stockfish rechnet …
              </p>
            ) : (
              <EngineLines fen={fen} lines={live.lines} label="Beste Fortsetzungen" onPlay={playLine} max={3} />
            )}
          </div>

          <div class="card">
            <div class="tile-head">
              <h3>Deine Variante</h3>
              {sans.length > 0 && <span class="tile-sub">{sans.length} Halbzüge</span>}
            </div>
            {sans.length ? (
              <LineMoves startFen={line.start} sans={sans} verdicts={verdicts} cursor={n} onPick={go} />
            ) : (
              <p class="muted small" style={{ margin: 0 }}>
                Noch keine Züge.
              </p>
            )}
          </div>

          <div class="card">
            <h3>Stellung laden</h3>
            <form
              class="fen-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = fenInput.trim();
                if (!validFen(f)) {
                  setFenError(true);
                  return;
                }
                setFenError(false);
                setFenInput("");
                reset(new Chess(f).fen());
              }}
            >
              <input
                type="text"
                value={fenInput}
                placeholder="FEN einfügen, z. B. aus Chess.com oder Lichess"
                onInput={(e) => setFenInput((e.target as HTMLInputElement).value)}
                aria-label="FEN"
              />
              <button class="btn" type="submit">
                Laden
              </button>
            </form>
            {fenError && <p class="error small">Diese FEN ist keine gültige Stellung.</p>}
            <div class="row" style={{ marginTop: "10px" }}>
              <button
                class="btn small"
                onClick={() => {
                  void navigator.clipboard?.writeText(fen).catch(() => undefined);
                }}
              >
                FEN kopieren
              </button>
              <button class="btn small" onClick={() => navigate({ view: "games" })}>
                Eigene Partie öffnen
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
