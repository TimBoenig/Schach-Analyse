import { Chess, type Square } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { judgeTried, positionLines } from "../../app/liveEval";
import { engineMove } from "../../app/trainingEngine";
import { solvesPuzzle } from "../../domain/live";
import { trClassification, trPhase } from "../../domain/i18n";
import { openingLabel } from "../../domain/profile";
import {
  CATEGORIES,
  judgePlayout,
  type PlayoutExercise,
  type PlayoutState,
  type PuzzleExercise,
  isSoundMove,
  type LineStep,
  playOnStats,
  refutationLine,
  type RepertoireExercise,
  type Verdict,
} from "../../domain/training";
import type { Classification } from "../../domain/types";
import { Board, type Arrow, type Promotion } from "../Board";
import { classLabel, formatDate } from "../labels";
import { navigate } from "../router";
import { BrilliantFx } from "../BrilliantFx";
import { Coach } from "../Coach";
import { ENGINE_NAME } from "../../engine/info";

export interface RunnerProps<T> {
  ex: T;
  /** Called once per exercise with the first verdict. */
  onResult: (success: boolean) => void;
  onNext: () => void;
  nextLabel: string;
}

type Feedback = { ok: boolean; text: string; detail?: string } | null;

/** The piece the board's picker chose, or a queen when a pawn reaches the last rank without one. */
function promotionFor(board: Chess, from: string, to: string, chosen?: Promotion): Promotion | undefined {
  return board.get(from as Square)?.type === "p" && (to[1] === "8" || to[1] === "1") ? (chosen ?? "q") : undefined;
}

function sideOf(fen: string): "white" | "black" {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

/** From/to squares of a SAN move in a position, for hint arrows. */
function squaresOf(fen: string, san: string): { from: string; to: string } | null {
  try {
    const m = new Chess(fen).move(san);
    return { from: m.from, to: m.to };
  } catch {
    return null;
  }
}

/**
 * The engine's answer to a position, taken from the same cached analysis that judges the
 * player's move: one engine run per move instead of two, so the reply comes quickly.
 */
async function replyFor(fen: string): Promise<{ uci: string; cp: number | null; mate: number | null } | null> {
  const lines = await positionLines(fen);
  if (lines[0]?.pv.length) return { uci: lines[0].pv[0], cp: lines[0].cp, mate: lines[0].mate };
  return engineMove(fen);
}

function legalTargetsFor(board: Chess | null, enabled: boolean) {
  return (from: string) => (board && enabled ? board.moves({ square: from as Square, verbose: true }).map((m) => m.to) : []);
}

/** SAN chips of a refutation; the shown step is highlighted and each chip jumps there. */
function LineChips({ line, step, onPick }: { line: LineStep[]; step: number; onPick: (i: number) => void }) {
  return (
    <div class="line-chips">
      {line.map((s, i) => (
        <button key={i} class={`line-chip${s.tried ? " tried" : ""}${i === step ? " on" : ""}${i > step ? " later" : ""}`} onClick={() => onPick(i)}>
          {s.san}
        </button>
      ))}
    </div>
  );
}

/** Steps through a refutation line on a timer; returns the shown step and controls. */
function useLinePlayer(onDone?: () => void) {
  const [line, setLine] = useState<LineStep[] | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  // A refutation is only offered; it plays when the player asks for it.
  const [pending, setPending] = useState<LineStep[] | null>(null);
  useEffect(() => {
    if (!line || !playing) return;
    if (step >= line.length - 1) {
      setPlaying(false);
      onDone?.();
      return;
    }
    const id = window.setTimeout(() => setStep((i) => i + 1), step === 0 ? 1000 : 850);
    return () => window.clearTimeout(id);
  }, [line, step, playing]);
  return {
    line,
    step,
    playing,
    pending,
    offer: (l: LineStep[]) => setPending(l.length > 1 ? l : null),
    show: () => {
      if (!pending) return;
      setLine(pending);
      setStep(0);
      setPlaying(true);
    },
    replay: () => {
      setStep(0);
      setPlaying(true);
    },
    pick: (i: number) => {
      setPlaying(false);
      setStep(i);
    },
    clear: () => {
      setLine(null);
      setPending(null);
      setPlaying(false);
    },
  };
}

function NextButton({ onNext, label }: { onNext: () => void; label: string }) {
  return (
    <button class="btn primary" onClick={onNext}>
      {label}
    </button>
  );
}

// ---------- puzzle from the player's own game ----------

export function PuzzleRunner({ ex, onResult, onNext, nextLabel }: RunnerProps<PuzzleExercise>) {
  // The line to play: own move, opponent reply, own move … (older puzzles: just the solution).
  const line = useMemo(() => (ex.moves?.length ? ex.moves : [ex.solution]), [ex.id]);
  const positions = useMemo(() => {
    const out = [ex.fen];
    const b = new Chess(ex.fen);
    for (const u of line) {
      try {
        b.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      } catch {
        break;
      }
      out.push(b.fen());
    }
    return out;
  }, [ex.id]);
  const steps = Math.ceil((positions.length - 1) / 2);
  // Index into `line` of the own move asked for now (always even).
  const [at, setAt] = useState(0);
  const [fen, setFen] = useState(ex.fen);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [hint, setHint] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [solved, setSolved] = useState(false);
  const [checking, setChecking] = useState(false);
  // The last move on the board with its verdict, so the board can show a badge (and celebrate a brilliant one).
  const [hit, setHit] = useState<{ from: string; to: string; cls?: Classification } | null>(null);
  // Wrong tries stay on the board as red arrows, so the player sees what was already ruled out.
  const [wrong, setWrong] = useState<{ from: string; to: string }[]>([]);
  const failed = useRef(false);
  const reported = useRef(false);
  const alive = useRef(true);
  const player = useLinePlayer();
  const shown = player.line ? player.line[player.step] : null;
  const boardFen = shown ? shown.fen : fen;
  const here = positions[at] ?? ex.fen;
  const board = useMemo(() => new Chess(fen), [fen]);
  const userWhite = sideOf(ex.fen) === "white";
  const ready = !solved && !reveal && !checking && fen === here && !player.line;

  useEffect(() => {
    alive.current = true;
    // Warm the engine for this position while the player thinks: a wrong try is then judged in about a second.
    void positionLines(ex.fen);
    return () => {
      alive.current = false;
    };
  }, [ex.id]);

  const report = (ok: boolean) => {
    if (reported.current) return;
    reported.current = true;
    onResult(ok);
  };

  // Other first moves the analysis already accepts, shown once the puzzle is over.
  const others = useMemo(() => {
    return ex.accept
      .filter((u) => u.slice(0, 4) !== ex.solution.slice(0, 4))
      .map((u) => {
        try {
          return new Chess(ex.fen).move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san;
        } catch {
          return null;
        }
      })
      .filter((x): x is string => Boolean(x));
  }, [ex]);

  const finish = (from: string, to: string, cls: Classification, text: string) => {
    setSolved(true);
    setHit({ from, to, cls });
    setFeedback({ ok: true, text: cls === "Brilliant" ? `Brillant!! ${text}` : text });
    report(!failed.current && !hint);
  };

  /** A correct own move: the opponent answers from the line, or the puzzle is solved. */
  const correct = (from: string, to: string, san: string, offLine: boolean) => {
    const last = offLine || at + 2 >= positions.length - 1;
    if (last) {
      const text = at === 0 && !offLine ? `${san} ist der beste Zug.` : offLine ? `${san} ist laut Engine genauso stark.` : `${san} – Aufgabe gelöst!`;
      finish(from, to, "Best", text);
      return;
    }
    setHit({ from, to, cls: "Best" });
    setFeedback({ ok: true, text: `${san} – richtig! Weiter …` });
    setHint(false);
    setWrong([]);
    const reply = line[at + 1];
    window.setTimeout(() => {
      if (!alive.current) return;
      setFen(positions[at + 2]);
      setHit({ from: reply.slice(0, 2), to: reply.slice(2, 4) });
      setAt(at + 2);
      setFeedback({ ok: true, text: `${san} – richtig! Und jetzt?` });
    }, 450);
  };

  const retry = () => {
    player.clear();
    setFen(here);
    setFeedback(null);
  };

  const tryMove = (from: string, to: string, chosen?: Promotion) => {
    if (!ready) return false;
    player.clear();
    const b = new Chess(here);
    let san = "";
    let uci = "";
    try {
      const m = b.move({ from, to, promotion: promotionFor(b, from, to, chosen) });
      san = m.san;
      uci = m.from + m.to + (m.promotion ?? "");
    } catch {
      return false;
    }
    setFen(b.fen());
    setHit({ from, to });
    const after = b.fen();
    const same = (a: string) => a === uci || (a.length === 4 && a === uci.slice(0, 4));
    const listed = at === 0 ? ex.accept.some(same) : same(line[at]);
    if (listed || b.isCheckmate()) {
      const offLine = !same(line[at]) && !b.isCheckmate();
      if (at === 0 && offLine) {
        finish(from, to, "Best", `${san} ist genauso gut wie ${ex.solution_san}.`);
      } else {
        correct(from, to, san, b.isCheckmate() && !same(line[at]));
      }
      // The stored answer says nothing about brilliance; the (cached) engine verdict upgrades the badge.
      void judgeTried(here, uci, after).then((v) => {
        if (alive.current && v?.classification === "Brilliant") {
          setHit({ from, to, cls: "Brilliant" });
          setFeedback((f) => (f && f.ok ? { ...f, text: `Brillant!! ${f.text}` } : f));
        }
      });
      return true;
    }
    // Not the stored answer: let the engine decide, since another move can be just as good.
    setChecking(true);
    setFeedback({ ok: true, text: `${ENGINE_NAME} prüft ${san} …` });
    void judgeTried(here, uci, after).then((v) => {
      if (!alive.current) return;
      setChecking(false);
      if (v && solvesPuzzle(v)) {
        if (v.classification === "Brilliant") finish(from, to, "Brilliant", `${san} ist laut Engine genauso stark.`);
        else correct(from, to, san, true);
        return;
      }
      failed.current = true;
      setWrong((w) => [...w, { from, to }]);
      setHit({ from, to, cls: (v?.classification as Classification) || "Mistake" });
      // Show why on the board: the move and how the engine punishes it, instead of a paragraph.
      setFeedback({ ok: false, text: v ? `${san} – ${classLabel(v.classification)}. Versuch es nochmal.` : `${san} ist nicht der gesuchte Zug.` });
      player.offer(refutationLine(here, uci, v?.reply_pv ?? []));
      window.setTimeout(() => {
        if (!alive.current) return;
        setFen((f) => (f === after ? here : f));
        setHit(null);
      }, 600);
    });
    return true;
  };

  /** Shows the solution: the rest of the line is played on the board, move by move. */
  const showSolution = () => {
    setReveal(true);
    report(false);
    player.clear();
    let i = at;
    const tick = () => {
      if (!alive.current || i >= positions.length - 1) return;
      const u = line[i];
      setFen(positions[i + 1]);
      setHit({ from: u.slice(0, 2), to: u.slice(2, 4), cls: i % 2 === 0 ? "Best" : undefined });
      i += 1;
      window.setTimeout(tick, 800);
    };
    setFen(here);
    window.setTimeout(tick, 300);
  };

  const next = player.line && player.step + 1 < player.line.length ? player.line[player.step + 1] : null;
  const arrows: Arrow[] = [];
  if (shown && next) arrows.push({ from: next.from, to: next.to, kind: "wrong" });
  if (!player.line && fen === here && !solved && !reveal) arrows.push(...wrong.map((w) => ({ ...w, kind: "wrong" as const })));
  const lastMove = shown ? { from: shown.from, to: shown.to } : hit;
  const badge: Classification | undefined = shown ? (shown.tried ? "Mistake" : undefined) : hit?.cls;
  const ownStep = at / 2 + 1;

  return (
    <div class="puzzle">
      <div class="board-fx-wrap">
        <Board
          fen={boardFen}
          flipped={!userWhite}
          arrows={arrows}
          lastMove={lastMove}
          badge={badge}
          highlight={hint && ready ? [line[at].slice(0, 2)] : []}
          onMove={tryMove}
          legalTargets={legalTargetsFor(board, ready)}
        />
        {hit?.cls === "Brilliant" && <BrilliantFx key={hit.to} square={hit.to} flipped={!userWhite} />}
      </div>
      <div class="side-panel">
        <div class="card">
          <div class="ex-cat">{CATEGORIES[ex.category].label}</div>
          <div class="puzzle-turn">
            <span class={`turn-dot ${userWhite ? "w" : "b"}`} />
            <h3>{userWhite ? "Weiß" : "Schwarz"} am Zug</h3>
            {steps > 1 && (
              <span class="puzzle-steps" aria-label={`Zug ${Math.min(ownStep, steps)} von ${steps}`}>
                {Array.from({ length: steps }, (_, i) => (
                  <span key={i} class={i < at / 2 || solved ? "on" : i === at / 2 && !reveal ? "cur" : ""} />
                ))}
              </span>
            )}
          </div>
          <p style={{ marginTop: 0 }}>{ex.prompt}</p>
          {steps > 1 && at === 0 && !solved && <p class="small muted">Diese Aufgabe hat {steps} Züge: Nach deinem Zug antwortet der Gegner.</p>}
          <p class="small muted">
            Aus deiner Partie gegen <strong>{ex.opponent || "?"}</strong>
            {ex.date ? ` (${formatDate(ex.date)})` : ""}. Gespielt: <strong>{ex.played_san}</strong> ({trClassification(ex.classification)},{" "}
            {trPhase(ex.phase)}, −{(ex.wp_loss * 100).toFixed(0)} %).
          </p>
          {feedback && (
            <Coach mood={feedback.ok ? "wow" : "think"} tone={feedback.ok ? "var(--win)" : "var(--loss)"} title={feedback.text}>
              {feedback.detail}
            </Coach>
          )}
          {player.pending && !player.line && !solved && !reveal && (
            <button class="btn small consequence-btn" onClick={player.show}>
              Warum? Konsequenz zeigen
            </button>
          )}
          {player.line && (
            <div class="refutation">
              <div class="small muted">{player.playing ? "So wird es bestraft …" : "So wird es bestraft. Tippe auf einen Zug:"}</div>
              <LineChips line={player.line} step={player.step} onPick={player.pick} />
              <div class="row">
                <button class="btn small ghost" onClick={player.replay} disabled={player.playing}>
                  Nochmal abspielen
                </button>
                <button class="btn small primary" onClick={retry}>
                  Neuer Versuch
                </button>
              </div>
            </div>
          )}
          {(solved || reveal) && others.length > 0 && (
            <p class="small">
              Im ersten Zug ebenfalls richtig: <strong>{others.join(", ")}</strong>
            </p>
          )}
          {(solved || reveal) && ex.line_san.length > 1 && (
            <p class="small">
              Fortsetzung der Engine: <span class="mono">{ex.line_san.join(" ")}</span>
            </p>
          )}
          {reveal && !solved && (
            <p>
              Lösung: <strong>{ex.line_san.slice(0, Math.max(1, positions.length - 1)).join(" ") || ex.solution_san}</strong>
            </p>
          )}
          <div class="row">
            {!solved && !reveal && !player.line && (
              <>
                <button
                  class="btn"
                  onClick={() => {
                    failed.current = true;
                    setHint(true);
                  }}
                  disabled={hint}
                >
                  Tipp
                </button>
                <button class="btn" onClick={showSolution}>
                  Lösung zeigen
                </button>
              </>
            )}
            {(solved || reveal) && <NextButton onNext={onNext} label={nextLabel} />}
          </div>
        </div>
        <button class="btn" onClick={() => navigate({ view: "analysis", gameId: ex.game_id, ply: ex.ply_index })}>
          Partie an dieser Stelle öffnen
        </button>
      </div>
    </div>
  );
}

// ---------- play on past the drilled line ----------

/** How many own moves the player gets after the repertoire line ends. */
const PLAY_ON_MOVES = 10;

/**
 * Free play from the end of an opening drill against the engine. Every own move
 * gets its badge; errors are refuted on the board and can be taken back,
 * brilliant moves are celebrated.
 */
function PlayOn({ startFen, userWhite, onExit }: { startFen: string; userWhite: boolean; onExit: () => void }) {
  const [fen, setFen] = useState(startFen);
  const [last, setLast] = useState<{ from: string; to: string; cls?: Classification } | null>(null);
  const [classes, setClasses] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Feedback>(null);
  const [undoFen, setUndoFen] = useState<string | null>(null);
  const player = useLinePlayer();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const board = useMemo(() => new Chess(fen), [fen]);
  const userColor = userWhite ? "w" : "b";
  const stats = playOnStats(classes);
  const over = board.isGameOver() || stats.moves >= PLAY_ON_MOVES;
  const shown = player.line ? player.line[player.step] : null;

  const reply = async (b: Chess) => {
    const r = await replyFor(b.fen());
    if (!alive.current || !r) return;
    const m = b.move({ from: r.uci.slice(0, 2), to: r.uci.slice(2, 4), promotion: r.uci[4] as "q" | undefined });
    setFen(b.fen());
    setLast({ from: m.from, to: m.to });
    // Analyse the new position while the player thinks, so the next verdict is quick.
    if (!b.isGameOver()) void positionLines(b.fen());
  };

  // The drilled line can end with the player's own move: then the engine starts.
  useEffect(() => {
    const b = new Chess(startFen);
    if (b.turn() === userColor || b.isGameOver()) return;
    setBusy(true);
    void reply(b).finally(() => alive.current && setBusy(false));
  }, [startFen]);

  const tryMove = (from: string, to: string, chosen?: Promotion) => {
    if (busy || over || player.line || board.turn() !== userColor) return false;
    player.clear();
    const before = fen;
    const b = new Chess(fen);
    let m;
    try {
      m = b.move({ from, to, promotion: promotionFor(b, from, to, chosen) });
    } catch {
      return false;
    }
    const uci = m.from + m.to + (m.promotion ?? "");
    setFen(b.fen());
    setLast({ from: m.from, to: m.to });
    setBusy(true);
    setNote({ ok: true, text: `${ENGINE_NAME} prüft ${m.san} …` });
    void (async () => {
      try {
        const v = await judgeTried(before, uci, b.fen());
        if (!alive.current) return;
        const cls = (v?.classification ?? "") as Classification;
        setClasses((c) => [...c, cls]);
        setLast({ from: m.from, to: m.to, cls });
        if (cls && !isSoundMove(cls)) {
          setUndoFen(before);
          setNote({ ok: false, text: `${m.san} – ${classLabel(cls)}` });
          const line = refutationLine(before, uci, v?.reply_pv ?? []);
          player.offer(line);
          await reply(b);
        } else {
          setUndoFen(null);
          setNote(cls ? { ok: true, text: cls === "Brilliant" ? `Brillant!! ${m.san}` : `${m.san} – ${classLabel(cls)}` } : null);
          if (!b.isGameOver()) await reply(b);
        }
      } finally {
        if (alive.current) setBusy(false);
      }
    })();
    return true;
  };

  const takeBack = () => {
    if (!undoFen) return;
    player.clear();
    setFen(undoFen);
    setLast(null);
    setUndoFen(null);
    setNote(null);
  };

  const next = player.line && player.step + 1 < player.line.length ? player.line[player.step + 1] : null;
  const arrows: Arrow[] = shown && next ? [{ from: next.from, to: next.to, kind: "wrong" }] : [];
  return (
    <div class="puzzle">
      <div class="board-fx-wrap">
        <Board
          fen={shown ? shown.fen : fen}
          flipped={!userWhite}
          lastMove={shown ? { from: shown.from, to: shown.to } : last}
          badge={shown ? (shown.tried ? "Mistake" : undefined) : last?.cls || undefined}
          arrows={arrows}
          onMove={tryMove}
          legalTargets={legalTargetsFor(board, !busy && !over && !player.line && board.turn() === userColor)}
        />
        {!shown && last?.cls === "Brilliant" && <BrilliantFx key={last.to + classes.length} square={last.to} flipped={!userWhite} />}
      </div>
      <div class="side-panel">
        <div class="card">
          <div class="ex-cat">Weiterspielen</div>
          <h3>Ab hier spielst du frei gegen {ENGINE_NAME}</h3>
          <p class="small muted" style={{ marginTop: 0 }}>
            Noch {Math.max(0, PLAY_ON_MOVES - stats.moves)} eigene Züge. Jeder Zug wird bewertet, Fehler zeige ich dir direkt auf dem Brett.
          </p>
          <div class="playon-stats tnum">
            <span>
              <strong>{stats.sound}</strong> gesund
            </span>
            <span class="bad">
              <strong>{stats.errors}</strong> Fehler
            </span>
            {stats.brilliant > 0 && (
              <span class="brill">
                <strong>{stats.brilliant}</strong> brillant
              </span>
            )}
          </div>
          {note && <Coach mood={note.ok ? "wow" : "think"} tone={note.ok ? "var(--win)" : "var(--loss)"} title={note.text} />}
          {player.pending && !player.line && (
            <div class="row">
              <button class="btn small consequence-btn" onClick={player.show}>
                Warum? Konsequenz zeigen
              </button>
              {undoFen && (
                <button class="btn small ghost" onClick={takeBack}>
                  Zug zurücknehmen
                </button>
              )}
            </div>
          )}
          {player.line && (
            <div class="refutation">
              <div class="small muted">So wird es bestraft:</div>
              <LineChips line={player.line} step={player.step} onPick={player.pick} />
              <div class="row">
                <button class="btn small ghost" onClick={player.replay} disabled={player.playing}>
                  Nochmal abspielen
                </button>
                <button class="btn small primary" onClick={takeBack}>
                  Zug zurücknehmen
                </button>
                <button class="btn small ghost" onClick={player.clear}>
                  Trotzdem weiter
                </button>
              </div>
            </div>
          )}
          {over && (
            <p class={stats.errors === 0 ? "feedback-ok" : "feedback-bad"}>
              {stats.errors === 0 ? "Sauber gespielt, kein einziger Fehler!" : `${stats.sound} von ${stats.moves} Zügen waren gesund.`}
            </p>
          )}
          <div class="row">
            <button class={`btn${over ? " primary" : ""}`} onClick={onExit}>
              {over ? "Fertig" : "Beenden"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- repertoire drill ----------

const DRILL_REPLY_MS = 450;

export function RepertoireRunner({ ex, onResult, onNext, nextLabel, learn = false }: RunnerProps<RepertoireExercise> & { learn?: boolean }) {
  const [ply, setPly] = useState(0);
  // Learn mode: every move is shown first (like a repertoire trainer), the test round follows without help.
  const [learning, setLearning] = useState(learn);
  const [errors, setErrors] = useState(0);
  const [missesHere, setMissesHere] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [playOn, setPlayOn] = useState(false);
  const reported = useRef(false);
  const userWhite = ex.color === "white";
  const isUserPly = (p: number) => (p % 2 === 0) === userWhite;

  const [positions, moves] = useMemo(() => {
    const b = new Chess();
    const out = [b.fen()];
    const sans: string[] = [];
    for (const san of ex.moves) {
      try {
        sans.push(b.move(san).san);
      } catch {
        break; // a SAN the board can't replay ends the drill early instead of crashing
      }
      out.push(b.fen());
    }
    return [out, sans] as const;
  }, [ex.id]);
  const done = ply >= moves.length;
  const fen = positions[ply];
  const plyRef = useRef(ply);
  plyRef.current = ply;
  const board = useMemo(() => new Chess(fen), [fen]);

  useEffect(() => {
    if (done) {
      if (!learning && !reported.current) {
        reported.current = true;
        onResult(errors === 0);
      }
      return;
    }
    if (isUserPly(ply)) return;
    const t = window.setTimeout(() => setPly((p) => p + 1), DRILL_REPLY_MS);
    return () => window.clearTimeout(t);
  }, [ply, done, learning]);

  const startTest = () => {
    setLearning(false);
    setPly(0);
    setErrors(0);
    setMissesHere(0);
    setFeedback(null);
  };

  const tryMove = (from: string, to: string, chosen?: Promotion) => {
    if (done || !isUserPly(ply)) return false;
    let san = "";
    try {
      const b = new Chess(fen);
      san = b.move({ from, to, promotion: promotionFor(b, from, to, chosen) }).san;
    } catch {
      return false;
    }
    if (san === moves[ply]) {
      setFeedback({ ok: true, text: `${san} – richtig.` });
      setMissesHere(0);
      setPly(ply + 1);
    } else {
      if (!learning) setErrors((e) => e + 1);
      setMissesHere((m) => m + 1);
      setFeedback({ ok: false, text: learning ? `Nicht ganz: Spiele den Zug mit dem Pfeil.` : `${san} ist nicht der Zug aus deinem Repertoire.` });
      if (learning) return true;
      // Tell apart "playable, just not your line" from a real opening error.
      const b = new Chess(fen);
      const m = b.move(san);
      const atPly = ply;
      void judgeTried(fen, m.from + m.to + (m.promotion ?? ""), b.fen()).then((v) => {
        if (!v || atPly !== plyRef.current) return;
        setFeedback(
          isSoundMove(v.classification)
            ? { ok: false, text: `${san} ist spielbar (${classLabel(v.classification)}), aber nicht deine Linie.`, detail: `Dein Zug hier: such ihn!` }
            : { ok: false, text: `${san} – ${classLabel(v.classification)}. Nicht deine Linie und auch schwach.` },
        );
      });
    }
    return true;
  };

  if (playOn) return <PlayOn startFen={positions[positions.length - 1]} userWhite={userWhite} onExit={onNext} />;

  const expected = !done && isUserPly(ply) ? squaresOf(fen, moves[ply]) : null;
  const arrows: Arrow[] = expected && (learning || missesHere >= 2) ? [{ ...expected, kind: learning ? "best" : "hint" }] : [];
  const last = ply > 0 ? squaresOf(positions[ply - 1], moves[ply - 1]) : null;
  const atCorrection = ex.correction && ply === ex.correction.ply && !done;
  const moveText = moves
    .slice(0, ply)
    .map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san))
    .join(" ");

  return (
    <div class="puzzle">
      <div>
        <Board
          fen={fen}
          flipped={!userWhite}
          lastMove={last}
          arrows={arrows}
          onMove={tryMove}
          legalTargets={legalTargetsFor(board, !done && isUserPly(ply))}
        />
      </div>
      <div class="side-panel">
        <div class="card">
          <div class="ex-cat">{CATEGORIES.repertoire.label}</div>
          <h3>
            {openingLabel(ex.opening)} mit {userWhite ? "Weiß" : "Schwarz"}
          </h3>
          <p class="small muted" style={{ marginTop: 0 }}>
            {ex.library
              ? "Hauptlinie aus der Eröffnungsbibliothek."
              : `Deine Hauptvariante aus ${ex.games} Partien${ex.score_pct !== null ? ` (${Math.round(ex.score_pct)} % Punkte)` : ""}.`}{" "}
            Spiele deine Züge, der Gegner antwortet automatisch.
          </p>
          {ex.idea && <p class="note-box small">Idee: {ex.idea}</p>}
          <div class={`learn-mode${learning ? " on" : ""}`}>
            {learning ? "Lernmodus: Die Buchzüge werden dir gezeigt. Spiele sie nach." : "Abfrage: ohne Hilfe."}
            {!done && (
              <button class="btn small ghost" onClick={learning ? startTest : () => setLearning(true)}>
                {learning ? "Ohne Hilfe abfragen" : "Züge zeigen"}
              </button>
            )}
          </div>
          <div class="progress" style={{ marginBottom: "10px" }}>
            <div style={{ width: `${(ply / Math.max(1, moves.length)) * 100}%` }} />
          </div>
          {atCorrection && ex.correction && (
            <p class="note-box small">
              Achtung: Hier hast du in {ex.correction.games} {ex.correction.games === 1 ? "Partie" : "Partien"} <strong>{ex.correction.played_san}</strong>{" "}
              gespielt – laut Engine ein Fehler. Finde den besseren Zug.
            </p>
          )}
          {feedback && !done && (
            <Coach mood={feedback.ok ? "happy" : "think"} tone={feedback.ok ? "var(--win)" : "var(--loss)"} title={feedback.text}>
              {feedback.detail}
            </Coach>
          )}
          {missesHere >= 2 && !done && !learning && <p class="small muted">Der Pfeil zeigt dir den Zug.</p>}
          {done && learning && <p class="feedback-ok">Linie einmal mit Hilfe durchgespielt. Jetzt aus dem Gedächtnis!</p>}
          {done && !learning && (
            <p class={errors === 0 ? "feedback-ok" : "feedback-bad"}>
              {errors === 0 ? "Fehlerfrei durchgespielt!" : `Durchgespielt mit ${errors} ${errors === 1 ? "Fehlversuch" : "Fehlversuchen"}. Morgen kommt die Linie wieder.`}
            </p>
          )}
          {done && ex.correction && (
            <p class="small">
              Merke: <strong>{ex.correction.best_san}</strong> statt {ex.correction.played_san}.
            </p>
          )}
          <p class="small mono drill-moves">{moveText || "Startstellung"}</p>
          <div class="row">
            {done && learning && (
              <button class="btn primary" onClick={startTest}>
                Jetzt ohne Hilfe abfragen
              </button>
            )}
            {done && !learning && (
              <button class="btn" onClick={() => setPlayOn(true)}>
                Weiterspielen gegen {ENGINE_NAME}
              </button>
            )}
            {done && !learning && <NextButton onNext={onNext} label={nextLabel} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- play-out against the engine ----------

const GOAL_TEXT: Record<PlayoutExercise["goal"], string> = {
  mate: "Ziel: Matt setzen",
  promote: "Ziel: Bauer umwandeln",
  win: "Ziel: Vorteil halten",
  hold: "Ziel: Remis halten",
};

export function PlayoutRunner({ ex, onResult, onNext, nextLabel }: RunnerProps<PlayoutExercise>) {
  const [fen, setFen] = useState(ex.fen);
  const [userMoves, setUserMoves] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [verdict, setVerdict] = useState<Verdict>({ done: false });
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState("");
  const [brilliant, setBrilliant] = useState<string | null>(null);
  const round = useRef(0);
  const promoted = useRef(false);
  const reported = useRef(false);
  const alive = useRef(true);
  const userColor = sideOf(ex.fen);
  const board = useMemo(() => new Chess(fen), [fen]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const finish = (v: Verdict) => {
    setVerdict(v);
    if (v.done && !reported.current) {
      reported.current = true;
      onResult(v.success);
    }
  };

  const over = (b: Chess): PlayoutState["over"] => {
    if (b.isCheckmate()) return b.turn() === userColor[0] ? "lost" : "won";
    if (b.isDraw()) return "draw";
    return null;
  };

  const tryMove = (from: string, to: string, chosen?: Promotion) => {
    if (thinking || verdict.done || board.turn() !== userColor[0]) return false;
    const b = new Chess(fen);
    let mv;
    try {
      mv = b.move({ from, to, promotion: promotionFor(b, from, to, chosen) });
    } catch {
      return false;
    }
    if (mv.promotion) promoted.current = true;
    const sq = mv.to;
    const judge = () =>
      // Judged after the reply (it reuses that analysis): a brilliant move gets its celebration.
      void judgeTried(before, mv.from + mv.to + (mv.promotion ?? ""), afterFen).then((v) => {
        if (alive.current && v?.classification === "Brilliant") setBrilliant(sq + ":" + moves);
      });
    const before = fen;
    const afterFen = b.fen();
    const moves = userMoves + 1;
    setFen(b.fen());
    setLastMove({ from: mv.from, to: mv.to });
    setUserMoves(moves);
    const state: PlayoutState = { userMoves: moves, maxMoves: ex.max_moves, score: null, over: over(b), promoted: promoted.current };
    if (state.over) {
      finish(judgePlayout(ex.goal, state));
      return true;
    }
    setThinking(true);
    const thisRound = round.current;
    void (async () => {
      try {
        const reply = await replyFor(b.fen());
        if (!alive.current || thisRound !== round.current) return;
        if (!reply) throw new Error("Die Engine hat keinen Zug gefunden.");
        judge();
        // The engine scores for itself (side to move); flip to the player's view.
        state.score = { cp: reply.cp !== null ? -reply.cp : null, mate: reply.mate !== null ? -reply.mate : null };
        const em = b.move({ from: reply.uci.slice(0, 2), to: reply.uci.slice(2, 4), promotion: reply.uci[4] as "q" | undefined });
        setFen(b.fen());
        setLastMove({ from: em.from, to: em.to });
        state.over = over(b);
        finish(judgePlayout(ex.goal, state));
        if (!state.over) void positionLines(b.fen());
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive.current) setThinking(false);
      }
    })();
    return true;
  };

  const retry = () => {
    round.current += 1;
    setFen(ex.fen);
    setUserMoves(0);
    setVerdict({ done: false });
    setLastMove(null);
    setError("");
    setThinking(false);
    promoted.current = false;
  };

  return (
    <div class="puzzle">
      <div class="board-fx-wrap">
        <Board
          fen={fen}
          flipped={userColor === "black"}
          lastMove={lastMove}
          onMove={tryMove}
          legalTargets={legalTargetsFor(board, !thinking && !verdict.done && board.turn() === userColor[0])}
        />
        {brilliant && <BrilliantFx key={brilliant} square={brilliant.split(":")[0]} flipped={userColor === "black"} />}
      </div>
      <div class="side-panel">
        <div class="card">
          <div class="ex-cat">{CATEGORIES[ex.category].label}</div>
          <h3>{ex.title}</h3>
          <p style={{ marginTop: 0 }} class="small">
            {ex.text}
          </p>
          <div class="kpi-rows">
            <div>
              <span>{GOAL_TEXT[ex.goal]}</span>
              <strong>{userColor === "white" ? "Weiß" : "Schwarz"}</strong>
            </div>
            <div>
              <span>Deine Züge</span>
              <strong class="tnum">
                {userMoves} / {ex.max_moves}
              </strong>
            </div>
          </div>
          <div class="progress" style={{ margin: "10px 0" }}>
            <div style={{ width: `${(userMoves / ex.max_moves) * 100}%` }} />
          </div>
          {thinking && <p class="small muted">Die Engine denkt …</p>}
          {verdict.done && <Coach mood={verdict.success ? "wow" : "sad"} tone={verdict.success ? "var(--win)" : "var(--loss)"} title={verdict.text} />}
          {error && <p class="error small">{error}</p>}
          <div class="row">
            {verdict.done && !verdict.success && (
              <button class="btn" onClick={retry}>
                Noch einmal
              </button>
            )}
            {!verdict.done && (
              <button
                class="btn ghost"
                onClick={() => finish({ done: true, success: false, text: "Aufgegeben. Beim nächsten Mal klappt's." })}
              >
                Aufgeben
              </button>
            )}
            {verdict.done && <NextButton onNext={onNext} label={nextLabel} />}
          </div>
        </div>
        {ex.game_id && (
          <button class="btn" onClick={() => navigate({ view: "analysis", gameId: ex.game_id, ply: ex.ply_index })}>
            Partie an dieser Stelle öffnen
          </button>
        )}
      </div>
    </div>
  );
}
