// Lucena tells one game in full screen: the grade and what it rests on, the
// course with its turning point, the best and the most expensive moment on
// the board, the three phases, and what to take away. Opened from the report
// beside the board, and once by itself the first time a report is opened.
import { useEffect, useMemo, useState } from "preact/hooks";

import { getUserColor } from "../../domain/metrics";
import { buildGameReview, type GameReview, type KeyMoment, ownStanding, parseGrade, reportMoments, sameSpeedAccuracies, type Standing, winCurve } from "../../domain/profile";
import type { GameAnalysis, StoredGame } from "../../domain/types";
import { getGame, getSetting, listGames } from "../../storage/db";
import { fromStoredGame } from "../../storage/rows";
import { type Arrow, Board } from "../Board";
import { CountUp } from "../kit";
import { IconChevron, IconPlay } from "../icons";
import { classLabel } from "../labels";
import { navigate } from "../router";
import { GradeBadge, gradeTone, MomentRow, ownErrors, PhaseRows, practiseGame, StandingLine } from "../report/ReportPanel";
import { WinChart } from "../report/WinChart";
import { Stage } from "./Stage";
import type { Mood } from "../Coach";
import { t } from "../../i18n";

const de = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",");
const pct = (wp: number) => `${Math.round(wp * 100)} %`;
const PHASE_IN: Record<string, string> = { opening: t("In der Eröffnung"), middlegame: t("Im Mittelspiel"), endgame: t("Im Endspiel") };

/** Seen id of the report story that opens by itself once. */
export const REPORT_INTRO = "report:first";

interface Loaded {
  row: StoredGame;
  game: GameAnalysis;
  review: GameReview;
  isWhite: boolean;
  standing: Standing | null;
}

function useReport(gameId: string): Loaded | null | "missing" {
  const [state, setState] = useState<Loaded | null | "missing">(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [row, names, rows] = await Promise.all([getGame(gameId), getSetting<string[]>("usernames", []), listGames()]);
      if (!alive) return;
      if (!row) return setState("missing");
      const game = fromStoredGame(row);
      const color = getUserColor(row, names) ?? "white";
      const review = buildGameReview(game, color);
      if (!review) return setState("missing");
      const standing = ownStanding(review.accuracy, sameSpeedAccuracies(rows, names, row.speed_category, row.id));
      setState({ row, game, review, isWhite: color === "white", standing });
    })();
    return () => {
      alive = false;
    };
  }, [gameId]);
  return state;
}

/** The position before a key move, with the move played and, after an error, the better one. */
function MomentBoard({ game, k, isWhite }: { game: GameAnalysis; k: KeyMoment; isWhite: boolean }) {
  const m = game.moves[k.ply_index];
  if (!m) return null;
  const error = k.wp_after < k.wp_before;
  const arrows: Arrow[] = [{ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), kind: error ? "wrong" : "best" }];
  if (error && m.best_move && m.best_move !== m.uci) arrows.push({ from: m.best_move.slice(0, 2), to: m.best_move.slice(2, 4), kind: "best" });
  return (
    <div class="rs-board">
      <Board fen={m.fen_before} flipped={!isWhite} arrows={arrows} />
      <div class="rs-board-key">
        <span>
          <i class={error ? "wrong" : "best"} /> gespielt
        </span>
        {arrows.length > 1 && (
          <span>
            <i class="best" /> besser
          </span>
        )}
      </div>
    </div>
  );
}

/** The turning point in one sentence: who moved, and whether it won or lost the game. */
function turnSentence(tp: KeyMoment, lost: boolean): string {
  if (lost) return tp.by_user ? t("Bei {move_label} ist die Partie gekippt.", { move_label: tp.move_label }) : t("Mit {move_label} hat dein Gegner die Partie an sich gerissen.", { move_label: tp.move_label });
  return tp.by_user ? t("Mit {move_label} hast du die Partie entschieden.", { move_label: tp.move_label }) : t("Bei {move_label} hat dein Gegner die Partie aus der Hand gegeben.", { move_label: tp.move_label });
}

type StepKey = "grade" | "course" | "best" | "worst" | "phases" | "take";

export function ReportStory({ gameId, onClose }: { gameId: string; onClose: () => void }) {
  const data = useReport(gameId);
  const [index, setIndex] = useState(0);
  const steps = useMemo((): StepKey[] => {
    if (!data || data === "missing") return [];
    const { best, worst } = reportMoments(data.review);
    return ["grade", "course", ...(best ? (["best"] as const) : []), ...(worst ? (["worst"] as const) : []), ...(data.review.phases.some((p) => p.accuracy !== null) ? (["phases"] as const) : []), "take"];
  }, [data]);

  if (data === "missing") {
    return (
      <Stage layout="center" mood="think" say={t("Diese Partie ist noch nicht analysiert.")} sub={<p>{t("Sobald die Engine sie durchgerechnet hat, erzähle ich sie dir hier.")}</p>} onClose={onClose} closeLabel={t("Schließen")} actions={<button class="btn primary" onClick={onClose}>{t("Verstanden")}</button>} />
    );
  }
  if (!data) return <div class="stage stage-loading" aria-busy="true" />;

  const { game, review, isWhite, standing, row } = data;
  const { best, worst } = reportMoments(review);
  const grade = parseGrade(review.grade);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  const next = () => (last ? onClose() : setIndex(index + 1));
  const back = index > 0 ? () => setIndex(index - 1) : undefined;
  const toGame = (ply?: number) => {
    onClose();
    navigate({ view: "analysis", gameId, ply });
  };
  const errors = ownErrors(review);
  const outcome = review.result_text.split(" ")[0];
  const tone = gradeTone(grade.value);
  const mood: Mood = tone === "good" ? "wow" : tone === "bad" ? "sad" : tone === "warn" ? "think" : "happy";

  const frame = {
    steps: steps.length,
    step: index,
    stepKey: `${gameId}-${step}`,
    kicker: t("Lucena · {result_text}", { result_text: review.result_text }),
    onBack: back,
    onNext: next,
    onClose,
    closeLabel: t("Schließen"),
    actions: (
      <button class="btn primary" onClick={next}>
        {last ? t("Fertig") : t("Weiter")}
        {!last && <IconChevron />}
      </button>
    ),
  };

  if (step === "grade") {
    return (
      <Stage
        {...frame}
        mood={mood}
        layout="split"
        say={review.headline}
        sub={
          <p>
            
            {t("Deine Note ist eine")} <strong>{grade.text}</strong>
            {grade.word ? ` (${grade.word})` : ""}{t(". Sie folgt aus deiner Genauigkeit: wie nah deine Züge an denen der Engine lagen.")}
          </p>
        }
      >
        <div class="stage-panel rs-grade">
          <GradeBadge grade={review.grade} size="huge" />
          <div class="stage-stats">
            <div class="stage-stat">
              <b>
                <CountUp value={review.accuracy} format={(v) => de(v)} />
              </b>
              <span>{t("deine Genauigkeit")}</span>
            </div>
            <div class="stage-stat">
              <b>
                <CountUp value={review.opponent_accuracy} format={(v) => de(v)} />
              </b>
              <span>{t("dein Gegner")}</span>
            </div>
          </div>
        </div>
        {standing && (
          <div class="stage-panel">
            <StandingLine standing={standing} speed={row.speed_category} />
          </div>
        )}
      </Stage>
    );
  }

  if (step === "course") {
    const tp = review.turning_point;
    return (
      <Stage
        {...frame}
        mood="think"
        layout="split"
        say={tp ? turnSentence(tp, outcome === "Niederlage") : t("So lief die Partie.")}
        sub={
          <p>
            
            {t("Die Linie ist deine Gewinnchance nach jedem Zug. Über der Mitte stehst du besser, darunter dein Gegner.")}
            {tp ? t(" Am Wendepunkt ging sie von {pct} auf {pct2}.", { pct: pct(tp.wp_before), pct2: pct(tp.wp_after) }) : ""}
          </p>
        }
      >
        <div class="stage-panel rs-chart">
          <WinChart points={winCurve(game.moves, isWhite)} plies={game.moves.length} moments={review.key_moments} turning={tp} height={220} />
        </div>
        {tp && <MomentRow k={tp} />}
      </Stage>
    );
  }

  if (step === "best" && best) {
    return (
      <Stage
        {...frame}
        mood="wow"
        layout="split"
        say={t("Dein stärkster Moment: {move_label}.", { move_label: best.move_label })}
        sub={
          <p>
            {classLabel(best.classification as never)}. {best.text}
          </p>
        }
      >
        <MomentBoard game={game} k={best} isWhite={isWhite} />
      </Stage>
    );
  }

  if (step === "worst" && worst) {
    return (
      <Stage
        {...frame}
        mood="sad"
        layout="split"
        say={t("Am teuersten war {move_label}.", { move_label: worst.move_label })}
        sub={
          <p>
            
            {t("Deine Gewinnchance fiel von")} <strong>{pct(worst.wp_before)}</strong> auf <strong>{pct(worst.wp_after)}</strong>.
            {worst.best_move_san ? (
              <>
                {" "}
                
                {t("Besser war")} <strong>{worst.best_move_san}</strong>.
              </>
            ) : null}
          </p>
        }
      >
        <MomentBoard game={game} k={worst} isWhite={isWhite} />
      </Stage>
    );
  }

  if (step === "phases") {
    const played = review.phases.filter((p) => p.accuracy !== null);
    const weakest = played.reduce((w, p) => ((p.accuracy ?? 100) < (w.accuracy ?? 100) ? p : w), played[0]);
    return (
      <Stage
        {...frame}
        mood="think"
        layout="split"
        say={played.length > 1 ? t("{0} ging die meiste Genauigkeit verloren.", { 0: PHASE_IN[weakest.phase] ?? weakest.name }) : t("Die Phasen der Partie.")}
        sub={<p>{t("Genauigkeit und Note für Eröffnung, Mittelspiel und Endspiel, jede für sich.")}</p>}
      >
        <div class="stage-panel">
          <PhaseRows review={review} />
        </div>
      </Stage>
    );
  }

  // The take-away: what went well, what to work on, and two ways on.
  return (
    <Stage
      {...frame}
      mood="happy"
      layout="split"
      say={review.lessons[0] ?? t("Das nimmst du aus dieser Partie mit.")}
      sub={<p>{review.positives[0]}</p>}
      actions={
        <>
          <button class="btn ghost" onClick={() => toGame(worst ? worst.ply_index + 1 : undefined)}>
            
            {t("Zur Partie")}
          </button>
          {errors > 0 ? (
            <button
              class="btn primary"
              onClick={() => {
                onClose();
                practiseGame(gameId);
              }}
            >
              <IconPlay />  {t("Fehler üben")}
            </button>
          ) : (
            <button class="btn primary" onClick={onClose}>
              
              {t("Fertig")}
            </button>
          )}
        </>
      }
    >
      <div class="stage-panel rs-take">
        {review.lessons.length > 1 && (
          <ol>
            {review.lessons.slice(1).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ol>
        )}
        <ul class="fd-list">
          {review.negatives.slice(0, 2).map((tk) => (
            <li class="fd-item neg" key={tk}>
              <span class="fd-mark" aria-hidden="true" />
              <div>{tk}</div>
            </li>
          ))}
          {review.positives.slice(1, 3).map((tk) => (
            <li class="fd-item pos" key={tk}>
              <span class="fd-mark" aria-hidden="true" />
              <div>{tk}</div>
            </li>
          ))}
        </ul>
      </div>
    </Stage>
  );
}
