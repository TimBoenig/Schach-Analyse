import { Chess, type Square } from "chess.js";
import { useEffect, useMemo, useState } from "preact/hooks";

import { buildProfileInWorker } from "../app/profileClient";
import { trClassification, trPhase } from "../domain/i18n";
import type { Puzzle } from "../domain/profile";
import { getSetting, listGames, setSetting } from "../storage/db";
import { Board, type Arrow } from "./Board";
import { navigate } from "./router";

type Feedback = { ok: boolean; text: string } | null;

function puzzleKey(p: Puzzle): string {
  return `${p.game_id}:${p.ply_index}`;
}

export function TrainingView() {
  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null);
  const [solved, setSolved] = useState<Record<string, boolean>>({});
  const [index, setIndex] = useState(0);
  const [fen, setFen] = useState<string>("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [hint, setHint] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [error, setError] = useState("");
  // A puzzle solved just now stays on screen until "Nächste Aufgabe".
  const [keep, setKeep] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const names = await getSetting<string[]>("usernames", []);
      setSolved(await getSetting<Record<string, boolean>>("training.solved", {}));
      if (!names.length) {
        setPuzzles([]);
        return;
      }
      try {
        const profile = await buildProfileInWorker({
          games: await listGames(),
          usernames: names,
          format: "All Formats",
          date: "All Time",
          color: "All Colors",
        });
        setPuzzles(profile.puzzles.filter((p) => !p.chess960));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPuzzles([]);
      }
    })();
  }, []);

  const list = useMemo(
    () => (puzzles ?? []).filter((p) => !onlyOpen || !solved[puzzleKey(p)] || puzzleKey(p) === keep),
    [puzzles, solved, onlyOpen, keep],
  );
  const puzzle = list[Math.min(index, list.length - 1)];

  useEffect(() => {
    if (puzzle) setFen(puzzle.fen);
    setFeedback(null);
    setHint(false);
    setReveal(false);
  }, [puzzle?.game_id, puzzle?.ply_index]);

  const board = useMemo(() => {
    try {
      return fen ? new Chess(fen) : null;
    } catch {
      return null;
    }
  }, [fen]);

  if (puzzles === null) return <div class="empty">Aufgaben werden aus deinen Partien gesucht …</div>;

  if (!puzzles.length) {
    return (
      <div>
        <div class="page-title">Training</div>
        <div class="empty">
          {error ? (
            <p class="error">{error}</p>
          ) : (
            <p>
              Hier erscheinen Stellungen aus deinen eigenen Partien, in denen es einen deutlich besseren Zug gab. Dafür
              braucht die App deine Spielernamen und ein paar analysierte Partien.
            </p>
          )}
          <button class="btn primary" onClick={() => navigate({ view: "games" })}>
            Zu den Partien
          </button>
        </div>
      </div>
    );
  }

  const done = puzzles.filter((p) => solved[puzzleKey(p)]).length;
  const userIsWhite = puzzle ? puzzle.fen.split(" ")[1] === "w" : true;

  const legalTargets = (from: string) =>
    board && fen === puzzle?.fen && !feedback?.ok
      ? board.moves({ square: from as Square, verbose: true }).map((m) => m.to)
      : [];

  const tryMove = (from: string, to: string) => {
    if (!board || !puzzle) return false;
    const promo = board.get(from as Square)?.type === "p" && (to[1] === "8" || to[1] === "1") ? "q" : undefined;
    const uci = from + to + (promo ?? "");
    let san = "";
    try {
      const b = new Chess(puzzle.fen);
      san = b.move({ from, to, promotion: promo }).san;
      setFen(b.fen());
    } catch {
      return false;
    }
    if (uci === puzzle.best_move_uci || uci.slice(0, 4) === puzzle.best_move_uci.slice(0, 4)) {
      setFeedback({ ok: true, text: `Richtig! ${san} ist der beste Zug.` });
      const next = { ...solved, [puzzleKey(puzzle)]: true };
      setKeep(puzzleKey(puzzle));
      setSolved(next);
      void setSetting("training.solved", next);
    } else {
      setFeedback({ ok: false, text: `${san} ist nicht der gesuchte Zug. Versuch es noch einmal.` });
      window.setTimeout(() => setFen(puzzle.fen), 900);
    }
    return true;
  };

  const arrows: Arrow[] = [];
  if (puzzle && reveal) arrows.push({ from: puzzle.best_move_uci.slice(0, 2), to: puzzle.best_move_uci.slice(2, 4), kind: "best" });

  return (
    <div>
      <div class="page-title">
        Training
        <span class="spacer" />
        <span class="pill accent">
          {done} / {puzzles.length} gelöst
        </span>
        <div class="segmented">
          <button class={onlyOpen ? "active" : ""} onClick={() => setOnlyOpen(true)}>
            Offen
          </button>
          <button class={!onlyOpen ? "active" : ""} onClick={() => setOnlyOpen(false)}>
            Alle
          </button>
        </div>
      </div>
      {!puzzle ? (
        <div class="empty">
          <p>Alle Aufgaben gelöst. Stark! Analysiere neue Partien für weitere Aufgaben.</p>
        </div>
      ) : (
        <div class="puzzle">
          <div>
            <Board
              fen={fen || puzzle.fen}
              flipped={!userIsWhite}
              arrows={arrows}
              highlight={hint ? [puzzle.best_move_uci.slice(0, 2)] : []}
              onMove={tryMove}
              legalTargets={legalTargets}
            />
          </div>
          <div class="side-panel">
            <div class="card">
              <h3>{userIsWhite ? "Weiß" : "Schwarz"} am Zug: Finde den besseren Zug</h3>
              <p class="small" style={{ marginTop: 0 }}>
                In deiner Partie gegen <strong>{puzzle.opponent || "?"}</strong>
                {puzzle.date ? ` (${puzzle.date})` : ""} hast du hier <strong>{puzzle.played_san}</strong> gespielt –{" "}
                {trClassification(puzzle.classification)} im {trPhase(puzzle.phase)}, deine Gewinnchance fiel um{" "}
                {(puzzle.wp_loss * 100).toFixed(0)} Prozentpunkte.
              </p>
              <p class="muted small">Tippe die Figur und dann das Zielfeld an.</p>
              {feedback && <p class={feedback.ok ? "feedback-ok" : "feedback-bad"}>{feedback.text}</p>}
              {reveal && !feedback?.ok && (
                <p>
                  Lösung: <strong>{puzzle.best_move_san}</strong>
                </p>
              )}
              <div class="row">
                {!feedback?.ok && (
                  <>
                    <button class="btn" onClick={() => setHint(true)} disabled={hint}>
                      Tipp
                    </button>
                    <button class="btn" onClick={() => setReveal(true)}>
                      Lösung zeigen
                    </button>
                  </>
                )}
                <button class="btn primary" onClick={() => {
                    // Dropping the solved puzzle from "Offen" already advances the list.
                    if (keep && onlyOpen) setKeep(null);
                    else setIndex((i) => (i + 1) % Math.max(1, list.length));
                  }}>
                  Nächste Aufgabe
                </button>
              </div>
            </div>
            <button
              class="btn"
              onClick={() => navigate({ view: "analysis", gameId: puzzle.game_id, ply: puzzle.ply_index })}
            >
              Partie an dieser Stelle öffnen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
