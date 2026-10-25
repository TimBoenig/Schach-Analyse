import { Chess, type Square } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { judgeTried } from "../../app/liveEval";
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
  type RepertoireExercise,
  type Verdict,
} from "../../domain/training";
import { Board, type Arrow, type Promotion } from "../Board";
import { classLabel, formatDate } from "../labels";
import { navigate } from "../router";

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

function legalTargetsFor(board: Chess | null, enabled: boolean) {
  return (from: string) => (board && enabled ? board.moves({ square: from as Square, verbose: true }).map((m) => m.to) : []);
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
  const [fen, setFen] = useState(ex.fen);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [hint, setHint] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [solved, setSolved] = useState(false);
  const [checking, setChecking] = useState(false);
  // Wrong tries stay on the board as red arrows, so the player sees what was already ruled out.
  const [wrong, setWrong] = useState<{ from: string; to: string }[]>([]);
  const failed = useRef(false);
  const reported = useRef(false);
  const board = useMemo(() => new Chess(fen), [fen]);
  const userWhite = sideOf(ex.fen) === "white";

  const report = (ok: boolean) => {
    if (reported.current) return;
    reported.current = true;
    onResult(ok);
  };

  // Other moves the analysis already accepts, shown once the puzzle is over.
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

  const tryMove = (from: string, to: string, chosen?: Promotion) => {
    if (solved || checking || fen !== ex.fen) return false;
    const b = new Chess(ex.fen);
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
    const ok = ex.accept.some((a) => a === uci || (a.length === 4 && a === uci.slice(0, 4)));
    if (ok) {
      setSolved(true);
      setFeedback({
        ok: true,
        text: uci.slice(0, 4) === ex.solution.slice(0, 4) ? `Richtig! ${san} ist der beste Zug.` : `Richtig! ${san} ist genauso gut wie ${ex.solution_san}.`,
      });
      report(!failed.current && !hint && !reveal);
    } else {
      // Not a stored answer: let the engine decide, since another move can be just as good.
      const after = b.fen();
      setChecking(true);
      setFeedback({ ok: true, text: `Stockfish prüft ${san} …` });
      void judgeTried(ex.fen, uci, after).then((v) => {
        setChecking(false);
        if (v && solvesPuzzle(v)) {
          setSolved(true);
          setFeedback({ ok: true, text: `Auch richtig! ${san} ist laut Engine genauso stark wie ${ex.solution_san}.` });
          report(!failed.current && !hint && !reveal);
          return;
        }
        failed.current = true;
        setWrong((w) => [...w, { from, to }]);
        // The better-move sentence would give the solution away, so only the refutation is shown.
        const why = v?.explanation.replace(/\s*(Besser war|Du hattest Matt)[\s\S]*$/, "") ?? "";
        setFeedback({
          ok: false,
          text: v ? `${san} – ${classLabel(v.classification)}.` : `${san} ist nicht der gesuchte Zug.`,
          detail: `${why} Versuch es noch einmal.`.trim(),
        });
        window.setTimeout(() => setFen(ex.fen), 1200);
      });
    }
    return true;
  };

  const arrows: Arrow[] = fen === ex.fen ? wrong.map((w) => ({ ...w, kind: "wrong" as const })) : [];
  if (reveal && !solved) arrows.push({ from: ex.solution.slice(0, 2), to: ex.solution.slice(2, 4), kind: "best" });

  return (
    <div class="puzzle">
      <div>
        <Board
          fen={fen}
          flipped={!userWhite}
          arrows={arrows}
          highlight={hint && !solved ? [ex.solution.slice(0, 2)] : []}
          onMove={tryMove}
          legalTargets={legalTargetsFor(board, fen === ex.fen && !solved)}
        />
      </div>
      <div class="side-panel">
        <div class="card">
          <div class="ex-cat">{CATEGORIES[ex.category].label}</div>
          <h3>{userWhite ? "Weiß" : "Schwarz"} am Zug</h3>
          <p style={{ marginTop: 0 }}>{ex.prompt}</p>
          <p class="small muted">
            Aus deiner Partie gegen <strong>{ex.opponent || "?"}</strong>
            {ex.date ? ` (${formatDate(ex.date)})` : ""}. Gespielt hast du <strong>{ex.played_san}</strong> –{" "}
            {trClassification(ex.classification)} im {trPhase(ex.phase)}, deine Gewinnchance fiel um {(ex.wp_loss * 100).toFixed(0)}{" "}
            Prozentpunkte.
          </p>
          {feedback && (
            <p class={feedback.ok ? "feedback-ok" : "feedback-bad"}>
              {feedback.text}
              {feedback.detail && <span class="feedback-detail">{feedback.detail}</span>}
            </p>
          )}
          {(solved || reveal) && others.length > 0 && (
            <p class="small">
              Ebenfalls richtig: <strong>{others.join(", ")}</strong>
            </p>
          )}
          {(solved || reveal) && ex.line_san.length > 1 && (
            <p class="small">
              Fortsetzung der Engine: <span class="mono">{ex.line_san.join(" ")}</span>
            </p>
          )}
          {reveal && !solved && (
            <p>
              Lösung: <strong>{ex.solution_san}</strong>
            </p>
          )}
          <div class="row">
            {!solved && !reveal && (
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
                <button
                  class="btn"
                  onClick={() => {
                    setReveal(true);
                    report(false);
                  }}
                >
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

// ---------- repertoire drill ----------

const DRILL_REPLY_MS = 450;

export function RepertoireRunner({ ex, onResult, onNext, nextLabel }: RunnerProps<RepertoireExercise>) {
  const [ply, setPly] = useState(0);
  const [errors, setErrors] = useState(0);
  const [missesHere, setMissesHere] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>(null);
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
  const board = useMemo(() => new Chess(fen), [fen]);

  useEffect(() => {
    if (done) {
      if (!reported.current) {
        reported.current = true;
        onResult(errors === 0);
      }
      return;
    }
    if (isUserPly(ply)) return;
    const t = window.setTimeout(() => setPly((p) => p + 1), DRILL_REPLY_MS);
    return () => window.clearTimeout(t);
  }, [ply, done]);

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
      setErrors((e) => e + 1);
      setMissesHere((m) => m + 1);
      setFeedback({ ok: false, text: `${san} ist nicht der Zug aus deinem Repertoire.` });
    }
    return true;
  };

  const expected = !done && isUserPly(ply) ? squaresOf(fen, moves[ply]) : null;
  const arrows: Arrow[] = expected && missesHere >= 2 ? [{ ...expected, kind: "hint" }] : [];
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
            Deine Hauptvariante aus {ex.games} Partien{ex.score_pct !== null ? ` (${Math.round(ex.score_pct)} % Punkte)` : ""}. Spiele deine Züge,
            der Gegner antwortet automatisch.
          </p>
          <div class="progress" style={{ marginBottom: "10px" }}>
            <div style={{ width: `${(ply / Math.max(1, moves.length)) * 100}%` }} />
          </div>
          {atCorrection && ex.correction && (
            <p class="note-box small">
              Achtung: Hier hast du in {ex.correction.games} {ex.correction.games === 1 ? "Partie" : "Partien"} <strong>{ex.correction.played_san}</strong>{" "}
              gespielt – laut Engine ein Fehler. Finde den besseren Zug.
            </p>
          )}
          {feedback && !done && <p class={feedback.ok ? "feedback-ok" : "feedback-bad"}>{feedback.text}</p>}
          {missesHere >= 2 && !done && <p class="small muted">Der Pfeil zeigt dir den Zug.</p>}
          {done && (
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
            {done && <NextButton onNext={onNext} label={nextLabel} />}
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
        const reply = await engineMove(b.fen());
        if (!alive.current || thisRound !== round.current) return;
        if (!reply) throw new Error("Die Engine hat keinen Zug gefunden.");
        // The engine scores for itself (side to move); flip to the player's view.
        state.score = { cp: reply.cp !== null ? -reply.cp : null, mate: reply.mate !== null ? -reply.mate : null };
        const em = b.move({ from: reply.uci.slice(0, 2), to: reply.uci.slice(2, 4), promotion: reply.uci[4] as "q" | undefined });
        setFen(b.fen());
        setLastMove({ from: em.from, to: em.to });
        state.over = over(b);
        finish(judgePlayout(ex.goal, state));
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
      <div>
        <Board
          fen={fen}
          flipped={userColor === "black"}
          lastMove={lastMove}
          onMove={tryMove}
          legalTargets={legalTargetsFor(board, !thinking && !verdict.done && board.turn() === userColor[0])}
        />
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
          {verdict.done && <p class={verdict.success ? "feedback-ok" : "feedback-bad"}>{verdict.text}</p>}
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
