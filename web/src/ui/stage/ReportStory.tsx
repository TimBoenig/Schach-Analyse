// Lucena tells one game in full screen: the grade and what it rests on, the
// course with its turning point, the best and the most expensive moment on
// the board, the three phases, and what to take away. Opened from the report
// beside the board, and once by itself the first time a report is opened.
import { useEffect, useMemo, useState } from "preact/hooks";

import { getUserColor } from "../../domain/metrics";
import { explainStored } from "../../domain/explainStored";
import { buildGameReview, type GameReview, type KeyMoment, openingParts, ownStanding, parseGrade, reportMoments, sameSpeedAccuracies, type Standing, winCurve } from "../../domain/profile";
import { costlyMoments, endingText, type OpeningStory, openingStory } from "../../domain/profile/gameStory";
import type { GameAnalysis, MoveData, StoredGame } from "../../domain/types";
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
import { t, tj, dec, tStored } from "../../i18n";

const de = (v: number, digits = 1) => v.toFixed(digits).replace(".", dec());
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

/** What a move's explanation says about it, for a game move of the player's own; empty for the opponent's. */
function reasonsFor(game: GameAnalysis, ply: number, byUser: boolean) {
  const m = game.moves[ply];
  if (!byUser || !m || !m.classification || m.classification === "Book") return { lines: [] as string[], arrows: [] as { from: string; to: string; by: "me" | "opp" }[], squares: [] as string[] };
  return explainStored(m, game.moves[ply + 1], game.moves[ply - 1]);
}

/** The position before a move, with the move played and, after an error, the better one and the ideas behind the reasons. */
function MomentBoard({ game, ply, isWhite, error, detail }: { game: GameAnalysis; ply: number; isWhite: boolean; error: boolean; detail?: ReturnType<typeof reasonsFor> }) {
  const m: MoveData | undefined = game.moves[ply];
  if (!m) return null;
  const arrows: Arrow[] = [{ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), kind: error ? "wrong" : "best" }];
  if (error && m.best_move && m.best_move !== m.uci) arrows.push({ from: m.best_move.slice(0, 2), to: m.best_move.slice(2, 4), kind: "best" });
  // The idea behind the sentences (the refutation, the fork, the stopped threat), as on the analysis board.
  for (const a of detail?.arrows ?? []) {
    if (!arrows.some((x) => x.from === a.from && x.to === a.to)) arrows.push({ from: a.from, to: a.to, kind: a.by === "opp" ? "threat" : "hint" });
  }
  const circles = (detail?.squares ?? []).map((at) => ({ at, kind: "user" as const }));
  return (
    <div class="rs-board">
      <Board fen={m.fen_before} flipped={!isWhite} arrows={arrows} circles={circles} />
      <div class="rs-board-key">
        <span>
          <i class={error ? "wrong" : "best"} /> {" "}{t("gespielt")}
        </span>
        {error && arrows.some((a) => a.kind === "best") && (
          <span>
            <i class="best" /> {" "}{t("besser")}
          </span>
        )}
        {arrows.some((a) => a.kind === "hint") && (
          <span>
            <i class="hint" /> {" "}{t("Idee")}
          </span>
        )}
        {arrows.some((a) => a.kind === "threat") && (
          <span>
            <i class="threat" /> {" "}{t("Drohung des Gegners")}
          </span>
        )}
      </div>
    </div>
  );
}

/** The sentences that say why, one under the other. */
function Reasons({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <ul class="rs-reasons">
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}

/** The opening in one paragraph: how long theory lasted and who left it, with the way on. */
function OpeningText({ o, isWhite }: { o: OpeningStory; isWhite: boolean }) {
  void isWhite;
  const ex = o.yourExit;
  const bad = ex && ["Inaccuracy", "Mistake", "Miss", "Blunder"].includes(ex.classification);
  return (
    <>
      <p>
        {o.leftBy === "you" ? t("Bei {label} hast du die bekannte Theorie verlassen.", { label: o.exitLabel }) : t("Bei {label} hat dein Gegner die bekannte Theorie verlassen.", { label: o.exitLabel })}
        {ex && (bad ? ` ${t("Der Zug war {cls}.", { cls: classLabel(ex.classification as never) })}${ex.best_move_san ? ` ${t("Besser war {best_move_san}.", { best_move_san: ex.best_move_san })}` : ""}` : ` ${t("Das war in Ordnung: {cls}.", { cls: classLabel(ex.classification as never) })}`)}
      </p>
      {o.known.length > 0 && <p>{t("Die Theorie kannte hier: {moves}.", { moves: o.known.slice(0, 4).join(", ") })}</p>}
    </>
  );
}

/** The turning point in one sentence: who moved, and whether it won or lost the game. */
function turnSentence(tp: KeyMoment, lost: boolean): string {
  if (lost) return tp.by_user ? t("Bei {move_label} ist die Partie gekippt.", { move_label: tp.move_label }) : t("Mit {move_label} hat dein Gegner die Partie an sich gerissen.", { move_label: tp.move_label });
  return tp.by_user ? t("Mit {move_label} hast du die Partie entschieden.", { move_label: tp.move_label }) : t("Bei {move_label} hat dein Gegner die Partie aus der Hand gegeben.", { move_label: tp.move_label });
}

type StepKey = "grade" | "opening" | "course" | "turn" | "best" | `error:${number}` | "phases" | "take";

export function ReportStory({ gameId, onClose }: { gameId: string; onClose: () => void }) {
  const data = useReport(gameId);
  const [index, setIndex] = useState(0);
  // Costly moves in game order, the opening's course, and a turning point that no other step already shows.
  const story = useMemo(() => {
    if (!data || data === "missing") return null;
    const { review, game, isWhite } = data;
    const { best } = reportMoments(review);
    const errors = costlyMoments(review);
    const tp = review.turning_point;
    const shown = tp && tp !== best && !errors.includes(tp) ? tp : null;
    return { errors, best, turn: shown, opening: openingStory(game.moves, isWhite, Boolean(game.metadata.chess960)) };
  }, [data]);
  const steps = useMemo((): StepKey[] => {
    if (!data || data === "missing" || !story) return [];
    return [
      "grade",
      ...(story.opening ? (["opening"] as const) : []),
      "course",
      ...(story.turn ? (["turn"] as const) : []),
      ...(story.best ? (["best"] as const) : []),
      ...story.errors.map((_, i): StepKey => `error:${i}`),
      ...(data.review.phases.some((p) => p.accuracy !== null) ? (["phases"] as const) : []),
      "take",
    ];
  }, [data, story]);

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
  const ending = endingText(game.metadata);
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
            
            {tj("Deine Note ist eine {text}{n}. Sie folgt aus deiner Genauigkeit: wie nah deine Züge an denen der Engine lagen.", { text: <strong>{grade.text}</strong>, n: grade.word ? ` (${grade.word})` : "" })}
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
            
            {t("Die Linie ist deine Gewinnchance nach jedem Zug. Über der Mitte stehst du besser, darunter dein Gegner.{n}", { n: tp ? t(" Am Wendepunkt ging sie von {pct} auf {pct2}.", { pct: pct(tp.wp_before), pct2: pct(tp.wp_after) }) : "" })}
            {ending ? ` ${t("Die Partie endete so: {ending}.", { ending: tStored(ending) })}` : ""}
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

  if (step === "opening" && story?.opening) {
    const o = story.opening;
    const parts = o.name ? openingParts(o.name) : null;
    const slip = o.yourExit && ["Inaccuracy", "Mistake", "Miss", "Blunder"].includes(o.yourExit.classification);
    return (
      <Stage
        {...frame}
        mood={slip ? "think" : "happy"}
        layout="split"
        say={parts ? t("Die Eröffnung: {name}.", { name: parts.main }) : t("So ging die Eröffnung.")}
        sub={
          <>
            {parts?.variation && <p>{parts.variation}</p>}
            <OpeningText o={o} isWhite={isWhite} />
          </>
        }
      >
        <MomentBoard game={game} ply={o.exitPly} isWhite={isWhite} error={Boolean(slip)} />
      </Stage>
    );
  }

  if (step === "turn" && story?.turn) {
    const tp = story.turn;
    const lost = outcome === "Niederlage";
    return (
      <Stage {...frame} mood={lost ? "sad" : "wow"} layout="split" say={turnSentence(tp, lost)} sub={<p>{tp.text}</p>}>
        <MomentBoard game={game} ply={tp.ply_index} isWhite={isWhite} error={tp.by_user ? tp.wp_after < tp.wp_before : false} />
      </Stage>
    );
  }

  if (step === "best" && best) {
    const detail = reasonsFor(game, best.ply_index, true);
    return (
      <Stage
        {...frame}
        mood="wow"
        layout="split"
        say={t("Dein stärkster Moment: {move_label}.", { move_label: best.move_label })}
        sub={
          <>
            <p>
              {classLabel(best.classification as never)}.{!detail.lines.length && <> {best.text}</>}
            </p>
            <Reasons lines={detail.lines} />
          </>
        }
      >
        <MomentBoard game={game} ply={best.ply_index} isWhite={isWhite} error={false} detail={detail} />
      </Stage>
    );
  }

  const errorAt = step.startsWith("error:") ? Number(step.slice(6)) : -1;
  const costly = errorAt >= 0 ? story?.errors[errorAt] : undefined;
  if (costly && story) {
    const detail = reasonsFor(game, costly.ply_index, true);
    const n = story.errors.length;
    const priciest = costly === worst;
    // The reasons already name the better move; without them the stored one is all there is to say.
    const better = !detail.lines.length && costly.best_move_san ? tj("Besser war {best_move_san}.", { best_move_san: <strong>{costly.best_move_san}</strong> }) : null;
    return (
      <Stage
        {...frame}
        mood="sad"
        layout="split"
        say={n === 1 || priciest ? t("Am teuersten war {move_label}.", { move_label: costly.move_label }) : t("Ein weiterer Fehler: {move_label}.", { move_label: costly.move_label })}
        sub={
          <>
            <p>
              {classLabel(costly.classification as never)}.
              {/* The reasons below say what went wrong; the percentages only when the engine line gives none. */}
              {!detail.lines.length && <> {tj("Deine Gewinnchance fiel von {x} auf {x2}.", { x: <strong>{pct(costly.wp_before)}</strong>, x2: <strong>{pct(costly.wp_after)}</strong> })}</>}
              {better && <> {better}</>}
            </p>
            <Reasons lines={detail.lines} />
            {n > 1 && <p class="rs-count">{t("Fehler {i} von {n}", { i: errorAt + 1, n })}</p>}
          </>
        }
      >
        <MomentBoard game={game} ply={costly.ply_index} isWhite={isWhite} error detail={detail} />
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
