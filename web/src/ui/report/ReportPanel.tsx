// The report of one game beside the board: the grade with what it rests on,
// the game as one line of winning chance, the moments that decided it, the
// three phases and what to take away. Lucena tells the same story in full
// screen from the button on top.
import type { ComponentChildren } from "preact";

import { trSpeed } from "../../domain/i18n";
import { type GameReview, parseGrade, reportMoments, type Standing, winCurve } from "../../domain/profile";
import type { MoveData } from "../../domain/types";
import { COACH_NAME, CoachAvatar } from "../Coach";
import { IconChevron, IconPlay } from "../icons";
import { badgeFor, CLASS_COLOR, classLabel } from "../labels";
import { navigate } from "../router";
import { openStage } from "../stage/store";
import { Level } from "../viz/Bars";
import { WinChart } from "./WinChart";
import { t, tj, dec } from "../../i18n";

const de = (v: number, digits = 1) => v.toFixed(digits).replace(".", dec());
const pct = (wp: number) => `${Math.round(wp * 100)} %`;

/** School grades in the app's signal colours: 1–2 good, 2,5–3,5 neutral, 4 a warning, 5–6 bad. */
export function gradeTone(value: number | null): string {
  if (value === null) return "quiet";
  if (value <= 2) return "good";
  if (value <= 3.5) return "mid";
  if (value <= 4.5) return "warn";
  return "bad";
}

/** Errors of the player that can become exercises: the button to practise them only shows when there are some. */
export function ownErrors(review: GameReview): number {
  return (review.move_counts.Mistake ?? 0) + (review.move_counts.Blunder ?? 0) + (review.move_counts.Miss ?? 0);
}

export function practiseGame(gameId: string): void {
  navigate({ view: "training", tab: "uebungen", category: `partie-${gameId}` });
}

export function GradeBadge({ grade, size = "big" }: { grade: string; size?: "small" | "big" | "huge" }) {
  const g = parseGrade(grade);
  return (
    <div class={`rp-grade ${size} tone-${gradeTone(g.value)}`} aria-label={t("Note {text} {word}", { text: g.text, word: g.word })}>
      <span class="rp-grade-label">{t("Note")}</span>
      <strong class="tnum">{g.text}</strong>
      <span class="rp-grade-word">{g.word}</span>
    </div>
  );
}

export function StandingLine({ standing, speed }: { standing: Standing | null; speed: string | null }) {
  if (!standing) return null;
  const kind = speed ? `${trSpeed(speed)}partien` : t("Partien");
  return (
    <p class="rp-standing">
      
      {tj("Genauer als {x} deiner {games} anderen {kind} {x2}", { x: <strong class="tnum">{Math.round(standing.better_than)} %</strong>, games: standing.games, kind, x2: <span class="faint tnum">{t("(dein Schnitt {n} %)", { n: de(standing.average) })}</span> })}
    </p>
  );
}

export function PhaseRows({ review }: { review: GameReview }) {
  return (
    <div class="rp-phases">
      {review.phases.map((p) => (
        <div key={p.phase} class={`rp-phase${p.accuracy === null ? " empty" : ""}`}>
          <span class="rp-phase-name">
            <strong>{p.name}</strong>
            <small class="tnum">{p.moves ? t("{moves} Züge{1}", { moves: p.moves, 1: p.errors ? (p.errors === 1 ? t(" · 1 grober Fehler") : t(" · {errors} grobe Fehler", { errors: p.errors })) : "" }) : "–"}</small>
          </span>
          <Level value={p.accuracy} tone={p.errors >= 2 ? "bad" : p.accuracy !== null && p.accuracy >= 85 && !p.errors ? "good" : "accent"} />
          <b class="tnum">{p.accuracy !== null ? `${de(p.accuracy, 0)} %` : "–"}</b>
          <span class={`rp-phase-grade tone-${gradeTone(parseGrade(p.grade).value)}`}>{parseGrade(p.grade).text}</span>
          <p class="rp-phase-note">{p.comment}</p>
        </div>
      ))}
    </div>
  );
}

export function MomentRow({ k, onPick, active }: { k: GameReview["key_moments"][number]; onPick?: () => void; active?: boolean }) {
  const badge = badgeFor(k.classification as never);
  const up = k.wp_after >= k.wp_before;
  const body = (
    <>
      <span class="rp-m-badge">{badge ? <img src={badge} alt={classLabel(k.classification as never)} /> : <i style={{ background: CLASS_COLOR[k.classification] ?? "var(--text-3)" }} />}</span>
      <span class="rp-m-text">
        <strong>{k.title.includes(k.move_label) ? k.title : `${k.move_label} ${k.title}`}</strong>
        <small>{k.text}</small>
      </span>
      <span class={`rp-m-swing ${up ? "up" : "down"}`} title={t("Deine Gewinnchance vor und nach dem Zug")}>
        <span class="tnum">{pct(k.wp_before)}</span>
        <IconChevron />
        <b class="tnum">{pct(k.wp_after)}</b>
      </span>
    </>
  );
  return onPick ? (
    <button class={`rp-moment${k.by_user ? " own" : ""}${active ? " on" : ""}`} onClick={onPick}>
      {body}
    </button>
  ) : (
    <div class={`rp-moment${k.by_user ? " own" : ""}`}>{body}</div>
  );
}

export function ReportPanel({
  gameId,
  review,
  moves,
  isWhite,
  names,
  speed,
  standing,
  idx,
  onJump,
  details,
}: {
  gameId: string;
  review: GameReview;
  moves: MoveData[];
  isWhite: boolean;
  names: { me: string; opp: string };
  speed: string | null;
  standing: Standing | null;
  /** The half move on the board. */
  idx: number;
  onJump: (stop: number) => void;
  /** Move counts per kind and the shine moves, drawn by the analysis page. */
  details?: ComponentChildren;
}) {
  const { best, worst } = reportMoments(review);
  const errors = ownErrors(review);
  const turning = review.turning_point;
  return (
    <div class="rp">
      <section class="card rp-hero">
        <div class="rp-hero-top">
          <GradeBadge grade={review.grade} />
          <div class="rp-hero-text">
            <span class="eyebrow">{review.result_text}</span>
            <h3>{review.headline}</h3>
            <StandingLine standing={standing} speed={speed} />
          </div>
        </div>
        <div class="rp-duel">
          <div class="rp-duel-row me">
            <span>{names.me}</span>
            <Level value={review.accuracy || null} tone="accent" />
            <b class="tnum">{review.accuracy ? `${de(review.accuracy)} %` : "–"}</b>
          </div>
          <div class="rp-duel-row">
            <span>{names.opp}</span>
            <Level value={review.opponent_accuracy || null} tone="quiet" />
            <b class="tnum">{review.opponent_accuracy ? `${de(review.opponent_accuracy)} %` : "–"}</b>
          </div>
          <small class="faint">{t("Genauigkeit: wie nah die Züge an denen der Engine lagen. Die Note folgt allein aus deiner.")}</small>
        </div>
        <div class="rp-actions">
          <button class="btn primary rp-story" onClick={() => openStage({ kind: "report", subject: gameId })}>
            <CoachAvatar mood="happy" size={22} />
            {t("{COACH_NAME} erklärt die Partie", { COACH_NAME })}
          </button>
          {errors > 0 && (
            <button class="btn" onClick={() => practiseGame(gameId)}>
              <IconPlay />  {t("Fehler üben")}
            </button>
          )}
        </div>
      </section>

      <section class="card rp-course">
        <header class="card-head">
          <div>
            <h3>{t("Verlauf")}</h3>
            <p class="card-sub">{t("Deine Gewinnchance nach jedem Zug. Tippe, um zur Stelle zu springen.")}</p>
          </div>
        </header>
        <WinChart points={winCurve(moves, isWhite)} plies={moves.length} moments={review.key_moments} turning={turning} cursor={idx} onPick={onJump} />
        {turning && (
          <button class="rp-turn" onClick={() => onJump(turning.ply_index + 1)}>
            <span class="rp-turn-tag">{t("Wendepunkt")}</span>
            <span>
              {tj("{move_label} · {n} auf {n2}", { move_label: <strong>{turning.move_label}</strong>, n: pct(turning.wp_before), n2: pct(turning.wp_after) })}
            </span>
            <IconChevron />
          </button>
        )}
      </section>

      {(best || worst) && (
        <section class="card rp-pair">
          {best && (
            <button class="rp-pair-cell good" onClick={() => onJump(best.ply_index + 1)}>
              <span class="eyebrow">{t("Dein bester Moment")}</span>
              <strong>{best.move_label}</strong>
              <small>
                {t("{classLabel} · {n} auf {n2}", { classLabel: classLabel(best.classification as never), n: pct(best.wp_before), n2: pct(best.wp_after) })}
              </small>
            </button>
          )}
          {worst && (
            <button class="rp-pair-cell bad" onClick={() => onJump(worst.ply_index + 1)}>
              <span class="eyebrow">{t("Am teuersten")}</span>
              <strong>{worst.move_label}</strong>
              <small>
                {t("{classLabel}{n}", { classLabel: classLabel(worst.classification as never), n: worst.best_move_san ? t(" · besser {best_move_san}", { best_move_san: worst.best_move_san }) : "" })}
              </small>
            </button>
          )}
        </section>
      )}

      {review.key_moments.length > 0 && (
        <section class="card rp-moments">
          <header class="card-head">
            <div>
              <h3>{t("Schlüsselmomente")}</h3>
              <p class="card-sub">{t("Die Züge, die die Partie am stärksten bewegt haben.")}</p>
            </div>
          </header>
          {review.key_moments.map((k) => (
            <MomentRow key={k.ply_index} k={k} active={idx === k.ply_index + 1} onPick={() => onJump(k.ply_index + 1)} />
          ))}
        </section>
      )}

      {review.phases.length > 0 && (
        <section class="card">
          <header class="card-head">
            <div>
              <h3>{t("Partiephasen")}</h3>
              <p class="card-sub">{t("Genauigkeit und Note je Phase.")}</p>
            </div>
          </header>
          <PhaseRows review={review} />
        </section>
      )}

      {details && <section class="card rp-details">{details}</section>}

      <section class="card rp-sum">
        <header class="card-head">
          <div>
            <h3>{t("Fazit")}</h3>
          </div>
        </header>
        <div class="fd-cols rp-cols">
          <ul class="fd-list">
            {review.positives.map((tk) => (
              <li class="fd-item pos" key={tk}>
                <span class="fd-mark" aria-hidden="true" />
                <div>{tk}</div>
              </li>
            ))}
          </ul>
          <ul class="fd-list">
            {review.negatives.map((tk) => (
              <li class="fd-item neg" key={tk}>
                <span class="fd-mark" aria-hidden="true" />
                <div>{tk}</div>
              </li>
            ))}
          </ul>
        </div>
        {review.lessons.length > 0 && (
          <div class="rp-lessons">
            <span class="eyebrow">{t("Was du mitnehmen kannst")}</span>
            <ol>
              {review.lessons.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ol>
          </div>
        )}
        {errors > 0 && (
          <button class="btn small rp-train" onClick={() => practiseGame(gameId)}>
            <IconPlay />  {t("Die Fehler dieser Partie als Übung")}
          </button>
        )}
      </section>
    </div>
  );
}
